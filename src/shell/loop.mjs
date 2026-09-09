// The coordinator loop (DESIGN §3.2 loop.mjs, §3.3, §3.4). It is the thin driver that turns the
// pure decision of decideDispatch into real actions against a platform and a worktree. It gathers
// state (parse the feature branch's PROGRESS.md, list workers, drain the inbox, read the kill
// switch), asks core what to do, and executes it: open the feature branch once, spawn auto builders
// and hands-on `you` scribes, hand a review-ready task to a fresh reviewer while closing its
// implementer, merge one done task branch into the feature branch and reconcile its row, close
// finished and dead workers, and promote the feature branch to main when the whole plan is ✅.
//
// It lives in src/shell/ and so may touch fs and drive the platform; every decision it makes comes
// from src/core/ (decideDispatch, reconcileTaskRow, parseProgress, the naming helpers), which stay
// pure. The platform and worktree are injected, so the same loop runs against the fakes (this task)
// or the real CLI and git (T06/T08).

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseProgress, reconcileTaskRow, progressPathFor } from '../core/progress.mjs';
import { decideDispatch } from '../core/dispatch.mjs';
import { workerName, parseAgentName } from '../core/naming.mjs';

// The phases the loop tracks per task from a worker's own messages plus the lifecycle step it
// drives (DESIGN §2.8: the name carries identity, the lifecycle carries phase). Only three of these
// are actionable to decideDispatch — review-ready, done, dead — the rest are "live, wait".
const IMPLEMENTING = 'implementing';
const VERIFYING = 'verifying';
const REVIEW_READY = 'review-ready';
const REVIEWING = 'reviewing';
const AWAITING = 'awaiting-answer';
const DONE = 'done';

// A fresh run's bookkeeping. `feature` is set the first pass; `tasks` maps a task id to what the
// loop knows about the worker holding it: its worktree, its live session id, its role and phase,
// and any parked decision. This is the phase memory §2.8 says the coordinator keeps.
export function createRunState() {
  return { feature: null, tasks: {} };
}

// The default kill switch and log for a dry run: never halted, log discarded. The real control.mjs
// (flag file + log file) is injected in its place by the live coordinator.
const NO_CONTROL = { isHalted: () => false, log: () => {} };

// The default pre-promotion test gate (DESIGN §2.9: the feature branch's tests are the last gate).
// A real run injects a function that runs the test command on the feature branch; the dry run has
// no suite on the scratch repo, so green is the default and a test injects a red result to prove the
// loop refuses to promote a red branch.
const GREEN = () => ({ ok: true });

function taskByWorkerId(state, workerId) {
  for (const [num, t] of Object.entries(state.tasks)) if (t.workerId === workerId) return { num, t };
  return null;
}

// Fold each drained worker→coordinator message into the tracked phase (DESIGN §2.5, §3.4). A
// question or an unresolved conflict parks the task and is surfaced to the user; implemented and
// done move it along.
function applyMessages(state, messages, actions) {
  for (const m of messages) {
    const t = state.tasks[m.task];
    if (!t) continue;
    if (m.kind === 'implemented') {
      t.phase = REVIEW_READY;
    } else if (m.kind === 'done') {
      t.phase = DONE;
    } else if (m.kind === 'question' || m.kind === 'conflict') {
      t.phase = AWAITING;
      t.decision = { kind: m.kind, text: m.text };
      actions.push({ type: 'surface', task: m.task, kind: m.kind, text: m.text });
    }
  }
}

// How many passes a just-spawned worker may be absent from the live list before it is declared dead.
// A worker takes a moment to appear in `claude agents --json`; without this grace a worker not yet
// listed would be called dead and respawned into a duplicate — the runaway the name-based match below
// otherwise prevents (FINDINGS 2026-09-09).
const APPEAR_GRACE = 1;

// Rebuild the assignments decideDispatch consumes, matching each tracked task to a live worker BY
// NAME, not by the id spawn returned. The name the coordinator assigns is deterministic (§2.8:
// "the coordinator finds and identifies its workers from the name alone"); the id `claude --bg`
// prints does NOT reliably equal the `id` in `claude agents --json` (T08 live run, FINDINGS
// 2026-09-09), so trusting it made the loop declare every worker dead and respawn — a runaway that
// breached the ceiling. So the name is the key, and the live id comes from the list: it is written
// back onto the task as the authoritative id that close acts on. A task whose worker is absent from
// the list past its grace is dead (DESIGN §2.5 — a crashed or abandoned worker); one still within
// grace is treated as live-pending, not respawned.
function buildAssignments(state, liveList, repo, slug) {
  const byName = new Map(liveList.map((w) => [w.name, w]));
  const assignments = [];
  for (const [num, t] of Object.entries(state.tasks)) {
    const w = byName.get(workerName({ repo, plan: slug, task: num }));
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

// runPass — one turn of the loop. Gathers, decides, executes, and returns the structured actions it
// took plus a human log and the counts drain needs to know when to stop. `state` carries the phase
// memory across passes; the platform, worktree, control and runTests are injected.
export function runPass({ platform, worktree, repo, slug, maxWorkers, state, control = NO_CONTROL, runTests = GREEN }) {
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

  // 0. Open the feature branch once, in the coordinator's own worktree (DESIGN §2.9).
  if (!state.feature) {
    state.feature = worktree.openFeature(slug);
    record('open-feature', { branch: state.feature.branch });
  }
  const featureProgressPath = join(state.feature.path, progressPathFor(slug));

  // 1. Gather. list() is the fake's tick, so it is called exactly once and its result reused.
  const halted = control.isHalted();
  const liveList = platform.list();
  const messages = platform.inbox();
  applyMessages(state, messages, actions);

  const progressText = readFileSync(featureProgressPath, 'utf8');
  const parsed = parseProgress(progressText);
  const assignments = buildAssignments(state, liveList, repo, slug);

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
      platform.close(id);
      closedThisPass.add(id);
      record('halt-close', { workerId: id });
    }
    const liveAfter = [...liveIds].filter((id) => !closedThisPass.has(id)).length;
    return { actions, log, halted: true, promoted: false, liveAfter, tasks: parsed.tasks };
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
    closedThisPass.add(workerId);
    if (found) {
      worktree.remove(found.t.worktree);
      record('close', { task: found.num, workerId, reason: 'dead' });
      delete state.tasks[found.num];
    } else {
      record('close', { workerId, reason: 'dead' });
    }
  }

  // 3b. Spawn ready tasks (auto builders and you scribes), each on a task branch off the feature
  // branch (DESIGN §2.6, §2.9). decideDispatch has already capped this to the ceiling.
  for (const { num, runs } of decision.spawn) {
    const wt = worktree.createTask(slug, num);
    const name = workerName({ repo, plan: slug, task: num });
    const role = runs === 'you' ? 'verify' : 'implement';
    const id = platform.spawn({ cwd: wt.path, name, phase: role });
    // workerId here is spawn's best-effort return, not trusted for liveness: buildAssignments resolves
    // the authoritative id by name next pass. grace lets the worker appear in the list before it could
    // be called dead (FINDINGS 2026-09-09).
    state.tasks[num] = { worktree: wt, workerId: id, role, phase: role === 'verify' ? VERIFYING : IMPLEMENTING, grace: APPEAR_GRACE };
    spawnedThisPass.push(id);
    record('spawn', { task: num, runs, role, workerId: id });
  }

  // 3c. Hand each review-ready task to a fresh reviewer on the same worktree, then close the
  // implementer's session (DESIGN §2.1, §2.3 — one task in review holds one slot). The reviewer
  // takes over the worktree, so closing the implementer is a session stop only.
  const reviewSwaps = new Map(); // implementer id → task num, so 3e closes the right session
  for (const workerId of decision.review) {
    const found = taskByWorkerId(state, workerId);
    if (!found) continue;
    const { num, t } = found;
    const reviewerId = platform.spawn({ cwd: t.worktree.path, name: workerName({ repo, plan: slug, task: num }), phase: 'review' });
    reviewSwaps.set(workerId, { num, reviewerId });
    spawnedThisPass.push(reviewerId);
    record('review', { task: num, workerId: reviewerId, closes: workerId });
  }

  // 3d. Merge one done task branch into the feature branch, reconcile its row to ✅ (DESIGN §2.5,
  // §2.9). A conflict the coordinator hits is surfaced and the branch is left dirty-free: no merge,
  // no row change, and the worker is parked awaiting the user rather than closed.
  const mergedTasks = new Set();
  for (const workerId of decision.merge) {
    const found = taskByWorkerId(state, workerId);
    if (!found) continue;
    const { num, t } = found;
    const res = worktree.mergeTask(t.worktree.branch);
    if (res.conflict) {
      t.phase = AWAITING;
      t.decision = { kind: 'conflict', text: `merge conflict in ${res.files?.join(', ') || 'the feature branch'}` };
      record('surface', { task: num, kind: 'conflict', text: t.decision.text });
      continue;
    }
    // The row folds back as ✅ (an auto task is reviewed, a you task is done — both ✅ at merge).
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
    mergedTasks.add(num);
    record('merge', { task: num, branch: t.worktree.branch });
  }

  // 3e. Close the remaining workers decideDispatch names (dead ones were handled in 3a):
  //   - a review-ready implementer being replaced: session stop, worktree kept, phase → reviewing;
  //   - a merged worker: session stop and worktree/branch removed, task done.
  for (const workerId of decision.close) {
    if (deadIds.has(workerId)) continue; // already cleaned up in 3a
    if (reviewSwaps.has(workerId)) {
      const { num, reviewerId } = reviewSwaps.get(workerId);
      platform.close(workerId);
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
    closedThisPass.add(workerId);
    if (found) {
      worktree.remove(found.t.worktree);
      record('close', { task: found.num, workerId, reason: mergedTasks.has(found.num) ? 'merged' : 'closed' });
      delete state.tasks[found.num];
    } else {
      record('close', { workerId });
    }
  }

  // 3f. Promote the feature branch to main — the one merge to main — only when the tests pass on it
  // (DESIGN §2.9). A red feature branch is surfaced, not promoted.
  let promoted = false;
  if (decision.promoteToMain) {
    const test = runTests(state.feature.path);
    if (!test.ok) {
      record('surface', { kind: 'red-feature', text: 'feature branch tests failed; not promoting' });
    } else {
      const res = worktree.promote(slug);
      if (res.conflict) {
        record('surface', { kind: 'promote-conflict', text: 'feature branch will not merge to main cleanly' });
      } else {
        promoted = true;
        record('promote', { branch: state.feature.branch });
      }
    }
  }

  const liveAfter =
    [...liveIds].filter((id) => !closedThisPass.has(id)).length + spawnedThisPass.length;
  return { actions, log, halted: false, promoted, liveAfter, tasks: parsed.tasks };
}

// drain — run passes until the plan promotes, the kill switch has closed everything, or the run goes
// quiet (all remaining workers parked on the user, or nothing left to do). Returns why it stopped,
// how many passes it took, and the flattened actions, plus the run state for inspection.
export function drain(opts) {
  const state = opts.state ?? createRunState();
  const maxPasses = opts.maxPasses ?? 200;
  const allActions = [];
  let idle = 0;

  for (let p = 1; p <= maxPasses; p++) {
    const r = runPass({ ...opts, state });
    allActions.push(...r.actions);

    if (r.promoted) return { reason: 'promoted', passes: p, promoted: true, actions: allActions, state };
    if (r.halted) return { reason: 'halted', passes: p, promoted: false, actions: allActions, state };

    const productive = r.actions.some((a) => ['spawn', 'review', 'merge', 'close', 'promote'].includes(a.type));
    idle = productive ? 0 : idle + 1;
    if (idle >= 2) {
      const reason = r.liveAfter > 0 ? 'parked' : 'stalled';
      return { reason, passes: p, promoted: false, actions: allActions, state };
    }
  }
  return { reason: 'maxPasses', passes: maxPasses, promoted: false, actions: allActions, state };
}
