// The dashboard model (DESIGN §2.3, §2.6, §2.7, §3.1, §3.2). Two pure things, kept apart on purpose:
// `buildDashboard` projects the resolved run views into the list (rows + counts the front-end paints),
// and `dashboardReducer` is the navigation state machine — list/watch, the Esc semantics, and the
// two-press stop/remove confirm. Neither reads a clock, a file or a process: the run states arrive
// already resolved by classifyRun (T01, src/core/runstate.mjs), so every rule a person could check —
// which run opens, when the confirm is armed, that a running run cannot be removed — is tested in
// milliseconds, not judged by eye (DESIGN §2.3's reason for the model/reducer split; it mirrors the
// display.mjs / render.mjs split the coordinator already uses).
//
// The two-press chords were taken from `claude agents` (DESIGN §2.6, §2.7): Ctrl+S twice stops a running run,
// Ctrl+X twice removes a non-running one. The first matching press arms a confirmation; the second
// identical press (same action, same run) carries it out; any other event cancels the arm. Both are
// irreversible in the moment — stop kills in-flight work, remove drops the record — so the guard is
// deliberate, not friction.

import { FINISHER_ID, askingCount, finisherEntry, finisherRow, rowEntries } from './display.mjs';

// A run can be stopped only while running, and removed only while NOT running (DESIGN §2.6, §2.7): a
// running run must be stopped before its record can be cleared. These two predicates are the whole of
// "which chord is live on which run", and they are what the tests pin.
// Resume (plans/pir-plan-command §2.14) is the third chord, Ctrl+R twice, and its eligibility needs the
// whole view (a plan row's outcome), not the state alone, so every predicate takes the view.
const CHORD = {
  ctrlS: { action: 'stop', eligible: (view) => view.state === 'running' },
  ctrlX: { action: 'remove', eligible: (view) => view.state !== 'running' },
  ctrlR: { action: 'resume', eligible: (view) => canResume(view) },
};

// --- Planning runs beside builds (plans/pir-plan-command §2.10, §2.14) ----------------------------------

// isPlan(view) → whether a view is a planning run. The index record's `kind` decides (absent reads `work`,
// T02); a view with no record but a plan snapshot counts too, so a caller holding only the snapshot agrees.
// Exported so the list frame paints TYPE and PROGRESS by the same rule STATE uses.
export function isPlan(view) {
  const kind = view?.record?.kind;
  if (kind) return kind === 'plan';
  return view?.snap?.runState?.kind === 'plan';
}

// isSingle(view) → whether a view is a single run (single-runs DESIGN §2.8), decided as isPlan decides:
// the index record's `kind`, else the snapshot's.
export function isSingle(view) {
  const kind = view?.record?.kind;
  if (kind) return kind === 'single';
  return view?.snap?.runState?.kind === 'single';
}

// A single run's snapshot state, or null before its program wrote one.
function singleState(view) {
  const rs = view?.snap?.runState;
  return rs && rs.kind === 'single' ? rs : null;
}

// singleStepState(runState) → `building` or `reviewing`, by the snapshot's step alone: the rename between
// the two already has the builder closed, so it reads `reviewing`, as a planning run's does.
export function singleStepState(rs) {
  return rs && (rs.step === 'rename' || rs.step === 'review') ? 'reviewing' : 'building';
}

// The planning run's snapshot state, or null before its program wrote one.
function planState(view) {
  const rs = view?.snap?.runState;
  return rs && rs.kind === 'plan' ? rs : null;
}

// planStepState(runState) → `planning` or `reviewing`, by the snapshot's step alone. The steps view's
// header names the step with it even while that step is asking, since its rows and footer carry the ask.
export function planStepState(rs) {
  return rs && (rs.step === 'rename' || rs.step === 'review' || rs.step === 'done') ? 'reviewing' : 'planning';
}

// runDisplayState(view) → the STATE a row shows (§2.10).
//   view = { state (classifyRun's), record ({ kind, go }), snap ({ runState: { kind:'plan', step, outcome } }) }
// A build shows its classification unchanged, except that a running build with any task waiting on the
// person reads `asking-you` (askingCount, the live view's own rule), so a question is visible from the
// list without opening the run (user 2026-09-27), and one waiting in `ready to merge` at its end reads
// `ready-to-merge` (pir-coordinator §2.10). A planning run shows `planning` or `reviewing` while it runs
// (by the snapshot's step: the rename between the two already has the planner done, so it reads
// `reviewing`), `asking-you` instead while either step's live session has a permission request or a
// question set pending (planRunState's step phase `asking`, user 2026-09-27), `your-go` once finished `reviewed` with no go recorded (§2.8), `finished` for any other
// finished outcome or a declined go, and `stopped`/`crashed` as classified. Any other classification (an
// unreachable entry) passes through as it came.
//
// A single run (single-runs DESIGN §2.8, §2.9) shows `building` or `reviewing` while it runs, `testing`
// instead while pir's tests or the baseline run, and `asking-you` over all three while a step's live
// session asks. The snapshot already keeps the two apart: during a test run only a pending request reads
// asking, never the stopped-session rule, so a step phase of `asking` is trusted as it comes. Finished
// `ready` it reads `ready-to-merge` until `view.merged` (the shell's merged check) says the person's
// merge landed, then `merged`; any other finished outcome (`dropped`) reads `finished`.
// The end sequence (single-finisher DESIGN §2.11): the sync step reads `syncing`; the wait reads
// `ready-for-your-go` while the finisher waits for the go and nothing else asks, `asking-you` while it is
// stuck or holds a request, `finishing` in its other phases, `ready-to-merge` on the fallback wait and
// `not-ready` on a red one. Finished, the outcome decides: `finished`, `merged` or `closed`.
export function runDisplayState(view) {
  const state = view?.state;
  if (isSingle(view)) {
    const rs = singleState(view);
    if (state === 'running') {
      if ((rs?.steps ?? []).some((st) => st.phase === 'asking')) return 'asking-you';
      // The end sequence (single-finisher DESIGN §2.11): a re-sync under the finisher reads syncing too.
      if (rs?.step === 'sync') return 'syncing';
      if (rs?.step === 'wait') {
        const merge = (rs.steps ?? []).find((st) => st.id === 'merge');
        if (merge?.phase === 'finisher') {
          const t = finisherEntry(merge.finisher ?? rs.finisher ?? {});
          if (t.state === 'awaiting-go') return 'ready-for-your-go';
          return finisherRow(t).kind === 'finisher-asking' ? 'asking-you' : 'finishing';
        }
        if (merge?.phase === 'ready') return 'ready-to-merge';
        if (rs.end?.tests === 'red') return 'not-ready';
        return 'finishing';
      }
      return rs?.phase === 'testing' ? 'testing' : singleStepState(rs);
    }
    if (state === 'finished') {
      const outcome = rs?.outcome ?? null;
      if (outcome === 'ready') return view.merged ? 'merged' : 'ready-to-merge';
      if (outcome === 'merged') return 'merged';
      if (outcome === 'closed') return 'closed';
    }
    return state;
  }
  if (!isPlan(view)) {
    if (state !== 'running') return state;
    const rs = view?.snap?.runState;
    // The finisher's end (finisher DESIGN §2.11): waiting for the person's go reads `ready-for-your-go`,
    // replacing `ready-to-merge` for these runs; stuck or holding a request is `asking-you` by the count
    // below; any other phase is the run still working, though its hand-off already reads ready.
    const f = rs?.finisher;
    if (f && (f.state ?? f.phase) === 'awaiting-go' && askingCount({ tasks: rs.tasks, helpers: rs.helpers }) === 0) return 'ready-for-your-go';
    if (askingCount(rs) > 0) return 'asking-you';
    if (f) return state;
    // The end of a run with the coordinator agent (pir-coordinator §2.10): the branch is prepared, the
    // report committed, and the run waits for the person to merge or close it.
    if (rs?.handoff?.state === 'ready') return 'ready-to-merge';
    return state;
  }
  const rs = planState(view);
  if (state === 'running' && (rs?.steps ?? []).some((st) => st.phase === 'asking')) return 'asking-you';
  if (state === 'running') return planStepState(rs);
  if (state === 'finished') return rs?.outcome === 'reviewed' && (view.record?.go ?? null) === null ? 'your-go' : 'finished';
  return state;
}

// planProgress(runState) → a planning run's PROGRESS cell (§2.10): the steps it has been through. The
// outcome decides a finished run; otherwise the step does. No snapshot yet reads as the planner at work.
export function planProgress(runState) {
  const outcome = runState?.outcome ?? null;
  if (outcome === 'no-plan') return 'plan ✗';
  if (outcome === 'not-reviewed') return 'plan ✓ review ✗';
  if (outcome === 'reviewed') return 'plan ✓ review ✓';
  const step = runState?.step ?? 'plan';
  return step === 'plan' ? 'plan …' : 'plan ✓ review …';
}

// canResume(view) → whether Ctrl+R Ctrl+R is offered on a row (§2.14): a stopped or crashed run of any
// type, and a finished planning run whose review ended not-reviewed (the person stopped to think). A
// finished single run, `ready` or `dropped`, is final (single-runs DESIGN §2.11); resumeRun does not
// refuse one itself, so this is the guard.
export function canResume(view) {
  if (!view) return false;
  if (view.state === 'stopped' || view.state === 'crashed') return true;
  return view.state === 'finished' && isPlan(view) && planState(view)?.outcome === 'not-reviewed';
}

// displayName(view) → how a row names its run: a planning or single run's label in quotes while it has no
// name of its own (the index clears `label` at the rename, §2.6), else the slug. The armed resume line uses it too, so a
// person confirming a resume sees the name the row shows.
export function displayName(view) {
  const label = isPlan(view) || isSingle(view) ? view?.record?.label : null;
  return label ? `"${label}"` : view?.slug ?? '';
}

// buildDashboard(views) → { rows, counts } (DESIGN §2.3).
//
//   views: [{ slug, state, repo, progress:{done,total}, workers }]
//     state — one of classifyRun's four: 'running' | 'finished' | 'stopped' | 'crashed' (T01). A view
//             may carry some other state (e.g. an unreachable stale entry, §2.8); it still counts in
//             `total` but not in any of the four named tallies.
//   rows   — the same views, in input order. The front-end paints them; order is the caller's, not ours.
//   counts — { running, finished, crashed, stopped, total }. `total` is every view; the four named are
//            tallies of the matching state, so the counts line can colour running green and crashed red.
//
// Each row gains `display` (runDisplayState) and the tallies count by it: `planning`/`reviewing` are
// running, and a `your-go` row is counted in `waiting` rather than `finished`, as the prototype's counts
// line reads (pir-plan-command §2.10). A build's `asking-you` row counts in `waiting` too, not `running`:
// the one tally says how many runs need the person, whichever kind. A single run's `building` and `testing`
// are running, its `ready-to-merge` waits on the person, and `merged` is finished (single-runs §2.8).
export function buildDashboard(views = []) {
  const counts = { running: 0, finished: 0, crashed: 0, stopped: 0, waiting: 0, total: views.length };
  const rows = views.map((v) => ({ ...v, display: runDisplayState(v) }));
  for (const v of rows) {
    const tally = TALLY[v.display];
    // Only the named states have a tally; an unknown state contributes to `total` alone.
    if (tally) counts[tally] += 1;
  }
  // Rows preserve input order.
  return { rows, counts };
}

// Which tally each display state counts in.
const TALLY = {
  running: 'running',
  planning: 'running',
  reviewing: 'running',
  building: 'running',
  testing: 'running',
  finished: 'finished',
  merged: 'finished',
  crashed: 'crashed',
  stopped: 'stopped',
  'your-go': 'waiting',
  'asking-you': 'waiting',
  'ready-to-merge': 'waiting',
  'ready-for-your-go': 'waiting',
  // A single run's end (single-finisher DESIGN §2.11): its program runs through the sync and the wait; a
  // red wait is not counted as waiting, as the amber states are.
  syncing: 'running',
  finishing: 'running',
  'not-ready': 'running',
  closed: 'finished',
};

// runKey(view) → the identity of one run. A slug alone is not unique: the same plan slug can run in two
// repos (the index keeps them apart as `{repo}__{slug}`, §2.8), and keying on the slug made the second of
// two same-slug rows unreachable by arrow key and let stop/remove resolve to the other repo's run. A view
// carries `key` when the loader built it from an index record; a view without one falls back to its slug.
export function runKey(view) {
  return view?.key ?? view?.slug ?? null;
}

// The navigation state the reducer owns. `view` is which block is on screen; `sel` is the highlighted
// row index in the list; `openSlug` is the run the watch view is showing and `openKey` its identity
// (null when it was opened by slug alone, `pir start {slug}`); `taskSel` is the highlighted task row in the
// watch view (live-workers §2.11); `openWorker` is the worker the 'worker' view shows; `note` is a
// one-shot footer line (why a task row did not open); `armed` is the pending confirm, null unless a
// chord's first press has landed.
export function initialUi() {
  return { view: 'list', sel: 0, openSlug: null, openKey: null, openRun: null, taskSel: 0, openWorker: null, note: null, armed: null };
}

// The steps a planning run's live view lists (pir-plan-command §2.11), in row order. A run with no
// snapshot yet still has the three, so the arrows and the footer note work from the first frame.
const STEP_IDS = ['plan', 'review', 'build'];
function planSteps(view) {
  const steps = planState(view)?.steps ?? [];
  return STEP_IDS.map((id) => steps.find((s) => s.id === id) ?? { id, phase: 'pending', worker: null });
}

// The steps a single run's view lists (single-runs DESIGN §2.8), in row order; `sync` carries its current or
// last helper's session and `merge` the finisher's while it is on (single-finisher DESIGN §2.11).
const SINGLE_STEP_IDS = ['build', 'review', 'sync', 'merge'];
function singleSteps(view) {
  const steps = singleState(view)?.steps ?? [];
  return SINGLE_STEP_IDS.map((id) => steps.find((s) => s.id === id) ?? { id, phase: 'pending', worker: null });
}

// openTasks(views, ui) → the open run's rows, in the live view's row order: a build's tasks, then the
// separator and its coordinator agent's row once the agent has started (T12), then its end-of-run helpers
// while they run (rowEntries, which buildDisplay draws one row each, in order; pir-coordinator T11), or []
// when it has no snapshot yet; a planning or single run's steps. The separator is never selected (moveRow).
export function openTasks(views, ui) {
  const open = findOpen(views, ui);
  if (open && isPlan(open)) return planSteps(open);
  if (open && isSingle(open)) return singleSteps(open);
  return rowEntries(open?.snap?.runState);
}

// moveRow(rows, from, step) → the row index one ↑ or ↓ from `from`, clamped to the ends, stepping over the
// separator above the coordinator agent's row (pir-coordinator T12), which is drawn but never selected.
export function moveRow(rows, from, step) {
  let i = clamp(from + step, rows.length);
  if (rows[i]?.separator) i = clamp(i + step, rows.length);
  return rows[i]?.separator ? from : i;
}

// Why a step row did not open (§2.11: a step with no session yet says so in the footer).
export function noSessionNote(step) {
  if (step?.id === 'build') return 'build has no conversation here — the build shows its own tasks once it starts.';
  if (step?.id === 'review') return 'review has no session yet — the reviewer starts when the plan is written.';
  return 'plan has no session yet — the planner is starting.';
}

// The same for a single run's step rows (single-runs DESIGN §2.8). A dropped run is final: its reviewer
// will never start and nothing is handed over to merge, so neither row may promise what is not coming.
// Once the person's merge has landed (`merged`, the shell's check) the merge row no longer asks for it.
export function singleNoSessionNote(step, { dropped = false, merged = false, base = null } = {}) {
  if (step?.id === 'sync') return `sync has no session — pir brought ${base ?? 'the base'} in itself.`;
  if (step?.id === 'merge') {
    if (dropped) return 'merge has no conversation — the run was dropped, so there is nothing to merge.';
    if (merged) return 'merge has no conversation — the branch is already merged.';
    return 'merge has no conversation — the merge is yours to run by hand.';
  }
  if (step?.id === 'review' && dropped) return 'review has no session — the run was dropped before the reviewer started.';
  if (step?.id === 'review') return 'review has no session yet — the reviewer starts when the change is built and its tests pass.';
  return 'build has no session yet — the builder is starting.';
}

// The coordinator agent of the open build (pir-coordinator §2.8): the run state's `coordinator`, or null
// with `--no-coordinator`, before it started, or for a planning or single run.
export function openCoordinator(views, ui) {
  const open = findOpen(views, ui);
  if (!open || isPlan(open) || isSingle(open)) return null;
  const c = open.snap?.runState?.coordinator;
  return c?.id ? c : null;
}

// openAgent(views, ui) → the session `c` opens (finisher DESIGN §2.11): the finisher's while it is the
// run's, else the coordinator agent's, as { taskId, workerId, logPath, live } for openWorker; else null.
// A single run's finisher also names `stepId: 'merge'`, the step row it is opened from and lands back on.
export function openAgent(views, ui) {
  const open = findOpen(views, ui);
  if (!open || isPlan(open)) return null;
  // A single run's finisher, while it is on (single-finisher DESIGN §2.11); a single run has no agent.
  if (isSingle(open)) {
    const w = finisherEntry(singleState(open)?.finisher ?? {}).worker;
    return singleState(open)?.finisher && w?.id ? { taskId: FINISHER_ID, stepId: 'merge', workerId: w.id, logPath: w.logPath, live: w.live } : null;
  }
  const pinned = rowEntries(open.snap?.runState).find((e) => e.finisher);
  if (pinned?.worker?.id) return { taskId: pinned.id, workerId: pinned.worker.id, logPath: pinned.worker.logPath, live: pinned.worker.live };
  const c = openCoordinator(views, ui);
  return c ? { taskId: 'coordinator', workerId: c.id, logPath: c.logPath ?? null, live: !!c.live } : null;
}

// Why `c` opened nothing: the open run has no coordinator agent to show.
export function noCoordinatorNote(views, ui) {
  const open = findOpen(views, ui);
  if (open && isPlan(open)) return 'a planning run has no coordinator agent.';
  if (open && isSingle(open)) return 'a single run has no coordinator agent.';
  return 'this run has no coordinator agent — it was started with --no-coordinator, or the agent has not started yet.';
}

// goOpen(views, ui) → whether the open run is waiting for the person's go (§2.8): the watch view of a
// planning run whose display state reads `your-go`.
export function goOpen(views, ui) {
  if (ui.view !== 'watch') return false;
  const open = findOpen(views, ui);
  return !!open && runDisplayState(open) === 'your-go';
}

// Why a task row with no worker to open did not open (live-workers §2.11: "a task with no worker yet
// says so in the footer"). Worded after the approved prototype's "T15 has no worker yet — it starts
// when T12 is merged."
export function noWorkerNote(task, tasks = []) {
  const id = task?.id ?? 'This task';
  if (task?.done) return `${id} has no worker to open — it was merged before this run started.`;
  if (task?.phase === 'preparing') return `${id} has no worker yet — its worktree is being set up.`;
  // Any other phase is a task in progress whose worker this process does not hold — after a restart the
  // task state is restored but platform.workers() starts empty — so "waiting for a slot" would be false.
  if (task?.phase) return `${id} has no worker to open — none is running for it right now.`;
  const done = new Set(tasks.filter((t) => t.done).map((t) => t.id));
  const unmet = (task?.deps ?? []).filter((d) => !done.has(d));
  if (unmet.length > 0) return `${id} has no worker yet — it starts when ${unmet.join(', ')} ${unmet.length === 1 ? 'is' : 'are'} merged.`;
  return `${id} has no worker yet — it starts when a slot frees up.`;
}

// dashboardReducer(ui, event, views) → { ui, intent } (DESIGN §2.3, §2.6, §2.7).
//
//   ui    = { view:'list'|'watch'|'worker', sel, openSlug, openKey, taskSel, openWorker, note, armed }
//           armed: null | { action:'stop'|'remove'|'resume', slug, key }
//           openWorker: null | { taskId, workerId, logPath, live }
//   event = { type, ... }:
//     {type:'down'} {type:'up'}     move selection, clamped to the list ends; in watch, the task row
//     {type:'select', index}        set selection (a click)
//     {type:'open'}                 list → watch on the selected run; watch → worker on the selected
//                                   task's worker (the snapshot's `worker`, T09), else a footer `note`
//     {type:'back'}                 worker → watch (taskSel kept); watch → list; list → intent quit
//     {type:'ctrlS'}                arm/confirm stop on the selected (list) or open (watch) run
//     {type:'ctrlX'}                arm/confirm remove on the selected run
//     {type:'ctrlR'}                arm/confirm resume on the selected run (pir-plan-command §2.14);
//                                   {type:'key', key:'ctrl+r'} is the same event
//   In 'worker' only `back` acts: the conversation view's keys are T13's, so the rest are inert here.
//   views — the current resolved views (the output of buildDashboard's `rows`, or anything carrying
//           {slug, state} per row). Passed rather than held so the reducer stays a pure function of its
//           inputs and never caches run data (DESIGN §2.3): it needs the length to clamp `sel` and the
//           selected/open row to read the target run's slug and state. This third argument is the one
//           addition to the interface sketch, which the task's own rule ("it takes the current views")
//           calls for.
//     {type:'key', key:'enter'|'n'} while the open planning run waits for the go (goOpen): intent start
//                                   or decline (pir-plan-command §2.8); otherwise Enter is `open` and `n` inert
//     {type:'key', key:'c'}         in a build's live view: open its coordinator agent's conversation as the
//                                   'worker' view (openWorker.taskId 'coordinator'), or the finisher's once
//                                   it is the run's (taskId 'finisher', finisher T07), else a footer `note`
//   intent = null | {type:'quit'} | {type:'stop', slug, key} | {type:'remove', slug, key} | {type:'resume', slug, key}
//            | {type:'start', slug, key} | {type:'decline', slug, key}
//           key is runKey of the target run; the caller resolves the run by it, never by slug alone.
//
// The one invariant across every branch: any event other than the second half of a chord clears `armed`
// first (DESIGN §2.6). So a stray keystroke — even a move onto another row — cancels a pending confirm,
// which is why an intervening `down` between two Ctrl+S presses re-arms from scratch rather than firing.
export function dashboardReducer(ui, event, views = []) {
  const len = views.length;
  if (event?.type === 'key' && event.key === 'ctrl+r') event = { type: 'ctrlR' };
  // The go keys (pir-plan-command §2.8, §2.11): while the open planning run waits for the go, Enter starts
  // the build and `n` declines it; otherwise Enter opens as → does and `n` is unbound. Esc is not here:
  // it quits `pir`, which leaves the question in place because nothing is written.
  if (event?.type === 'key' && (event.key === 'enter' || event.key === 'n')) {
    if (ui.view === 'watch' && goOpen(views, ui)) {
      const open = findOpen(views, ui);
      const type = event.key === 'enter' ? 'start' : 'decline';
      return { ui: { ...ui, note: null, armed: null }, intent: { type, slug: open.slug, key: runKey(open) } };
    }
    event = event.key === 'enter' ? { type: 'open' } : { type: 'unbound' };
  }
  // `c` in a build's live view opens its coordinator agent's conversation (pir-coordinator §2.8), the way →
  // opens a task's worker; ← comes back to the live view. With no agent it says so and opens nothing.
  if (event?.type === 'key' && event.key === 'c') {
    if (ui.view !== 'watch') return { ui: { ...ui, note: null, armed: null }, intent: null };
    const openWorker = openAgent(views, ui);
    if (!openWorker) return { ui: { ...ui, note: noCoordinatorNote(views, ui), armed: null }, intent: null };
    return { ui: { ...ui, view: 'worker', openWorker, note: null, armed: null }, intent: null };
  }
  // `note` is one-shot like `armed`: whatever the next event is, it clears.
  ui = { ...ui, note: null };
  if (ui.view === 'worker') {
    if (event?.type === 'back') return { ui: { ...ui, view: 'watch', openWorker: null, armed: null }, intent: null };
    return { ui: { ...ui, armed: null }, intent: null };
  }
  switch (event?.type) {
    case 'down':
    case 'up': {
      const step = event.type === 'down' ? 1 : -1;
      // In the live view the arrows move the task row, and the list's `sel` stays where it was.
      if (ui.view === 'watch') {
        return { ui: { ...ui, taskSel: moveRow(openTasks(views, ui), ui.taskSel ?? 0, step), armed: null }, intent: null };
      }
      return { ui: { ...ui, sel: clamp(ui.sel + step, len), armed: null }, intent: null };
    }
    case 'select': {
      // In the live view a click selects a task row (mouse-navigation §2.1): `taskSel` moves and the list's
      // `sel` stays. The separator is never selected by a key (moveRow), so a select on it changes nothing.
      if (ui.view === 'watch') {
        const tasks = openTasks(views, ui);
        const i = clamp(event.index, tasks.length);
        return { ui: { ...ui, taskSel: tasks[i]?.separator ? ui.taskSel : i, armed: null }, intent: null };
      }
      return { ui: { ...ui, sel: clamp(event.index, len), armed: null }, intent: null };
    }
    case 'open': {
      if (ui.view === 'watch') {
        const tasks = openTasks(views, ui);
        const task = tasks[ui.taskSel ?? 0];
        if (!task) return { ui: { ...ui, armed: null }, intent: null };
        const w = task.worker;
        const open = findOpen(views, ui);
        if ((task.agent || task.finisher) && !w?.id) return { ui: { ...ui, note: noCoordinatorNote(views, ui), armed: null }, intent: null };
        if (!w?.id) {
          const note = isSingle(open)
            ? singleNoSessionNote(task, { dropped: singleState(open)?.outcome === 'dropped', merged: runDisplayState(open) === 'merged' || singleState(open)?.outcome === 'finished', base: singleState(open)?.base ?? open.record?.baseBranch ?? null })
            : isPlan(open)
              ? noSessionNote(task)
              : noWorkerNote(task, tasks);
          return { ui: { ...ui, note, armed: null }, intent: null };
        }
        // A single run's merge row opens the finisher: the conversation header reads `agent` only for the
        // finisher's own id (single-finisher DESIGN §2.11), and `stepId` keeps the row it came from.
        const finisherStep = isSingle(open) && task.id === 'merge';
        const openWorker = finisherStep
          ? { taskId: FINISHER_ID, stepId: 'merge', workerId: w.id, logPath: w.logPath ?? null, live: !!w.live }
          : { taskId: task.id, workerId: w.id, logPath: w.logPath ?? null, live: !!w.live };
        return { ui: { ...ui, view: 'worker', openWorker, armed: null }, intent: null };
      }
      if (ui.view !== 'list') return { ui: { ...ui, armed: null }, intent: null };
      // An empty list has no run to open: without this, → or Enter opened a live view on nothing, which
      // the screen then drew as a placeholder crashed run.
      if (!views[ui.sel]) return { ui: { ...ui, armed: null }, intent: null };
      return {
        // A run waiting for the go opens on its build step, the row the question is about (prototype scene 5).
        ui: { ...ui, view: 'watch', openSlug: views[ui.sel]?.slug ?? null, openKey: runKey(views[ui.sel]), openRun: runIdentity(views[ui.sel]), taskSel: runDisplayState(views[ui.sel]) === 'your-go' ? 2 : 0, armed: null },
        intent: null,
      };
    }
    case 'back':
      // Esc steps back one level: watch → list (no confirm), and list → quit `pir` outright (DESIGN §2.3:
      // quitting stops nothing, so there is no confirm here — the confirms are on stop/remove only).
      if (ui.view === 'watch') return { ui: { ...ui, view: 'list', openSlug: null, openKey: null, openRun: null, armed: null }, intent: null };
      return { ui: { ...ui, armed: null }, intent: { type: 'quit' } };
    case 'ctrlS':
    case 'ctrlX':
    case 'ctrlR':
      return chord(event.type, ui, views);
    default:
      // An unrecognised event is inert but still cancels a pending confirm (the invariant above): a key
      // the dashboard does not bind must not leave a stale armed line waiting to be completed by chance.
      return { ui: { ...ui, armed: null }, intent: null };
  }
}

// Clamp an index into a list's valid row range; an empty list pins to 0 so `sel` is always a real slot.
// A non-finite index (a malformed `select` with no `index`, or an already-corrupt `sel`) also pins to 0
// rather than propagating NaN — Math.min/Math.max let NaN through and it would then stick across every
// later move, silently breaking selection. Coercing here keeps the "always a real slot" invariant true.
function clamp(i, len) {
  if (len <= 0 || !Number.isFinite(i)) return 0;
  return Math.max(0, Math.min(i, len - 1));
}

// A Ctrl+S / Ctrl+X / Ctrl+R press. Resolve the run it acts on, check the chord is live on that run's state, then
// either arm (first press), fire the intent (second identical press) or cancel (ineligible run).
function chord(type, ui, views) {
  const { action, eligible } = CHORD[type];
  // Resume is offered on the list's selected row only (§2.14). In the live view `sel` can point at a row
  // other than the open run (a view opened by `pir start {slug}` starts at row 0), so it is inert there.
  if (action === 'resume' && ui.view !== 'list') return { ui: { ...ui, armed: null }, intent: null };
  // Stop targets the OPEN run while watching (DESIGN §2.6 — you can stop a run from inside its live view),
  // otherwise the selected row. Remove and resume are list actions and always target the selected row.
  const target =
    action === 'stop' && ui.view === 'watch'
      ? findOpen(views, ui)
      : views[ui.sel];

  // Ineligible — no such run, or the chord does not apply to its state (Ctrl+S on a non-running run,
  // Ctrl+X on a running one): no arm, no intent, and any pending confirm is cleared (DESIGN §2.6, §2.7).
  if (!target || !eligible(target)) {
    return { ui: { ...ui, armed: null }, intent: null };
  }

  // Second identical press (same action, same run) carries the confirm out and disarms.
  const key = runKey(target);
  if (ui.armed && ui.armed.action === action && ui.armed.key === key) {
    return { ui: { ...ui, armed: null }, intent: { type: action, slug: target.slug, key } };
  }

  // First matching press arms the confirmation line for that exact run.
  return { ui: { ...ui, armed: { action, slug: target.slug, key } }, intent: null };
}

// findOpen(views, ui) → the run the watch view is showing: by its key when it was opened from the list,
// by slug when it was opened by `pir start {slug}` (which names no repo), else by the process it was
// opened on (`openRun`), else undefined. The last is the rename (pir-plan-command §2.6): a planning run's
// index entry moves from `{repo}__plan-{hex4}` to `{repo}__{slug}` under an open view, and the program
// that wrote both is the same one, so its repo, pid and start time still name it.
export function findOpen(views, ui) {
  const byName = ui.openKey != null ? views.find((v) => runKey(v) === ui.openKey) : views.find((v) => v.slug === ui.openSlug);
  if (byName || !ui.openRun) return byName;
  return views.find((v) => sameRun(runIdentity(v), ui.openRun));
}

// runIdentity(view) → { repo, pid, startTime } of the program behind a run, or null without a record.
export function runIdentity(view) {
  const r = view?.record;
  if (!r || r.pid == null || r.startTime == null) return null;
  return { repo: r.repo ?? view.repo ?? null, pid: r.pid, startTime: r.startTime };
}

function sameRun(a, b) {
  return !!a && !!b && a.repo === b.repo && a.pid === b.pid && a.startTime === b.startTime;
}

// repinOpen(ui, views) → ui whose openKey/openSlug/openRun follow the open run: found by name, its identity
// is refreshed (a go replaces the record with the build's under the same key); found only by identity,
// its new key and slug are taken, so the view stays on the run through a rename. The shell calls it on
// every read, before the reducer and before painting.
export function repinOpen(ui, views) {
  if (ui.view === 'list') return ui;
  const open = findOpen(views, ui);
  if (!open) return ui;
  return { ...ui, openKey: runKey(open), openSlug: open.slug ?? ui.openSlug, openRun: runIdentity(open) ?? ui.openRun ?? null };
}
