// decideDispatch — the one place the whole parallel behaviour comes together (DESIGN §3.3).
// A pure function of its arguments: the parsed task table, the live worker assignments, the
// worker ceiling and the kill-switch flag. It reads no clock and no filesystem, which is what
// lets the entire dispatch logic be proven before any agent exists (DESIGN §3.1, §4). The
// loop in src/shell/ gathers the state (parse PROGRESS.md, `claude agents --json`, the control
// flag) and executes the actions this returns.
//
// It answers, for this one pass: which ready tasks to spawn a worker for (each tagged auto or
// you so the loop spawns a builder or a hands-on scribe, §2.6), which implemented task needs a
// fresh review session (§2.1), which finished branch to merge into the feature branch (§2.9,
// serialized one at a time), which workers to close (§2.3), and whether the whole plan is done
// and the feature branch should be promoted to main (§2.9 — the one merge to main).

// The done state glyph and the phases we key on. Kept as named constants so the intent reads
// at the call site rather than a bare emoji or string literal.
const DONE = '✅';
const READY = '⬜';
const PHASE_REVIEW_READY = 'review-ready';
const PHASE_DONE = 'done';
const PHASE_DEAD = 'dead';

// The numeric order of a task id ("T05" → 5), for "lowest task number first" everywhere.
function order(id) {
  return Number(String(id).slice(1));
}

// A worker occupies a slot under the ceiling unless it is dead. live===false or phase "dead"
// both mean gone; everything else (implementing, review-ready, reviewing, awaiting-answer,
// done) is a running session holding one slot. A review-ready or done worker still counts,
// because the slot only frees on the NEXT pass once close has actually run and the agent list
// no longer shows it — crediting the freed slot early could push real agents over the ceiling.
function isLive(a) {
  return a.live !== false && a.phase !== PHASE_DEAD;
}

function isDead(a) {
  return a.live === false || a.phase === PHASE_DEAD;
}

// Sort a list of assignments by their task number and return just the workerIds.
function idsByTask(assignments) {
  return [...assignments].sort((x, y) => order(x.task) - order(y.task)).map((a) => a.workerId);
}

export function decideDispatch({ tasks, assignments, maxWorkers, halted }) {
  // Kill switch: dispatch nothing, deliver nothing, merge nothing, promote nothing, and close
  // every worker there is (§2.4). Dead ones are closed too — that is cleanup, not a slot game.
  if (halted) {
    return { spawn: [], review: [], merge: [], close: idsByTask(assignments), promoteToMain: false };
  }

  const live = assignments.filter(isLive);
  const dead = assignments.filter(isDead);

  // A task is already taken if a live (non-dead) worker holds it, so it is never re-spawned.
  const takenByLive = new Set(live.map((a) => a.task));

  // review: every worker that reported implemented and now needs a FRESH review session
  // (§2.1). Keyed on the phase, so a done worker — auto or you — never lands here; a you
  // worker has no code to review and goes straight to merge/close (§2.6).
  const reviewReady = live.filter((a) => a.phase === PHASE_REVIEW_READY);
  const review = idsByTask(reviewReady);

  // merge: at most one done worker's branch per pass, serialized into the feature branch
  // (§2.5, §2.9). Lowest task number first when several are done. A done worker whose session
  // has died is not merged (its work cannot be trusted) — it falls to close as dead instead.
  const doneLive = live.filter((a) => a.phase === PHASE_DONE);
  doneLive.sort((x, y) => order(x.task) - order(y.task));
  const merged = doneLive[0];
  const merge = merged ? [merged.workerId] : [];

  // close, three sources (§3.3): every dead worker (frees its leaked slot); the implement
  // session of each review-ready task, closed as its fresh reviewer spawns so a task in review
  // holds one slot not two (§2.1); and the single worker whose branch we merge this pass (§2.1
  // step 6 merges then closes). Deduped and ordered by task number.
  const closeSet = new Map();
  for (const a of dead) closeSet.set(a.workerId, a);
  for (const a of reviewReady) closeSet.set(a.workerId, a);
  if (merged) closeSet.set(merged.workerId, merged);
  const close = idsByTask([...closeSet.values()]);

  // spawn: the ready tasks (⬜, all deps ✅, not already held by a live worker), lowest number
  // first, capped so the live count plus what we spawn never exceeds the ceiling (§2.4). Each
  // entry carries its auto/you marker so the loop spawns a builder or a hands-on scribe (§2.6);
  // both kinds count against the ceiling and compete for slots by task number.
  const doneNums = new Set(tasks.filter((t) => t.state === DONE).map((t) => t.num));
  const ready = tasks
    .filter((t) => t.state === READY)
    .filter((t) => !takenByLive.has(t.num))
    .filter((t) => t.deps.every((d) => doneNums.has(d)))
    .sort((x, y) => order(x.num) - order(y.num));

  const slots = Math.max(0, maxWorkers - live.length);
  const spawn = ready.slice(0, slots).map((t) => ({ num: t.num, runs: t.runs }));

  // promoteToMain: the single signal the plan is complete — every task ✅ and no live worker
  // (§2.9). A plan with no tasks never promotes. Dead workers pending close do not block it,
  // matching "all ✅ and none live"; the loop closes them and promotes on the same clean state.
  const promoteToMain =
    tasks.length > 0 && tasks.every((t) => t.state === DONE) && live.length === 0;

  return { spawn, review, merge, close, promoteToMain };
}
