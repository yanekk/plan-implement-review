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
// the person and the answer back down; the person now opens the asking worker's conversation in `pir`
// and answers there (live-workers §2.4, §2.11) — nothing is relayed. Only the UP-channel remains: a worker
// drops a one-line report into the control folder's `reports/` drop-dir (createReportInbox below), which
// a Node process reads directly — no agent needed. The program uses that signal for two things only: to
// keep a parked worker's slot under the ceiling, and to show its question in the live display so the
// person can see who is asking. In the tests the fake platform IS the bus, so the report inbox is not
// exercised there — its live behaviour is hand-verified (T09).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { parseProgress, reconcileTaskRow, progressPathFor } from '../core/progress.mjs';
import { workerName, isWorkerOf } from '../core/naming.mjs';
import { buildDisplay } from '../core/display.mjs';
import { waitingOn, waitingFor, waitingItems, itemKey } from '../core/asking.mjs';
import { readEntry } from '../core/stream.mjs';
import { parseRecord } from '../core/runrecord.mjs';
import { parseTestBlock } from '../core/testblock.mjs';
import { runLines, startLines } from './commands.mjs';
import { runPass, createRunState, applyMessages, resumeAnswered } from './loop.mjs';
import { buildConflictPrompt, MAIN_SYNC_TASK, TESTS_FIX_TASK } from '../core/conflict.mjs';
import { handoffFor, resyncedFor } from '../core/coordinator-brief.mjs';
import {
  notableDecisions, branchFooter, assembleReport, replaceFooter, endFacts, unverifiedTasks, findingRows,
} from '../core/coordinator-report.mjs';
import { createPlatform, resolveClaudePath } from './platform.mjs';
import { createRenderer } from './render.mjs';
import { createWaker, drainDropFolder, waitForDrop } from './drop-folder.mjs';
import { createGrants, startPersonInbox } from './person-inbox.mjs';
import { writeSnapshot } from './snapshot-store.mjs';
import { updateRecord } from './index-store.mjs';
import { createWorktree } from './worktree.mjs';
import { resolveRunBase } from './base-branch.mjs';
import { reapRecorded } from './reap.mjs';
import { planHome } from './plan-home.mjs';
import { startCoordinatorAgent, withAgent, closingAnswer, readLogEntries, readJson } from './coordinator-agent.mjs';
import { startFinisher as startFinisherSession } from './finisher-agent.mjs';
import { chooseRules } from '../core/finisher-policy.mjs';
import { startWorker } from './worker-proc.mjs';
import { alertText, endAlert, holdAlert, notifyStep, notifyExit, newNotifyState, finisherAlert, finisherNotifyView } from '../core/notify.mjs';
import { holdText } from '../core/basebranch.mjs';
import { publish as ntfyPublish, clear as ntfyClear } from './ntfy.mjs';
import { readNotifyConfig, ensurePresenceMarker, notifyIcon } from './notify-config.mjs';

// The engine's own root (this file is {engine}/src/shell/coordinate.mjs): the built-in rules' home
// (finisher DESIGN §2.2), for the installed engine and a checkout alike.
const ENGINE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// The least time between two passes' starts (fast-tests DESIGN §2.2): wakes inside it coalesce into one pass
// at its end, so a flood of worker output cannot run passes back to back. Below the `pir` screen's 500 ms
// refresh, so the spacing is never what a person sees. A constant: nobody has a reason to tune it.
export const PASS_MIN_GAP_MS = 250;

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
export function readReviewGate(slug, { root = process.cwd(), exec, fs } = {}) {
  const text = planHome(slug, { root, exec, fs }).read('PROGRESS.md');
  if (text == null) {
    return { reviewed: false, note: '', missing: true };
  }
  const { planReviewed } = parseProgress(text);
  return { reviewed: planReviewed.reviewed, note: planReviewed.note, missing: false };
}

// --- The setup/test block gate (declared-test-command DESIGN §2.2, §2.3) -----------------------
//
// A plan whose DESIGN.md has no valid setup/test block counts as not reviewed: the engine could not run
// its tests at the end, so it is not ready to be built by it. Read from the plan's home (planHome,
// pir-plan-command §2.9), the same copy readReviewGate reads: the main checkout's when the plan is
// there, because that is the copy a narrow review pass fixes, else the committed pir/{slug} branch.
export function readTestBlockGate(slug, { root = process.cwd(), exec, fs } = {}) {
  const text = planHome(slug, { root, exec, fs }).read('DESIGN.md');
  if (text == null) return { ok: false, reason: 'no DESIGN.md' };
  return parseTestBlock(text);
}

// The refusal both entry points print (the coordinator bin here, `pir` via launch.mjs's no-test-block).
export function testBlockRefusal(slug, detail) {
  return (
    `cannot start '${slug}': plans/${slug}/DESIGN.md has no valid setup/test block (${detail}).\n` +
    `A plan without one counts as not reviewed. Run /pir-review-plan ${slug} to add it.\n`
  );
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

// startCoordinator({ slug, repo, platform, worktree, maxWorkers, control, runTests, startAgent }) → the
// controller the bin drives. `startAgent({ featurePath, askRules })` → a CoordinatorAgent
// (coordinator-agent.mjs), called once the feature worktree is open; null runs without one (DESIGN §2.1,
// `--no-coordinator` / PARALLEL_COORDINATOR=0), which is exactly the run as it was before the agent. `platform` and `worktree` are injected (the fakes in tests, the real CLI+git in
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
  prepare,
  holdMerges = false,
  startAgent = null,
  startFinisher = null,
  priorFinisher = () => null,
  lastWords = lastWordsOf,
  readLog = readLogEntries,
  now = () => Date.now(),
  holdMs = holdLimitMs(),
  // The run's base branch (base-branch DESIGN §2.5): the bin passes the one it resolved at start and the
  // end of the run syncs with it. The default serves only the tests that drive a `main` scratch repo.
  base = 'main',
  // The end-of-run sync's two clocks (base-branch DESIGN §2.8): a held sync retries every `retryMs`, and
  // while the run waits for the person's merge the remote is fetched every `watchMs`. Compared against
  // `now()`, so a test steps them without waiting.
  retryMs = 60_000,
  watchMs = DEFAULT_BASE_WATCH_MS,
} = {}) {
  if (!slug) throw new Error('startCoordinator: no slug');
  const RUN_BASE = base;
  const RUN_BASE_REF = `refs/heads/${base}`;
  if (!repo) throw new Error('startCoordinator: no repo (worker names are built from it, DESIGN §2.8)');
  if (!platform || !worktree) throw new Error('startCoordinator: platform and worktree must be injected');

  const state = createRunState();
  const passOpts = { platform, worktree, repo, slug, maxWorkers, state };
  if (control) passOpts.control = control;
  if (runTests) passOpts.runTests = runTests;
  if (prepare) passOpts.prepare = prepare;
  if (holdMerges) passOpts.holdMerges = true;

  // The account of what one pass did, in the shape the skill acts on. It re-expresses the loop's raw
  // actions as the things the skill has to do something about: surface a decision, report a task
  // reaching ✅, and know when the run is done or blocked. There is no auto/you distinction any more,
  // so nothing is a hands-on worker the user must go drive (§2.5) — a task that needs the person is an
  // ordinary worker that parks and asks, which surfaces like any other question.
  // --- The coordinator agent in front of the person (pir-coordinator DESIGN §2.3–§2.5, §2.11, §3.6) ---
  //
  // Every waiting item is briefed to the agent the first pass it is waiting (waitingItems uses the same
  // predicate as the row), and it is the agent's from then until it is answered or passed on. A reserved
  // item is briefed for a note but is the person's from the start; an item that first waits while the
  // agent is down is the person's for good. The person may answer any item at any time: the first answer
  // wins and the agent is told. `held` is what the row, the clock and Remote Control read (heldByAgent).
  //
  // The hold limit (DESIGN §2.11, T13): an item held `holdMs` without a decision leaves `held` and is the
  // person's as if passed on; the agent is told, and may still answer it until the person does. The time
  // is the pass's `now()`, and a timed-out item that is still waiting is never held again.
  let agent = null;
  let agentTried = false;
  let askRules = [];
  const held = new Map(); // itemKey → the item, while the agent holds it
  const seen = new Map(); // itemKey → the item, every item waiting last pass (briefed or not)
  const heldAt = new Map(); // itemKey → when the agent began holding it (the pass's now())
  const timedOut = new Map(); // itemKey → the item, handed to the person by the hold limit, still waiting
  // itemKey → the item, for a reserved item the agent was briefed on for a note (T15). Never held: the row,
  // the tally and Remote Control do not read it. Kept only so the agent is told who answered it and what.
  const reserved = new Map();
  // Keys of timed-out items the agent then passed on: a pass is a decision of its own, so the person's later
  // answer is not reported (T15). They stay in `timedOut` so a later decision is still ledgered `late`.
  const passedLate = new Set();
  // Items the agent answered this pass. A `message` to a report park lands after runPass read the park, so
  // the task stays parked until the next pass's resumeAnswered sees the coordinator send; counting the item
  // as the agent's until then keeps its worker off Remote Control (DESIGN §2.5). One pass only: whatever is
  // still waiting after it is the person's.
  let justSettled = new Set();
  // itemKey → the item, for an item the agent passed on to the person (reliable-notifications T05). Only
  // whyPerson reads it: the alert names why a question is the person's, and without this the routing
  // forgets a pass the moment it lands. Released with the other maps.
  const passed = new Map();
  // itemKey → the order it was first seen waiting, so whyPerson can name a worker's oldest item's reason.
  const firstSeen = new Map();
  let seenCount = 0;

  // The end of the run (T05): on only when the run has an agent (startAgent given); with
  // `--no-coordinator` the end is today's. `handoff` is null until the end gate has run.
  const endOfRun = startAgent !== null;
  let handoff = null;
  // The finisher (finisher DESIGN §2.1, §2.8, §2.12, T05): `startFinisher({ featurePath, askRules,
  // reportPath })` → a Finisher (finisher-agent.mjs), called once the end sequence settles `ready`; only
  // with the agent on. `priorFinisher()` → the stored `finisher/state.json` of this run, or null: present
  // means pir restarted over a finisher, which is resumed instead of the agent. `handoff.finisher` is
  // null | 'starting' | 'on' | 'fallback' (today's ready-to-merge wait, for good).
  const withFinisher = endOfRun && startFinisher !== null;
  const prior = withFinisher ? priorFinisher() ?? null : null;
  let finisher = null;
  let agentClosedForFinisher = false;
  let lastTasks = [];
  const adopted = []; // tasks adopted into the plan while the agent was alive, for the report

  const briefItem = (item, workers) => {
    const t = state.tasks[item.task];
    const brief = { ...item };
    if (t?.name) brief.name = t.name; // an end-of-run helper (main-sync, tests-fix), which holds no task of the plan
    else if (t?.slug) brief.name = workerName({ repo, plan: slug, task: item.task, slug: t.slug, role: t.role ?? 'implement' });
    if (item.kind === 'report') {
      const words = lastWords(workers.find((w) => w.id === item.worker)?.logPath);
      if (words) brief.lastWords = words;
    }
    return brief;
  };

  // The log a worker's item is read from, live or exited (platform.workers() lists both).
  const logOf = (worker, workers) => workers.find((w) => w.id === worker)?.logPath ?? platform.logPathOf?.(worker) ?? null;
  // closedOf(item, workers) → how the item stopped waiting (closingAnswer), read from the worker's log. A
  // report park is read from `since`, the log's length when it was first seen.
  const closedOf = (item, workers) => {
    try {
      return closingAnswer(readLog(logOf(item.worker, workers)), item, { since: item.since ?? 0 });
    } catch {
      return { by: 'unknown' };
    }
  };

  function route() {
    const out = { passed: [], report: null, close: false };
    if (!agent) return out;
    const alive = agent.alive();
    const t = now();
    justSettled = new Set();
    // A dead agent never leaves a worker waiting on it: what it held is the person's (DESIGN §2.11).
    if (!alive) {
      held.clear();
      heldAt.clear();
      timedOut.clear();
      reserved.clear();
      passedLate.clear();
      passed.clear();
    }
    const release = (key) => {
      held.delete(key);
      heldAt.delete(key);
      timedOut.delete(key);
      reserved.delete(key);
      passedLate.delete(key);
      passed.delete(key);
    };
    const workers = platform.workers();
    const items = waitingItems(state.tasks, workers, { askRules });
    const waitingNow = new Map(items.map((i) => [itemKey(i), i]));
    for (const key of firstSeen.keys()) if (!waitingNow.has(key)) firstSeen.delete(key);
    for (const key of waitingNow.keys()) if (!firstSeen.has(key)) firstSeen.set(key, seenCount++);
    // A passed item is the person's decision to close; the agent is not told who closed it (T15).
    for (const key of passed.keys()) if (!waitingNow.has(key)) passed.delete(key);

    // Briefed items (held, timed out or reserved) no longer waiting were closed without a decision of the
    // agent's (DESIGN §2.3, T15): the agent is told who closed each and the answer, once. Read before the
    // drain, so a late decision for one (the T09 `pass`) is refused with the same facts. An item the agent
    // answered or passed on left these maps on the pass it did so, so it is never reported.
    for (const map of [held, timedOut, reserved]) {
      for (const [key, item] of map) {
        if (waitingNow.has(key)) continue;
        const quiet = passedLate.has(key);
        release(key);
        if (alive && !quiet) agent.answeredElsewhere(item, closedOf(item, workers));
      }
    }

    // A `close` is accepted only once the run waits in `ready to merge` (DESIGN §2.10).
    const ready = handoff?.step === 'waiting';
    const drained = alive
      ? agent.drain(items, { ready, late: new Set(timedOut.keys()), closedOf: (i) => closedOf(i, workers) })
      : { passed: [], settled: [] };
    const settled = new Set((drained.settled ?? []).map(itemKey));
    for (const key of settled) release(key);
    justSettled = settled;
    for (const p of drained.passed ?? []) {
      // A late pass of a timed-out item changes nothing on screen: it is the person's already (T13). It
      // stays in `timedOut`, so a later decision for it is still ledgered `late: true`.
      held.delete(itemKey(p));
      heldAt.delete(itemKey(p));
      reserved.delete(itemKey(p));
      if (timedOut.has(itemKey(p))) passedLate.add(itemKey(p));
      passed.set(itemKey(p), waitingNow.get(itemKey(p)) ?? p);
      out.passed.push(p);
      control?.log?.(`coordinator-pass ${waitingNow.get(itemKey(p))?.task ?? p.worker}`);
    }
    if (drained.report) out.report = drained.report;
    if (drained.close) out.close = true;

    // The hold limit (T13): checked after the drain, so a decision landing on the pass the limit passes wins.
    for (const [key, item] of held) {
      const heldForMs = t - (heldAt.get(key) ?? t);
      if (heldForMs < holdMs) continue;
      held.delete(key);
      heldAt.delete(key);
      timedOut.set(key, item);
      control?.log?.(`coordinator-timeout ${item.task ?? item.worker}`);
      agent.timedOut?.(item, { holdMs, heldForMs });
    }
    // An item gone from the wait is forgotten, so the same worker's next park is briefed afresh.
    for (const [key, item] of seen) if (!waitingNow.has(key)) agent.forget?.(item);

    for (const [key, item] of waitingNow) {
      if (seen.has(key) || settled.has(key)) continue;
      if (!alive) continue; // first waiting while the agent is down: the person's
      // A report park has no requestId to find its answer by: the log's length now marks where to read from.
      if (item.kind === 'report') item.since = readLog(logOf(item.worker, workers)).length;
      const briefed = agent.brief(briefItem(item, workers));
      if (briefed && item.reserved) reserved.set(key, item);
      else if (briefed) {
        held.set(key, item);
        heldAt.set(key, t);
      }
    }
    seen.clear();
    for (const [key, item] of waitingNow) seen.set(key, item);
    return out;
  }

  // whyPerson() → Map<workerId, 'passed'|'timeout'|'reserved'|'unavailable'|'off'> (reliable-notifications
  // DESIGN §2.1, T05): for each live worker with a waiting item that is the person's (not in heldByAgent()),
  // why, from its oldest such item. It reads the current waiting items against the maps route() left, and
  // changes nothing. A worker waiting with no item (waitingOn without itemsOf) is absent: its reason is null.
  function whyPerson() {
    const out = new Map();
    const alive = agent?.alive() ?? false;
    const heldNow = alive ? new Set([...held.keys(), ...justSettled]) : new Set(); // as heldByAgent()
    const items = waitingItems(state.tasks, platform.workers(), { askRules });
    const order = (i) => firstSeen.get(itemKey(i)) ?? Infinity;
    const byWorker = new Map();
    for (const item of items) {
      if (heldNow.has(itemKey(item))) continue;
      const prev = byWorker.get(item.worker);
      // The oldest by first-seen pass; an item not yet routed is newest; ties keep the listed order.
      if (!prev || order(item) < order(prev)) byWorker.set(item.worker, item);
    }
    for (const [worker, item] of byWorker) out.set(worker, reasonOf(item, alive));
    return out;
  }
  function reasonOf(item, alive) {
    if (startAgent === null) return 'off';
    if (!agent || !alive) return 'unavailable';
    const key = itemKey(item);
    if (timedOut.has(key)) return 'timeout';
    if (item.reserved || reserved.has(key)) return 'reserved';
    if (passed.has(key)) return 'passed';
    // Never briefed (first waiting while the agent was down), its brief failed, or held when the agent died.
    return 'unavailable';
  }

  // closeAgent({ immediate }) → the agent's session ended (teardown, HALT). `immediate` is teardownRun's:
  // called from a signal handler just before process.exit, so the SIGTERM goes now, as platform.close does.
  function closeAgent({ immediate = false } = {}) {
    if (!agent) return;
    const a = agent;
    const pid = a.session?.pid ?? null;
    a.close(immediate ? { graceMs: 0 } : undefined).catch(() => {});
    if (immediate && pid) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // already gone
      }
    }
  }

  function pass() {
    if (handoff) return endPass();
    const r = runPass(passOpts);
    const of = (type) => r.actions.filter((a) => a.type === type);

    // Started once the feature worktree is open, so its settings and plan files are the current ones.
    // A restart over a finisher resumes the finisher, not the agent: the agent's work ended with the report.
    if (startAgent && !agentTried && state.feature && prior) {
      agentTried = true;
      agentClosedForFinisher = true;
      askRules = readAskRules(state.feature.path);
      control?.log?.('coordinator agent not started: the finisher is resumed');
    }
    if (startAgent && !agentTried && state.feature) {
      agentTried = true;
      askRules = readAskRules(state.feature.path);
      try {
        agent = startAgent({ featurePath: state.feature.path, askRules });
        control?.log?.('coordinator agent started');
      } catch (err) {
        // A run without its agent is today's run: every item is the person's.
        control?.log?.(`coordinator agent failed to start: ${err?.message ?? err}`);
      }
    }
    if (r.halted) closeAgent();
    const routed = r.halted ? { passed: [], report: null, close: false } : route();

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
    // A task adopted into the plan while the agent was on is a notable decision (DESIGN §2.7): only the
    // agent or the person can have approved it. It goes in the ledger, so the report lists it after a
    // pir restart too.
    if (agent?.alive()) {
      for (const a of of('adopt')) {
        const name = r.tasks.find((t) => t.num === a.task)?.name ?? null;
        adopted.push({ task: a.task, name });
        agent.record?.({ kind: 'adopt', task: a.task, name, item: `new task ${a.task}${name ? ` (${name})` : ''}`, answer: 'adopted into the plan', reason: 'a worker added it with approval', notable: true });
      }
    }

    const assigned = new Set(Object.keys(state.tasks));
    const waiting = readyWaiting(r.tasks, assigned);
    const ceilingFull = !r.halted && r.liveAfter >= maxWorkers && waiting.length > 0;
    if (ceilingFull && control) {
      control.log(`ceiling full: ${r.liveAfter}/${maxWorkers} busy, waiting: ${waiting.join(', ')}`);
    }

    // The end of the run with the agent (DESIGN §2.9): once the end gate has run, the next passes sync
    // main, get the report written and wait in `ready to merge`. Without the agent the run ends here, as
    // it always did.
    if (r.complete && endOfRun) {
      lastTasks = r.tasks;
      // A red gate gets its one test-fix worker before the sync (T10, user 2026-09-27).
      const gate = r.testsPassed ? 'green' : 'red';
      handoff = {
        state: 'preparing', step: gate === 'red' ? 'fix' : 'sync', gate, gateReason: r.testsReason ?? null, tests: null, testsReason: null,
        sync: null, baseSha: null, reportPath: null, finished: null, fix: null, fixUsed: false, fixAfter: null,
        // The base-branch sync (base-branch DESIGN §2.8): the hold while the base cannot be prepared, the
        // remote it was fetched from, the local base's tip at the last sync (a move of it re-syncs), and
        // the watch clock while waiting for the merge.
        hold: null, remote: null, localSeen: null, watchFrom: null, lastWatch: null, lastWatchFailure: null,
        // The finisher (finisher DESIGN §2.1, §2.12): null until the hand-over, then 'starting', 'on' or
        // 'fallback' with its reason; `resynced` marks a re-sync it has yet to be told of.
        finisher: null, fallback: null, resynced: false,
      };
    }

    return {
      handoff: handoffView(),
      finished: null,
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
      // Tasks whose setup is still running (DESIGN §2.4) — work in flight, so drive() and the bin never
      // count such a pass as quiet.
      preparing: r.preparing ?? 0,
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
      // What the coordinator agent returned this pass: items it passed on, and its report / close
      // decisions for the end of the run (T05).
      agent: routed,
    };
  }

  // --- The end of the run with the agent on (pir-coordinator DESIGN §2.9–§2.11, T05) ---
  //
  // One step per pass, so the display stays live: (a red gate: one test-fix worker, T10) → sync main into
  // the feature branch → (a conflict: a worker in the feature worktree finishes the merge) → tests (red, and
  // no fix worker yet this sequence: one now) → brief the agent → its `report` → REPORT.md
  // committed → hand-off told → `ready to merge` (or `red`). Waiting there, each pass: main holds the tip
  // (the person merged) or a `close` from the agent ends the run; main moved without it → re-sync, rewrite
  // the report's footer, commit, tell the agent. A restart in `ready` finds REPORT.md already committed and
  // takes the re-sync path, so the report is not rewritten.
  function handoffView() {
    if (!handoff) return null;
    // `unresolved` (main-sync left unresolved) is what the end-of-run alert names as the red cause
    // (reliable-notifications DESIGN §2.4). Only present when true, so the view's shape (and status.json)
    // is unchanged for every other run.
    const view = {
      state: handoff.state,
      reportPath: handoff.reportPath,
      baseSha: handoff.baseSha,
      base: RUN_BASE,
      // Why the run is held in `preparing` (base-branch DESIGN §2.8), or null; the live view shows its text.
      hold: handoff.hold ? { ...handoff.hold } : null,
      lastWatch: handoff.lastWatch,
      lastWatchFailure: handoff.lastWatchFailure,
    };
    if (handoff.sync?.state === 'unresolved') view.unresolved = true;
    // Only once the finisher is in play, so a run without one keeps the view's old shape.
    if (handoff.finisher) view.finisher = handoff.finisher;
    if (handoff.fallback) view.fallback = handoff.fallback;
    return view;
  }

  const reportRel = join('plans', slug, 'REPORT.md');
  const planFile = (name) => {
    try {
      return readFileSync(join(state.feature.path, 'plans', slug, name), 'utf8');
    } catch {
      return '';
    }
  };
  const endRecord = (actions) => (type, extra = {}) => {
    actions.push({ type, ...extra });
    control?.log?.(`${type} ${extra.task ?? ''}`.trim());
  };
  const isoNow = () => new Date(now()).toISOString().replace(/\.\d+Z$/, 'Z');
  const branchReady = () => handoff.tests === 'green' && handoff.sync?.state !== 'unresolved';
  const fixResult = () => (handoff.fix === 'green' || handoff.fix === 'red' ? handoff.fix : null);
  const footerNow = () =>
    branchFooter({ baseSha: handoff.sync?.baseSha ?? null, base: RUN_BASE, tests: handoff.tests, syncedAt: isoNow(), unresolved: handoff.sync?.state === 'unresolved', fix: fixResult() });
  const settle = () => {
    handoff.state = branchReady() ? 'ready' : 'red';
    handoff.baseSha = handoff.sync?.baseSha ?? handoff.baseSha;
    handoff.step = 'waiting';
    // The first remote check of the wait is one watch interval from now.
    handoff.watchFrom = now();
  };

  // prepareRunBase(mode) → prepareBase's result for the run's base (base-branch DESIGN §2.3). A worktree
  // without prepareBase (a hand-built stub) has no remote to ask, so its local base is the answer. A throw
  // is held like an unreachable remote: the run waits and retries rather than dying at its last step.
  const prepareRunBase = (mode) => {
    try {
      if (worktree.prepareBase) return worktree.prepareBase(RUN_BASE, { mode });
      const sha = worktree.baseTip({ ref: RUN_BASE_REF });
      return sha ? { ok: true, sha, remote: null, local: 'keep' } : { ok: false, reason: 'no-base-branch', remote: null };
    } catch (err) {
      return { ok: false, reason: 'fetch-failed', remote: handoff.remote, error: String(err?.message ?? err) };
    }
  };
  const trackingRef = () => (handoff.remote ? `refs/remotes/${handoff.remote}/${RUN_BASE}` : null);

  // holdSync(prep, rec) → the base could not be prepared (fetch-failed, diverged): stay in `preparing`
  // with the reason, retry after retryMs (DESIGN §2.8). `since` is kept while the reason stays the same,
  // so the view and the one alert per reason see one hold, not a new one every minute.
  function holdSync(prep, rec) {
    const t = now();
    const same = handoff.hold?.reason === prep.reason;
    if (prep.remote) handoff.remote = prep.remote;
    handoff.hold = { reason: prep.reason, text: holdText(prep, { base: RUN_BASE }), since: same ? handoff.hold.since : t, nextTry: t + retryMs };
    handoff.state = 'preparing';
    handoff.step = 'sync';
    if (!same) {
      rec('base-hold', { reason: prep.reason });
      if (prep.error) control?.log?.(`base-hold ${prep.reason}: ${prep.error}`);
    }
  }

  // An end-of-run helper worker (main-sync, tests-fix): spawned in the feature worktree under its task
  // label, held in state.tasks under that label so its reports and parks are read like a task worker's.
  function spawnHelper(label, role, prompt) {
    const name = `${repo} / ${slug} / ${label}`;
    const id = platform.spawn({ cwd: state.feature.path, name, phase: role, task: label, opening: mainSyncOpening(prompt) });
    state.tasks[label] = { worktree: state.feature, workerId: id, role, slug: label, name, phase: 'implementing' };
    return id;
  }

  // helperFinished(label, listed) → true once the helper has reported done or is gone (closed and dropped
  // from state.tasks), false while it still works or waits on a question.
  function helperFinished(label, listed) {
    const t = state.tasks[label];
    const live = t && listed.some((w) => w.id === t.workerId);
    if (t && t.phase !== 'done' && live) return false;
    if (t) {
      platform.close(t.workerId);
      platform.remove?.(t.workerId);
      state.closedIds.add(t.workerId);
      delete state.tasks[label];
    }
    return true;
  }

  function spawnSyncWorker(files) {
    return spawnHelper(MAIN_SYNC_TASK, 'sync', buildConflictPrompt({ kind: 'main-sync', slug, plan: slug, files, base: RUN_BASE, audience: 'worker' }));
  }

  // The one test-fix worker of an end sequence (T10, DESIGN §2.9 step 1, user 2026-09-27). `after` is
  // where the sequence goes once it is done: 'sync' from a red gate, else the report (brief or footer).
  function startFix(rec, after, reason) {
    handoff.fixUsed = true;
    handoff.fixAfter = after;
    handoff.fix = 'running';
    const prompt = buildConflictPrompt({ kind: 'tests-red', slug, plan: slug, testsReason: reason?.reason ?? null, logPath: reason?.logPath ?? null, audience: 'worker' });
    const id = spawnHelper(TESTS_FIX_TASK, 'fix', prompt);
    rec('spawn', { task: TESTS_FIX_TASK, role: 'fix', workerId: id });
    handoff.step = 'fixing';
  }

  function endFix(rec) {
    // A restart after the person merged while pir was down: nothing to fix, endSync finishes it as merged.
    if (existsSync(join(state.feature.path, reportRel)) && worktree.baseContains(state.feature.branch, { refs: [RUN_BASE_REF] })) {
      handoff.step = 'sync';
      return;
    }
    startFix(rec, 'sync', handoff.gateReason);
  }

  function endFixing(rec, listed) {
    if (!helperFinished(TESTS_FIX_TASK, listed)) return;
    runEndTests();
    handoff.fix = handoff.tests;
    rec('tests-fix', { state: handoff.fix });
    rec('tests', { state: handoff.tests });
    handoff.step = handoff.fixAfter === 'sync' ? 'sync' : handoff.rewrite ? 'footer' : 'brief';
  }

  function endSync(rec) {
    const existing = existsSync(join(state.feature.path, reportRel));
    handoff.rewrite = existing;
    // A restart after the person merged while pir was down: the base already holds the tip. Syncing now
    // would merge the base back into the branch, move its tip past the base, and wait in ready for a merge
    // already done.
    const mergedInto = (refs) => {
      if (!existing || !worktree.baseContains(state.feature.branch, { refs })) return false;
      handoff.reportPath = reportRel;
      handoff.baseSha = worktree.baseTip?.({ ref: refs[0] }) ?? handoff.baseSha;
      handoff.hold = null;
      handoff.tests ??= handoff.gate;
      handoff.state = handoff.tests === 'green' ? 'ready' : 'red';
      handoff.step = 'waiting';
      // After a go the finisher's own merge put the tip in the base; the run ends only on its done or close
      // (finisher DESIGN §2.8), so the restarted run waits in ready and resumes it.
      if (prior?.goGiven === true && handoff.finisher === null) return true;
      finish('merged', rec);
      return true;
    };
    if (mergedInto([RUN_BASE_REF])) return;
    // Held: nothing until the retry interval has passed (DESIGN §2.8).
    if (handoff.hold && now() < handoff.hold.nextTry) return;
    // Never merge a base this sync did not just try to fetch (DESIGN §2.8, §2.3).
    const prep = prepareRunBase('start');
    if (!prep.ok) {
      holdSync(prep, rec);
      return;
    }
    if (handoff.hold) rec('base-hold', { reason: null });
    handoff.hold = null;
    if (prep.remote) handoff.remote = prep.remote;
    // The merge may have been done on the remote only (a pull request merged on GitHub): its copy holds it.
    if (mergedInto([prep.sha])) return;
    handoff.localSeen = worktree.baseTip({ ref: RUN_BASE_REF });
    let res;
    try {
      res = worktree.syncBase(state.feature.path, { baseSha: prep.sha, base: RUN_BASE });
    } catch (err) {
      control?.log?.(`main-sync failed: ${err?.message ?? err}`);
      handoff.sync = { state: 'unresolved', baseSha: prep.sha, files: [] };
      handoff.tests = 'red';
      handoff.step = existing ? 'footer' : 'brief';
      return;
    }
    rec('main-sync', { state: res.state });
    handoff.sync = { state: res.state, baseSha: res.baseSha, files: res.files ?? [] };
    if (res.state === 'up-to-date') {
      handoff.tests ??= handoff.gate;
      if (existing && handoff.fix) {
        // A restart in a red `ready`, and this sequence's fix worker ran: its result goes in the footer.
        handoff.step = 'footer';
      } else if (existing) {
        // A restart in `ready` (DESIGN §2.11): nothing moved, so the committed report stands as it is.
        handoff.reportPath = reportRel;
        settle();
      } else handoff.step = 'brief';
      return;
    }
    if (res.state === 'merged') {
      handoff.step = 'tests';
      return;
    }
    const id = spawnSyncWorker(res.files ?? []);
    rec('spawn', { task: MAIN_SYNC_TASK, role: 'sync', workerId: id });
    handoff.step = 'syncing';
  }

  function endSyncing(rec, listed) {
    if (!helperFinished(MAIN_SYNC_TASK, listed)) return; // still resolving, or parked on a question
    if (worktree.syncPending(state.feature.path)) {
      // The worker reported done without finishing the merge, or exited: the conflict stands unresolved,
      // the merge is abandoned so the branch is clean, and the report says the branch is not ready.
      worktree.abortSync(state.feature.path);
      handoff.sync.state = 'unresolved';
      handoff.tests = 'red';
      rec('main-sync', { state: 'unresolved' });
      handoff.step = handoff.rewrite ? 'footer' : 'brief';
      return;
    }
    handoff.sync.state = 'resolved';
    rec('main-sync', { state: 'resolved' });
    handoff.step = 'tests';
  }

  function runEndTests() {
    const res = (passOpts.runTests ?? (() => ({ ok: true })))(state.feature.path, { tasks: lastTasks });
    handoff.tests = res.ok ? 'green' : 'red';
    handoff.testsReason = res.ok ? null : { reason: res.reason ?? null, logPath: res.logPath ?? null };
    return res;
  }

  function endTests(rec) {
    runEndTests();
    rec('tests', { state: handoff.tests });
    // Red after the sync, and this sequence has had no fix worker yet: its one attempt (T10).
    if (handoff.tests === 'red' && !handoff.fixUsed) {
      startFix(rec, 'report', handoff.testsReason);
      return;
    }
    handoff.step = handoff.rewrite ? 'footer' : 'brief';
  }

  // A re-sync (main moved while waiting, or a restart in ready) rewrites only the report's footer.
  function endFooter(rec) {
    const path = join(state.feature.path, reportRel);
    let text = '';
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      // gone from the worktree: rewritten below with only the footer, as the branch had it
    }
    writeFileSync(path, replaceFooter(text, footerNow()));
    worktree.commitFeature(`report(${slug}): re-synced with ${RUN_BASE}`);
    rec('report', { resync: true });
    handoff.reportPath = reportRel;
    settle();
    if (agent?.alive()) agent.tell(resyncedFor({ slug, baseSha: handoff.sync?.baseSha, base: RUN_BASE, tests: handoff.tests, unresolved: handoff.sync?.state === 'unresolved' }));
  }

  function endBrief() {
    if (agent?.alive()) {
      const facts = endFacts({
        tasks: parseProgress(planFile('PROGRESS.md')).tasks,
        ledger: agent.ledger(),
        findings: findingRows(planFile('FINDINGS.md')),
        unverified: unverifiedTasks(planFile('PROGRESS.md')),
        sync: handoff.sync,
        tests: handoff.tests,
        fix: fixResult(),
        base: RUN_BASE,
      });
      if (agent.briefEnd(facts)) handoff.step = 'report';
      return;
    }
    // Given up, or never started: carry on without it (DESIGN §2.11). One merely restarting is waited for.
    if (!agent || agent.givenUp?.()) endWrite(null);
  }

  function endWrite(sections) {
    const ledger = agent ? agent.ledger() : [];
    const text = assembleReport({ slug, sections, notable: notableDecisions(ledger, adopted), footer: footerNow() });
    writeFileSync(join(state.feature.path, reportRel), text);
    worktree.commitFeature(`report(${slug}): delivery report`);
    control?.log?.(`report ${reportRel}`);
    handoff.reportPath = reportRel;
    settle();
    const ready = handoff.state === 'ready';
    if (agent?.alive()) agent.tell(handoffFor({ slug, reportPath: reportRel, ready, report: text, base: RUN_BASE, finisher: ready && withFinisher }));
  }

  function finish(by, rec) {
    handoff.finished = by;
    rec('finished', { by });
    closeAgent();
    closeFinisher();
  }

  // closeFinisher({ immediate }) → the finisher's session ended (the run's end, HALT, teardown), as
  // closeAgent does for the agent.
  function closeFinisher({ immediate = false } = {}) {
    if (!finisher) return;
    const f = finisher;
    const pid = f.session?.pid ?? null;
    f.close(immediate ? { graceMs: 0 } : undefined).catch(() => {});
    if (immediate && pid) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // already gone
      }
    }
  }

  // today's ready-to-merge wait, for good (DESIGN §2.12): the finisher failed to start, gave up, or the
  // branch turned red under it (user 2026-09-29: close it; the run waits as a red run does today).
  function fallBack(why, rec) {
    handoff.finisher = 'fallback';
    handoff.fallback = why;
    rec('finisher-fallback', { why });
    closeFinisher();
  }

  // The hand-over (DESIGN §2.1): the first pass the run waits in a green `ready` with the agent on.
  function handOver(rec) {
    closeAgent();
    agentClosedForFinisher = true;
    handoff.finisher = 'starting';
    try {
      finisher = startFinisher({ featurePath: state.feature.path, askRules, reportPath: reportRel });
    } catch (err) {
      control?.log?.(`finisher failed to start: ${err?.message ?? err}`);
      fallBack('failed', rec);
      return;
    }
    handoff.finisher = 'on';
    control?.log?.(prior ? 'finisher resumed' : 'finisher started');
    rec('finisher', { state: 'started' });
    if (finisher.givenUp?.()) {
      control?.log?.('finisher gave up');
      fallBack('gave-up', rec);
      return;
    }
    // A restart that died between the finisher's done and the run's end: nothing is left for it to do.
    if (finisher.phase?.() === 'done') {
      finish('finisher', rec);
      return;
    }
    // pir was down while the base moved and this start re-synced the branch: the finisher's old steps are void.
    if (prior && (handoff.sync?.state === 'merged' || handoff.sync?.state === 'resolved')) finisher.resynced(handoff.baseSha);
  }

  // Each pass with the finisher on (DESIGN §2.8): its statuses end the run; a hand merge ends it only
  // before the first go; main moving before a go re-syncs as today, then sends it back to preparing.
  function finisherWaiting(rec) {
    if (handoff.resynced) {
      handoff.resynced = false;
      if (handoff.state !== 'ready') {
        control?.log?.('finisher closed: the branch is not ready after the re-sync');
        fallBack('red', rec);
        return;
      }
      finisher.resynced(handoff.baseSha);
    }
    if (finisher.givenUp()) {
      control?.log?.('finisher gave up');
      fallBack('gave-up', rec);
      return;
    }
    const out = finisher.drain();
    for (const st of out.accepted ?? []) {
      if (st.kind === 'done') return finish('finisher', rec);
      if (st.kind === 'close') return finish('closed', rec);
    }
    if (finisher.goGiven()) return; // after a go only done or close end the run
    const seen = watchBase();
    if (seen === 'merged') finish('merged', rec);
    else if (seen === 'moved') {
      // The old go is void from this pass, not from the re-sync's end, which may be minutes of sync or fix
      // worker away (review T05).
      finisher.resyncing();
      handoff.resynced = true;
      resync(rec);
    }
  }

  // The base moved without the feature tip: re-sync so the hand-off still merges cleanly (§2.10).
  function resync(rec) {
    handoff.state = 'preparing';
    handoff.rewrite = true;
    // A re-sync whose tests turn red gets one fix attempt of its own (T10). The last sequence's fix
    // result is cleared too: the rewritten footer describes this sync, and a stale "stayed red" over
    // "Tests: green" would contradict itself.
    handoff.fixUsed = false;
    handoff.fix = null;
    handoff.step = 'sync';
    endSync(rec);
  }

  // watchBase() → 'merged' | 'moved' | null: one look at the base while the run waits for the merge
  // (base-branch DESIGN §2.8), shared by the plain wait and the finisher's before its go. Each pass reads
  // the local base; every watchMs the remote is fetched too (moving nothing but its remote-tracking ref),
  // so a merge done on GitHub is seen. A failed fetch is only noted.
  function watchBase() {
    const t = now();
    let watched = null;
    if (handoff.watchFrom == null) handoff.watchFrom = t;
    if (t - handoff.watchFrom >= watchMs) {
      handoff.watchFrom = t;
      watched = prepareRunBase('watch');
      if (watched.remote) handoff.remote = watched.remote;
      if (!watched.ok && watched.reason === 'fetch-failed') handoff.lastWatchFailure = t;
      else handoff.lastWatch = t;
    }
    const refs = [RUN_BASE_REF, trackingRef()].filter(Boolean);
    if (worktree.baseContains(state.feature.branch, { refs })) return 'merged';
    // Moved: the local base is not where the last sync left it, or the remote's newer copy is not what was
    // merged. Compared with the local tip at the sync, not the merged commit, since that may be the
    // remote's copy while the local branch stays behind it (a checked-out base with changes, §2.3).
    const localMoved = worktree.baseTip({ ref: RUN_BASE_REF }) !== handoff.localSeen;
    const remoteMoved = !!watched?.ok && watched.sha !== handoff.baseSha;
    return localMoved || remoteMoved ? 'moved' : null;
  }

  // The wait for the person's merge: the base holding the tip ends the run, the base moving without it
  // re-syncs.
  function endWait(rec) {
    const seen = watchBase();
    if (seen === 'merged') finish('merged', rec);
    else if (seen === 'moved') resync(rec);
  }

  function endPass() {
    const actions = [];
    const rec = endRecord(actions);
    const halted = control?.isHalted?.() ?? false;
    if (halted) {
      for (const label of HELPERS) {
        const t = state.tasks[label];
        if (t) platform.close(t.workerId);
      }
      closeAgent();
      closeFinisher();
      return endResult({ actions, halted: true, routed: { passed: [], report: null, close: false } });
    }

    // The helper workers' reports and answers (main-sync, tests-fix), read the way the loop reads a task
    // worker's: list() once (the fake's tick), then the inbox.
    const listed = platform.list().filter((w) => !state.closedIds.has(w.id));
    const messages = platform.inbox().filter((m) => HELPERS.includes(m.task));
    if (HELPERS.some((label) => state.tasks[label])) {
      applyMessages(state, messages, rec);
      resumeAnswered(state, new Map(listed.map((w) => [w.id, w])), rec);
    }
    const routed = route();

    switch (handoff.step) {
      case 'fix':
        endFix(rec);
        break;
      case 'fixing':
        endFixing(rec, listed);
        break;
      case 'sync':
        endSync(rec);
        break;
      case 'syncing':
        endSyncing(rec, listed);
        break;
      case 'tests':
        endTests(rec);
        break;
      case 'footer':
        endFooter(rec);
        break;
      case 'brief':
        endBrief();
        break;
      case 'report':
        if (routed.report) endWrite(routed.report);
        else if (!agent || agent.givenUp?.()) endWrite(null);
        break;
      case 'waiting':
        if (handoff.finisher === 'on') finisherWaiting(rec);
        else if (handoff.finisher === null && withFinisher && handoff.state === 'ready') handOver(rec);
        else if (routed.close) finish('closed', rec);
        else endWait(rec);
        break;
      default:
        break;
    }
    return endResult({ actions, halted: false, routed, listed });
  }

  function endResult({ actions, halted, routed, listed = [] }) {
    const surfaces = actions.filter((a) => a.type === 'surface').map(renderSurface);
    const live = listed.filter((w) => HELPERS.some((label) => w.id === state.tasks[label]?.workerId)).length;
    const waitingNow = handoff.step === 'waiting';
    return {
      handoff: handoffView(),
      finished: handoff.finished,
      actions,
      surfaces,
      spawned: [],
      reviewing: [],
      completed: [],
      restartSummary: null,
      closed: [],
      ceilingFull: false,
      waiting: [],
      live,
      preparing: 0,
      halted,
      complete: waitingNow,
      readyToMerge: waitingNow && handoff.state === 'ready' ? { branch: state.feature.branch } : null,
      testsPassed: handoff.tests === null ? undefined : handoff.tests === 'green',
      testsReason: handoff.tests === 'red' ? handoff.testsReason ?? handoff.gateReason ?? null : null,
      done: waitingNow,
      tasks: lastTasks,
      agent: routed,
      finisher: finisherView(),
    };
  }

  // finisherView() → the finisher for the run state (buildRunState's `finisher`): its view() while it is
  // the run's, null before the hand-over and once it has fallen back.
  function finisherView() {
    if (!finisher || handoff?.finisher !== 'on') return null;
    return finisher.view?.() ?? null;
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
      // A running setup is work in flight, not a parked worker: without this a 60 s `npm ci` would end
      // drive() as `parked` after two passes (DESIGN §2.4).
      const productive = r.actions.some((a) => PRODUCTIVE_ACTIONS.includes(a.type)) || r.preparing > 0;
      idle = productive ? 0 : idle + 1;
      if (idle >= 2) {
        return { reason: r.live > 0 ? 'parked' : 'stalled', passes: p, complete: false };
      }
    }
    return { reason: 'maxPasses', passes: maxPasses, complete: false };
  }

  return {
    state,
    pass,
    defer,
    drive,
    closeAgent,
    closeFinisher,
    // closeAll({ immediate }) → every session the controller holds (teardown, a signal).
    closeAll(opts) {
      closeAgent(opts);
      closeFinisher(opts);
    },
    // The agent, or null (not started, disabled, or failed to start).
    get agent() {
      return agent;
    },
    // The finisher while it is the run's session (DESIGN §2.1), else null: `pir`'s conversation view and
    // the notifier reach it through withAgent in its place once it has replaced the agent.
    get finisher() {
      return handoff?.finisher === 'on' ? finisher : null;
    },
    finisherView,
    // The keys of the items the agent holds now; empty while it is down, so every item is the person's.
    // The end-of-run state (T05) — null until the end gate has run with the agent on.
    get handoff() {
      return handoffView();
    },
    // The end-of-run step endPass runs next, or null before the end gate. Kept out of handoffView so the
    // view's shape (and status.json) is unchanged; main() compares it across a pass (passProgressed).
    get handoffStep() {
      return handoff?.step ?? null;
    },
    endOfRun,
    heldByAgent() {
      return agent?.alive() ? new Set([...held.keys(), ...justSettled]) : new Set();
    },
    whyPerson,
    // agentView() → the agent for the run state (buildRunState's `coordinator`), with `holding`, how many
    // waiting items it holds, for its row (T12). Counted from `held`, not the agent's own `briefed` map,
    // which also keeps reserved and already-answered items; `justSettled` is answered, so not held.
    agentView() {
      // Closed for the finisher: its row is gone (DESIGN §2.11), and runState.coordinator is null.
      if (agentClosedForFinisher) return null;
      const v = agent?.view?.();
      return v ? { ...v, holding: v.state === 'up' && agent.alive() ? held.size : 0 } : null;
    },
  };
}

// The end-of-run helper workers' task labels (pir-coordinator T05, T10): each holds no task of the plan.
const HELPERS = [MAIN_SYNC_TASK, TESTS_FIX_TASK];
// What each helper does, as its row's slug: kebab like a task's, and within the row's 22-column slug field.
const HELPER_SLUG = { [MAIN_SYNC_TASK]: 'resolve-base-merge', [TESTS_FIX_TASK]: 'fix-red-tests' };

// mainSyncOpening(prompt) → the opening instruction of an end-of-run helper worker: main-sync (T05) or
// tests-fix (T10). It runs under the pir-worker contract for asking the person and dropping its report,
// but its instruction is the helper's prompt, not a stock skill: it holds no task of the plan.
export function mainSyncOpening(prompt) {
  return (
    'You are a worker session in a parallel PIR run. Invoke the pir-worker skill and follow its contract for ' +
    'asking the person and dropping reports, but your instruction is neither pir-implement nor pir-review: do not ' +
    'run pir-work, do not pick a task, and carry out exactly this and nothing else.\n\n' +
    prompt
  );
}

// holdLimitMs(env) → the coordinator agent's hold limit (pir-coordinator DESIGN §2.11, T13): 5 minutes,
// or PARALLEL_COORDINATOR_HOLD_MS when it is a positive number (the live check and tests shorten it).
export const DEFAULT_HOLD_MS = 5 * 60 * 1000;
export function holdLimitMs(env = process.env) {
  const v = Number(env?.PARALLEL_COORDINATOR_HOLD_MS);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_HOLD_MS;
}

// baseWatchMs(env) → how often the wait for the person's merge fetches the remote (base-branch DESIGN §2.8):
// 5 minutes, or PARALLEL_BASE_WATCH_MS when it is a positive number. A test lever only: the harness's
// dev-base scenario merges on the remote and must see it within its budget (base-branch T09).
export const DEFAULT_BASE_WATCH_MS = 5 * 60 * 1000;
export function baseWatchMs(env = process.env) {
  const v = Number(env?.PARALLEL_BASE_WATCH_MS);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_BASE_WATCH_MS;
}

// coordinatorEnabled(env) → whether this run has a coordinator agent (pir-coordinator DESIGN §2.1): on by
// default; PARALLEL_COORDINATOR=0 (set by `pir start --no-coordinator`, and by the harness for a scenario
// that does not ask for the agent) turns it off, and the run is exactly as it was before the agent.
export function coordinatorEnabled(env = process.env) {
  return env.PARALLEL_COORDINATOR !== '0';
}

// readAskRules(featurePath) → the `permissions.ask` strings of the feature worktree's
// `.claude/settings.json` (pir-coordinator DESIGN §2.4: the plan review writes the §5.3 bins there). A
// missing or unreadable file, or no such key, is []: nothing is reserved by rule, and the rest of the
// rulebook (destructive commands, the SDK's flags) still holds.
export function readAskRules(featurePath) {
  try {
    const ask = JSON.parse(readFileSync(join(featurePath, '.claude', 'settings.json'), 'utf8'))?.permissions?.ask;
    return Array.isArray(ask) ? ask.filter((r) => typeof r === 'string') : [];
  } catch {
    return [];
  }
}

// lastWordsOf(logPath) → the worker's last assistant text in its conversation log, for a report park's
// brief (DESIGN §2.3), or null. Read on the pass the park is first briefed, never after.
export function lastWordsOf(logPath) {
  if (typeof logPath !== 'string' || !existsSync(logPath)) return null;
  let last = null;
  try {
    for (const line of readFileSync(logPath, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      for (const ev of readEntry(entry)) if (ev.kind === 'text' && ev.role === 'assistant' && ev.text.trim()) last = ev.text;
    }
  } catch {
    return null;
  }
  return last;
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

  // Drain the reports drop-dir: each *.json file is one worker report, read exactly once and removed,
  // in name order (drop-folder.mjs). A file that does not parse is dropped, never guessed into a message.
  const drainReports = () =>
    drainDropFolder(reportsDir, {
      parse: (raw) => {
        const { from = null, text = '' } = JSON.parse(raw);
        return { from, text };
      },
    });

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
// that is not a clean promotion/halt (a stall, a signal, an error) must close this run's live workers.
// Since live-workers T05 every worker is a child of this process, and teardownRun stays synchronous
// because it runs from signal handlers just before process.exit: `platform.close(id, { immediate })`
// ends the child's input queue and SIGTERMs its pid now, without waiting (live-workers DESIGN §2.12). A
// child that survives the SIGTERM is reaped from workers.json by the next start or a stop (T06).
// Closing an already-gone id is a safe no-op.
//
// It closes workers ONLY and never removes a task worktree or branch, on any exit. Those branches are
// the durable record of in-flight work, and the next `pir start {slug}` reconciles them from git: a 🔍 branch
// goes to review, a half-built one is resumed. Removing them on exit is what made a restart rebuild
// everything: on 2026-09-22 a full disk (ENOSPC) threw, the `error` teardown deleted a built T04, a
// built T06 and a half-built T07 in real-screen-time, and the next start implemented all three again.
// A run nobody restarts leaves its branches behind; docs/restart-recovery.md § Manual recovery covers
// removing them by hand.
//
// It also kills every running worker setup (DESIGN §2.4). Setup lines run detached, in their own process
// group, so a coordinator that exits without killing them leaves an `npm ci` running in a worktree the
// next start will set up again. teardownRun is on every exit path but a HALT (the loop kills those) and a
// clean completion (which has no task left, so no setup either).
export function teardownRun({ platform, state, repo, slug, control } = {}) {
  for (const [num, t] of Object.entries(state?.tasks ?? {})) {
    if (!t.setup) continue;
    try {
      t.setup.kill();
    } catch {
      /* already finished */
    }
    control?.log?.(`teardown: killed setup for ${num}`);
  }
  const closed = new Set();
  const closeId = (id, name) => {
    if (!id || closed.has(id)) return;
    try {
      platform.close(id, { immediate: true });
    } catch {
      /* already gone */
    }
    // remove (T41, DESIGN §2.3) is a no-op for live children; kept for a platform that holds a record.
    // Never the HALT forensics case, which the loop handles and never reaches here.
    try {
      platform.remove?.(id);
    } catch {
      /* best-effort; the close is what matters for orphan-avoidance */
    }
    closed.add(id);
    control?.log?.(`teardown: closed ${name ?? ''} (${id})`.trim());
  };

  // Every worker of THIS run the platform still lists: its live children.
  let live = [];
  try {
    live = platform.list().filter((w) => isWorkerOf(w.name, { repo, plan: slug }));
  } catch {
    live = [];
  }
  for (const w of live) closeId(w.id, w.name);
  // Plus any worker this run still tracks, so an id the list somehow lacks is still closed (a no-op on
  // an exited child). Cheap belt and braces from the `claude --bg` days, when a new session took a pass
  // to appear.
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
// marker the launcher sets (§3.5), so a bare `node src/shell/coordinate.mjs` run — which never sets it — writes
// no snapshot and touches no index entry, and the classic path is byte-for-byte unchanged.

// shouldSelfReport(env) → whether this run reports on itself. True only when PIR_RUN is set, which only
// the `pir` launcher (T08) does. The single gate the bin keys the whole self-reporting half on.
export function shouldSelfReport(env = process.env) {
  return !!env.PIR_RUN;
}

// finalStateForExit(reason) → the final status a given exit path records, or null for none (DESIGN §2.2,
// §7; T10 interface). Only a CLEAN end records a status: a completed hand-off (green OR red branch) and a
// stall ("nothing left to do") are `finished`; a stop is `stopped`. Every ABNORMAL exit — the HALT kill
// switch, the runaway breaker, an uncaught error — records NOTHING, so its snapshot and
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
// status onto its cross-repo index entry (DESIGN §2.8, §3.4; T10 interface). A thin call to the store's
// updateRecord, the one read-modify-write of an entry (plans/pir-plan-command T02, user at plan review
// 2026-09-26): it patches finalState and an updatedAt stamp and keeps every other field, writing back
// through the injected store's writeRecord. `indexStore` is null when the store module is not present
// (see the bin's lazy load), in which case this is a no-op; a missing or unparseable entry is likewise a
// no-op, never a throw, because the exit path must not fail on bookkeeping.
export function updateIndexFinalState({
  repo,
  slug,
  finalState,
  indexStore,
  readFile = readFileSync,
  now = () => new Date().toISOString(),
} = {}) {
  if (!indexStore) return { updated: false, reason: 'no-index-store' };
  // Only a failed read is the no-op; a failed write surfaces, as it did before the delegation.
  let writing = false;
  try {
    const record = updateRecord(
      { repo, slug },
      { finalState, updatedAt: now() },
      {
        dir: dirname(indexStore.recordPath(repo, slug)),
        fs: { readFileSync: readFile },
        write: (rec) => {
          writing = true;
          indexStore.writeRecord(rec);
        },
      },
    );
    return { updated: true, record };
  } catch (err) {
    if (writing) throw err;
    if (err && err.code === 'EUNPARSEABLE') return { updated: false, reason: 'unparseable-entry' };
    return { updated: false, reason: 'no-entry' }; // the launcher's entry is not there to update.
  }
}

// --- The runaway circuit-breaker verdict (DESIGN §5.2; ported from spawn-one-scratch.mjs, T12 P5) --
//
// The first live spawn-one-scratch run "ran away" to ~12 workers before a breaker existed; coordinate
// .mjs had none. A review handoff briefly holds CEILING+1 (the implementer is stopped async as the
// reviewer spawns — FINDINGS 2026-09-09), so a single over-ceiling worker is tolerated for `overGrace`
// consecutive passes; more than one over, or an overage that persists, is a real runaway. Pure so the
// bin's safety net is tested without a live process. `liveCount` is THIS run's workers only (the
// caller filters with isWorkerOf), so the coordinator's own session never trips it.
//
// Since passes wake on activity (fast-tests DESIGN §2.6) they can run 250 ms apart, and a hand-off takes
// seconds, so a pass count alone would abort it within a second. The single-over grace therefore also needs
// the overage to have held for `minHeldMs` (grace × the backstop period) since the first pass it held on:
// `overSince` is that pass's time, carried by the caller like `over`, and `now` is this pass's. Both
// default to a zero hold, which is the pass-count-only verdict. More than one over still aborts at once.
export function runawayVerdict({ liveCount, ceiling, overPasses = 0, overGrace = 3, overSince = null, now = 0, minHeldMs = 0 }) {
  if (liveCount <= ceiling) return { abort: false, over: 0, overSince: null };
  const over = overPasses + 1;
  const since = overSince ?? now;
  const held = over >= overGrace && now - since >= minHeldMs;
  return { abort: liveCount > ceiling + 1 || held, over, overSince: since };
}

// stallVerdict({ quiet, idlePasses, idleSince, now, grace, minHeldMs }) → { stalled, idle, idleSince }.
// `quiet` is this pass doing nothing productive with nothing live. The run is declared stalled once that
// has held for `grace` consecutive passes AND for `minHeldMs` (grace × the backstop period) since the first
// quiet pass (fast-tests DESIGN §2.6), so wake-driven passes a quarter-second apart never end a run early.
// Any pass that is not quiet resets both.
export function stallVerdict({ quiet, idlePasses = 0, idleSince = null, now = 0, grace = 3, minHeldMs = 0 }) {
  if (!quiet) return { stalled: false, idle: 0, idleSince: null };
  const idle = idlePasses + 1;
  const since = idleSince ?? now;
  return { stalled: idle >= grace && now - since >= minHeldMs, idle, idleSince: since };
}

// The action kinds main() and drive() call productive: a pass that took one did real work.
export const PRODUCTIVE_ACTIONS = ['spawn', 'review', 'merge', 'close'];

// passProgressed({ stepBefore, stateBefore, handoff, actions }) → boolean (fast-tests DESIGN §2.3).
// True when the pass moved the end of the run (`handoff.step` or `handoff.state` differ from before it) or
// took a productive action. The pass after such a pass often has work (endPass advances one step per pass;
// the --no-coordinator run's end gate is the pass after the last merge), yet nothing external wakes the
// loop for it, so main() wakes itself. A pass that changed nothing returns false and does not wake, so an
// idle run still sleeps on the backstop and STALL_GRACE keeps meaning quiet backstop periods.
// `handoff` is { step, state } after the pass, or null before the end gate has run.
export function passProgressed({ stepBefore = null, stateBefore = null, handoff = null, actions = [] } = {}) {
  if ((handoff?.step ?? null) !== stepBefore) return true;
  if ((handoff?.state ?? null) !== stateBefore) return true;
  return actions.some((a) => PRODUCTIVE_ACTIONS.includes(a.type));
}

// --- The end-of-run hand-off (DESIGN §2.4, §2.8) ----------------------------------------------
//
// When the plan is complete, the run stops at the feature branch and hands it to the person to merge
// by hand — the one irreversible act, the merge to main, is the person's `what`, not the program's
// (CLAUDE.md, §2.4). renderHandoff builds the line(s) main() prints from the loop's complete result.
// Pure, so the green/red wording is asserted without running the bin (DESIGN §2.3's pure-display
// stance). On green it hands over `git switch {base} && git merge pir/{slug}` (switching first, so it is
// right whichever branch the person has checked out; base-branch DESIGN §2.9); on red it names the
// failure and offers NO merge line, because telling the person a red branch is ready would be a lie the
// tests caught (§2.8). `why` is the red gate's reason and log path (loop.mjs 3f), printed so the person
// can tell a failing suite from a command that never ran.
export function renderHandoff({ readyToMerge, taskCount, slug, why, base = 'main' } = {}) {
  const branch = `pir/${slug}`;
  if (readyToMerge) {
    return (
      `✔ all ${taskCount} task(s) green on ${branch} · tests pass. Yours to merge:\n\n` +
      `  git switch ${base} && git merge ${branch}\n`
    );
  }
  return (
    `✗ all ${taskCount} task(s) built on ${branch}, but its tests fail — not ready to merge.\n` +
    (why ? `  ${why}\n` : '') +
    `Fix the feature branch, then merge it yourself. No merge is offered on a red branch.`
  );
}

// renderFinished({ by, slug, ready, reportPath, summary, base }) → the line printed when a run with the agent
// ends (pir-coordinator DESIGN §2.10): the person merged, or told the agent (or the finisher) to close the
// run; `finisher`: the finisher wrote done (finisher DESIGN §2.8), `summary` its done summary. Also
// `finisher-gave-up`, printed while the run goes on: the finisher could not start or gave up, and the run
// falls back to today's ready-to-merge wait with the merge line (DESIGN §2.12).
export function renderFinished({ by, slug, ready = false, reportPath = null, summary = null, base = 'main' } = {}) {
  const branch = `pir/${slug}`;
  const report = reportPath ? ` The report is ${reportPath}.` : '';
  if (by === 'merged') return `✔ ${branch} is in ${base}. The run is finished.${report}`;
  if (by === 'finisher') {
    const first = String(summary ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? 'the finisher is done';
    return `✔ finished: ${first}${report}`;
  }
  if (by === 'finisher-gave-up') {
    return (
      `✗ the finisher could not go on; nothing more will run for you.${report}\n` +
      `${branch} is ready to merge; it is yours to merge by hand:\n\n  git switch ${base} && git merge ${branch}\n`
    );
  }
  return (
    `✔ run closed.${report}\n` +
    (ready ? `${branch} is not merged; it is yours to merge when you want:\n\n  git switch ${base} && git merge ${branch}\n` : `${branch} is not merged and not ready to merge.`)
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

// parseCoordinateArgs(argv) → { ok: true, slug, base: string|null, baseSha: string|null } | { ok: false, error }
// `{slug} [--base <branch> [--base-sha <sha>]]`: `pir start` passes the base it resolved (and, for a
// feature branch it just cut, the commit), so the coordinator never re-reads the settings (base-branch
// DESIGN §2.7). A --base-sha without --base is refused: a commit with no branch name is not a base.
export function parseCoordinateArgs(argv = []) {
  let slug = null;
  let base = null;
  let baseSha = null;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--base' || a === '--base-sha') {
      const v = argv[i + 1];
      if (!v || v.startsWith('--')) return { ok: false, error: `${a} needs a value` };
      if (a === '--base') base = v;
      else baseSha = v;
      i += 1;
    } else if (a.startsWith('--')) {
      return { ok: false, error: `unknown option ${a}` };
    } else if (slug === null) {
      slug = a;
    } else {
      return { ok: false, error: `unexpected argument ${a}` };
    }
  }
  if (!slug) return { ok: false, error: null };
  if (baseSha && !base) return { ok: false, error: '--base-sha needs --base' };
  return { ok: true, slug, base, baseSha };
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
// The control folder is reused across a restart. clearTransientFeeds empties the two transient feeds —
// `reports/`, the worker up-channel (DESIGN §3.5), and `inbox/`, the person's input (live-workers T07) —
// so a dead run's leftovers never route into a fresh run. The two DURABLE records are never touched
// here — `log` is the audit trail and the harness signal, and `HALT` is the deliberate stop whose whole
// value is surviving a restart until a person removes it (auto-clearing it would defeat the kill switch,
// §2.7).
//
// Clearing runs on every startup, not only a detected restart: a genuine first start has reports/ empty,
// so an unconditional clear is safe and needs no restart detection (matches the reconciliation approach
// in §2.1). Each feed is a dir of one-file-per-drop, so emptying its *.json is the clear. Best-effort:
// a missing feed is nothing to clear, and its clear may never throw the run down. Returns what it
// touched, for the startup log line.
export function clearTransientFeeds(controlDir) {
  const cleared = [];

  // inbox/ is the person's input to workers (live-workers DESIGN §2.5, T07): an input addressed to a
  // previous run's worker must never reach a new one, so it is cleared with reports/. The coordinator
  // agent's decisions/ are the same kind of feed, naming workers and requests of a run that is gone
  // (pir-coordinator DESIGN §3.5); the rest of coordinator/ (ledger.jsonl, session.json) is durable.
  // The finisher's status/ is the same kind of feed (finisher DESIGN §3.5); its state.json, session.json and
  // ledger.jsonl are durable.
  for (const feed of ['reports', 'inbox', join('coordinator', 'decisions'), join('finisher', 'status')]) {
    const feedDir = join(controlDir, feed);
    try {
      if (!existsSync(feedDir)) continue;
      for (const n of readdirSync(feedDir)) {
        if (!n.endsWith('.json')) continue;
        try {
          unlinkSync(join(feedDir, n));
        } catch {
          /* vanished under us; nothing to clear for this one */
        }
      }
      cleared.push(`${feed}/`);
    } catch {
      /* cannot read the dir — best-effort, leave it */
    }
  }

  return { cleared };
}

// startupControlHygiene(control, { reap }) → the restart-hygiene step the bin runs once, before it stands
// up the loop (DESIGN §2.7, §7). First it reaps the previous coordinator's surviving workers from
// workers.json (live-workers T06, DESIGN §2.12: a child mid-command outlives a SIGKILLed parent, and no
// listing finds it since T05). The reap comes before the first pass, so a leftover worker is gone before
// reconcile adopts its branch and a fresh worker is spawned into its worktree; it also runs on a HALTed
// start, because a HALT stops every worker and a survivor of it is still a worker burning tokens. Then, if
// HALT is still present, it is a deliberate stop the person must lift, so this refuses ({ halted:true })
// and NEVER clears the flag — auto-clearing would blow a restarted run straight past the kill switch.
// Otherwise it clears the transient feeds and appends a `restart` marker to the preserved log (the
// audit-trail boundary between runs). Async only for the reap's SIGKILL window. Exported so every half is
// unit-tested without the live bin.
export async function startupControlHygiene(control, { reap = reapRecorded } = {}) {
  const { reaped } = await reap(control.dir);
  if (reaped.length) control.log(`startup: reaped leftover workers ${reaped.join(', ')}`);
  if (control.isHalted()) {
    return { halted: true, flag: control.flag, reaped };
  }
  const { cleared } = clearTransientFeeds(control.dir);
  control.log('restart');
  return { halted: false, cleared, reaped };
}

// waitForReport(dirs, timeoutMs, { watch }) → resolve as soon as anything lands in the reports drop-dir
// (and, since live-workers T07, the person's inbox/), or after timeoutMs (DESIGN §2.2). A worker's report
// or the person's input wakes the loop at once; the timeout is only a backstop for a missed fs.watch
// event. The watcher itself, including its survival of a runtime FSWatcher 'error' (T17), lives in
// drop-folder.mjs's waitForDrop, which the person inbox's forwarder shares.
export function waitForReport(dirs, timeoutMs, opts = {}) {
  return waitForDrop(dirs, timeoutMs, opts);
}

// Run the plan's declared setup and test lines on the feature worktree (DESIGN §2.5): the last gate
// before the run hands the branch off. The lines come from the front-matter block of the plan's home
// (planHome: the main checkout's plans/<slug>/DESIGN.md under `root`, else the committed pir/{slug}
// branch — pir-plan-command §2.9), never the feature worktree's copy: a feature branch cut
// before a narrow review pass wrote the block would otherwise still lack it (§2.2). No prose is read and
// nothing is guessed — an invalid block is red with the parser's reason and runs nothing. Setup runs
// first because the feature worktree is fresh (remote-e2e's `make server-test` exited 127 until `npm ci`).
// Both halves share one log: setup rewrites it, test appends, so the `$` headers read in run order. The
// env scrub and log format live in commands.mjs. Returns { ok, half, command, logPath, reason }; half is
// 'setup' or 'test' when a line failed, null otherwise; command names the failing line, null on green.
export function runFeatureTests(featurePath, { slug, logPath = null, root, exec, fs } = {}) {
  // No DESIGN.md reads as '' — the parser reports it as no front-matter block.
  const design = planHome(slug, { root, exec, fs }).read('DESIGN.md') ?? '';
  const block = parseTestBlock(design);
  if (!block.ok) {
    return { ok: false, half: null, command: null, logPath: null, reason: `plans/${slug}/DESIGN.md: ${block.reason}` };
  }

  const setup = runLines(block.setup, { cwd: featurePath, logPath });
  if (!setup.ok) return red('setup', setup);
  const tests = runLines(block.test, { cwd: featurePath, logPath, append: true });
  if (!tests.ok) return red('test', tests);
  return { ok: true, half: null, command: null, logPath: tests.logPath, reason: null };
}

function red(half, r) {
  return { ok: false, half, command: r.line, logPath: r.logPath, reason: `${half} ${r.reason}` };
}

// makePrepare({ design, setupDir, start }) → the loop's prepare(num, worktreePath) for this plan, or null
// when there is nothing to run (DESIGN §2.4). `design` is the text of the plan's DESIGN.md as planHome
// resolves it (§2.2; pir-plan-command §2.9). No setup lines — `setup: none`, or a block that does not parse (the start refusal, T03, keeps
// such a plan from running at all) — gives null, so the loop spawns in the dispatching pass as before.
// Otherwise each call starts the setup lines in the background in that worktree, logging to
// `{setupDir}/T{nn}.log`, rewritten per attempt; the loop polls the handle once per pass.
// `onSettled` is passed to each start, so a setup finishing wakes the loop (fast-tests DESIGN §2.1).
export function makePrepare({ design, setupDir, start = startLines, onSettled = () => {} } = {}) {
  const block = parseTestBlock(design);
  if (!block.ok || block.setup.length === 0) return null;
  return (num, worktreePath) => {
    try {
      mkdirSync(setupDir, { recursive: true });
    } catch {
      /* startLines runs without a log when it cannot open one */
    }
    return start(block.setup, { cwd: worktreePath, logPath: join(setupDir, `${num}.log`), onSettled });
  };
}

// --- Feeding the live display (DESIGN §2.3, §3.4) ---------------------------------------------
//
// The pure display model (src/core/display.mjs) takes the run state a pass produces and returns the
// rows/summary/footer as data. These two helpers assemble that run state from a pass result and the
// tracked worker state, mapping the loop's internal phase names onto the display's vocabulary. They are
// shell glue but read no clock or fs — `now`, `since` and `doneMs` arrive as arguments — so the mapping
// is unit-tested; only the painting itself is judged by eye (T09).

// displayPhaseFor(t, activity) → the display phase for a tracked worker, or null when no worker holds the
// task. A worker parked on the person (AWAITING, §2.2) is `asking` whatever its role, but only while it is
// actually waiting (waitingOn, real-asking-state §2.1): a worker that dropped its report and is still inside
// that turn is working, and reads its role's phase. `activity` is the task's live worker's fold
// (taskActivity); without it a park keeps reading `asking`. A conflict fix pir sent stays `asking` here and
// the display reads it as `fixing conflict` (conflictSent). A worker that has reported `done` is `merging` —
// its review is finished and the loop is waiting for the session to go idle before it merges (loop.mjs 3d),
// which can take up to AWAIT_IDLE_TIMEOUT_MS, so `reviewing` there would lie. Otherwise the role names it —
// an implementer (or a `you` scribe) is `building`, a reviewer `reviewing`. An implementer or reviewer that
// has stopped with nothing running is `asking` too (waitingOn's stopped clause, stopped-worker-asking §2.1):
// the rule lives in waitingOn alone, so the row, the clock and Remote Control cannot read it differently.
export function displayPhaseFor(t, activity) {
  if (!t) return null;
  if (t.phase === 'preparing') return 'preparing'; // setup running, no worker yet (DESIGN §2.4)
  if (t.phase === 'awaiting-answer' && (t.decision?.sent || waitingOn(t, activity))) return 'asking';
  if ((t.phase === 'implementing' || t.phase === 'reviewing') && waitingOn(t, activity)) return 'asking';
  if (t.phase === 'done') return 'merging';
  if (t.role === 'review') return 'reviewing';
  return 'building';
}

// taskActivity(workers, num, st) → the activity of the live worker holding task `num`, or undefined when
// none is live or visible. A task with a tracked workerId reads only that worker, as resumeAnswered and
// remoteWanted do: falling back to another live worker on the task (an implementer still closing as its
// reviewer starts) would let its open turn un-ask a park the loop still holds. Only an untracked task
// (some test fakes) takes the task's latest live worker.
export function taskActivity(workers, num, st) {
  const live = workers.filter((w) => w.live && w.task === num);
  return (st?.workerId ? live.find((w) => w.id === st.workerId) : live.at(-1))?.activity;
}

// clockPhase(st, activity) → the phase the clock tracks: `asking` whenever the task waits on the person
// (a pending request stops the clock even though the loop's phase is still `building`).
function clockPhase(st, activity) {
  return waitingOn(st, activity) ? 'asking' : displayPhaseFor(st, activity);
}

// buildRunState({ passTasks, stateTasks, branch, ceiling, sinceByTask, stoppedAtByTask, doneMsByTask, complete,
// readyToMerge, testsReason, interrupted }) → the runState buildDisplay consumes (DESIGN §2.3). passTasks are the
// parsed PROGRESS rows the pass returned ({ num, name, deps, state }); stateTasks is
// coordinator.state.tasks (the live workers). A ✅ row is done; otherwise a tracked worker's phase names
// the row. sinceByTask/doneMsByTask carry the phase-start and final-duration times the shell tracks;
// stoppedAtByTask is when an asking task began waiting, where its clock stops.
// testsReason is the red gate's { reason, logPath } (null otherwise); it rides in runState so it lands in
// status.json and a detached viewer can say why a finished run is red (DESIGN §2.8).
// workers is platform.workers(): every worker the run spawned, live or exited, in spawn order, each with
// its activity. From it each task gets `asking` (the kind of answer wanted, live-workers §2.4), `worker`
// (the one `pir` opens: the live one, else the latest, §2.11) and `workers` (all of the task's).
// An end-of-run helper in stateTasks (main-sync, tests-fix) with a worker gets an entry of the same shape
// in `helpers`, flagged `helper: true` (pir-coordinator T11); the key is absent while there is none.
export function buildRunState({
  passTasks,
  stateTasks = {},
  workers = [],
  branch,
  ceiling,
  sinceByTask = {},
  stoppedAtByTask = {},
  doneMsByTask = {},
  complete = false,
  readyToMerge = false,
  testsReason = null,
  interrupted = false,
  handoff = null,
  heldByAgent = new Set(),
  coordinator = null,
  finisher = null,
  base = null,
} = {}) {
  // One row entry: a plan task, or an end-of-run helper (`st` its state.tasks entry, keyed by its label).
  const entryFor = ({ id, slug: rowSlug, deps, done }) => {
    const st = done ? null : stateTasks[id];
    const activity = st ? taskActivity(workers, id, st) : undefined;
    const phase = st ? displayPhaseFor(st, activity) : null;
    // Who holds the task's waiting items (pir-coordinator §2.5): the row reads `asking coordinator` while
    // the agent holds every one, `asking you` once one is the person's. waitingFor is the rule Remote
    // Control reads, so the row and the phone cannot disagree.
    const holder = st ? waitingFor(st, activity, { workerId: st.workerId, heldByAgent })?.holder ?? null : null;
    return {
      id,
      slug: rowSlug,
      deps,
      done,
      phase,
      since: phase ? sinceByTask[id] ?? null : null,
      // Held only while the task waits on the person: an `asking` phase or a live worker's request.
      stoppedAt: phase ? stoppedAtByTask[id] ?? null : null,
      doneMs: done ? doneMsByTask[id] ?? null : null,
      question: phase === 'asking' ? st.decision?.text ?? null : null,
      // A merge-conflict fix went to the live worker (loop.mjs 3d, live-workers §2.10): the row
      // reads `fixing conflict` and nothing is asked of the person. A later question from that worker
      // replaces the decision, so the flag drops and the row turns `asking you`.
      conflictSent: phase === 'asking' && !!st.decision?.sent,
      ...workerFields(workers.filter((w) => w.task === id), { done, waiting: st ? waitingOn(st, activity) : null }),
      // Only on a task something is asking for, so a row with nothing waiting keeps its old shape.
      ...(holder ? { holder } : {}),
    };
  };
  const tasks = passTasks.map((t) => entryFor({ id: t.num, slug: t.name, deps: t.deps, done: t.state === DONE_GLYPH }));
  // The end-of-run helpers (main-sync, tests-fix; pir-coordinator T11): a row each while it has a worker,
  // read exactly like a task's, so the person can open it and answer a question the agent passed on. They
  // are kept apart from `tasks` because they are no task of the plan: `n/m done` and the runs list's
  // progress count the plan's tasks only.
  const helpers = HELPERS.filter((label) => stateTasks[label]?.workerId).map((label) => ({
    ...entryFor({ id: label, slug: HELPER_SLUG[label], deps: [], done: false }),
    helper: true,
  }));
  // handoff is the end of the run with the agent on (pir-coordinator T05): { state: 'preparing'|'ready'|'red',
  // reportPath, baseSha, base, hold, lastWatch, lastWatchFailure }, null otherwise (base-branch DESIGN §2.8).
  // base is the run's base branch (base-branch DESIGN §2.9), for the hand-off footers and a stale frame's
  // hand-off line; absent when not given, so a snapshot without it reads `main` as before.
  // coordinator is the run's agent for the screen to open and its row (pir-coordinator §2.8, T12):
  // { id, live, logPath, state, holding }, null with `--no-coordinator` or when it never started.
  return {
    branch,
    ceiling,
    complete,
    readyToMerge: !!readyToMerge,
    testsReason: testsReason ?? null,
    interrupted: !!interrupted,
    handoff: handoff ?? null,
    coordinator: coordinator ?? null,
    // The finisher's view() (finisher-agent.mjs) while it is the run's (finisher T05); absent otherwise,
    // so a run without one keeps the old shape.
    ...(finisher ? { finisher } : {}),
    ...(base ? { base } : {}),
    tasks,
    ...(helpers.length ? { helpers } : {}),
  };
}

// newTiming() / advanceTiming(timing, stateTasks, completed, now) — per-task timing for the display's
// elapsed clocks (DESIGN §2.3): when each task's current phase began (for `now − since`) and, once
// merged, how long it took. A completed task is dropped from state.tasks at merge, so its start is
// remembered separately. A task asking the person stops its clock (user 2026-09-26): `since` is kept and
// the stop time recorded; when the answer sends it back to the phase it left, since and start shift
// forward by the wait, so the clock resumes where it stopped and the merged duration leaves the wait out.
// `now` is passed in so the bookkeeping is unit-tested without a clock. `workers` is platform.workers():
// each task's live worker activity decides whether it is waiting on the person (waitingOn, the same rule
// the row and Remote Control read), so a pending request stops the clock though the loop's phase is still
// `building`, and a parked worker still inside its asking turn keeps its clock running.
export function newTiming() {
  return { startByTask: {}, phaseByTask: {}, sinceByTask: {}, stoppedAtByTask: {}, resumeByTask: {}, doneMsByTask: {} };
}

export function advanceTiming(timing, stateTasks, completed, now, workers = []) {
  const { startByTask, phaseByTask, sinceByTask, stoppedAtByTask, resumeByTask, doneMsByTask } = timing;
  for (const [num, st] of Object.entries(stateTasks)) {
    if (startByTask[num] == null) startByTask[num] = now;
    const ph = clockPhase(st, taskActivity(workers, num, st));
    const prev = phaseByTask[num];
    if (prev === ph) continue;
    phaseByTask[num] = ph;
    if (ph === 'asking') {
      stoppedAtByTask[num] = now;
      if (prev == null) sinceByTask[num] = now;
      continue;
    }
    const stoppedAt = stoppedAtByTask[num];
    delete stoppedAtByTask[num];
    if (stoppedAt != null) startByTask[num] += now - stoppedAt;
    // resumeByTask is the last non-asking phase: only a return to it continues the stopped clock.
    if (stoppedAt != null && ph === resumeByTask[num]) sinceByTask[num] += now - stoppedAt;
    else sinceByTask[num] = now;
    resumeByTask[num] = ph;
  }
  for (const num of completed) {
    if (doneMsByTask[num] == null) doneMsByTask[num] = now - (startByTask[num] ?? now);
  }
  // A worker gone from state.tasks leaves no phase behind, so one spawned again under the same key (an
  // end-of-run helper, whose label is reused by the next sync's fix worker, T11) starts a fresh clock
  // instead of carrying on the last one's. startByTask is kept: a task's merged duration counts from it.
  for (const num of Object.keys(phaseByTask)) {
    if (stateTasks[num]) continue;
    delete phaseByTask[num];
    delete sinceByTask[num];
    delete stoppedAtByTask[num];
    delete resumeByTask[num];
  }
}

// remoteWanted(workers, stateTasks, { agentId, heldByAgent }) → the ids of the live workers waiting on the
// person (waitingOn), whose sessions the run makes reachable over Remote Control (claude.ai and the Claude
// app, so the person is notified and can answer away from the terminal). A park counts only for the worker
// holding the task, and only once its asking turn has ended; a conflict fix pir sent asks the person
// nothing. A worker whose every waiting item the coordinator agent holds is not the person's yet
// (pir-coordinator DESIGN §2.5): it becomes reachable once the agent passes an item on, or when the item
// is reserved. The agent's own session is wanted for the whole run (DESIGN §2.8). Every other live worker
// has Remote Control off.
export function remoteWanted(workers, stateTasks = {}, { agentId = null, heldByAgent = new Set() } = {}) {
  const ids = new Set();
  for (const w of workers) {
    if (!w.live) continue;
    const t = stateTasks[w.task];
    const waiting = waitingFor(t?.workerId === w.id ? t : undefined, w.activity, { workerId: w.id, heldByAgent });
    if (waiting?.holder === 'person') ids.add(w.id);
  }
  if (agentId) ids.add(agentId);
  return ids;
}

// workerFields(taskWorkers, { done, waiting }) → the row's `asking` kind (waitingOn for the task, none once
// done) and the workers `pir` can open: the live one, else the latest (live-workers §2.4, §2.11).
function workerFields(taskWorkers, { done, waiting }) {
  const liveOnes = taskWorkers.filter((w) => w.live);
  const open = liveOnes.at(-1) ?? taskWorkers.at(-1) ?? null;
  return {
    asking: done ? null : waiting ?? null,
    // cwd is the worktree each was spawned in, kept after it exits so the dashboard can name its folder.
    worker: open ? { id: open.id, live: !!open.live, logPath: open.logPath ?? null, cwd: open.cwd ?? null } : null,
    workers: taskWorkers.map((w) => ({ id: w.id, role: w.role, n: w.n ?? null, logPath: w.logPath ?? null, cwd: w.cwd ?? null })),
  };
}

// testingRunState(runState, { since }) → the same run state marked as the end gate running: `testing`
// carries when the gate started, so the display says the tests are running and for how long instead of
// reading as finished. Only painted from inside the completing pass, where every row is already ✅.
export function testingRunState(runState, { since } = {}) {
  return { ...runState, complete: false, readyToMerge: false, testsReason: null, testing: { since: since ?? null } };
}

// --- Phone alerts in a build run (reliable-notifications DESIGN §2.1–§2.8, §3.3; T07) ----------------
//
// Each pass the shell turns the workers that are the person's into views, runs the pure episode machine
// (src/core/notify.mjs) and fires what it returns without awaiting it. The config is read per action, so
// `pir notify off` stops alerts in a run already going (§2.6). Only the exit sends are awaited, bounded.

export const NOTIFY_EXIT_WAIT_MS = 2000;

// workerEnv(env, { fs }) → { CLAUDE_CLIENT_PRESENCE_FILE } | null (DESIGN §2.7): with ntfy configured when a
// build worker or the agent is spawned, the session is told the person is "present" so the Claude app
// skips its own push; the marker file is made to exist. No config (or a corrupt one): null, today's env.
export function workerEnv(env = process.env, { fs } = {}) {
  const opts = fs ? { fs } : {};
  const config = readNotifyConfig(env, opts);
  if (!config || config.corrupt) return null;
  return { CLAUDE_CLIENT_PRESENCE_FILE: ensurePresenceMarker(env, opts) };
}

// notifyViews({ plan, workers, stateTasks, heldByAgent, why, remoteOn }) → the episode machine's views
// (DESIGN §3.2), one per live worker something is waiting on. `waiting` is read from exactly the predicate
// remoteWanted and the row use (waitingFor(...).holder === 'person'), so the phone, Remote Control and
// `asking you` cannot disagree (§2.1); a worker the agent holds gets `waiting: null`, which ends or never
// starts its episode. A worker nothing waits on (working, or a non-holder of its task with no request)
// has no view. `why` is coordinator.whyPerson(); `remoteOn` is false under PARALLEL_REMOTE=0.
export function notifyViews({ plan, workers = [], stateTasks = {}, heldByAgent = new Set(), why = new Map(), remoteOn = true } = {}) {
  const views = [];
  for (const w of Array.isArray(workers) ? workers : []) {
    if (!w?.live) continue;
    const st = stateTasks[w.task];
    const t = st?.workerId === w.id ? st : undefined;
    const waiting = waitingFor(t, w.activity, { workerId: w.id, heldByAgent });
    if (!waiting) continue;
    const mine = waiting.holder === 'person';
    // An end-of-run helper holds no task of the plan: its title is its label and what it does (§2.3).
    const name = HELPERS.includes(w.task) ? `${w.task} ${HELPER_SLUG[w.task]}` : null;
    const { title, message } = mine
      ? alertText({
          plan,
          task: w.task,
          role: w.role,
          name,
          why: why?.get?.(w.id) ?? null,
          kind: waiting.kind,
          decisionText: t?.decision?.text ?? null,
          lastText: w.lastText ?? null,
          pending: w.activity?.pending,
        })
      : { title: '', message: '' };
    views.push({
      id: w.id,
      waiting: mine ? waiting.kind : null,
      title,
      message,
      remote: w.remote === 'refused' ? 'refused' : remoteOn ? 'wanted' : 'off',
      url: w.url ?? null,
    });
  }
  return views;
}

// newNotifyTrack() → the runner's memory across passes: the sends still in flight by seq (a clear waits
// for its send, §2.8) and the episodes whose failure was already noted (noted once per episode).
export const newNotifyTrack = () => ({ inflight: new Map(), failedNoted: new Set() });

// Never the topic in a log line or a note (DESIGN §5.3): an error string is scrubbed of it in case a
// transport ever echoes the URL.
const scrub = (text, topic) => (typeof text === 'string' && topic ? text.split(topic).join('…') : text);
const statusOf = (res) => (res?.ok ? `ok ${res.status}` : `failed ${res?.error ?? (res?.status != null ? `HTTP ${res.status}` : 'unknown')}`);

// runNotifyActions(actions, { readConfig, icon, publish, clear, note, log, track }) → Promise, settled when
// every action has. `send` publishes (with the icon and the action's tags, default bell) and notes
// `notified` on success or `notify-failed` once per episode on failure; `clear` waits for its episode's
// send in flight, then clears once and notes nothing (§2.8). No config at the time of the action: dropped,
// nothing noted or logged (§2.8). A send's note goes to `noteTo` when the action names one (the end alert:
// the agent's conversation, or null for none), else to its worker. `publish`/`clear` never reject (ntfy.mjs).
export function runNotifyActions(actions, { readConfig, icon, publish, clear, note, log, track = newNotifyTrack() } = {}) {
  const usable = () => {
    const c = readConfig?.();
    return c && !c.corrupt && c.topic ? c : null;
  };
  const noteSafe = (id, kind, fields) => {
    if (id == null) return;
    try {
      note?.(id, kind, fields);
    } catch {
      // a note is a courtesy; an exited worker's log refusing it must not break the run
    }
  };
  const logSafe = (line) => {
    try {
      log?.(line);
    } catch {
      /* the flow log is best-effort */
    }
  };
  const runs = [];
  for (const a of Array.isArray(actions) ? actions : []) {
    if (a?.type === 'send') {
      const config = usable();
      if (!config) continue;
      const key = a.seq ?? a.id;
      const noteTo = 'noteTo' in a ? a.noteTo : a.id;
      const p = Promise.resolve(
        publish({
          server: config.server,
          topic: config.topic,
          title: a.title,
          message: a.message,
          click: a.click ?? null,
          seq: a.seq ?? null,
          icon,
          ...(a.tags ? { tags: a.tags } : {}),
        }),
      ).then((res) => {
        logSafe(`notify ${a.reminder ? 'reminder' : 'send'} ${a.id} ${a.seq ?? '-'} ${scrub(statusOf(res), config.topic)}`);
        if (res?.ok) noteSafe(noteTo, 'notified', { reminder: !!a.reminder });
        else if (!track.failedNoted.has(key)) {
          track.failedNoted.add(key);
          noteSafe(noteTo, 'notify-failed', { status: res?.status ?? null, error: scrub(res?.error ?? null, config.topic) });
        }
      });
      if (a.seq != null) {
        const entry = p.finally(() => {
          if (track.inflight.get(a.seq) === entry) track.inflight.delete(a.seq);
        });
        track.inflight.set(a.seq, entry);
      }
      runs.push(p);
    } else if (a?.type === 'clear') {
      const before = track.inflight.get(a.seq) ?? Promise.resolve();
      runs.push(
        before.then(async () => {
          const config = usable();
          if (!config) return;
          const res = await clear({ server: config.server, topic: config.topic, seq: a.seq });
          logSafe(`notify clear ${a.id} ${a.seq} ${scrub(statusOf(res), config.topic)}`);
        }),
      );
    }
  }
  return Promise.all(runs).then(() => undefined);
}

// notifyPass({ plan, platform, coordinator, notifyState, remote, now, run, stepOpts }) → notifyState. One
// pass of the alerts: workers() → notifyViews → notifyStep → run(actions), not awaited. main calls it after
// the REMOTE-gated syncRemote, every pass, whatever REMOTE is (§3.3). Extracted from main, which builds the
// real platform and cannot be driven with the fake one.
export function notifyPass({ plan, platform, coordinator, notifyState, remote = true, now, run, stepOpts = {} }) {
  const views = notifyViews({
    plan,
    workers: platform.workers(),
    stateTasks: coordinator.state.tasks,
    heldByAgent: coordinator.heldByAgent(),
    why: coordinator.whyPerson(),
    remoteOn: remote,
  });
  const fin = finisherViewFor(plan, coordinator, remote);
  if (fin) views.push(fin);
  const { state, actions } = notifyStep(notifyState, views, now, stepOpts);
  // The finisher's episodes are keyed `finisher` (the flow log's `notify send finisher …`); their notes go
  // to its conversation, found by its session id through withAgent.
  const finisherId = coordinator.finisher?.id ?? null;
  if (actions.length) run(actions.map((a) => (a.id === 'finisher' && a.type === 'send' ? { ...a, noteTo: finisherId } : a)));
  return state;
}

// finisherViewFor(plan, coordinator, remote) → the finisher's notify view (finisher DESIGN §2.9), or null
// while no finisher is the run's. Its link is its Remote Control URL, waited for 20 s as for a worker.
function finisherViewFor(plan, coordinator, remote) {
  const f = coordinator.finisher;
  if (!f) return null;
  let pending = [];
  try {
    pending = f.alive?.() ? f.session?.pending?.() ?? [] : [];
  } catch {
    pending = [];
  }
  return finisherNotifyView({
    slug: plan,
    view: coordinator.finisherView?.() ?? null,
    pending,
    url: f.remoteUrl?.() ?? null,
    remote: f.session?.remoteRefused ? 'refused' : remote ? 'wanted' : 'off',
  });
}

// finisherOneShot(alert, { click, noteTo }) → the runner's send for the finisher's done or gave-up alert
// (finisher DESIGN §2.9, §2.12): no episode and no reminder, logged under `finisher`.
export function finisherOneShot({ title, message, tags }, { click = null, noteTo = null } = {}) {
  return { type: 'send', id: 'finisher', seq: null, title, message, click, reminder: false, ...(tags ? { tags } : {}), noteTo };
}

// endAlertPass({ r, coordinator, slug, sent, send }) → sent. With the agent, the one end-of-run alert
// (DESIGN §2.4): fired the first pass the handoff reads `ready` or `red` (settle() sets it with `step:
// 'waiting'`), never on a pass that finished the run (a restart finding main already holding the tip must
// not announce a merge that is done), and never again for this process — a re-sync after main moves is the
// same wait. The tap opens the agent's chat, where the report and the merge are presented.
//
// With the finisher (`takesOver`, finisher DESIGN §2.9, §2.12): a green run sends no `ready to merge`, the
// finisher's own ready alert replaces it; a finisher that gave up sends `{slug} · finisher gave up` instead;
// one that failed to start falls back to today's wait and so to today's alert. A red run is unchanged.
export function endAlertPass({ r, coordinator, slug, sent = false, send, takesOver = false, sendFinisher = null }) {
  if (sent || r?.finished) return sent;
  const state = r?.handoff?.state;
  if (takesOver && r?.handoff?.fallback === 'gave-up') {
    sendFinisher?.(finisherAlert({ slug, phase: 'gave-up', base: r.handoff.base ?? 'main' }));
    return true;
  }
  if (state !== 'ready' && state !== 'red') return sent;
  if (takesOver && state === 'ready' && r?.handoff?.fallback !== 'failed') return sent;
  const alert = endAlert({
    slug,
    ready: state === 'ready',
    taskCount: Array.isArray(r.tasks) ? r.tasks.length : 0,
    reason: r.testsReason?.reason ?? null,
    unresolved: !!r.handoff.unresolved,
    base: r.handoff.base ?? 'main',
  });
  send({ ...alert, click: coordinator?.agent?.remoteUrl?.() ?? null });
  return true;
}

// holdAlertPass({ r, slug, sentReason, send }) → the reason last alerted, or null. A held end sync
// (base-branch DESIGN §2.8) sends one alert when the hold begins, none on its retries, and a new one only
// when its reason changes; once the hold clears, a later hold alerts again.
export function holdAlertPass({ r, slug, sentReason = null, send }) {
  const hold = r?.finished ? null : r?.handoff?.hold ?? null;
  if (!hold) return null;
  if (hold.reason === sentReason) return sentReason;
  send(holdAlert({ slug, hold }));
  return hold.reason;
}

// holdAlertAction(alert, { noteTo }) → the runner's send for a hold alert: like the end alert, never
// cleared or reminded, under its own id.
export function holdAlertAction(alert, opts = {}) {
  return { ...endAlertAction(alert, opts), id: 'hold' };
}

// endAlertAction(alert, { noteTo }) → the runner's send for the end-of-run alert: no episode, no seq (it is
// never cleared or reminded), its own tags, noted on the agent's conversation or nowhere.
export function endAlertAction({ title, message, tags, click = null }, { noteTo = null } = {}) {
  return { type: 'send', id: 'end', seq: null, title, message, click, reminder: false, tags, noteTo };
}

// withinMs(promise, ms) → resolves when the promise settles or `ms` pass, whichever is first. The timer is
// unref'd so a bounded wait never holds the process open by itself.
export function withinMs(promise, ms) {
  let timer;
  const cap = new Promise((resolve) => {
    timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
  return Promise.race([Promise.resolve(promise).catch(() => {}), cap]).finally(() => clearTimeout(timer));
}

async function main(argv) {
  const args = parseCoordinateArgs(argv);
  if (!args.ok) {
    console.error(`${args.error ? `${args.error}\n` : ''}usage: node src/shell/coordinate.mjs {slug} [--base <branch> [--base-sha <sha>]]`);
    process.exit(2);
  }
  const { slug } = args;

  const root = mainWorktree(process.cwd()) || process.cwd();
  const repo = basename(root);

  // The gate (DESIGN §2.1): refuse an unreviewed plan and name the line, exactly as pir-work does.
  const gate = readReviewGate(slug, { root });
  if (!gate.reviewed) {
    const why = gate.missing
      ? `plans/${slug}/PROGRESS.md was not found in this checkout or on branch pir/${slug}`
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

  // Before the PARALLEL_LIVE branch, so a dry run and a restart (a re-run of this command) refuse too.
  const block = readTestBlockGate(slug, { root });
  if (!block.ok) {
    process.stderr.write(testBlockRefusal(slug, block.reason));
    process.exit(1);
  }

  console.log(`pir start ${slug} — plan reviewed (${gate.note}). This is a plain command; there is no coordinator session.`);

  const maxWorkers = Number(process.env.PARALLEL_MAX_WORKERS ?? 4);

  // Live seatbelt (DESIGN §5.2). This bin spawns REAL, paid `claude` workers and cuts pir/{slug}
  // branches. A full multi-worker live drive is hand-verified in T09, and the rule is never to run the
  // unbounded version to find something out. So the loop only runs with an explicit opt-in; without it
  // the bin does the safe half — confirm the gate, show what it WOULD dispatch — and stops. The run
  // never merges to main (§2.4); the person does that by hand. The T09 person-check runs the live path
  // deliberately on the scratch plan, ceiling 1:
  //   PARALLEL_LIVE=1 PARALLEL_MAX_WORKERS=1 node src/shell/coordinate.mjs scratch
  if (process.env.PARALLEL_LIVE !== '1') {
    const { tasks } = parseProgress(planHome(slug, { root }).read('PROGRESS.md') ?? '');
    const ready = readyWaiting(tasks, new Set());
    console.log(
      `\nDRY: not spawning real workers (set PARALLEL_LIVE=1 to actually drive — the live drive is\n` +
        `hand-verified in T09, and the first live run is seatbelted: scratch plan, ceiling 1).\n` +
        `Ready to dispatch now: ${ready.length ? ready.join(', ') : '(none)'}.`,
    );
    return;
  }

  console.log('LIVE: spawning real workers (PARALLEL_LIVE=1).');

  // The run's base (base-branch DESIGN §2.5, §2.7). `pir start` resolved it before spawning this and
  // passes it in; a coordinator started by hand resolves it here the same way, refusing before anything
  // is created. A missing local base is created from the remote's copy by prepareBase, never at HEAD.
  const runBase = args.base ? { ok: true, base: args.base, baseSha: args.baseSha } : resolveRunBase(root, slug);
  if (!runBase.ok) {
    console.error(runBase.message);
    process.exit(1);
  }
  const { base, baseSha } = runBase;
  console.log(`base branch: ${base}`);

  const control = fileControl(root, slug);

  // Restart hygiene (DESIGN §2.7): before this run writes anything, refuse a still-HALTed run (naming
  // the flag, never clearing it) and clear the dead run's transient reports so none of its leftovers
  // route into a fresh worker. Runs before the report inbox and the loop, so neither side has written a
  // report yet this run. The log and HALT are preserved; a `restart` marker records the boundary.
  const hygiene = await startupControlHygiene(control);
  if (hygiene.halted) {
    console.error(
      `HALT flag present at ${hygiene.flag} — remove it to restart.\n` +
        `The kill switch is a deliberate stop and is never cleared automatically; a run started past it\n` +
        `would blow straight through the stop. Delete the flag to let the run start again:\n\n` +
        `  rm ${hygiene.flag}\n`,
    );
    process.exit(1);
  }
  if (hygiene.reaped.length) console.log(`reaped ${hygiene.reaped.length} leftover worker(s) from a prior run: ${hygiene.reaped.join(', ')}`);
  if (hygiene.cleared.length) console.log(`cleared stale control feeds from a prior run: ${hygiene.cleared.join(', ')}`);

  const inbox = createReportInbox({ dir: control.dir });
  // Workers run the installed `claude`, resolved once here so a machine without one fails before the
  // first spawn rather than at it (live-workers DESIGN §2.1).
  let claudePath;
  try {
    claudePath = resolveClaudePath();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  // The person's input from the `pir` screen (live-workers DESIGN §2.5, T07): the grants are shared, so a
  // "do not ask again" the inbox records is what the platform consults on the worker's next request.
  const grants = createGrants();
  // With ntfy configured, build workers start with the Claude app's own push silenced (DESIGN §2.7), read
  // at each spawn so a `pir notify` mid-run reaches the next worker.
  // The loop's one wake-up (fast-tests DESIGN §2.1, §2.2): built before everything that feeds it. Anything
  // the next pass would act on or show calls wake(), and passes are spaced PASS_MIN_GAP_MS apart.
  const waker = createWaker({ minGapMs: PASS_MIN_GAP_MS });
  const wake = () => waker.wake();
  const platform = createPlatform({ root, controlDir: control.dir, transport: inbox.transport, claudePath, grants, onActivity: wake, workerEnv: () => workerEnv() });
  // The person may type to the coordinator agent in its own conversation (pir-coordinator §2.8): the inbox
  // forwards to it by id once it has started (currentAgent is set when the controller exists).
  let currentAgent = () => null;
  const personInbox = startPersonInbox({ controlDir: control.dir, platform: withAgent(platform, () => currentAgent()), grants, log: control.log, onActivity: wake });
  const worktree = createWorktree({ root, base, ...(baseSha ? { from: baseSha } : {}) });
  // No DESIGN.md reads as '': makePrepare sees no block and runs no setup.
  const design = planHome(slug, { root }).read('DESIGN.md') ?? '';
  const prepare = makePrepare({ design, setupDir: join(control.dir, 'setup'), onSettled: wake });
  // Set once the display state below exists; runTests calls it before the suite blocks the pass.
  let showTesting = () => {};
  // Remote Control follows the person being waited on (remoteWanted): on while a worker waits, off once
  // it is answered and working again. On unless PARALLEL_REMOTE=0 (user 2026-09-26): it puts a session in
  // the person's claude.ai account and may notify their phone, which not everyone wants.
  const REMOTE = process.env.PARALLEL_REMOTE !== '0';
  // The coordinator agent (pir-coordinator DESIGN §2.1): on unless `pir start --no-coordinator`, which
  // the launcher passes as PARALLEL_COORDINATOR=0. Its project rules are `.claude/pir-coordinator.md`.
  const startAgent = !coordinatorEnabled(process.env)
      ? null
      : ({ featurePath, askRules }) => {
          const rules = join(featurePath, '.claude', 'pir-coordinator.md');
          return startCoordinatorAgent({
            controlDir: control.dir,
            featurePath,
            repoRoot: root,
            slug,
            projectRulesPath: existsSync(rules) ? rules : null,
            platform,
            askRules,
            startWorker,
            claudePath,
            remote: REMOTE,
            onActivity: wake,
            env: () => workerEnv(),
          });
        };
  // The finisher (finisher DESIGN §2.1, §2.2): only with the agent on. Its rules are the first of the
  // project's, the person's for this repo and the default that exists, else the engine's own copy.
  const startFinisher = !startAgent
    ? null
    : ({ featurePath, askRules, reportPath }) => {
        const rules = chooseRules({ featurePath, home: homedir(), repo: root, engineDir: ENGINE_DIR, exists: existsSync });
        control.log(`finisher rules: ${rules.path} (${rules.source})`);
        return startFinisherSession({
          controlDir: control.dir,
          featurePath,
          repoRoot: root,
          slug,
          mainCheckout: root,
          rules,
          reportPath: join(featurePath, reportPath),
          askRules,
          platform,
          startWorker,
          claudePath,
          remote: REMOTE,
          env: () => workerEnv(),
        });
      };
  const priorFinisher = () => readJson(join(control.dir, 'finisher', 'state.json'));
  const coordinator = startCoordinator({ slug, repo, platform, worktree, maxWorkers, control, startAgent, startFinisher, priorFinisher, base, watchMs: baseWatchMs(),
    runTests: (featurePath, { tasks } = {}) => {
      showTesting(tasks ?? []);
      return runFeatureTests(featurePath, { slug, root, logPath: join(control.dir, 'tests.log') });
    },
    ...(prepare ? { prepare } : {}),
    // A test lever for the merge-conflict fixture (dispatch.mjs holdMerges): the harness sets it so a
    // live run reaches the coordinator-side conflict deterministically. No person has a reason to.
    holdMerges: process.env.PARALLEL_HOLD_MERGES === '1',
  });
  // Once the finisher replaces the agent, the person's replies (the go included) and the notifier's notes
  // reach the finisher's session instead (finisher T05).
  currentAgent = () => coordinator.finisher ?? coordinator.agent;
  const renderer = createRenderer({ stream: process.stdout });

  console.log(`ceiling: ${maxWorkers}   control: ${control.dir}`);
  console.log(`ABORT:   touch ${control.flag}`);
  console.log(`reports: ${inbox.reportsDir}`);
  // A worker that asks is answered by the person in `pir`: its task row opens the worker's conversation,
  // where the person replies, allows a command or answers a question set (live-workers §2.4, §2.11).
  console.log(`\nA worker that asks you shows in the display below; answer it in \`pir\`: open its task (→).\n`);

  const POLL_MS = Number(process.env.PARALLEL_POLL_MS ?? 5000);
  const CEILING = maxWorkers;
  const OVER_GRACE = Number(process.env.PARALLEL_OVER_GRACE ?? 3);
  const STALL_GRACE = 3; // consecutive quiet passes with nothing live before the run is declared done
  // Both graces keep their wall-clock meaning under wake-driven passes (fast-tests DESIGN §2.6): each also
  // needs grace × POLL_MS since the first pass its condition held on.
  const OVER_HOLD_MS = OVER_GRACE * POLL_MS;
  const STALL_HOLD_MS = STALL_GRACE * POLL_MS;
  const branch = `pir/${slug}`;

  // Detached self-reporting (DESIGN §2.4, §2.6, §3.5; T10). PIR_RUN is set only by the `pir` launcher
  // (T08); a bare `node src/shell/coordinate.mjs` run leaves it unset and skips everything below, so the classic
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
  let lastRunState = buildRunState({ passTasks: [], branch, base, ceiling: CEILING, interrupted: true });

  // Tear down every live worker of this run on any exit that is not a clean hand-off or a kill-switch
  // halt (both of which the loop already handled). This is the orphan-guard: a stall, a
  // Ctrl-C or an error must not leave a paid session running (DESIGN §2.6). Idempotent (close is safe
  // twice). A re-run reaps whatever a second Ctrl-C during teardown left behind (§2.6, §2.8).
  const teardown = () => {
    coordinator.closeAll({ immediate: true });
    return teardownRun({ platform, state: coordinator.state, repo, slug, control });
  };
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
    coordinator.closeAll({ immediate: true });
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

  // Phone alerts (reliable-notifications DESIGN §3.3, T07). The runner notes through withAgent so the end
  // alert can note on the agent's conversation. Retry waits are unref'd: a send still retrying must not
  // hold the process open after the run has ended.
  const notifyTrack = newNotifyTrack();
  const notifyPlatform = withAgent(platform, () => currentAgent());
  const unrefSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms).unref());
  const runNotify = (actions) =>
    runNotifyActions(actions, {
      readConfig: () => readNotifyConfig(),
      icon: notifyIcon(),
      publish: (fields) => ntfyPublish(fields, { sleep: unrefSleep }),
      clear: (fields) => ntfyClear(fields),
      note: (id, kind, fields) => notifyPlatform.note(id, kind, fields),
      log: control.log,
      track: notifyTrack,
    });
  // PIR_NOTIFY_REMIND_MS shortens the reminder for the live check (T08); undocumented to users.
  const remindMs = Number(process.env.PIR_NOTIFY_REMIND_MS);
  const notifyStepOpts = remindMs > 0 ? { remindMs } : {};
  let notifyState = newNotifyState();
  let endAlertSent = false;
  let holdAlertReason = null; // the reason of the last hold alert sent, null while no hold (base-branch §2.8)
  // The exit clears for every open episode (and the no-agent end alert, when given), awaited at most 2 s:
  // every exit path ends the process soon after, and an unawaited request dies with it (§3.3).
  const notifyExitNow = (extra = null) => {
    const clears = notifyExit(notifyState);
    notifyState = newNotifyState();
    return withinMs(Promise.all([runNotify(clears), ...(extra ? [extra] : [])]), NOTIFY_EXIT_WAIT_MS);
  };

  // A signal must close workers before we go (DESIGN §2.6). A detached stop is SIGTERM under PIR_RUN and
  // takes the stop path (leave worktrees, record `stopped`); every other signal is the classic teardown.
  // The exit clears are awaited (bounded) before process.exit; a second signal during that wait exits now.
  let signalled = false;
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, async () => {
      if (signalled) process.exit(130);
      signalled = true;
      if (selfReport && sig === 'SIGTERM') stopDetached();
      else teardownOnce(`${sig} received`);
      await notifyExitNow();
      process.exit(130);
    });
  }

  // Per-task timing for the display's elapsed clocks (DESIGN §2.3), tracked here in the shell, never in
  // the pure model (advanceTiming below).
  const timing = newTiming();
  const { sinceByTask, stoppedAtByTask, doneMsByTask } = timing;
  const trackTiming = (stateTasks, completed) =>
    advanceTiming(timing, stateTasks, completed, Date.now(), platform.workers());

  // The end gate runs synchronously inside the completing pass, so without this the last frame painted
  // (every task merged, or the final one still `merging`) sat unchanged for the minutes the suite took
  // and read as done or frozen (user 2026-09-25). Paint and snapshot a `testing` state first: the
  // coordinator's own frame cannot tick while the suite blocks it, but a detached `pir` viewer ticks its
  // spinner and clock from `testing.since`.
  showTesting = (passTasks) => {
    const since = Date.now();
    trackTiming({}, passTasks.map((t) => t.num)); // the last merge's duration, before the pass ends
    const runState = testingRunState(
      buildRunState({ passTasks, workers: platform.workers(), branch, base, ceiling: CEILING, doneMsByTask, coordinator: coordinator.agentView() }),
      { since },
    );
    lastRunState = runState;
    if (selfReport) writeRunSnapshot({ controlDir: control.dir, proc, runState });
    renderer.paint(buildDisplay(runState, { now: since }));
  };

  // The agent's own Remote Control is its session's, switched on when it starts (coordinator-agent.mjs);
  // only the workers are synced here, each on once an item of its is the person's.
  const syncRemote = (stateTasks) => {
    const workers = platform.workers();
    const wanted = remoteWanted(workers, stateTasks, { heldByAgent: coordinator.heldByAgent() });
    for (const w of workers) if (w.live) platform.remoteControl(w.id, wanted.has(w.id));
  };

  let over = 0;
  let overSince = null;
  let idle = 0;
  let fallbackPrinted = false;
  let lastFinisherSummary = null;
  let lastFinisherUrl = null;
  let idleSince = null;
  try {
    // No pass cap: the run's only ends are the hand-off, a halt, the runaway breaker, a stall, or a signal.
    // A worker parked on a question waits for the person indefinitely — a cap here used to tear the run
    // down after ~7h while the person slept. Waiting costs nothing: a pass is local file and `claude
    // agents` reads, and a parked worker's session makes no model calls until it is answered.
    for (;;) {
      // A signal handler awaits the exit clears (up to 2 s) before process.exit, and this loop is still
      // scheduled meanwhile. A pass after its teardown would dispatch fresh workers into the freed slots, to
      // be orphaned by the exit a moment later, so park here for good: the handler ends the process.
      if (signalled) await new Promise(() => {});
      personInbox.drain(); // the backstop for a drop the forwarder's watch missed
      const stepBefore = coordinator.handoffStep;
      const stateBefore = coordinator.handoff?.state ?? null;
      const r = coordinator.pass();
      // The done summary, kept from the pass's view: the pass that ends the run closes the finisher.
      if (r.finisher?.summary) lastFinisherSummary = r.finisher.summary;
      // Its link too, for the done alert's tap: that pass closes the session, and a closed session has none.
      lastFinisherUrl = coordinator.finisher?.remoteUrl?.() ?? lastFinisherUrl;
      // A pass that moved the run on wakes the loop once, so the next step runs after the pass gap rather
      // than the backstop (fast-tests DESIGN §2.3). The flag it sets is consumed by this pass's closing wait.
      if (passProgressed({ stepBefore, stateBefore, handoff: { step: coordinator.handoffStep, state: coordinator.handoff?.state ?? null }, actions: r.actions })) {
        waker.wake();
      }
      trackTiming(coordinator.state.tasks, r.completed);
      if (REMOTE) syncRemote(coordinator.state.tasks);
      // Alerts run every pass, whatever REMOTE is (DESIGN §2.1); a fault in them never stops the run.
      try {
        notifyState = notifyPass({ plan: slug, platform, coordinator, notifyState, remote: REMOTE, now: Date.now(), run: runNotify, stepOpts: notifyStepOpts });
      } catch (err) {
        control.log(`notify pass failed: ${err?.message ?? err}`);
      }

      // A restart's one-line reconciliation summary scrolls above the live block, so the run does not
      // look like a fresh start (DESIGN §2.8). Only ever set on the first pass of a run that adopted work.
      if (r.restartSummary) renderer.line(`  ↻ ${r.restartSummary}`);

      // A coordinator-side merge conflict with no live worker to send it to (a restart, or a worker that
      // exited before the send) scrolls its resolution prompt above the live block (T14, §2.8): bulky and
      // selectable, so on the NORMAL screen via line(), never inside the clipped live frame (the T15 wrap
      // bug). It is surfaced exactly once, so it prints exactly once; the task is ⛔ and off the live block.
      // A conflict sent to its live worker (live-workers T08) is a `conflict-sent` action, not a surface,
      // so it prints nothing here.
      for (const s of r.surfaces) {
        if (s.kind === 'conflict' && s.prompt) renderer.line(`\n${s.prompt}`);
      }

      if (r.halted) {
        // Abnormal exit (DESIGN §2.2, T10): the HALT kill switch records NO final status, so the gone
        // process reads as crashed, not dim `finished`. Nothing to write — the last live snapshot and the
        // index entry both keep finalState:null.
        renderer.close(); // leave the alt screen so the notice lands on the normal screen (T15)
        renderer.line('\n=== HALTED by the kill switch — workers stopped, nothing merged ===');
        await notifyExitNow();
        return; // the halt pass already closed every worker
      }

      // Paint the live display: the pass's tasks and worker phases, the ceiling, the asking-you footer,
      // and — when complete — the hand-off (DESIGN §2.3). The model is pure; the renderer paints it in
      // place on a TTY and as plain lines otherwise.
      const runState = buildRunState({
        passTasks: r.tasks,
        stateTasks: coordinator.state.tasks,
        workers: platform.workers(),
        branch,
        base,
        ceiling: CEILING,
        sinceByTask,
        stoppedAtByTask,
        doneMsByTask,
        // With the agent on, the run is not handed off while it prepares (sync, report): the display must
        // not offer the merge before REPORT.md is committed and the branch re-tested (T05).
        complete: r.handoff ? r.handoff.state !== 'preparing' : r.complete,
        readyToMerge: r.handoff ? r.handoff.state === 'ready' : !!r.readyToMerge,
        testsReason: r.testsReason,
        handoff: r.handoff,
        heldByAgent: coordinator.heldByAgent(),
        coordinator: coordinator.agentView(),
        finisher: r.finisher ?? null,
      });
      lastRunState = runState;
      // Feed the detached live view (DESIGN §2.4): write this pass's run state to the snapshot the
      // dashboard reads, finalState null (still running). Same run state that is painted, so a watcher on
      // another terminal sees exactly what a live pane would. No-op on the classic path (selfReport false).
      if (selfReport) writeRunSnapshot({ controlDir: control.dir, proc, runState });
      renderer.paint(buildDisplay(runState, { now: Date.now() }));

      // The end of the run with the agent (pir-coordinator DESIGN §2.9, §2.10): the passes after the end
      // gate sync the base, get the report committed and wait in `ready to merge` until the person merges or
      // tells the agent to close. The run's own waiting is not a stall.
      if (coordinator.handoff) {
        // The one end-of-run alert, the first pass the run waits on the person's merge (DESIGN §2.4).
        endAlertSent = endAlertPass({
          r,
          coordinator,
          slug,
          sent: endAlertSent,
          send: (alert) => runNotify([endAlertAction(alert, { noteTo: coordinator.agent?.id ?? null })]),
          takesOver: startFinisher !== null,
          sendFinisher: (alert) => runNotify([finisherOneShot(alert)]),
        });
        // The finisher could not start or gave up: the merge line scrolls above the live block once, and the
        // run waits in today's ready to merge (finisher DESIGN §2.12). Not for a branch that turned red.
        if (!fallbackPrinted && (r.handoff?.fallback === 'failed' || r.handoff?.fallback === 'gave-up')) {
          fallbackPrinted = true;
          renderer.line('\n' + renderFinished({ by: 'finisher-gave-up', slug, base, reportPath: r.handoff?.reportPath }));
        }
        // A held end sync alerts once per reason (base-branch DESIGN §2.8): the diverged case needs the person.
        holdAlertReason = holdAlertPass({
          r,
          slug,
          sentReason: holdAlertReason,
          send: (alert) => runNotify([holdAlertAction(alert, { noteTo: coordinator.agent?.id ?? null })]),
        });
        if (r.finished) {
          finishRun('complete'); // merged, closed or the finisher's done: `finished` (DESIGN §2.10)
          renderer.close();
          renderer.line('\n' + renderFinished({ by: r.finished, slug, base, ready: r.handoff?.state === 'ready', reportPath: r.handoff?.reportPath, summary: lastFinisherSummary }));
          // The finisher's done alert (finisher DESIGN §2.9): one-shot, awaited with the exit clears, bounded.
          const done = r.finished === 'finisher'
            ? runNotify([finisherOneShot(finisherAlert({ slug, phase: 'done', summary: lastFinisherSummary }), { click: lastFinisherUrl })])
            : null;
          await notifyExitNow(done);
          return;
        }
        await waker.wait([inbox.reportsDir, personInbox.inboxDir], POLL_MS);
        continue;
      }

      if (r.complete) {
        // Without the agent the run ends here, as it did before it (DESIGN §2.1).
        coordinator.closeAgent();
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
          base,
          why: r.surfaces.find((s) => s.kind === 'red-feature')?.text,
        }));
        // Without the agent the run ends on this pass, so its end alert is awaited, bounded (DESIGN §2.4).
        const alert = endAlert({
          slug,
          ready: !!r.readyToMerge,
          taskCount: r.tasks.length,
          reason: r.surfaces.find((s) => s.kind === 'red-feature')?.text ?? null,
          unresolved: false,
          base,
        });
        await notifyExitNow(runNotify([endAlertAction(alert)]));
        return;
      }

      // Runaway breaker (DESIGN §5.2). Count THIS run's workers only — a foreign session sharing the
      // git-dir must not trip it. r.live is already that count (loop.mjs filters), so reuse it.
      const verdict = runawayVerdict({ liveCount: r.live, ceiling: CEILING, overPasses: over, overGrace: OVER_GRACE, overSince, now: Date.now(), minHeldMs: OVER_HOLD_MS });
      over = verdict.over;
      overSince = verdict.overSince;
      if (verdict.abort) {
        // Abnormal exit (T10): the runaway breaker records NO final status → crashed, not `finished`.
        renderer.line(`\nABORT: ${r.live} live workers over ceiling ${CEILING} for ${over} pass(es) — a runaway.`);
        teardownOnce('runaway');
        await notifyExitNow();
        return;
      }

      // Stall detection: a pass that did nothing AND has nothing live is the run genuinely finished (all
      // tasks ✅ and handed off, or everything deferred). A parked worker (live > 0) is NOT a stall — it
      // waits for the person's answer, so the loop keeps polling for it.
      const productive = r.actions.some((a) => PRODUCTIVE_ACTIONS.includes(a.type));
      const stall = stallVerdict({ quiet: !productive && r.live === 0, idlePasses: idle, idleSince, now: Date.now(), grace: STALL_GRACE, minHeldMs: STALL_HOLD_MS });
      idle = stall.idle;
      idleSince = stall.idleSince;
      if (stall.stalled) {
        finishRun('stall'); // nothing left to do is a clean end — records `finished` (§2.2, T10).
        renderer.line('\n=== nothing left to do (no live workers, nothing to dispatch or hand off) ===');
        teardownOnce('stalled'); // a no-op when nothing is live; still safe
        await notifyExitNow();
        return;
      }

      // React to a worker's report instead of only polling for it (DESIGN §2.2). A worker drops its
      // report into reports/ and the person's input lands in inbox/, so watch both and wake the moment a
      // file lands: a forwarded answer changes what the next pass shows. POLL_MS is only a backstop for a
      // missed fs.watch event. Only these two folders are watched, never the control dir at large, so the
      // bin's OWN writes this pass (the flow log) cannot wake it into a busy spin. Everything else that is
      // not a drop (a worker's request, output, turn end or exit, the agent's decisions, a setup settling)
      // calls waker.wake() (fast-tests DESIGN §2.1); a wake that landed during this pass returns at once.
      await waker.wait([inbox.reportsDir, personInbox.inboxDir], POLL_MS);
    }
  } catch (e) {
    // Abnormal exit (T10): an uncaught error records NO final status → crashed.
    teardownOnce('error');
    await notifyExitNow();
    throw e;
  } finally {
    personInbox.stop();
  }
}

// Only run the bin when invoked directly, never on import (the tests import the functions above).
if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
