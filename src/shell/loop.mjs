// The coordinator loop (DESIGN §3.2 loop.mjs, §3.3, §3.4). It is the thin driver that turns the
// pure decision of decideDispatch into real actions against a platform and a worktree. It gathers
// state (parse the feature branch's PROGRESS.md, list workers, drain the inbox, read the kill
// switch), asks core what to do, and executes it: open the feature branch once, spawn an
// implement worker per ready task, hand a review-ready task to a fresh reviewer while closing its
// implementer, merge one done task branch into the feature branch and reconcile its row, close
// finished and dead workers, and — when the whole plan is ✅ — run the feature-branch tests and
// carry a ready-to-merge (or red) result out for the shell to hand off. It never merges to main
// (DESIGN §2.4): the one irreversible act, the merge to main, is the person's to run by hand.
//
// It lives in src/shell/ and so may touch fs and drive the platform; every decision it makes comes
// from src/core/ (decideDispatch, reconcileTaskRow, parseProgress, the naming helpers), which stay
// pure. The platform and worktree are injected, so the same loop runs against the fakes (this task)
// or the real CLI and git (T06/T08).

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseProgress, reconcileTaskRow, progressPathFor } from '../core/progress.mjs';
import { decideDispatch } from '../core/dispatch.mjs';
import { decideResume } from '../core/resume.mjs';
import { workerName, isWorkerOf, parseAgentName } from '../core/naming.mjs';
import { buildConflictPrompt } from '../core/conflict.mjs';

// The phases the loop tracks per task from a worker's own messages plus the lifecycle step it
// drives (DESIGN §2.8: the name carries identity, the lifecycle carries phase). Only three of these
// are actionable to decideDispatch — review-ready, done, dead — the rest are "live, wait".
const IMPLEMENTING = 'implementing';
const REVIEW_READY = 'review-ready';
const REVIEWING = 'reviewing';
const AWAITING = 'awaiting-answer';
const DONE = 'done';

// A fresh run's bookkeeping. `feature` is set the first pass; `tasks` maps a task id to what the
// loop knows about the worker holding it: its worktree, its live session id, its role and phase,
// and any parked decision. This is the phase memory §2.8 says the coordinator keeps.
export function createRunState() {
  return { feature: null, tasks: {}, closedIds: new Set(), reconciled: false };
}

// The default kill switch and log for a dry run: never halted, log discarded. The real control.mjs
// (flag file + log file) is injected in its place by the live coordinator.
const NO_CONTROL = { isHalted: () => false, log: () => {} };

// The default pre-hand-off test gate (DESIGN §2.4: the feature branch's tests are the last gate
// before the run hands the branch to the person to merge). A real run injects a function that runs
// the test command on the feature branch; the dry run has no suite on the scratch repo, so green is
// the default and a test injects a red result to prove the loop refuses to hand off a red branch.
const GREEN = () => ({ ok: true });

function taskByWorkerId(state, workerId) {
  for (const [num, t] of Object.entries(state.tasks)) if (t.workerId === workerId) return { num, t };
  return null;
}

// Record the adoption of any worker-introduced tasks a merge carried, and surface any rejected rows
// (DESIGN §2.2, §2.3, §2.5, §3.2). Both merge sites — the live merge in runPass (3d) and the
// restart-reconcile merge — read `added`/`errors` off mergeTask's return: an `adopt` action per task
// number the coordinator folded into the feature table (so the run tells the person what it picked
// up, dispatched on a later pass by the unchanged brain), and a `bad-plan-change` surface per error
// (a forbidden edit, a dep on an unknown task, a duplicate number, a malformed row). Unlike a merge
// conflict a bad-plan-change does not park anyone: the introducing task's reviewed code has landed,
// so the surface is informational and the run continues — the person adds the task by hand if they
// still want it (DESIGN §2.5, §6). A merge with nothing to adopt and no error records neither, so a
// run with no plan change is byte-for-byte the old behaviour.
// A `late-block` surface is an adopted task whose `blocks` edge landed on a task already started —
// ✅/🔍/🟡 on the feature row, or ⬜ there but held by a live worker, which only the loop knows. It is
// informational like bad-plan-change: nothing can stop that worker (no down-channel), but the person
// must hear the task was built without the new work (docs/task-state.md). `held` is the set of task
// numbers the run has a worker on.
function recordAdoption(record, res, held = new Set()) {
  for (const task of res.added ?? []) record('adopt', { task });
  for (const text of res.errors ?? []) record('surface', { kind: 'bad-plan-change', task: taskInAdoptError(text), text });
  for (const { task, target, state } of res.blockEdges ?? []) {
    if (state === '⬜' && !held.has(target)) continue;
    const text = `${task} blocks ${target}, but ${target} was already started without ${task}'s work; check whether ${target} needs redoing`;
    record('surface', { kind: 'late-block', task: target, text });
  }
}

// An adoptNewTaskRows error string names the offending task first when it has one ("T03: …"); a
// parse or no-table error may name none. Pull the first T-number so the surface (and the flow log
// line, which keys on `task`) points at the rejected task where the error identifies one, and leave
// it undefined otherwise rather than inventing a task id.
function taskInAdoptError(text) {
  const m = /T\d+/.exec(text);
  return m ? m[0] : undefined;
}

// Fold each drained worker→coordinator report into the tracked phase (DESIGN §2.2, §3.4). A question
// or an unresolved conflict parks the task and is recorded for the live display — the program shows who
// is asking and the person answers that worker directly (DESIGN §2.2), nothing is routed. `implemented`
// and `done` move the task along. `record` (not a raw actions array) is passed so a worker-raised surface is
// written to the FLOW LOG, not only the in-memory actions: the capture harness reads the flow log
// (control/log, T14), and a worker's question or a conflict the worker caught at its own integrate
// step used to live only in `actions` — invisible in the flow, so questionRoundTrip and the
// conflict facts could not see it happened (T16 review 2026-09-11). A conflict the COORDINATOR hits
// at mergeTask is logged by its own record('surface') in 3d; this closes the worker-raised path so
// both an operator and the harness see every escalation. The log line stays `surface {task}` (no
// kind on disk), so the facts still key on the task, not a kind (see this file's header note).
function applyMessages(state, messages, record) {
  for (const m of messages) {
    const t = state.tasks[m.task];
    if (!t) continue;
    if (m.kind === 'implemented') {
      t.phase = REVIEW_READY;
    } else if (m.kind === 'done') {
      t.phase = DONE;
    } else if (m.kind === 'question' || m.kind === 'decision' || m.kind === 'conflict') {
      // `decision` is a worker's "genuine choice, either answer defensible" (pir-worker skill, DESIGN
      // §2.5); it parks and surfaces exactly like a `question`. It was previously unhandled here, so a
      // real worker's decision message was silently dropped (found closing the T12 wire contract).
      t.phase = AWAITING;
      t.decision = { kind: m.kind, text: m.text };
      record('surface', { task: m.task, kind: m.kind, text: m.text });
    }
  }
}

// How many passes a just-spawned worker may be absent from the live list before it is declared dead.
// A worker takes a moment to appear in `claude agents --json`; without this grace a worker not yet
// listed would be called dead and respawned into a duplicate — the runaway the name-based match below
// otherwise prevents (FINDINGS 2026-09-09).
const APPEAR_GRACE = 1;

// How long the loop keeps DEFERRING a finished worker (review-ready or done) that `claude agents
// --json` still reports `busy`, before it stops trusting that flag and forces the hand-off (3c) or the
// merge-and-close (3d). The idle gate (T13 Problem B) exists to avoid SIGTERMing a worker mid-turn and
// to let its final commit land — but a worker that has already dropped its `implemented`/`done` report
// has finished its deliverable, so a session that stays busy long past that report is almost always a
// LEFTOVER BACKGROUND PROCESS holding the session open (a test suite's daemon, a file-watcher, an
// `until … sleep` poll loop), not real work. Left unbounded it stalls the whole run: the usage-limits
// live run held T05 ~1h on its implementer and ~4h on its reviewer, both from a backgrounded test suite
// whose `cockpitd` daemon outlived it, until the run was torn down by hand — and the coordinator's own
// guess ("paused on a permission prompt?") was wrong, sending the post-mortem the wrong way. Past this
// cap the loop forces the close and logs a distinct `force-idle` line naming the likely cause. This
// UNBLOCKS THE COORDINATOR — it stops one stuck session holding up the whole run — but it is NOT a
// cleanup: SIGTERMing the session does NOT reliably kill the leaked process. A daemon that double-forks
// detaches from the session's process group and reparents to init, so it survives the session's death
// entirely (the usage-limits `cockpitd` daemons were still running 8+ hours later as pid-1 orphans). The
// only reliable cleanup is the worker's: run the suite in the FOREGROUND so the test script's own
// `trap … EXIT` fires and kills its daemons, and leave nothing running before going idle (pir-worker
// skill). This cap only bounds the coordinator-side stall; it cannot undo a leak the worker left behind.
// Generous on purpose: a real final commit lands in seconds, so it only ever fires on a stuck session.
const AWAIT_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

// Rebuild the assignments decideDispatch consumes, matching each tracked task to a live worker BY
// the task NUMBER and role parsed out of the worker's NAME, not by the id spawn returned. The id
// `claude --bg` prints does NOT reliably equal the `id` in `claude agents --json` (T08 live run,
// FINDINGS 2026-09-09), so trusting it made the loop declare every worker dead and respawn — a runaway
// that breached the ceiling. The name is the key, and the live id comes from the list: it is written
// back onto the task as the authoritative id that close acts on.
//
// The match is on the NUMBER (and role), never a reconstruction of the full name: a worker name now
// carries a readable slug (DESIGN §2.9) that is a label, not the identity, so matching on the number
// keeps a worker resolving to its task regardless of its slug — and regardless of the legacy "·" vs new
// "/" separator during the T02→T05 transition, since parseAgentName reads both. liveList is already
// this run's workers only (the caller filters with isWorkerOf), so a foreign or coordinator name never
// enters the map. A task whose worker is absent from the list past its grace is dead (DESIGN §2.5); one
// still within grace is treated as live-pending, not respawned.
function buildAssignments(state, liveList) {
  const byNumRole = new Map();
  for (const w of liveList) {
    const p = parseAgentName(w.name);
    if (p.task) byNumRole.set(`${p.task}/${p.role}`, w);
  }
  const assignments = [];
  for (const [num, t] of Object.entries(state.tasks)) {
    const w = byNumRole.get(`${num}/${t.role}`);
    if (w) {
      t.workerId = w.id; // authoritative id from the list, what close can actually stop
      t.grace = 0;
      assignments.push({ workerId: w.id, task: num, phase: t.phase, live: true });
    } else if ((t.grace ?? 0) > 0) {
      t.grace -= 1; // spawned but not yet listed — wait rather than respawn into a duplicate
      assignments.push({ workerId: t.workerId ?? null, task: num, phase: t.phase, live: true });
    } else if (t.workerId) {
      assignments.push({ workerId: t.workerId, task: num, phase: 'dead', live: false });
    }
  }
  return assignments;
}

// reconcile — pass 0, folded into the first pass (DESIGN §2.1, §2.4, §2.5). A restart's in-memory
// state is empty and the feature-branch PROGRESS.md lags (it only advances a row past ⬜ at merge), so
// a task built (🔍) or built-and-reviewed (✅) on its own task branch but not merged still reads ⬜ on
// the feature branch and would be rebuilt from scratch. Git is the ground truth: this reads each task
// branch's committed glyph (T02), asks the pure classifier (T01) for one action per task, and executes
// it against the real platform and worktree. It runs once per run, gated on state.reconciled, and is a
// no-op on a genuine first start because a first start has no task branches to adopt — which is why
// there is no "am I restarting?" flag anywhere (a flag is a second source of truth that can disagree
// with git; the presence of task branches cannot). `record` is the runPass logger, so every action
// reconciliation takes also reaches the flow log the harness reads.
function reconcile({ platform, worktree, repo, slug, maxWorkers, state, featureProgressPath, record }) {
  // Reap the dead run's leftover worker sessions FIRST, session-only (DESIGN §2.5). The only crash that
  // leaves task branches to reconcile is one that skips coordinate.mjs's SIGTERM teardown (which would
  // have removed the worktrees and branches) — and that same abruptness leaves the dead run's worker
  // sessions still running. An un-reaped orphan both inflates the live-worker count (tripping the runaway
  // breaker) and hides from decideDispatch's slot maths (so it would over-spawn). So stop every listed
  // worker of this slug before adopting anything — close + remove the session record ONLY, NEVER
  // worktree.remove, because the task branches and worktrees are exactly what the adoption below needs.
  // Reaped ids go into closedIds so a lingering listing is not recounted against the ceiling.
  for (const w of platform.list()) {
    if (!isWorkerOf(w.name, { repo, plan: slug })) continue;
    platform.close(w.id);
    platform.remove?.(w.id);
    state.closedIds.add(w.id);
  }

  // Read the task list and terminal states from the feature branch, each task's in-flight state from
  // its own task branch's committed glyph (DESIGN §2.2), and classify (pure, DESIGN §2.3).
  const featureTasks = parseProgress(readFileSync(featureProgressPath, 'utf8')).tasks;
  const slugByNum = new Map(featureTasks.map((t) => [t.num, t.name])); // Task-column slug per task (§2.9)
  const branchStates = {};
  for (const t of featureTasks) branchStates[t.num] = worktree.taskBranchState(slug, t.num);
  const { merge, review, rebuild } = decideResume({ featureTasks, branchStates });

  // merge: fold each built-and-reviewed (✅) branch into the feature branch directly — no worker
  // session, because the branch is already reviewed (DESIGN §2.5). This mirrors the loop's own
  // merge-and-reconcile (3d) minus the close, applied in task order. Merges are performed HERE rather
  // than by seeding a tracked task, because buildAssignments treats a sessionless tracked task as dead
  // and removes its branch — which would discard exactly the work being adopted (FINDINGS 2026-09-17).
  // A conflict is surfaced and the branch left untouched — never rebuilt: the work is good, it only
  // needs a hand to land (DESIGN §2.6). It is ALSO marked ⛔ on the feature row so the coordinator does
  // not re-grab it: unlike the loop's own 3d conflict path, reconciliation has no live worker to park
  // (the session died in the crash), so a ⬜ row left behind would be seen as ready by decideDispatch
  // and re-implemented on the very same pass — clobbering the reviewed work the design says to preserve
  // (reproduced 2026-09-17). ⛔ is skipped by both decideDispatch (not ⬜) and decideResume (feature
  // ✅/⛔), so the branch is left untouched for a person to land and its dependents wait (§2.7). The run
  // cannot complete until the person resolves it. User decision 2026-09-17 (flag needs-a-person, continue).
  const merged = [];
  const conflicted = [];
  for (const num of merge) {
    const handle = worktree.taskWorktreeHandle(slug, num);
    if (!handle) continue; // branch vanished under us; nothing to fold in.
    const res = worktree.mergeTask(handle.branch);
    if (res.conflict) {
      // No live worker to attach to — the crashed run's session died with it (DESIGN §2.6) — so the
      // prompt names the branch for the person to check out and land by hand (T14, buildConflictPrompt).
      const text = `merge conflict in ${res.files?.join(', ') || 'the feature branch'}`;
      const prompt = buildConflictPrompt({
        task: num,
        slug: slugByNum.get(num),
        workerName: null,
        taskBranch: handle.branch,
        featureBranch: state.feature.branch,
        files: res.files,
      });
      record('surface', { task: num, kind: 'conflict', text, prompt });
      const blocked = reconcileTaskRow(readFileSync(featureProgressPath, 'utf8'), { num, state: '⛔', notes: '' });
      writeFileSync(featureProgressPath, blocked);
      worktree.commitFeature(`reconcile ${num} → ⛔ (merge conflict, needs a hand)`);
      conflicted.push(num);
      continue;
    }
    const reconciled = reconcileTaskRow(readFileSync(featureProgressPath, 'utf8'), { num, state: '✅', notes: '' });
    writeFileSync(featureProgressPath, reconciled);
    worktree.commitFeature(`reconcile ${num} → ✅`);
    worktree.remove(handle);
    merged.push(num);
    record('merge', { task: num, branch: handle.branch });
    // A restart merge adopts a worker-introduced task exactly as a live merge does (DESIGN §2.5,
    // §3.2): the row rode the branch and lands on this same merge, ready to dispatch next pass.
    recordAdoption(record, res);
  }

  // review: hand each built-but-unreviewed (🔍) branch to a FRESH reviewer on its existing worktree and
  // seed it into run state as a normal reviewing task (worktree, the reviewer's id, role review, phase
  // reviewing, appear grace), so from the next pass the live loop owns it and reviews and merges it like
  // any other (DESIGN §2.5). The seeded task has a real, freshly spawned session — never a sessionless
  // one, or buildAssignments would call it dead and discard the adopted branch. Cap review spawns at the
  // ceiling: the in-flight bound makes exceeding it unreachable (a 🔍 branch held a live slot at the
  // crash, and the reap freed it), so the cap fails loud rather than over-spawning (DESIGN §2.5).
  let reviewSpawns = 0;
  for (const num of review) {
    const handle = worktree.taskWorktreeHandle(slug, num);
    if (!handle) continue;
    if (reviewSpawns >= maxWorkers) {
      record('surface', { task: num, kind: 'over-ceiling', text: `reconciliation would spawn more than ${maxWorkers} reviewers — the in-flight bound says this cannot happen` });
      continue;
    }
    const taskSlug = slugByNum.get(num);
    const name = workerName({ repo, plan: slug, task: num, slug: taskSlug, role: 'review' });
    const reviewerId = platform.spawn({ cwd: handle.path, name, phase: 'review' });
    state.tasks[num] = { worktree: handle, workerId: reviewerId, role: 'review', slug: taskSlug, phase: REVIEWING, grace: APPEAR_GRACE };
    reviewSpawns += 1;
    record('review', { task: num, workerId: reviewerId, adopted: true });
  }

  // rebuild: discard each half-built branch (worktree + branch). The feature row stays ⬜, so the same
  // pass's normal spawn step re-dispatches a fresh implementer and createTask re-cuts a clean branch off
  // the feature branch (DESIGN §2.5). Discarding FIRST is what guarantees the retry starts clean rather
  // than on the leaked half-built branch. Rebuild-clean over salvage is the user's decision (§2.3, §7):
  // a re-implement from the task doc is correct by construction; adopting a possibly-half-finished branch
  // risks landing it as done.
  for (const num of rebuild) {
    const handle = worktree.taskWorktreeHandle(slug, num);
    if (handle) worktree.remove(handle);
    record('rebuild', { task: num });
  }

  // cleanup: a task already merged (feature ✅) whose task branch was never removed — the merge landed
  // but close did not run before the crash. Remove the leftover worktree/branch so restarts do not leave
  // orphaned branches accumulating (DESIGN §2.6). decideResume skips feature-✅ tasks, so this is a
  // separate sweep over the ORIGINAL feature states (a task merged just above was ⬜ at restart, so it is
  // not swept, and its branch was already removed by its merge).
  for (const t of featureTasks) {
    if (t.state !== '✅') continue;
    const handle = worktree.taskWorktreeHandle(slug, t.num);
    if (handle) {
      worktree.remove(handle);
      record('cleanup', { task: t.num, branch: handle.branch });
    }
  }

  // Narrate the restart in one plain-English line (DESIGN §2.8). A resumed run is otherwise
  // indistinguishable from a fresh one in the coordinator's output, yet resume-not-rebuild is exactly
  // what the live drill (T07) has a person judge. Only an ADOPTION counts as a resume: a first start
  // adopts nothing (every branch absent), so it emits no summary and a first run's output is unchanged.
  // The never-started tasks are named as "starting fresh" only when something was adopted alongside them.
  const started = featureTasks
    .filter((t) => t.state === '⬜' && branchStates[t.num] == null)
    .map((t) => t.num);
  // `merged` is what actually folded in, not decideResume's merge list — a ✅ branch that hit a conflict
  // was blocked (⛔), not merged, and is narrated as needing a hand rather than falsely as merged.
  if (merged.length + review.length + rebuild.length + conflicted.length > 0) {
    const parts = [];
    if (merged.length) parts.push(`merged ${merged.join(', ')} (already finished)`);
    if (review.length) parts.push(`sent ${review.join(', ')} to review (already built)`);
    if (rebuild.length) parts.push(`rebuilding ${rebuild.join(', ')} (only half-built)`);
    if (conflicted.length) parts.push(`${conflicted.join(', ')} need a hand to land (finished but clash with a neighbour)`);
    if (started.length) parts.push(`starting ${started.join(', ')} fresh`);
    record('restart-summary', {
      text: `Restarted and reconciled from git: ${parts.join('; ')}.`,
      merged,
      reviewed: review,
      rebuilt: rebuild,
      blocked: conflicted,
      started,
    });
  }

  state.reconciled = true;
}

// runPass — one turn of the loop. Gathers, decides, executes, and returns the structured actions it
// took plus a human log and the counts drain needs to know when to stop. `state` carries the phase
// memory across passes; the platform, worktree, control and runTests are injected.
export function runPass({ platform, worktree, repo, slug, maxWorkers, state, control = NO_CONTROL, runTests = GREEN, now = () => Date.now() }) {
  const actions = [];
  const log = [];
  const record = (type, extra = {}) => {
    const a = { type, ...extra };
    actions.push(a);
    const line = `${type} ${extra.task ?? extra.branch ?? ''}`.trim();
    log.push(line);
    control.log(line);
    return a;
  };

  // The loop makes no down-send, and there is no down-channel to make one on (DESIGN §2.2, T03). A
  // worker that cannot continue drops a question/decision report UP (applyMessages below parks it and
  // records the escalation for the live display); the person then answers that worker DIRECTLY in its
  // own session, and the worker un-parks and re-signals on its own. Nothing is routed back down — the
  // program never sees the answer. The spawn-time hello was retired in T30 and the whole down-channel,
  // with the answer relay, in T03, so this loop never calls a platform send.

  // 0. Open the feature branch once, in the coordinator's own worktree (DESIGN §2.9).
  if (!state.feature) {
    state.feature = worktree.openFeature(slug);
    record('open-feature', { branch: state.feature.branch });
  }
  const featureProgressPath = join(state.feature.path, progressPathFor(slug));

  // 0.5 Reconcile from git once, before the first dispatch (DESIGN §2.1, §2.4). A no-op on a genuine
  // first start (no task branches to adopt); on a restart it reaps the dead run's leftover sessions,
  // merges ✅ branches, hands 🔍 branches to fresh reviewers, and discards half-built ones — so the loop
  // below runs over a state that matches git. closedIds may be absent on a hand-built state; ensure it
  // before the reap writes to it.
  state.closedIds ??= new Set();
  if (!state.reconciled) {
    reconcile({ platform, worktree, repo, slug, maxWorkers, state, featureProgressPath, record });
  }

  // 1. Gather. list() is the fake's tick, so it is called exactly once and its result reused.
  const halted = control.isHalted();
  const listed = platform.list();
  // A session this loop has already closed can linger in `claude agents --json` for several passes:
  // `close` SIGTERMs the process, but that is asynchronous and a stale Remote Control registry entry
  // can outlive the process itself (single live run 2026-09-12: a just-closed implementer stayed listed
  // alongside its fresh reviewer, so at ceiling 1 the loop counted 2 workers for 3 passes and the
  // runaway breaker tore the run down mid-review, before any promote). So the loop remembers every id it
  // closed and never recounts it as live.
  //
  // The memory is NEVER pruned within a run. An earlier version pruned an id the moment it fell off the
  // list — but a SIGTERM'd session does not just linger, it can VANISH for a pass or two and then
  // REAPPEAR under the SAME id as a stale registry entry (human-decision live run 2026-09-13: a closed
  // implementer dropped off `claude agents --json` for ~10s, came back `idle` beside its reviewer, and
  // was recounted → 2 over ceiling 1 for 3 passes → the runaway breaker tore the run down mid-review,
  // the exact failure the 2026-09-12 fix meant to close). Pruning on a single-pass absence un-suppressed
  // exactly that resurrection. Session ids are unique per session, so a remembered closed id can never
  // collide with a genuinely new worker; retaining every closed id for the life of the run is safe, and
  // the set stays small (at most one implement + one review id per task).
  state.closedIds ??= new Set();
  // Keep only THIS run's workers ({repo} · {slug} · T…), and drop any we have already closed. `claude
  // agents --json` lists every session sharing the repo git-dir, which includes the coordinator's OWN
  // session and any foreign agent; the drill counted the coordinator itself and reported `ceiling full:
  // 2/1 busy` with one real worker (T12 Problem 5). Everything downstream — the ceiling count,
  // buildAssignments, close — operates on this run's not-yet-closed workers only, so a foreign session
  // can never be counted, adopted or closed, and neither can a closed session lingering in the list.
  const liveList = listed.filter(
    (w) => isWorkerOf(w.name, { repo, plan: slug }) && !state.closedIds.has(w.id),
  );
  // The live worker record by its authoritative id, so a close of a FINISHED worker can be gated on it
  // being idle (T13 Problem B). `claude agents --json` reports each session's `status` (idle/busy);
  // parseAgents carries it through (platform.mjs). A worker is "busy" only when the list explicitly
  // says so, so an ad-hoc platform that omits `status` (some loop.test fakes) reads as not-busy and the
  // gate is inert — this only ever DEFERS a close, never forces one.
  const liveById = new Map(liveList.map((w) => [w.id, w]));
  const isBusy = (id) => liveById.get(id)?.status === 'busy';
  const messages = platform.inbox();
  applyMessages(state, messages, record);

  const progressText = readFileSync(featureProgressPath, 'utf8');
  const parsed = parseProgress(progressText);
  // Each task's slug is its Task-column value (DESIGN §2.9), carried into the worker name at spawn as a
  // readable label. Keyed by number so a spawn can look it up; the number stays the identity everything
  // matches on (buildAssignments).
  const slugByNum = new Map(parsed.tasks.map((t) => [t.num, t.name]));
  const assignments = buildAssignments(state, liveList);

  // 2. Decide.
  const decision = decideDispatch({ tasks: parsed.tasks, assignments, maxWorkers, halted });

  const liveIds = new Set(liveList.map((w) => w.id));
  const closedThisPass = new Set();
  const spawnedThisPass = [];
  const deadIds = new Set(assignments.filter((a) => !a.live || a.phase === 'dead').map((a) => a.workerId));

  // 3a. Halted: close every worker's session and do nothing else. Worktrees and branches are left on
  // disk for inspection; main is untouched (DESIGN §2.4, §2.5). No promotion, no merge, no spawn.
  if (halted) {
    for (const id of decision.close) {
      // Close only — NO platform.remove here (T41, DESIGN §2.3): a HALT is an emergency stop, and a
      // killed worker's session record is deliberately left in `claude agents` for forensics, exactly as
      // its worktree and branch are left on disk. Removal is for workers that FINISHED, not ones a HALT
      // killed; a mutation that removes on halt reddens the HALT-exception test.
      platform.close(id);
      closedThisPass.add(id);
      record('halt-close', { workerId: id });
    }
    for (const id of closedThisPass) state.closedIds.add(id);
    const liveAfter = [...liveIds].filter((id) => !closedThisPass.has(id)).length;
    return { actions, log, halted: true, complete: false, liveAfter, tasks: parsed.tasks };
  }

  // 3a. Clean up dead workers first (DESIGN §2.5 — a crashed or abandoned worker). Their session is
  // stopped and their worktree and branch removed BEFORE the spawn step, because decideDispatch may
  // re-spawn the same task this pass (its row is still ⬜) and the retry needs a clean branch, not
  // the leaked one. Review-ready implementers and merged workers are live, not dead, and are torn
  // down later in their own steps.
  for (const workerId of decision.close) {
    if (!deadIds.has(workerId)) continue;
    const found = taskByWorkerId(state, workerId);
    platform.close(workerId);
    platform.remove?.(workerId); // clear the leftover `stopped` record — a normal finish (T41, DESIGN §2.3)
    closedThisPass.add(workerId);
    if (found) {
      worktree.remove(found.t.worktree);
      record('close', { task: found.num, workerId, reason: 'dead' });
      delete state.tasks[found.num];
    } else {
      record('close', { workerId, reason: 'dead' });
    }
  }

  // 3b. Spawn ready tasks, each an implement worker on a task branch off the feature branch (DESIGN
  // §2.5, §2.9). Every task is built the same way now: an implement worker, then a review; a task that
  // needs the person's judgement is an ordinary worker that prepares the ground and asks (§2.5, the
  // worker-contract half in T07). decideDispatch has already capped this to the ceiling.
  for (const num of decision.spawn) {
    const wt = worktree.createTask(slug, num);
    const role = 'implement';
    const taskSlug = slugByNum.get(num);
    const name = workerName({ repo, plan: slug, task: num, slug: taskSlug, role });
    const id = platform.spawn({ cwd: wt.path, name, phase: role });
    // workerId here is spawn's best-effort return, not trusted for liveness: buildAssignments resolves
    // the authoritative id by name next pass. grace lets the worker appear in the list before it could
    // be called dead (FINDINGS 2026-09-09). The task slug is stored so a later rebuild of this worker's
    // name (teardown) addresses the exact session that was spawned (§2.9).
    state.tasks[num] = { worktree: wt, workerId: id, role, slug: taskSlug, phase: IMPLEMENTING, grace: APPEAR_GRACE };
    spawnedThisPass.push(id);
    record('spawn', { task: num, role, workerId: id, slug: taskSlug });
  }

  // Finished workers whose close is held this pass because the agent list still shows them busy (T13
  // Problem B). They stay live and hold their slot; the close (and its paired review handoff or merge)
  // retries on a later pass once the worker is idle. A dead worker and the kill switch are exempt —
  // both close regardless of idleness (3a).
  const deferredClose = new Set();

  // 3c. Hand each review-ready task to a fresh reviewer on the same worktree, then close the
  // implementer's session (DESIGN §2.1, §2.3 — one task in review holds one slot). The reviewer
  // takes over the worktree, so closing the implementer is a session stop only.
  const reviewSwaps = new Map(); // implementer id → task num, so 3e closes the right session
  for (const workerId of decision.review) {
    const found = taskByWorkerId(state, workerId);
    if (!found) continue;
    const { num, t } = found;
    // Hand off to a fresh reviewer only once the implementer is idle (T13 Problem B). Closing it while
    // it is still mid-turn (SIGTERM) can interrupt or lose work — the session-idle analogue of the
    // mid-commit close FINDINGS 2026-09-09 already caught. If it is busy, hold: no reviewer spawns and
    // the implementer keeps its slot until a later pass finds it idle.
    if (isBusy(workerId)) {
      t.busySince ??= now();
      if (now() - t.busySince < AWAIT_IDLE_TIMEOUT_MS) {
        deferredClose.add(workerId);
        record('await-idle', { task: num, workerId, reason: 'review-ready worker still busy' });
        continue;
      }
      // Busy past AWAIT_IDLE_TIMEOUT_MS: stop trusting the flag and force the hand-off. A review-ready
      // worker has dropped its `implemented` report, so its deliverable is committed; a session still
      // busy this long past that is almost always a leftover background process, not work in flight.
      record('force-idle', { task: num, workerId, reason: 'review-ready worker busy past cap — likely a leftover background process; forcing hand-off' });
    }
    t.busySince = undefined;
    const revName = workerName({ repo, plan: slug, task: num, slug: t.slug, role: 'review' });
    const reviewerId = platform.spawn({ cwd: t.worktree.path, name: revName, phase: 'review' });
    reviewSwaps.set(workerId, { num, reviewerId });
    spawnedThisPass.push(reviewerId);
    record('review', { task: num, workerId: reviewerId, closes: workerId });
  }

  // 3d. Merge one done task branch into the feature branch, reconcile its row to ✅, and — only once
  // it merges cleanly — close the worker (DESIGN §2.5, §2.9). Merge and close are PAIRED here, not in
  // decideDispatch: a done worker is no longer listed in `close`, so a merge that CONFLICTS cannot
  // close the worker (the T22 conflict-path bug, where the same pass parked the conflict yet still
  // closed the done+merged worker and deleted its task, letting the next pass respawn a clobbering
  // fresh build). On a conflict the coordinator keeps the worker ALIVE and parked (AWAITING): its
  // session, worktree and task all stay, it holds its slot, and the person attaches to that same worker
  // directly to drive the resolution — nothing is routed down (§2.2, the down-channel is gone). It
  // resolves on its own branch and re-signals done (§2.5 Option 2, T28).
  for (const workerId of decision.merge) {
    const found = taskByWorkerId(state, workerId);
    if (!found) continue;
    const { num, t } = found;
    // Merge (and then close) a done worker only once it is idle (T13 Problem B). A worker that has just
    // signalled done may still be finishing its turn; waiting for idle both avoids SIGTERMing it
    // mid-work and guarantees its final commit has landed before its branch is merged. If busy, hold:
    // no merge, no close, the slot stays held, and the merge retries next pass.
    if (isBusy(workerId)) {
      t.busySince ??= now();
      if (now() - t.busySince < AWAIT_IDLE_TIMEOUT_MS) {
        deferredClose.add(workerId);
        record('await-idle', { task: num, workerId, reason: 'done worker still busy' });
        continue;
      }
      // Busy past AWAIT_IDLE_TIMEOUT_MS: a done worker has integrated and committed, so its final commit
      // has long since landed; a session still busy this long past its `done` report is a leftover
      // background process, not work. Force the merge and close so the run is not held up. (Closing the
      // session does not reliably kill a detached daemon — see AWAIT_IDLE_TIMEOUT_MS — it only unblocks.)
      record('force-idle', { task: num, workerId, reason: 'done worker busy past cap — likely a leftover background process; forcing merge and close' });
    }
    t.busySince = undefined;
    const res = worktree.mergeTask(t.worktree.branch);
    if (res.conflict) {
      // Keep the worker alive and parked — do NOT close it, remove its worktree, or delete its task.
      // There is no down-channel and no answer() any more (DESIGN §2.2, T03): the PERSON drives the
      // resolution. The run parks the worker and hands the person a ready-to-paste resolution prompt
      // (buildConflictPrompt, T14) naming this worker, the branch to merge in, and the conflicting files
      // — with the keep-which-side choice left blank. The person attaches to this same worker, resolves
      // on its branch and re-signals done, at which point this merge step runs again and lands cleanly
      // (§2.5, §2.8, T28). The run routes nothing down.
      const text = `merge conflict in ${res.files?.join(', ') || 'the feature branch'}`;
      const name = workerName({ repo, plan: slug, task: num, slug: t.slug, role: t.role });
      const prompt = buildConflictPrompt({
        task: num,
        slug: t.slug,
        workerName: name,
        taskBranch: t.worktree.branch,
        featureBranch: state.feature.branch,
        files: res.files,
      });
      t.phase = AWAITING;
      t.decision = { kind: 'conflict', text, prompt };
      record('surface', { task: num, kind: 'conflict', text, prompt });
      continue;
    }
    // The row folds back as ✅ (the task has been implemented and reviewed).
    // notes is empty for now: parseProgress does not surface the Notes column, so the worker's own
    // row account cannot be folded back yet (FINDINGS 2026-09-08). Restore it when the parser exposes
    // notes or the real coordinator (T09) writes its own summary.
    const reconciled = reconcileTaskRow(readFileSync(featureProgressPath, 'utf8'), {
      num,
      state: '✅',
      notes: '',
    });
    writeFileSync(featureProgressPath, reconciled);
    worktree.commitFeature(`reconcile ${num} → ✅`);
    record('merge', { task: num, branch: t.worktree.branch });
    // Narrate any worker-introduced task this branch carried and surface any rejected row (DESIGN
    // §2.2, §2.3, §2.5). Adoption already happened inside mergeTask; this only tells the person about
    // it. The adopted row dispatches on a later pass through the unchanged decideDispatch.
    recordAdoption(record, res, new Set(Object.keys(state.tasks)));
    // The branch is safely in the feature branch, so end the worker now (session stop + worktree
    // removal) and forget its task. This is the close decideDispatch used to schedule; pairing it with
    // the successful merge is what makes a conflicted merge leave the worker untouched (T28).
    platform.close(workerId);
    platform.remove?.(workerId); // clear the leftover `stopped` record — a normal finish (T41, DESIGN §2.3)
    closedThisPass.add(workerId);
    worktree.remove(t.worktree);
    record('close', { task: num, workerId, reason: 'merged' });
    delete state.tasks[num];
  }

  // 3e. Close the remaining workers decideDispatch names. Dead ones were handled in 3a, and a merged
  // worker is now closed in 3d paired with its merge (T28), so the only worker decideDispatch lists
  // here is a review-ready implementer being replaced: session stop, worktree kept, phase → reviewing.
  // The generic tail closes any other close-id defensively; it should not fire in normal flow.
  for (const workerId of decision.close) {
    if (deadIds.has(workerId)) continue; // already cleaned up in 3a
    if (deferredClose.has(workerId)) continue; // busy finished worker — held for a later pass (3c/3d)
    if (reviewSwaps.has(workerId)) {
      const { num, reviewerId } = reviewSwaps.get(workerId);
      platform.close(workerId);
      // The implementer's worktree is KEPT for the reviewer, but the implementer SESSION has finished,
      // so clear its leftover record — the "implementer lingered beside its reviewer" clutter (T41).
      platform.remove?.(workerId);
      closedThisPass.add(workerId);
      const t = state.tasks[num];
      t.workerId = reviewerId; // best-effort; resolved to the real id by name next pass
      t.grace = APPEAR_GRACE; // the fresh reviewer needs time to appear in the list
      t.role = 'review';
      t.phase = REVIEWING;
      continue;
    }
    const found = taskByWorkerId(state, workerId);
    platform.close(workerId);
    platform.remove?.(workerId); // a defensive finish close — clear its leftover record too (T41)
    closedThisPass.add(workerId);
    if (found) {
      worktree.remove(found.t.worktree);
      record('close', { task: found.num, workerId, reason: 'closed' });
      delete state.tasks[found.num];
    } else {
      record('close', { workerId });
    }
  }

  // 3f. The plan is done — run the feature-branch tests and carry the result out for the shell to hand
  // off (DESIGN §2.4). The run NEVER merges to main: merging the finished plan is the one irreversible
  // act in the system and it is the person's `what`, done by hand with `git merge`. A green branch
  // carries a readyToMerge; a red one carries testsPassed=false and no readyToMerge, and is surfaced so
  // the shell prints the failure and offers no merge line (DESIGN §2.8). worktree.promote is never
  // called and main is never touched.
  let complete = false;
  let testsPassed;
  let readyToMerge = null;
  if (decision.complete) {
    complete = true;
    const test = runTests(state.feature.path);
    if (test.ok) {
      testsPassed = true;
      readyToMerge = { branch: state.feature.branch };
    } else {
      testsPassed = false;
      record('surface', { kind: 'red-feature', text: 'feature branch tests failed; not ready to merge' });
    }
  }

  // Remember what we closed this pass so a lingering (still-listed) closed session is not recounted as
  // live next pass — the over-count that fired the runaway breaker on the first live single run.
  for (const id of closedThisPass) state.closedIds.add(id);
  const liveAfter =
    [...liveIds].filter((id) => !closedThisPass.has(id)).length + spawnedThisPass.length;
  return { actions, log, halted: false, complete, testsPassed, readyToMerge, liveAfter, tasks: parsed.tasks };
}

// drain — run passes until the plan is complete (every task ✅, tests run on the feature branch), the
// kill switch has closed everything, or the run goes quiet (all remaining workers parked on the user,
// or nothing left to do). Returns why it stopped, how many passes it took, the flattened actions, and
// the hand-off result (readyToMerge/testsPassed) when complete, plus the run state for inspection.
export function drain(opts) {
  const state = opts.state ?? createRunState();
  const maxPasses = opts.maxPasses ?? 200;
  const allActions = [];
  let idle = 0;

  for (let p = 1; p <= maxPasses; p++) {
    const r = runPass({ ...opts, state });
    allActions.push(...r.actions);

    if (r.complete)
      return { reason: 'complete', passes: p, complete: true, readyToMerge: r.readyToMerge, testsPassed: r.testsPassed, actions: allActions, state };
    if (r.halted) return { reason: 'halted', passes: p, complete: false, actions: allActions, state };

    const productive = r.actions.some((a) => ['spawn', 'review', 'merge', 'close'].includes(a.type));
    idle = productive ? 0 : idle + 1;
    if (idle >= 2) {
      const reason = r.liveAfter > 0 ? 'parked' : 'stalled';
      return { reason, passes: p, complete: false, actions: allActions, state };
    }
  }
  return { reason: 'maxPasses', passes: maxPasses, complete: false, actions: allActions, state };
}
