// coordinate.mjs — the plain foreground command that runs a reviewed plan in parallel (DESIGN §2.1–§2.9,
// §3.2 loop.mjs). There is no coordinator session and no `pir-coordinate` skill any more (DESIGN §2.1,
// T03): this is a program with a stable process, a real Ctrl-C, and its whole state on disk in git. It
// wires the reviewed loop (loop.mjs) to the REAL platform (spawn/list/close + the reports up-channel)
// and the REAL worktree (feature/task branches), steps `runPass` once per iteration, and paints a live,
// in-place status display (src/core/display.mjs + src/shell/render.mjs, §2.3). loop.mjs already turns
// decideDispatch into spawns, reviews, merges and closes, and signals when the plan is complete (all ✅,
// tests run on the feature branch); this module adds the plan-reviewed refusal, the end-of-run hand-off
// (§2.4), the live display, and the `node src/shell/coordinate.mjs {slug}` bin.
//
// The controller is injected with its platform and worktree, exactly as runPass is, so the whole of
// dispatch is proven against the fakes in coordinate.test.mjs (DESIGN §4) and the same code runs the
// live CLI + git in the bin below.
//
// There is no down-channel (DESIGN §2.2, T03). The coordinator used to relay a worker's question up to
// the person and the answer back down; the person now finds the asking worker in their own `claude
// agents` view, attaches, and answers there — nothing is routed. Only the UP-channel remains: a worker
// drops a one-line report into the control folder's `reports/` drop-dir (createReportInbox below), which
// a Node process reads directly — no agent needed. The program uses that signal for two things only: to
// keep a parked worker's slot under the ceiling, and to show its question in the live display so the
// person can see who is asking. In the tests the fake platform IS the bus, so the report inbox is not
// exercised there — its live behaviour is hand-verified (T09).

import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, unlinkSync, watch, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { parseProgress, reconcileTaskRow, progressPathFor } from '../core/progress.mjs';
import { workerName, isWorkerOf } from '../core/naming.mjs';
import { buildDisplay } from '../core/display.mjs';
import { parseRecord } from '../core/runrecord.mjs';
import { testCommandFrom } from '../core/testcommand.mjs';
import { runPass, createRunState } from './loop.mjs';
import { createPlatform } from './platform.mjs';
import { createRenderer } from './render.mjs';
import { writeSnapshot } from './snapshot-store.mjs';
import { createWorktree } from './worktree.mjs';

const DONE_GLYPH = '✅';
const READY_GLYPH = '⬜';
const BLOCKED_GLYPH = '⛔';

// --- The plan-reviewed gate (DESIGN §2.1) -----------------------------------------------------
//
// The coordinator refuses to start on a plan whose PROGRESS.md has not been reviewed, exactly as
// pir-work does: an unreviewed plan copies its defects into every task, and running many at once
// multiplies that. This reads the file (so it is shell, not core) and delegates the actual verdict to
// the pure parseProgress gate, which is conservative — anything short of a positive "reviewed" note
// (missing line, empty note, "not yet …") reads as not reviewed.
export function readReviewGate(slug, { root = process.cwd() } = {}) {
  const path = join(root, progressPathFor(slug));
  if (!existsSync(path)) {
    return { reviewed: false, note: '', missing: true };
  }
  const { planReviewed } = parseProgress(readFileSync(path, 'utf8'));
  return { reviewed: planReviewed.reviewed, note: planReviewed.note, missing: false };
}

// --- Plain-English surfacing (DESIGN §2.2, §2.3) ----------------------------------------------
//
// The loop emits `surface` actions — a worker's question, an unresolved merge conflict, a red feature
// branch. renderSurface turns one action into a plain-English message. It is what the live display and
// the audit log show so the person can read who is asking and why (DESIGN §2.2: the program shows the
// question, the person answers that worker directly). Nothing is relayed; this is display text, not a
// route.
function renderSurface(a) {
  const who = a.task ? `The worker on ${a.task}` : 'The coordinator';
  let message;
  switch (a.kind) {
    case 'question':
    case 'decision':
      // A worker sends `question` (something unspecified) or `decision` (a genuine choice); both are
      // the user's to answer and read the same in plain English (DESIGN §2.5, pir-worker skill).
      message = `${who} needs a decision from you: ${a.text}`;
      break;
    case 'conflict':
      message = `${who} hit a merge conflict it could not resolve on its own: ${a.text}. It is waiting for you.`;
      break;
    // (a.prompt, when the surface is a coordinator-side conflict, rides through below — T14.)
    case 'red-feature':
      message =
        'Every task is built, but the tests fail on the assembled feature branch, so it is NOT ready to ' +
        'merge. The failure needs fixing before you merge the branch by hand.' +
        (a.text ? ` (${a.text})` : '');
      break;
    default:
      message = `${who}: ${a.text ?? a.kind}`;
  }
  // prompt is the copy-paste conflict-resolution block (T14, buildConflictPrompt), present only on a
  // coordinator-side merge conflict; null otherwise. The live bin prints it once on the normal screen so
  // the person can select and copy it (the compact live frame does not carry it — T15, §2.3).
  return { task: a.task ?? null, kind: a.kind, text: a.text ?? '', prompt: a.prompt ?? null, message };
}

// The ready-but-unstarted tasks whose dependencies are all ✅ and which no worker holds — the tasks
// that would run now if a slot were free. Used to tell "the ceiling is full, work is waiting" from
// "there is simply nothing more to do". assignedNums is the set of tasks the coordinator is already
// tracking a worker for (state.tasks), which after a pass includes anything just spawned.
function readyWaiting(tasks, assignedNums) {
  const doneNums = new Set(tasks.filter((t) => t.state === DONE_GLYPH).map((t) => t.num));
  return tasks
    .filter((t) => t.state === READY_GLYPH)
    .filter((t) => !assignedNums.has(t.num))
    .filter((t) => t.deps.every((d) => doneNums.has(d)))
    .map((t) => t.num);
}

// startCoordinator({ slug, repo, platform, worktree, maxWorkers, control, runTests }) → the controller
// the skill drives. `platform` and `worktree` are injected (the fakes in tests, the real CLI+git in
// the bin); `repo` is the repo name the worker/coordinator names are built from (DESIGN §2.8); control
// and runTests default the same way runPass defaults them (never halted, tests green).
export function startCoordinator({
  slug,
  repo,
  platform,
  worktree,
  maxWorkers = 4,
  control,
  runTests,
} = {}) {
  if (!slug) throw new Error('startCoordinator: no slug');
  if (!repo) throw new Error('startCoordinator: no repo (worker names are built from it, DESIGN §2.8)');
  if (!platform || !worktree) throw new Error('startCoordinator: platform and worktree must be injected');

  const state = createRunState();
  const passOpts = { platform, worktree, repo, slug, maxWorkers, state };
  if (control) passOpts.control = control;
  if (runTests) passOpts.runTests = runTests;

  // The account of what one pass did, in the shape the skill acts on. It re-expresses the loop's raw
  // actions as the things the skill has to do something about: surface a decision, report a task
  // reaching ✅, and know when the run is done or blocked. There is no auto/you distinction any more,
  // so nothing is a hands-on worker the user must go drive (§2.5) — a task that needs the person is an
  // ordinary worker that parks and asks, which surfaces like any other question.
  function pass() {
    const r = runPass(passOpts);
    const of = (type) => r.actions.filter((a) => a.type === type);

    const surfaces = of('surface').map(renderSurface);
    const spawned = of('spawn').map((a) => ({ task: a.task, role: a.role, slug: a.slug }));
    const reviewing = of('review').map((a) => ({ task: a.task }));
    // A merge this pass is a task reaching ✅ on the feature branch (DESIGN §2.9) — what the skill
    // reports to the user as progress.
    const completed = of('merge').map((a) => a.task);
    // The restart reconciliation's one-line plain-English summary (DESIGN §2.8), emitted only on the
    // first pass of a run that actually adopted work from git; a genuine first start records none, so
    // this is null. The skill relays it so the user knows the run resumed rather than started over.
    const restart = of('restart-summary')[0];
    const restartSummary = restart ? restart.text : null;
    const closed = of('close').map((a) => ({ task: a.task ?? null, reason: a.reason ?? 'closed' }));

    // Ceiling accounting (DESIGN §2.4): if the plan has ready work it could not start because every
    // slot is taken, that is logged and reported, so a slow run reads as "throttled at the ceiling",
    // not "stuck". A task simply waits for a slot; nothing is dropped.
    const assigned = new Set(Object.keys(state.tasks));
    const waiting = readyWaiting(r.tasks, assigned);
    const ceilingFull = !r.halted && r.liveAfter >= maxWorkers && waiting.length > 0;
    if (ceilingFull && control) {
      control.log(`ceiling full: ${r.liveAfter}/${maxWorkers} busy, waiting: ${waiting.join(', ')}`);
    }

    return {
      actions: r.actions,
      surfaces,
      spawned,
      reviewing,
      completed,
      restartSummary,
      closed,
      ceilingFull,
      waiting,
      live: r.liveAfter,
      halted: r.halted,
      // The plan is done — all ✅, none live, tests run on the feature branch (loop.mjs 3f). readyToMerge
      // is set on green, null on red; testsPassed carries the verdict. There is no promotion (§2.4): the
      // shell hands the person the branch to merge by hand. `done` is just `complete`, kept as the name
      // drive()/the bin loop stop on.
      complete: r.complete,
      readyToMerge: r.readyToMerge ?? null,
      testsPassed: r.testsPassed,
      // The red gate's { reason, logPath }, null on green or before completion (DESIGN §2.8).
      testsReason: r.testsReason ?? null,
      done: r.complete,
      tasks: r.tasks,
    };
  }

  // There is no answer() any more (DESIGN §2.2, T03). The coordinator used to route the person's
  // decision down to a parked worker; the person now answers that worker directly in its own session and
  // the worker un-parks itself, so the program routes nothing and never sees the answer. A parked
  // worker's slot is held (loop.mjs keeps it AWAITING and live) and its question is shown in the display.

  // defer({ task }) → the user has decided not to answer this task's question for now (DESIGN §2.5,
  // §2.6). Its row is marked ⛔ on the feature branch so the state survives a restart and its dependents
  // wait, and its parked worker is closed to free the slot. reconcileTaskRow touches only that row, so
  // the coordinator stays PROGRESS.md's single writer. Requires the feature branch to be open (a pass
  // has run), because that is where PROGRESS.md the coordinator owns lives.
  function defer({ task, note = 'deferred by the user' }) {
    if (!task) throw new Error('defer: no task');
    if (!state.feature) throw new Error('defer: no feature branch open yet (run a pass first)');
    const progressPath = join(state.feature.path, progressPathFor(slug));
    const updated = reconcileTaskRow(readFileSync(progressPath, 'utf8'), {
      num: task,
      state: BLOCKED_GLYPH,
      notes: note,
    });
    writeFileSync(progressPath, updated);
    worktree.commitFeature(`defer ${task} → ⛔`);

    // Free the slot: the parked worker has nothing more to do. close is session-only; remove takes the
    // worktree and branch down (DESIGN §2.3).
    const t = state.tasks[task];
    if (t) {
      if (t.workerId) platform.close(t.workerId);
      if (t.worktree) worktree.remove(t.worktree);
      delete state.tasks[task];
    }
    return { ok: true, task };
  }

  // drive({ maxPasses, onPass }) → run passes until the plan is complete (all ✅, tests run on the
  // feature branch), the kill switch has closed everything, or the run goes quiet (every remaining
  // worker parked on the person, or nothing left to do). It mirrors loop.drain's stop conditions but runs
  // through pass(), so onPass sees each pass's surfaces and completions — which is how the dry-run tests
  // and harness step it. The live bin (main) steps pass() itself so it can paint between passes. On
  // completion it carries the hand-off result out.
  function drive({ maxPasses = 200, onPass } = {}) {
    let idle = 0;
    for (let p = 1; p <= maxPasses; p++) {
      const r = pass();
      if (onPass) onPass(r, p);
      if (r.complete)
        return { reason: 'complete', passes: p, complete: true, readyToMerge: r.readyToMerge, testsPassed: r.testsPassed, testsReason: r.testsReason };
      if (r.halted) return { reason: 'halted', passes: p, complete: false };
      const productive = r.actions.some((a) => ['spawn', 'review', 'merge', 'close'].includes(a.type));
      idle = productive ? 0 : idle + 1;
      if (idle >= 2) {
        return { reason: r.live > 0 ? 'parked' : 'stalled', passes: p, complete: false };
      }
    }
    return { reason: 'maxPasses', passes: maxPasses, complete: false };
  }

  return { state, pass, defer, drive };
}

// --- The worker up-channel: the reports drop-dir the bin drains directly (DESIGN §2.2, §3.5) --
//
// A worker reports UP by dropping one JSON file per report into `reports/` — `{ from, text }`, `text`
// being its `[pir:v1 …]` message — and the bin reads and removes each. No agent turn: a Node process
// reads a plain file drop directly. There is no DOWN-channel any more (DESIGN §2.2, T03): the person
// replies to a blocked worker directly in its own session, so the bin routes nothing and the down-channel
// feeds are gone with the relay. A worker writes temp-then-rename so the bin never
// reads a half-written file; a file that still will not parse is dropped, not guessed. The transport
// this returns is exactly what platform.mjs's createMessaging binds inbox() to (createPlatform). The
// unit tests use the fake platform (its own bus, no drop-dir); the live drop-dir is hand-verified (T09).
export function createReportInbox({ dir } = {}) {
  mkdirSync(dir, { recursive: true });
  const reportsDir = join(dir, 'reports');
  mkdirSync(reportsDir, { recursive: true });

  // Drain the reports drop-dir: each *.json file is one worker report, read exactly once and removed.
  // Files are processed in name order (workers name them with a leading timestamp, so reports are
  // ingested roughly in the order they were sent). A file that does not parse is unlinked and dropped —
  // never re-read, never guessed into a message — the drop-dir analogue of a malformed inbox line.
  const drainReports = () => {
    let names;
    try {
      names = readdirSync(reportsDir).filter((n) => n.endsWith('.json')).sort();
    } catch {
      return [];
    }
    const out = [];
    for (const n of names) {
      const p = join(reportsDir, n);
      let raw;
      try {
        raw = readFileSync(p, 'utf8');
      } catch {
        continue; // vanished under us (a concurrent drain); skip
      }
      try {
        unlinkSync(p); // consume it, so a report is ingested exactly once
      } catch {
        /* already gone */
      }
      try {
        const { from = null, text = '' } = JSON.parse(raw);
        out.push({ from, text });
      } catch {
        /* a torn or malformed report — dropped, not guessed into a wrong message */
      }
    }
    return out;
  };

  return {
    reportsDir,
    // The transport platform.mjs's createMessaging binds inbox() to: drain the reports workers dropped
    // up. There is no `deliver` — the down-channel is gone (DESIGN §2.2).
    transport: {
      drain() {
        return drainReports();
      },
    },
  };
}

// --- Tearing down a run's workers, so no exit path orphans one (DESIGN §2.3, §2.4; T12 P6) ----
//
// The drill's bin ran out its pass budget and printed "ran out of passes" while a worker was still
// live and parked, leaving a paid session orphaned that had to be stopped by hand. So EVERY exit path
// that is not a clean promotion/halt (a safety cap, a stall, a signal, an error) must close this run's
// live workers. `platform.close` is stop + SIGTERM — `claude stop` alone only interrupts (FINDINGS
// 2026-09-09), so this is what actually ends the session. Closing an already-gone id is a safe no-op.
//
// It closes sessions ONLY and never removes a task worktree or branch, on any exit. Those branches are
// the durable record of in-flight work, and the next `pir {slug}` reconciles them from git: a 🔍 branch
// goes to review, a half-built one is resumed. Removing them on exit is what made a restart rebuild
// everything: on 2026-09-22 a full disk (ENOSPC) threw, the `error` teardown deleted a built T04, a
// built T06 and a half-built T07 in real-screen-time, and the next start implemented all three again.
// A run nobody restarts leaves its branches behind; docs/restart-recovery.md § Manual recovery covers
// removing them by hand.
export function teardownRun({ platform, state, repo, slug, control } = {}) {
  const closed = new Set();
  const closeId = (id, name) => {
    if (!id || closed.has(id)) return;
    try {
      platform.close(id);
    } catch {
      /* already gone */
    }
    // Clear the leftover `stopped` record too (T41, DESIGN §2.3). teardownRun runs on every exit that is
    // not a clean promotion or a kill-switch halt (a stall, a safety cap, a signal, an error) — none of
    // them the HALT forensics case, which the loop handles and never reaches here — so these workers have
    // finished and leave the view. Best-effort and optional: a platform without `remove` is fine.
    try {
      platform.remove?.(id);
    } catch {
      /* best-effort record cleanup; the session close is what matters for orphan-avoidance */
    }
    closed.add(id);
    control?.log?.(`teardown: closed ${name ?? ''} (${id})`.trim());
  };

  // Every worker of THIS run the platform still lists — the authoritative live sessions.
  let live = [];
  try {
    live = platform.list().filter((w) => isWorkerOf(w.name, { repo, plan: slug }));
  } catch {
    live = [];
  }
  for (const w of live) closeId(w.id, w.name);
  // Plus any worker this run spawned that we still track — covers the appear-grace window in which a
  // just-spawned session is not listed yet, so a spawn is never left behind on an early exit.
  for (const [num, t] of Object.entries(state?.tasks ?? {})) {
    if (t.workerId) closeId(t.workerId, workerName({ repo, plan: slug, task: num, slug: t.slug, role: t.role ?? 'implement' }));
  }
  return { closed: [...closed] };
}

// --- Detached self-reporting: the snapshot each pass and the final status on exit (DESIGN §2.4, §2.6, §3.4, §3.5; T10) --
//
// When `pir` launches the coordinator detached (T08), nobody is attached to read the live display, so
// the coordinator writes its state to disk instead: a live snapshot each pass (fed to the dashboard,
// §2.4) and a final status on every exit path (§2.2, §2.6). This whole half is gated on the PIR_RUN
// marker the launcher sets (§3.5), so a foreground `pir-coordinate` run — which never sets it — writes
// no snapshot and touches no index entry, and the classic path is byte-for-byte unchanged.

// shouldSelfReport(env) → whether this run reports on itself. True only when PIR_RUN is set, which only
// the `pir` launcher (T08) does. The single gate the bin keys the whole self-reporting half on.
export function shouldSelfReport(env = process.env) {
  return !!env.PIR_RUN;
}

// finalStateForExit(reason) → the final status a given exit path records, or null for none (DESIGN §2.2,
// §7; T10 interface). Only a CLEAN end records a status: a completed hand-off (green OR red branch) and a
// stall ("nothing left to do") are `finished`; a stop is `stopped`. Every ABNORMAL exit — the HALT kill
// switch, the runaway breaker, the safety cap, an uncaught error — records NOTHING, so its snapshot and
// index entry both stay finalState:null and the front-end classifies the gone process crashed (red), not
// dim `finished`. A red feature branch is a clean exit: the run finished, the code is red (§2.2).
export function finalStateForExit(reason) {
  switch (reason) {
    case 'complete': // the plan is done and the feature-branch tests ran (green or red) — a clean end.
    case 'stall': // nothing left to dispatch or hand off — a clean end.
      return 'finished';
    case 'stop': // the user stopped the run (SIGTERM under PIR_RUN, §2.6).
      return 'stopped';
    // 'halt' | 'runaway' | 'safety-cap' | 'error' (and anything unrecognised): abnormal, record nothing.
    default:
      return null;
  }
}

// writeRunSnapshot({ controlDir, proc, runState }) → write the live snapshot for this pass (finalState
// null, i.e. still running). Thin over the store's atomic writeSnapshot (T07). `writeSnapshotFn` is
// injectable so a test asserts the shape without a real control folder path assumption.
export function writeRunSnapshot({ controlDir, proc, runState, writeSnapshotFn = writeSnapshot } = {}) {
  writeSnapshotFn(controlDir, { proc, finalState: null, runState });
}

// writeRunFinal({ controlDir, proc, runState, reason, writeSnapshotFn, updateIndex, log }) → record the
// run's final status on an exit path (DESIGN §2.2, §2.6; T10 interface). On a status-bearing exit
// (finished/stopped) it writes the snapshot with that finalState AND asks updateIndex to stamp the same
// status on the index entry, so the dashboard reads one consistent verdict. On an abnormal exit
// (finalState null) it writes NOTHING: the last live snapshot and the index entry both keep finalState
// null, which is exactly what makes the gone process read as crashed (§2.2). The index update is
// best-effort — a failure is logged, never thrown, because the process is on its way out and a red
// display is a smaller harm than a crash during exit.
export function writeRunFinal({
  controlDir,
  proc,
  runState,
  reason,
  writeSnapshotFn = writeSnapshot,
  updateIndex,
  log,
} = {}) {
  const finalState = finalStateForExit(reason);
  if (finalState === null) {
    return { finalState: null, wrote: false }; // abnormal exit: leave both snapshot and index null.
  }
  writeSnapshotFn(controlDir, { proc, finalState, runState });
  let indexResult = null;
  if (updateIndex) {
    try {
      indexResult = updateIndex(finalState);
    } catch (e) {
      log?.(`index final-status update failed: ${e?.message ?? e}`);
    }
  }
  return { finalState, wrote: true, indexResult };
}

// updateIndexFinalState({ repo, slug, finalState, indexStore, readFile, now }) → stamp a run's final
// status onto its cross-repo index entry (DESIGN §2.8, §3.4; T10 interface). It reads the entry the
// launcher wrote (T08), sets its finalState (and an updatedAt stamp), and writes it back through the
// index store's atomic writeRecord — composing T02's parseRecord with T06's store rather than owning
// either format or path, so there stays one owner per fact. `indexStore` is null when the store module
// is not present (see the bin's lazy load), in which case this is a no-op; a missing or unparseable
// entry is likewise a no-op, never a throw, because the exit path must not fail on bookkeeping.
export function updateIndexFinalState({
  repo,
  slug,
  finalState,
  indexStore,
  readFile = readFileSync,
  now = () => new Date().toISOString(),
} = {}) {
  if (!indexStore) return { updated: false, reason: 'no-index-store' };
  let existing;
  try {
    existing = parseRecord(readFile(indexStore.recordPath(repo, slug), 'utf8'));
  } catch {
    return { updated: false, reason: 'no-entry' }; // the launcher's entry is not there to update.
  }
  if (!existing) return { updated: false, reason: 'unparseable-entry' };
  const record = { ...existing, finalState, updatedAt: now() };
  indexStore.writeRecord(record);
  return { updated: true, record };
}

// --- The runaway circuit-breaker verdict (DESIGN §5.2; ported from spawn-one-scratch.mjs, T12 P5) --
//
// The first live spawn-one-scratch run "ran away" to ~12 workers before a breaker existed; coordinate
// .mjs had none. A review handoff briefly holds CEILING+1 (the implementer is stopped async as the
// reviewer spawns — FINDINGS 2026-09-09), so a single over-ceiling worker is tolerated for `overGrace`
// consecutive passes; more than one over, or an overage that persists, is a real runaway. Pure so the
// bin's safety net is tested without a live process. `liveCount` is THIS run's workers only (the
// caller filters with isWorkerOf), so the coordinator's own session never trips it.
export function runawayVerdict({ liveCount, ceiling, overPasses = 0, overGrace = 3 }) {
  if (liveCount <= ceiling) return { abort: false, over: 0 };
  const over = overPasses + 1;
  return { abort: liveCount > ceiling + 1 || over >= overGrace, over };
}

// --- The scratch-repo branch-safety guard (DESIGN §2.4, §5.2; ported from spawn-one-scratch.mjs, T12 P5) --
//
// The LIVE bin opens the feature branch off THIS checkout's main and writes task branches and
// worktrees against it. The run never merges to main (§2.4), but it still cuts and mangles pir/{slug}
// branches inside whatever repo it runs in — so never let a live run open them inside the canonical
// project by accident: refuse when the main worktree's basename is the canonical repo unless
// PARALLEL_ALLOW_HERE=1 (a same-named scratch clone). Pure predicate so it is tested directly. The
// name is historical; it now guards the feature branch, not a promotion.
const CANONICAL_REPO = 'plan-implement-review';
export function canPromoteHere(repoName, { allowHere = false } = {}) {
  return repoName !== CANONICAL_REPO || allowHere;
}

// --- The end-of-run hand-off (DESIGN §2.4, §2.8) ----------------------------------------------
//
// When the plan is complete, the run stops at the feature branch and hands it to the person to merge
// by hand — the one irreversible act, the merge to main, is the person's `what`, not the program's
// (CLAUDE.md, §2.4). renderHandoff builds the line(s) main() prints from the loop's complete result.
// Pure, so the green/red wording is asserted without running the bin (DESIGN §2.3's pure-display
// stance). On green it hands over `git merge pir/{slug}`; on red it names the failure and offers NO
// merge line, because telling the person a red branch is ready would be a lie the tests caught (§2.8).
// `why` is the red gate's reason and log path (loop.mjs 3f), printed so the person can tell a failing
// suite from a command that never ran.
export function renderHandoff({ readyToMerge, taskCount, slug, why } = {}) {
  const branch = `pir/${slug}`;
  if (readyToMerge) {
    return (
      `✔ all ${taskCount} task(s) green on ${branch} · tests pass. Yours to merge:\n\n` +
      `  git merge ${branch}\n`
    );
  }
  return (
    `✗ all ${taskCount} task(s) built on ${branch}, but its tests fail — not ready to merge.\n` +
    (why ? `  ${why}\n` : '') +
    `Fix the feature branch, then merge it yourself. No merge is offered on a red branch.`
  );
}

// --- The `node src/shell/coordinate.mjs {slug}` bin entry --------------------------------------
//
// The whole coordinator: refuse an unreviewed plan (DESIGN §2.1), otherwise stand up the real platform
// + worktree + control, step the loop once per iteration, and paint the live status display (§2.3). It
// drains a worker's UP-report through the reports drop-dir (createReportInbox); it routes nothing down,
// because the person answers a blocked worker directly (§2.2). There is no coordinator session and no
// skill — this is a plain foreground process (§2.1). The full live drive over real agents is
// hand-verified in T09; run here it spawns real paid workers, so it is guarded to a bounded ceiling.

function gitStdout(cwd, args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch {
    return '';
  }
}

// A git runner that reports success/failure (unlike gitStdout, which swallows it), so ensureMain can
// tell "no local main" from "the checkout is broken". Injected into ensureMain so a test drives it
// against a scratch repo.
export function gitRun(cwd, args) {
  try {
    const stdout = execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { ok: true, stdout, stderr: '' };
  } catch (e) {
    return { ok: false, stdout: e.stdout ?? '', stderr: e.stderr ?? String(e) };
  }
}

// Ensure a checkout has a local `main` (DESIGN §2.9; T12 Problem 4). worktree.mjs cuts the feature
// branch with `git branch pir/{plan} main` — `main` hardcoded, as the real project always has one — so
// a local main must exist for openFeature to branch off it (the run never merges back to main, §2.4;
// main is only the base the feature branch is cut from). A scratch clone taken off a side branch has
// only origin/main and no local `main`, so pass 1 throws "not a valid object name: 'main'" (the drill
// created one by hand). When there is no local main, create it at the current HEAD and check it out; a
// checkout that already has main is left exactly as it is. Runs only on the LIVE path, which the
// branch-safety guard confines to a scratch checkout, so pointing main at HEAD is safe (mirrors
// ensureMainCheckedOut, verified with the user 2026-09-09). `-B main HEAD` pins main to the exact
// commit, never a same-named origin/main.
export function ensureMain(root, { git = gitRun } = {}) {
  if (git(root, ['rev-parse', '--verify', '--quiet', 'refs/heads/main']).ok) {
    return { created: false };
  }
  const from = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim();
  const r = git(root, ['checkout', '-B', 'main', 'HEAD']);
  if (!r.ok) throw new Error(`ensureMain: could not create a local main at HEAD: ${r.stderr}`);
  return { created: true, from };
}

// The main (primary) worktree of the repo, whose basename is the repo name the agent names are built
// from (DESIGN §2.8), and the checkout that stays on main until promotion (DESIGN §2.9).
function mainWorktree(cwd) {
  const first = gitStdout(cwd, ['worktree', 'list', '--porcelain'])
    .split('\n')
    .find((l) => l.startsWith('worktree '));
  return first ? first.slice('worktree '.length).trim() : '';
}

// Exported for the T04 startup-hygiene tests, which drive startupControlHygiene against the SAME control
// object the bin builds live (a temp repo dir stands in for the checkout).
export function fileControl(repo, slug) {
  const dir = join(repo, 'plans', slug, '.parallel', 'control');
  mkdirSync(dir, { recursive: true });
  const flag = join(dir, 'HALT');
  const logPath = join(dir, 'log');
  return {
    dir,
    flag,
    logPath,
    isHalted: () => existsSync(flag),
    log: (line) => {
      try {
        writeFileSync(logPath, `${new Date().toISOString()} ${line}\n`, { flag: 'a' });
      } catch {
        /* logging must never break the loop */
      }
    },
  };
}

// --- Restart hygiene for the control folder (DESIGN §2.7, §7) ---------------------------------
//
// The control folder is reused across a restart. clearTransientFeeds empties the one transient feed —
// `reports/`, the worker up-channel (DESIGN §3.5) — so a dead run's leftover reports never route into a
// fresh run. The down-channel feeds are gone (removed with the relay, DESIGN §2.2, T03), so reports/ is
// all that is left to clear. The two DURABLE records are never touched
// here — `log` is the audit trail and the harness signal, and `HALT` is the deliberate stop whose whole
// value is surviving a restart until a person removes it (auto-clearing it would defeat the kill switch,
// §2.7).
//
// Clearing runs on every startup, not only a detected restart: a genuine first start has reports/ empty,
// so an unconditional clear is safe and needs no restart detection (matches the reconciliation approach
// in §2.1). reports/ is a dir of one-file-per-report, so emptying its *.json is the clear. Best-effort:
// a missing feed is nothing to clear, and its clear may never throw the run down. Returns what it
// touched, for the startup log line.
export function clearTransientFeeds(controlDir) {
  const cleared = [];

  const reportsDir = join(controlDir, 'reports');
  try {
    if (existsSync(reportsDir)) {
      for (const n of readdirSync(reportsDir)) {
        if (!n.endsWith('.json')) continue;
        try {
          unlinkSync(join(reportsDir, n));
        } catch {
          /* vanished under us; nothing to clear for this one */
        }
      }
      cleared.push('reports/');
    }
  } catch {
    /* cannot read the dir — best-effort, leave it */
  }

  return { cleared };
}

// startupControlHygiene(control) → the restart-hygiene step the bin runs once, before it stands up the
// loop (DESIGN §2.7, §7). If HALT is still present it is a deliberate stop the person must lift, so this
// refuses ({ halted:true }) and NEVER clears the flag — auto-clearing would blow a restarted run
// straight past the kill switch. Otherwise it clears the transient feeds and appends a `restart` marker
// to the preserved log (the audit-trail boundary between runs), returning what it cleared. Exported so
// both halves — the refusal and the clear+marker — are unit-tested without the live bin.
export function startupControlHygiene(control) {
  if (control.isHalted()) {
    return { halted: true, flag: control.flag };
  }
  const { cleared } = clearTransientFeeds(control.dir);
  control.log('restart');
  return { halted: false, cleared };
}

// waitForReport(reportsDir, timeoutMs, { watch }) → resolve as soon as anything changes in the reports
// drop-dir, or after timeoutMs, whichever comes first (DESIGN §2.2). This is the "react, don't poll"
// half: a worker dropping a report file wakes the loop immediately, and the timeout is only a backstop
// so a missed filesystem event is still picked up within a poll interval. fs.watch may be unavailable on
// some filesystems — then this degrades to a plain timeout, which is exactly the old polling behaviour,
// so correctness never depends on the watch firing.
//
// fs.watch signals a RUNTIME failure (EMFILE under fd pressure, ENOSPC, a watch that dies later) by
// emitting an 'error' event on the FSWatcher, NOT by throwing from watch() — the sync try/catch below
// only covers a watch that cannot start at all. Without an 'error' listener Node re-throws that event as
// an unhandled 'error' and the whole coordinator process exits, defeating the very timeout backstop this
// function exists to provide (a live run can always meet fd pressure — several sessions push fs.watch
// past the OS limit). So on an 'error' we close the dead watcher and do NOTHING else: we do not finish()
// (resolving immediately would busy-spin the pass loop into re-watching every pass), letting the pending
// setTimeout(finish) fire so this pass degrades to paced POLL_MS polling. Each later pass re-attempts a
// fresh watch(); if the OS is still refusing, it keeps falling back, which is correct. `watch` is
// injectable so a test can emit 'error' without a real EMFILE.
export function waitForReport(reportsDir, timeoutMs, { watch: watchFn = watch } = {}) {
  return new Promise((resolve) => {
    let done = false;
    let watcher = null;
    let timer = null;
    const finish = () => {
      if (done) return;
      done = true;
      try {
        watcher?.close();
      } catch {
        /* already closed */
      }
      clearTimeout(timer);
      resolve();
    };
    try {
      watcher = watchFn(reportsDir, () => finish());
      watcher.on('error', () => {
        // Runtime watch failure: drop the dead watcher and let the timeout backstop take over. Do not
        // finish() here — that would re-watch every pass in a tight loop. Paced POLL_MS polling is correct.
        try {
          watcher?.close();
        } catch {
          /* already gone */
        }
        watcher = null;
      });
    } catch {
      /* no fs.watch here — fall back to the pure timeout (old polling behaviour) */
    }
    timer = setTimeout(finish, timeoutMs);
  });
}

// Run the project's test command on the feature worktree (DESIGN §2.4, §5): the last gate before the
// run hands the branch off. The command is the one the plan names in its own DESIGN.md (§ Environment,
// read from the feature branch's copy by testCommandFrom); it used to be a hard-coded `npm test`, which
// exited 254 on every project without a package.json and so failed runs whose tests pass. Each line
// runs through the shell in order, stopping at the first failure. Anything that stops a command from
// launching, a non-zero exit, or no command found counts as red — a hand-off must never claim a green
// it did not observe (§2.8). Output goes to logPath, not the terminal (the live display owns it), so a
// red result can say where to look. The run's own switches (PARALLEL_*, PIR_RUN) are dropped from the
// environment: they drive this coordinator, and a project's suite that spawns a coordinator of its own
// (this repo's does) must not inherit PARALLEL_LIVE=1. Returns { ok, command, reason, logPath }; command names
// the failing line and is null on green.
export function runFeatureTests(featurePath, { slug, logPath } = {}) {
  let design = '';
  try {
    design = readFileSync(join(featurePath, 'plans', slug, 'DESIGN.md'), 'utf8');
  } catch {
    /* no DESIGN.md — reported below as no command */
  }
  const commands = testCommandFrom(design);
  if (!commands) {
    return { ok: false, command: null, logPath: null, reason: `no test command found in plans/${slug}/DESIGN.md` };
  }

  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith('PARALLEL_') && k !== 'PIR_RUN'),
  );
  let fd = 'ignore';
  try {
    if (logPath) fd = openSync(logPath, 'w');
  } catch {
    /* an unwritable log must not turn a green suite red */
  }
  try {
    for (const command of commands) {
      if (typeof fd === 'number') writeFileSync(fd, `$ ${command}\n`);
      try {
        execFileSync('/bin/sh', ['-c', command], { cwd: featurePath, env, stdio: ['ignore', fd, fd] });
      } catch (e) {
        const how = e.status != null ? `exited ${e.status}` : `could not run (${e.code ?? e.signal ?? e.message})`;
        return { ok: false, command, logPath: typeof fd === 'number' ? logPath : null, reason: `\`${command}\` ${how}` };
      }
    }
    return { ok: true, command: null, logPath: typeof fd === 'number' ? logPath : null };
  } finally {
    if (typeof fd === 'number') closeSync(fd);
  }
}

// --- Feeding the live display (DESIGN §2.3, §3.4) ---------------------------------------------
//
// The pure display model (src/core/display.mjs) takes the run state a pass produces and returns the
// rows/summary/footer as data. These two helpers assemble that run state from a pass result and the
// tracked worker state, mapping the loop's internal phase names onto the display's vocabulary. They are
// shell glue but read no clock or fs — `now`, `since` and `doneMs` arrive as arguments — so the mapping
// is unit-tested; only the painting itself is judged by eye (T09).

// displayPhaseFor(t) → the display phase for a tracked worker, or null when no worker holds the task. A
// worker parked on the person (AWAITING, §2.2) is `asking` whatever its role; a worker that has reported
// `done` is `merging` — its review is finished and the loop is waiting for the session to go idle before
// it merges (loop.mjs 3d), which can take up to AWAIT_IDLE_TIMEOUT_MS, so `reviewing` there would lie.
// Otherwise the role names it — an implementer (or a `you` scribe) is `building`, a reviewer `reviewing`.
export function displayPhaseFor(t) {
  if (!t) return null;
  if (t.phase === 'awaiting-answer') return 'asking';
  if (t.phase === 'done') return 'merging';
  if (t.role === 'review') return 'reviewing';
  return 'building';
}

// buildRunState({ passTasks, stateTasks, branch, ceiling, sinceByTask, doneMsByTask, complete,
// readyToMerge, testsReason, interrupted }) → the runState buildDisplay consumes (DESIGN §2.3). passTasks are the
// parsed PROGRESS rows the pass returned ({ num, name, deps, state }); stateTasks is
// coordinator.state.tasks (the live workers). A ✅ row is done; otherwise a tracked worker's phase names
// the row. sinceByTask/doneMsByTask carry the phase-start and final-duration times the shell tracks.
// testsReason is the red gate's { reason, logPath } (null otherwise); it rides in runState so it lands in
// status.json and a detached viewer can say why a finished run is red (DESIGN §2.8).
export function buildRunState({
  passTasks,
  stateTasks = {},
  branch,
  ceiling,
  sinceByTask = {},
  doneMsByTask = {},
  complete = false,
  readyToMerge = false,
  testsReason = null,
  interrupted = false,
} = {}) {
  const tasks = passTasks.map((t) => {
    const done = t.state === DONE_GLYPH;
    const st = done ? null : stateTasks[t.num];
    const phase = st ? displayPhaseFor(st) : null;
    return {
      id: t.num,
      slug: t.name,
      deps: t.deps,
      done,
      phase,
      since: phase ? sinceByTask[t.num] ?? null : null,
      doneMs: done ? doneMsByTask[t.num] ?? null : null,
      question: phase === 'asking' ? st.decision?.text ?? null : null,
      // A coordinator-side merge conflict carries a copy-paste resolution prompt (T14); an ordinary
      // question does not, so this is null for a plain ask.
      prompt: phase === 'asking' ? st.decision?.prompt ?? null : null,
    };
  });
  return { branch, ceiling, complete, readyToMerge: !!readyToMerge, testsReason: testsReason ?? null, interrupted: !!interrupted, tasks };
}

async function main(argv) {
  const slug = argv[0];
  if (!slug) {
    console.error('usage: node src/shell/coordinate.mjs {slug}');
    process.exit(2);
  }

  const root = mainWorktree(process.cwd()) || process.cwd();
  const repo = basename(root);

  // The gate (DESIGN §2.1): refuse an unreviewed plan and name the line, exactly as pir-work does.
  const gate = readReviewGate(slug, { root });
  if (!gate.reviewed) {
    const why = gate.missing
      ? `plans/${slug}/PROGRESS.md was not found`
      : gate.note
        ? `the plan-reviewed gate says: "${gate.note}"`
        : 'the plan has no positive "Plan reviewed:" line';
    console.error(
      `Refusing to coordinate "${slug}": it has not been reviewed (${why}).\n` +
        `A defect in an unreviewed plan is copied into every task, and running many workers at once\n` +
        `multiplies it. Review the plan first:\n\n  /pir-review-plan ${slug}\n`,
    );
    process.exit(1);
  }

  console.log(`pir ${slug} — plan reviewed (${gate.note}). This is a plain command; there is no coordinator session.`);

  const maxWorkers = Number(process.env.PARALLEL_MAX_WORKERS ?? 4);

  // Live seatbelt (DESIGN §5.2). This bin spawns REAL, paid `claude` workers and cuts pir/{slug}
  // branches. A full multi-worker live drive is hand-verified in T09, and the rule is never to run the
  // unbounded version to find something out. So the loop only runs with an explicit opt-in; without it
  // the bin does the safe half — confirm the gate, show what it WOULD dispatch — and stops. The run
  // never merges to main (§2.4); the person does that by hand. The T09 person-check runs the live path
  // deliberately on the scratch plan, ceiling 1:
  //   PARALLEL_LIVE=1 PARALLEL_MAX_WORKERS=1 node src/shell/coordinate.mjs scratch
  if (process.env.PARALLEL_LIVE !== '1') {
    const { tasks } = parseProgress(readFileSync(join(root, progressPathFor(slug)), 'utf8'));
    const ready = readyWaiting(tasks, new Set());
    console.log(
      `\nDRY: not spawning real workers (set PARALLEL_LIVE=1 to actually drive — the live drive is\n` +
        `hand-verified in T09, and the first live run is seatbelted: scratch plan, ceiling 1).\n` +
        `Ready to dispatch now: ${ready.length ? ready.join(', ') : '(none)'}.`,
    );
    return;
  }

  console.log('LIVE: spawning real workers (PARALLEL_LIVE=1).');

  // Promotion guard (DESIGN §5.2; T12 Problem 5): never open+merge the feature branch inside the
  // canonical project by accident. A scratch clone is named anything else; PARALLEL_ALLOW_HERE=1
  // overrides for a same-named clone.
  if (!canPromoteHere(repo, { allowHere: process.env.PARALLEL_ALLOW_HERE === '1' })) {
    console.error(
      `Refusing the LIVE run inside "${repo}" — this opens pir/${slug} off THIS repo's main and cuts\n` +
        `task branches and worktrees against it. (It never merges to main; you do that by hand.) Still,\n` +
        `run it in a throwaway clone instead (e.g. \`git clone . ../pir-scratch && cd ../pir-scratch\`).\n` +
        `If this really is a scratch clone that happens to share the name, set PARALLEL_ALLOW_HERE=1.`,
    );
    process.exit(1);
  }

  // Ensure a local `main` exists (DESIGN §2.9; T12 Problem 4): a scratch clone off a side branch has
  // only origin/main, and openFeature would throw on pass 1 without this.
  const mained = ensureMain(root);
  if (mained.created) console.log(`prepared a local main at HEAD (checkout was on "${mained.from}", which had none).`);

  const control = fileControl(root, slug);

  // Restart hygiene (DESIGN §2.7): before this run writes anything, refuse a still-HALTed run (naming
  // the flag, never clearing it) and clear the dead run's transient reports so none of its leftovers
  // route into a fresh worker. Runs before the report inbox and the loop, so neither side has written a
  // report yet this run. The log and HALT are preserved; a `restart` marker records the boundary.
  const hygiene = startupControlHygiene(control);
  if (hygiene.halted) {
    console.error(
      `HALT flag present at ${hygiene.flag} — remove it to restart.\n` +
        `The kill switch is a deliberate stop and is never cleared automatically; a run started past it\n` +
        `would blow straight through the stop. Delete the flag to let the run start again:\n\n` +
        `  rm ${hygiene.flag}\n`,
    );
    process.exit(1);
  }
  if (hygiene.cleared.length) console.log(`cleared stale control feeds from a prior run: ${hygiene.cleared.join(', ')}`);

  const inbox = createReportInbox({ dir: control.dir });
  const platform = createPlatform({ root, transport: inbox.transport });
  const worktree = createWorktree({ root });
  const coordinator = startCoordinator({ slug, repo, platform, worktree, maxWorkers, control,
    runTests: (featurePath) => runFeatureTests(featurePath, { slug, logPath: join(control.dir, 'tests.log') }),
  });
  const renderer = createRenderer({ stream: process.stdout });

  console.log(`ceiling: ${maxWorkers}   control: ${control.dir}`);
  console.log(`ABORT:   touch ${control.flag}`);
  console.log(`reports: ${inbox.reportsDir}`);
  // A blocked worker is answered by the person DIRECTLY (DESIGN §2.2): find it in `claude agents`,
  // attach, and reply there. Nothing is routed through this command, so there is no coordinator session
  // and no answers file to write to.
  console.log(`\nA worker that asks you shows in the display below; answer it directly with \`claude agents\`.\n`);

  const POLL_MS = Number(process.env.PARALLEL_POLL_MS ?? 5000);
  // A safety cap only — the run's real end is the hand-off, a halt, or a stall, not a fixed pass budget
  // (the drill exited on its budget and orphaned a worker; DESIGN §2.6). At the cap we tear down.
  const MAX_PASSES = Number(process.env.PARALLEL_MAX_PASSES ?? 5000);
  const CEILING = maxWorkers;
  const OVER_GRACE = Number(process.env.PARALLEL_OVER_GRACE ?? 3);
  const STALL_GRACE = 3; // consecutive quiet passes with nothing live before the run is declared done
  const branch = `pir/${slug}`;

  // Detached self-reporting (DESIGN §2.4, §2.6, §3.5; T10). PIR_RUN is set only by the `pir` launcher
  // (T08); a foreground `pir-coordinate` run leaves it unset and skips everything below, so the classic
  // path is unchanged.
  const selfReport = shouldSelfReport(process.env);

  // index-store (T06) is loaded LAZILY, not statically imported at the top of this file. T10 was
  // dispatched before T06 was built (T10's declared dependencies name only T07, the snapshot store), so
  // a static `import './index-store.mjs'` would break this branch's `npm test`. On the assembled feature
  // branch T06 is always present and this resolves it; if it is somehow absent, snapshot self-reporting
  // still works and only the index finalState is skipped. The index update's decision logic is unit
  // tested via updateIndexFinalState with a fake store, so only this glue is untested here.
  let indexStore = null;
  if (selfReport) {
    try {
      indexStore = await import('./index-store.mjs');
    } catch {
      control.log('index-store (T06) not importable — writing snapshots only, index finalState skipped');
    }
  }

  // The process facts every snapshot carries (DESIGN §3.4). startTime is the launch time the launcher
  // recorded in the index entry (T08) — read back from the entry so the snapshot's identity matches the
  // index's one recorded value rather than re-deriving it (T10 interface); fall back to a PIR_START_TIME
  // env the launcher may pass, else null (the dashboard classifies liveness from the index entry, not
  // this field, so a missing value only weakens the snapshot's self-description).
  const readIndexStartTime = () => {
    if (!indexStore) return null;
    try {
      return parseRecord(readFileSync(indexStore.recordPath(repo, slug), 'utf8'))?.startTime ?? null;
    } catch {
      return null;
    }
  };
  const proc = selfReport
    ? {
        pid: process.pid,
        startTime: readIndexStartTime() ?? process.env.PIR_START_TIME ?? null,
        slug,
        repo,
        branch,
        startedAt: new Date().toISOString(),
      }
    : null;
  const updateIndex = selfReport
    ? (finalState) => updateIndexFinalState({ repo, slug, finalState, indexStore, log: control.log })
    : null;
  // The last run state painted, so an exit path (a signal, a stall, completion) can write it as the final
  // snapshot. Seeded with an empty-but-valid run state so a stop arriving before the first pass still
  // writes a snapshot parseSnapshot accepts.
  let lastRunState = buildRunState({ passTasks: [], branch, ceiling: CEILING, interrupted: true });

  // Tear down every live worker of this run on any exit that is not a clean hand-off or a kill-switch
  // halt (both of which the loop already handled). This is the orphan-guard: a safety cap, a stall, a
  // Ctrl-C or an error must not leave a paid session running (DESIGN §2.6). Idempotent (close is safe
  // twice). A re-run reaps whatever a second Ctrl-C during teardown left behind (§2.6, §2.8).
  const teardown = () => teardownRun({ platform, state: coordinator.state, repo, slug, control });
  let tornDown = false;
  const teardownOnce = (why) => {
    if (tornDown) return;
    tornDown = true;
    // Leave the alternate screen first (T15): so any teardown message lands on the normal screen, and so
    // even a teardown that closes nothing (a Ctrl-C before any worker spawned) still restores the
    // terminal — the alt screen must always be left on exit.
    renderer.close();
    const { closed } = teardown();
    if (closed.length) renderer.line(`\n=== ${why}: closed ${closed.length} live worker(s) so none is orphaned ===`);
  };

  // The detached stop (DESIGN §2.6, T10): a `pir` stop sends SIGTERM to a PIR_RUN coordinator. Like every
  // teardown it leaves the task worktrees for the next start to reconcile; unlike the others it records a
  // `stopped` final status. It shares tornDown with teardownOnce so only one of the two runs.
  const stopDetached = () => {
    if (tornDown) return;
    tornDown = true;
    renderer.close();
    const { closed } = teardownRun({ platform, state: coordinator.state, repo, slug, control });
    writeRunFinal({ controlDir: control.dir, proc, runState: lastRunState, reason: 'stop', updateIndex, log: control.log });
    renderer.line(
      closed.length
        ? `\n=== stopped: closed ${closed.length} live worker(s); worktrees left for the next start (§2.6) ===`
        : '\n=== stopped: worktrees left for the next start (§2.6) ===',
    );
  };

  // On every abnormal exit finishRun writes nothing (finalStateForExit → null), so the gone process reads
  // as crashed; on a clean end it records the matching final status (DESIGN §2.2, T10).
  const finishRun = (reason) => {
    if (!selfReport) return;
    writeRunFinal({ controlDir: control.dir, proc, runState: lastRunState, reason, updateIndex, log: control.log });
  };

  // A signal must close workers before we go (DESIGN §2.6). A detached stop is SIGTERM under PIR_RUN and
  // takes the stop path (leave worktrees, record `stopped`); every other signal is the classic teardown.
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      if (selfReport && sig === 'SIGTERM') stopDetached();
      else teardownOnce(`${sig} received`);
      process.exit(130);
    });
  }

  // Per-task timing for the display's elapsed clocks (DESIGN §2.3): when each task's current phase began
  // (for `now − since`) and, once merged, how long it took. Tracked here in the shell, never in the pure
  // model. A completed task is dropped from state.tasks at merge, so its start is remembered separately.
  const startByTask = {};
  const phaseByTask = {};
  const sinceByTask = {};
  const doneMsByTask = {};
  const trackTiming = (stateTasks, completed) => {
    const t = Date.now();
    for (const [num, st] of Object.entries(stateTasks)) {
      if (startByTask[num] == null) startByTask[num] = t;
      const ph = displayPhaseFor(st);
      if (phaseByTask[num] !== ph) {
        phaseByTask[num] = ph;
        sinceByTask[num] = t;
      }
    }
    for (const num of completed) {
      if (doneMsByTask[num] == null) doneMsByTask[num] = t - (startByTask[num] ?? t);
    }
  };

  let over = 0;
  let idle = 0;
  try {
    for (let p = 1; p <= MAX_PASSES; p++) {
      const r = coordinator.pass();
      trackTiming(coordinator.state.tasks, r.completed);

      // A restart's one-line reconciliation summary scrolls above the live block, so the run does not
      // look like a fresh start (DESIGN §2.8). Only ever set on the first pass of a run that adopted work.
      if (r.restartSummary) renderer.line(`  ↻ ${r.restartSummary}`);

      // A coordinator-side merge conflict scrolls its copy-paste resolution prompt above the live block
      // (T14, §2.8). The block is bulky and must be selectable to copy, so it lands on the NORMAL screen
      // via line() — never inside the compact, clipped live frame, which would truncate it to useless and
      // re-open the T15 wrap bug. A conflict is surfaced exactly once, on the pass it happens, so each
      // prompt prints exactly once; the compact live footer keeps naming the parked worker to attach to.
      for (const s of r.surfaces) {
        if (s.kind === 'conflict' && s.prompt) renderer.line(`\n${s.prompt}`);
      }

      if (r.halted) {
        // Abnormal exit (DESIGN §2.2, T10): the HALT kill switch records NO final status, so the gone
        // process reads as crashed, not dim `finished`. Nothing to write — the last live snapshot and the
        // index entry both keep finalState:null.
        renderer.close(); // leave the alt screen so the notice lands on the normal screen (T15)
        renderer.line('\n=== HALTED by the kill switch — workers stopped, nothing merged ===');
        return; // the halt pass already closed every worker
      }

      // Paint the live display: the pass's tasks and worker phases, the ceiling, the asking-you footer,
      // and — when complete — the hand-off (DESIGN §2.3). The model is pure; the renderer paints it in
      // place on a TTY and as plain lines otherwise.
      const runState = buildRunState({
        passTasks: r.tasks,
        stateTasks: coordinator.state.tasks,
        branch,
        ceiling: CEILING,
        sinceByTask,
        doneMsByTask,
        complete: r.complete,
        readyToMerge: !!r.readyToMerge,
        testsReason: r.testsReason,
      });
      lastRunState = runState;
      // Feed the detached live view (DESIGN §2.4): write this pass's run state to the snapshot the
      // dashboard reads, finalState null (still running). Same run state that is painted, so a watcher on
      // another terminal sees exactly what a live pane would. No-op on the classic path (selfReport false).
      if (selfReport) writeRunSnapshot({ controlDir: control.dir, proc, runState });
      renderer.paint(buildDisplay(runState, { now: Date.now() }));

      if (r.complete) {
        // The plan is done and the loop has run the feature-branch tests (§2.4). Hand the branch off: on
        // green, print the `git merge` command for the person to run; on red, print the failure and offer
        // no merge (§2.8). The run never merges to main itself. The complete pass has no live workers, so
        // nothing is orphaned by returning here.
        finishRun('complete'); // a clean end (green OR red branch) records `finished` (§2.2, T10).
        renderer.close(); // leave the alt screen; the hand-off prints on the normal screen (T15, DESIGN §2.3)
        renderer.line('\n' + renderHandoff({
          readyToMerge: r.readyToMerge,
          taskCount: r.tasks.length,
          slug,
          why: r.surfaces.find((s) => s.kind === 'red-feature')?.text,
        }));
        return;
      }

      // Runaway breaker (DESIGN §5.2). Count THIS run's workers only — a foreign session sharing the
      // git-dir must not trip it. r.live is already that count (loop.mjs filters), so reuse it.
      const verdict = runawayVerdict({ liveCount: r.live, ceiling: CEILING, overPasses: over, overGrace: OVER_GRACE });
      over = verdict.over;
      if (verdict.abort) {
        // Abnormal exit (T10): the runaway breaker records NO final status → crashed, not `finished`.
        renderer.line(`\nABORT: ${r.live} live workers over ceiling ${CEILING} for ${over} pass(es) — a runaway.`);
        teardownOnce('runaway');
        return;
      }

      // Stall detection: a pass that did nothing AND has nothing live is the run genuinely finished (all
      // tasks ✅ and handed off, or everything deferred). A parked worker (live > 0) is NOT a stall — it
      // waits for the person's answer, so the loop keeps polling for it.
      const productive = r.actions.some((a) => ['spawn', 'review', 'merge', 'close'].includes(a.type));
      idle = !productive && r.live === 0 ? idle + 1 : 0;
      if (idle >= STALL_GRACE) {
        finishRun('stall'); // nothing left to do is a clean end — records `finished` (§2.2, T10).
        renderer.line('\n=== nothing left to do (no live workers, nothing to dispatch or hand off) ===');
        teardownOnce('stalled'); // a no-op when nothing is live; still safe
        return;
      }

      // React to a worker's report instead of only polling for it (DESIGN §2.2). A worker drops its
      // report into reports/, so watch that dir and wake the moment a file lands; POLL_MS is only a
      // backstop for a missed fs.watch event. Only reports/ is watched, never the control dir at large,
      // so the bin's OWN writes this pass (the flow log) cannot wake it into a busy spin.
      await waitForReport(inbox.reportsDir, POLL_MS);
    }
    // Abnormal exit (T10): the safety cap and an uncaught error both record NO final status → crashed.
    renderer.line('\n=== safety cap reached ===');
    teardownOnce('safety cap');
  } catch (e) {
    teardownOnce('error');
    throw e;
  }
}

// Only run the bin when invoked directly, never on import (the tests import the functions above).
if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
