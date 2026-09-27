// The dashboard model, exercised exhaustively without a terminal (DESIGN §2.3, §2.6, §2.7, §4). The
// in-place painting and the real key handling are the front-end's (T12) and are hand-verified; every
// rule a person could otherwise only check by eye — which run opens, when a confirm is armed, that a
// running run cannot be removed and a stopped one cannot be stopped — is pinned here, in milliseconds.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDashboard, canResume, runKey, dashboardReducer, displayName, initialUi, noWorkerNote, planProgress, runDisplayState } from './dashboard.mjs';

// One resolved run view in the shape the shell hands the model (state already from classifyRun, T01).
const view = (over) => ({
  slug: 'a-run',
  state: 'running',
  repo: 'demo',
  progress: { done: 0, total: 1 },
  workers: 0,
  ...over,
});

// A small fixed list used across the reducer tests: one run of each state, so a chord's eligibility can
// be checked against every state without rebuilding the list each time.
const RUNS = [
  view({ slug: 'run-running', state: 'running' }),
  view({ slug: 'run-finished', state: 'finished' }),
  view({ slug: 'run-crashed', state: 'crashed' }),
  view({ slug: 'run-stopped', state: 'stopped' }),
];

// --- buildDashboard: counts and order --------------------------------------------------------------

test('buildDashboard counts each state and preserves row order', () => {
  const views = [
    view({ slug: 'a', state: 'running' }),
    view({ slug: 'b', state: 'crashed' }),
    view({ slug: 'c', state: 'running' }),
    view({ slug: 'd', state: 'finished' }),
    view({ slug: 'e', state: 'stopped' }),
  ];
  const { rows, counts } = buildDashboard(views);

  assert.deepEqual(rows.map((r) => r.slug), ['a', 'b', 'c', 'd', 'e']); // input order preserved
  assert.deepEqual(counts, { running: 2, finished: 1, crashed: 1, stopped: 1, waiting: 0, total: 5 });
});

test('buildDashboard on no runs gives all-zero counts and an empty list', () => {
  assert.deepEqual(buildDashboard([]), {
    rows: [],
    counts: { running: 0, finished: 0, crashed: 0, stopped: 0, waiting: 0, total: 0 },
  });
  // Called with nothing at all behaves the same (a fresh machine, §2.3's empty dashboard).
  assert.deepEqual(buildDashboard().counts, { running: 0, finished: 0, crashed: 0, stopped: 0, waiting: 0, total: 0 });
});

test('buildDashboard counts an unknown state in total only, never as one of the four', () => {
  // A stale index entry can classify as unreachable (§2.8); it is still a run in the total but is not
  // one of the four coloured tallies, so it must not land in any of them.
  const { counts } = buildDashboard([view({ state: 'unreachable' }), view({ state: 'running' })]);
  assert.deepEqual(counts, { running: 1, finished: 0, crashed: 0, stopped: 0, waiting: 0, total: 2 });
});

test('buildDashboard rows are a copy: mutating the returned list does not reorder the input', () => {
  const views = [view({ slug: 'a' }), view({ slug: 'b' })];
  const { rows } = buildDashboard(views);
  rows.reverse();
  assert.deepEqual(views.map((v) => v.slug), ['a', 'b']);
});

// --- navigation: selection, clamp, open/back -------------------------------------------------------

test('down/up move and clamp at the ends; select sets the index', () => {
  let ui = initialUi(); // sel 0
  assert.equal(ui.sel, 0);

  ui = dashboardReducer(ui, { type: 'up' }, RUNS).ui; // already at top
  assert.equal(ui.sel, 0, 'up clamps at the top');

  ui = dashboardReducer(ui, { type: 'down' }, RUNS).ui;
  assert.equal(ui.sel, 1);
  ui = dashboardReducer(ui, { type: 'down' }, RUNS).ui;
  ui = dashboardReducer(ui, { type: 'down' }, RUNS).ui;
  assert.equal(ui.sel, 3, 'at the last of four rows');
  ui = dashboardReducer(ui, { type: 'down' }, RUNS).ui;
  assert.equal(ui.sel, 3, 'down clamps at the bottom');

  ui = dashboardReducer(ui, { type: 'select', index: 2 }, RUNS).ui;
  assert.equal(ui.sel, 2, 'select sets the index');
  ui = dashboardReducer(ui, { type: 'select', index: 99 }, RUNS).ui;
  assert.equal(ui.sel, 3, 'select clamps an out-of-range click to the last row');
});

test('selection stays at 0 on an empty list', () => {
  const ui = initialUi();
  assert.equal(dashboardReducer(ui, { type: 'down' }, []).ui.sel, 0);
  assert.equal(dashboardReducer(ui, { type: 'select', index: 5 }, []).ui.sel, 0);
});

test('a malformed select (no index) pins sel to 0, and does not stick as NaN', () => {
  // A select event whose index is missing/non-numeric must not corrupt sel: Math.min/Math.max let NaN
  // through, and a NaN sel would then survive every later move. Selection stays a real slot instead.
  const bad = dashboardReducer(initialUi(), { type: 'select' }, RUNS).ui;
  assert.equal(bad.sel, 0, 'a missing index resets to the top row, not NaN');
  const moved = dashboardReducer(bad, { type: 'down' }, RUNS).ui;
  assert.equal(moved.sel, 1, 'a later move recovers rather than staying stuck');
});

test('open moves to watch with openSlug set; back returns to list', () => {
  let ui = dashboardReducer(initialUi(), { type: 'select', index: 2 }, RUNS).ui; // select run-crashed
  const opened = dashboardReducer(ui, { type: 'open' }, RUNS);
  assert.equal(opened.ui.view, 'watch');
  assert.equal(opened.ui.openSlug, 'run-crashed', 'a finished/crashed run opens too (§2.3)');
  assert.equal(opened.intent, null);

  const back = dashboardReducer(opened.ui, { type: 'back' }, RUNS);
  assert.equal(back.ui.view, 'list');
  assert.equal(back.ui.openSlug, null);
  assert.equal(back.intent, null);
});

test('open on an empty list is inert: no live view on a run that is not there', () => {
  for (const event of [{ type: 'open' }, { type: 'key', key: 'enter' }]) {
    const r = dashboardReducer(initialUi(), event, []);
    assert.equal(r.ui.view, 'list', 'stays on the list rather than drawing a placeholder crashed run');
    assert.equal(r.ui.openSlug ?? null, null);
    assert.equal(r.intent, null);
  }
});

test('open from watch is inert (nothing new to open)', () => {
  const watching = { view: 'watch', sel: 0, openSlug: 'run-running', armed: null };
  const r = dashboardReducer(watching, { type: 'open' }, RUNS);
  assert.equal(r.ui.view, 'watch');
  assert.equal(r.ui.openSlug, 'run-running');
  assert.equal(r.intent, null);
});

test('back in list emits {type:quit}', () => {
  const r = dashboardReducer(initialUi(), { type: 'back' }, RUNS);
  assert.deepEqual(r.intent, { type: 'quit' });
  assert.equal(r.ui.view, 'list');
});

// --- the stop chord (Ctrl+S) -----------------------------------------------------------------------

test('ctrlS on a running run arms; second ctrlS emits {type:stop, slug} and disarms', () => {
  const ui0 = { view: 'list', sel: 0, openSlug: null, armed: null }; // run-running selected
  const first = dashboardReducer(ui0, { type: 'ctrlS' }, RUNS);
  assert.deepEqual(first.ui.armed, { action: 'stop', slug: 'run-running', key: 'run-running' });
  assert.equal(first.intent, null);

  const second = dashboardReducer(first.ui, { type: 'ctrlS' }, RUNS);
  assert.deepEqual(second.intent, { type: 'stop', slug: 'run-running', key: 'run-running' });
  assert.equal(second.ui.armed, null, 'the confirm disarms once it fires');
});

test('an intervening down between the two ctrlS presses cancels the arm (no intent)', () => {
  const ui0 = { view: 'list', sel: 0, openSlug: null, armed: null };
  const armed = dashboardReducer(ui0, { type: 'ctrlS' }, RUNS);
  assert.deepEqual(armed.ui.armed, { action: 'stop', slug: 'run-running', key: 'run-running' });

  const moved = dashboardReducer(armed.ui, { type: 'down' }, RUNS);
  assert.equal(moved.ui.armed, null, 'moving cancels the pending confirm');

  // A ctrlS now is a fresh first press on the newly selected run — it arms, it does not fire.
  const again = dashboardReducer(moved.ui, { type: 'ctrlS' }, RUNS);
  assert.equal(again.intent, null, 'no stop intent leaks through the cancelled arm');
  assert.equal(again.ui.armed, null, 'run-finished is not stoppable, so this ctrlS does not even arm');
});

test('any non-matching event cancels a pending stop arm', () => {
  const ui0 = { view: 'list', sel: 0, openSlug: null, armed: null };
  const armed = dashboardReducer(ui0, { type: 'ctrlS' }, RUNS).ui;
  // A click on the same row still counts as another event and clears the arm.
  assert.equal(dashboardReducer(armed, { type: 'select', index: 0 }, RUNS).ui.armed, null);
  // An unbound key clears it too, so a stale confirm can never be completed by chance.
  assert.equal(dashboardReducer(armed, { type: 'somethingElse' }, RUNS).ui.armed, null);
});

// --- the remove chord (Ctrl+X) ---------------------------------------------------------------------

for (const idx of [1, 2, 3]) {
  test(`ctrlX on ${RUNS[idx].state} arms; second emits {type:remove, slug}`, () => {
    const ui0 = { view: 'list', sel: idx, openSlug: null, armed: null };
    const first = dashboardReducer(ui0, { type: 'ctrlX' }, RUNS);
    assert.deepEqual(first.ui.armed, { action: 'remove', slug: RUNS[idx].slug, key: RUNS[idx].slug });
    assert.equal(first.intent, null);

    const second = dashboardReducer(first.ui, { type: 'ctrlX' }, RUNS);
    assert.deepEqual(second.intent, { type: 'remove', slug: RUNS[idx].slug, key: RUNS[idx].slug });
    assert.equal(second.ui.armed, null);
  });
}

// --- eligibility: stop only on running, remove only on non-running ---------------------------------

test('ctrlS on a non-running run: no arm, no intent', () => {
  for (const idx of [1, 2, 3]) {
    // run-finished, run-crashed, run-stopped — none are stoppable.
    const ui0 = { view: 'list', sel: idx, openSlug: null, armed: null };
    const r = dashboardReducer(ui0, { type: 'ctrlS' }, RUNS);
    assert.equal(r.ui.armed, null, `${RUNS[idx].state} cannot be stopped`);
    assert.equal(r.intent, null);
  }
});

test('ctrlX on a running run: no arm, no intent (stop it first)', () => {
  const ui0 = { view: 'list', sel: 0, openSlug: null, armed: null };
  const r = dashboardReducer(ui0, { type: 'ctrlX' }, RUNS);
  assert.equal(r.ui.armed, null, 'a running run cannot be removed (§2.7)');
  assert.equal(r.intent, null);
});

test('a ctrlS on a non-running run also clears a pending arm', () => {
  // Armed to remove a crashed run, then Ctrl+S on it (ineligible): the arm is cleared, nothing fires.
  const armed = { view: 'list', sel: 2, openSlug: null, armed: { action: 'remove', slug: 'run-crashed', key: 'run-crashed' } };
  const r = dashboardReducer(armed, { type: 'ctrlS' }, RUNS);
  assert.equal(r.ui.armed, null);
  assert.equal(r.intent, null);
});

// --- the chord inside the watch view ---------------------------------------------------------------

test('ctrlS while in watch on a running open run arms and confirms the open run', () => {
  // Watching run-running; the selected row index points elsewhere to prove the target is the OPEN run.
  const watching = { view: 'watch', sel: 3, openSlug: 'run-running', armed: null };
  const first = dashboardReducer(watching, { type: 'ctrlS' }, RUNS);
  assert.deepEqual(first.ui.armed, { action: 'stop', slug: 'run-running', key: 'run-running' }, 'targets the open run, not sel');

  const second = dashboardReducer(first.ui, { type: 'ctrlS' }, RUNS);
  assert.deepEqual(second.intent, { type: 'stop', slug: 'run-running', key: 'run-running' });
  assert.equal(second.ui.armed, null);
});

test('ctrlS while watching a non-running open run does not arm', () => {
  const watching = { view: 'watch', sel: 0, openSlug: 'run-finished', armed: null };
  const r = dashboardReducer(watching, { type: 'ctrlS' }, RUNS);
  assert.equal(r.ui.armed, null, 'a finished run being watched still cannot be stopped');
  assert.equal(r.intent, null);
});

// --- the two headline invariants (DESIGN "Done when") ----------------------------------------------

test('a running run can never produce a remove intent', () => {
  // Even from an armed-remove ui (which cannot legitimately arise on a running run), a Ctrl+X second
  // press must re-check eligibility and refuse, so no remove intent can escape for a running run.
  const armed = { view: 'list', sel: 0, openSlug: null, armed: { action: 'remove', slug: 'run-running' } };
  const r = dashboardReducer(armed, { type: 'ctrlX' }, RUNS);
  assert.equal(r.intent, null);
});

test('a non-running run can never produce a stop intent', () => {
  const armed = { view: 'list', sel: 1, openSlug: null, armed: { action: 'stop', slug: 'run-finished' } };
  const r = dashboardReducer(armed, { type: 'ctrlS' }, RUNS);
  assert.equal(r.intent, null);
});

// --- the task row in the run live view (live-workers T12, DESIGN §2.11) -----------------------------

// A run view carrying a snapshot whose runState.tasks are the live view's task rows, in order.
const task = (id, over) => ({ id, slug: `s-${id}`, deps: [], done: false, phase: null, worker: null, ...over });
const withTasks = (over, tasks) => view({ ...over, snap: { runState: { tasks } } });
const LIVE = { id: 'w-live', live: true, logPath: '/c/conversations/w-live.jsonl' };
const DEAD = { id: 'w-dead', live: false, logPath: '/c/conversations/w-dead.jsonl' };
const TASKED = [
  withTasks({ slug: 'plan', key: 'r1__plan' }, [
    task('T01', { done: true, worker: DEAD }),
    task('T02', { phase: 'building', worker: LIVE }),
    task('T03', { deps: ['T02'] }),
    task('T04'),
    task('T05', { phase: 'preparing' }),
    task('T06', { done: true }),
  ]),
  view({ slug: 'other' }),
];
const watchingTasks = (over) => ({ ...initialUi(), view: 'watch', sel: 1, openSlug: 'plan', openKey: 'r1__plan', ...over });

test('in watch, up/down move taskSel and clamp to the task rows; the list sel does not drift', () => {
  let ui = watchingTasks();
  ui = dashboardReducer(ui, { type: 'up' }, TASKED).ui;
  assert.equal(ui.taskSel, 0, 'up clamps at the first task');
  for (let i = 0; i < 10; i++) ui = dashboardReducer(ui, { type: 'down' }, TASKED).ui;
  assert.equal(ui.taskSel, 5, 'down clamps at the last of six tasks');
  assert.equal(ui.sel, 1, 'the list selection stays where it was');
  assert.equal(ui.view, 'watch');
});

test('in watch on a run with no snapshot, the arrows keep taskSel at 0', () => {
  const ui = { ...initialUi(), view: 'watch', openSlug: 'other' };
  assert.equal(dashboardReducer(ui, { type: 'down' }, TASKED).ui.taskSel, 0);
});

test('opening a run from the list starts its task selection at the top', () => {
  const ui = { ...initialUi(), taskSel: 4 };
  const opened = dashboardReducer(ui, { type: 'open' }, TASKED).ui;
  assert.equal(opened.view, 'watch');
  assert.equal(opened.taskSel, 0);
});

test('two runs of one slug: the task rows are the run named by openKey', () => {
  const twin = withTasks({ slug: 'plan', key: 'r2__plan' }, [task('T09', { worker: LIVE })]);
  const views = [TASKED[0], twin];
  const ui = watchingTasks({ openKey: 'r2__plan' });
  assert.equal(dashboardReducer(ui, { type: 'down' }, views).ui.taskSel, 0, 'r2 has one task, so down clamps at 0');
  const opened = dashboardReducer(ui, { type: 'open' }, views).ui;
  assert.equal(opened.openWorker.taskId, 'T09', 'open reads the r2 run, not the first same-slug row');
});

test('open on a task with a live worker goes to the worker view with the snapshot\'s log path', () => {
  const r = dashboardReducer(watchingTasks({ taskSel: 1 }), { type: 'open' }, TASKED);
  assert.equal(r.ui.view, 'worker');
  assert.deepEqual(r.ui.openWorker, { taskId: 'T02', workerId: 'w-live', logPath: '/c/conversations/w-live.jsonl', live: true });
  assert.equal(r.intent, null);
});

test('open on a task whose workers have all finished opens the latest one read-only', () => {
  const r = dashboardReducer(watchingTasks({ taskSel: 0 }), { type: 'open' }, TASKED);
  assert.equal(r.ui.view, 'worker');
  assert.deepEqual(r.ui.openWorker, { taskId: 'T01', workerId: 'w-dead', logPath: '/c/conversations/w-dead.jsonl', live: false });
});

test('open on a task with no worker stays in watch and sets a footer note saying why', () => {
  const noteAt = (taskSel) => {
    const r = dashboardReducer(watchingTasks({ taskSel }), { type: 'open' }, TASKED);
    assert.equal(r.ui.view, 'watch');
    assert.equal(r.ui.openWorker, null);
    return r.ui.note;
  };
  assert.equal(noteAt(2), 'T03 has no worker yet — it starts when T02 is merged.');
  assert.equal(noteAt(3), 'T04 has no worker yet — it starts when a slot frees up.');
  assert.equal(noteAt(4), 'T05 has no worker yet — its worktree is being set up.');
  assert.equal(noteAt(5), 'T06 has no worker to open — it was merged before this run started.');
});

test('a task in progress with no worker to open says none is running, not that it waits for a slot (T12 review, user 2026-09-25)', () => {
  // After a restart the coordinator's task state survives but this process's worker list does not, so a
  // task can read `building` or `merge conflict` with worker null.
  for (const phase of ['building', 'reviewing', 'merging', 'asking']) {
    const task = { id: 'T07', deps: [], done: false, phase, worker: null };
    assert.equal(noWorkerNote(task, [task]), 'T07 has no worker to open — none is running for it right now.');
  }
});

test('the footer note clears on the next event', () => {
  const noted = dashboardReducer(watchingTasks({ taskSel: 3 }), { type: 'open' }, TASKED).ui;
  assert.ok(noted.note);
  assert.equal(dashboardReducer(noted, { type: 'down' }, TASKED).ui.note, null);
});

test('back from the worker view returns to watch with the task selection kept', () => {
  const inWorker = dashboardReducer(watchingTasks({ taskSel: 1 }), { type: 'open' }, TASKED).ui;
  const back = dashboardReducer(inWorker, { type: 'back' }, TASKED);
  assert.equal(back.ui.view, 'watch');
  assert.equal(back.ui.taskSel, 1);
  assert.equal(back.ui.openWorker, null);
  assert.equal(back.ui.openKey, 'r1__plan', 'still on the same run');
  assert.equal(back.intent, null);
});

test('in the worker view every event but back is inert, the chords included', () => {
  const inWorker = dashboardReducer(watchingTasks({ taskSel: 1 }), { type: 'open' }, TASKED).ui;
  for (const type of ['up', 'down', 'open', 'ctrlS', 'ctrlX', 'select']) {
    const r = dashboardReducer(inWorker, { type, index: 0 }, TASKED);
    assert.equal(r.ui.view, 'worker', type);
    assert.deepEqual(r.ui.openWorker, inWorker.openWorker, type);
    assert.equal(r.ui.taskSel, 1, type);
    assert.equal(r.ui.armed, null, type);
    assert.equal(r.intent, null, type);
  }
});

test('Ctrl+S in watch still arms and fires stop for the open run with a task selected', () => {
  const ui = watchingTasks({ openSlug: 'plan', openKey: 'r1__plan', taskSel: 2 });
  const first = dashboardReducer(ui, { type: 'ctrlS' }, TASKED);
  assert.deepEqual(first.ui.armed, { action: 'stop', slug: 'plan', key: 'r1__plan' });
  const second = dashboardReducer(first.ui, { type: 'ctrlS' }, TASKED);
  assert.deepEqual(second.intent, { type: 'stop', slug: 'plan', key: 'r1__plan' });
});

// --- planning runs beside builds (pir-plan-command T11, DESIGN §2.10, §2.14) -----------------------

const STATES = ['running', 'finished', 'stopped', 'crashed'];
const STEPS = ['plan', 'rename', 'review', 'done'];
const OUTCOMES = [null, 'no-plan', 'reviewed', 'not-reviewed'];
const planView = ({ state = 'running', step = 'plan', outcome = null, go = null, label = null, snap = true, slug = 'plan-ab12' } = {}) => ({
  key: `repo__${slug}`,
  slug,
  state,
  repo: 'repo',
  progress: { done: 0, total: 0 },
  workers: 0,
  record: { kind: 'plan', label, go, repo: 'repo', slug },
  snap: snap ? { runState: { kind: 'plan', label, slug: null, step, outcome, steps: [] } } : null,
});

test('runDisplayState: a build (kind work, or no kind at all) shows its classification unchanged', () => {
  for (const state of [...STATES, 'unreachable']) {
    assert.equal(runDisplayState(view({ state })), state, `no record: ${state}`);
    assert.equal(runDisplayState(view({ state, record: { kind: 'work', go: null } })), state, `kind work: ${state}`);
    assert.equal(runDisplayState(view({ state, record: { kind: 'work', go: 'declined' } })), state);
  }
});

test('runDisplayState: every plan combination of classification, step, outcome and go', () => {
  for (const state of STATES) {
    for (const step of STEPS) {
      for (const outcome of OUTCOMES) {
        for (const go of [null, 'declined']) {
          let want;
          if (state === 'running') want = step === 'plan' ? 'planning' : 'reviewing';
          else if (state === 'finished') want = outcome === 'reviewed' && go === null ? 'your-go' : 'finished';
          else want = state;
          assert.equal(runDisplayState(planView({ state, step, outcome, go })), want, `${state} ${step} ${outcome} ${go}`);
        }
      }
    }
  }
});

test('runDisplayState: a plan with no snapshot yet is planning while running, finished once finished', () => {
  assert.equal(runDisplayState(planView({ snap: false })), 'planning');
  assert.equal(runDisplayState(planView({ state: 'finished', snap: false })), 'finished');
  assert.equal(runDisplayState(planView({ state: 'crashed', snap: false })), 'crashed');
  // A view with no record but a plan snapshot is a plan too.
  const { record, ...bare } = planView({ step: 'review' });
  void record;
  assert.equal(runDisplayState(bare), 'reviewing');
});

test('planProgress: each step and each outcome', () => {
  assert.equal(planProgress(null), 'plan …');
  assert.equal(planProgress({ step: 'plan', outcome: null }), 'plan …');
  assert.equal(planProgress({ step: 'rename', outcome: null }), 'plan ✓ review …');
  assert.equal(planProgress({ step: 'review', outcome: null }), 'plan ✓ review …');
  assert.equal(planProgress({ step: 'done', outcome: 'reviewed' }), 'plan ✓ review ✓');
  assert.equal(planProgress({ step: 'done', outcome: 'no-plan' }), 'plan ✗');
  assert.equal(planProgress({ step: 'plan', outcome: 'no-plan' }), 'plan ✗');
  assert.equal(planProgress({ step: 'done', outcome: 'not-reviewed' }), 'plan ✓ review ✗');
  assert.equal(planProgress({ step: 'review', outcome: 'not-reviewed' }), 'plan ✓ review ✗');
});

test('canResume: stopped or crashed of either type, and a finished plan that ended not-reviewed, nothing else', () => {
  for (const state of STATES) {
    const want = state === 'stopped' || state === 'crashed';
    assert.equal(canResume(view({ state })), want, `work ${state}`);
    for (const outcome of OUTCOMES) {
      const plan = want || (state === 'finished' && outcome === 'not-reviewed');
      assert.equal(canResume(planView({ state, step: 'done', outcome })), plan, `plan ${state} ${outcome}`);
    }
  }
  assert.equal(canResume(view({ state: 'unreachable' })), false);
  assert.equal(canResume(undefined), false);
});

test('displayName: a plan row before the rename shows its label in quotes, else the slug', () => {
  assert.equal(displayName(planView({ label: 'Add dark mode to the bl…' })), '"Add dark mode to the bl…"');
  assert.equal(displayName(planView({ label: null, slug: 'dark-mode' })), 'dark-mode');
  assert.equal(displayName(view({ slug: 'a-build', record: { kind: 'work', label: 'stray' } })), 'a-build');
});

test('buildDashboard: plan rows count planning/reviewing as running, your go as waiting, and carry `display`', () => {
  const { rows, counts } = buildDashboard([
    planView({ slug: 'a', state: 'finished', step: 'done', outcome: 'reviewed' }),
    planView({ slug: 'b', state: 'running', step: 'plan' }),
    view({ slug: 'c', state: 'running' }),
    planView({ slug: 'd', state: 'crashed', step: 'review' }),
    planView({ slug: 'e', state: 'finished', step: 'done', outcome: 'reviewed', go: 'declined' }),
  ]);
  assert.deepEqual(rows.map((r) => r.display), ['your-go', 'planning', 'running', 'crashed', 'finished']);
  assert.deepEqual(counts, { running: 2, finished: 1, crashed: 1, stopped: 0, waiting: 1, total: 5 });
});

const RESUMABLE = [
  view({ slug: 'w-running', state: 'running' }),
  view({ slug: 'w-stopped', state: 'stopped' }),
  planView({ slug: 'p-crashed', state: 'crashed' }),
  planView({ slug: 'p-not-reviewed', state: 'finished', step: 'done', outcome: 'not-reviewed' }),
  planView({ slug: 'p-your-go', state: 'finished', step: 'done', outcome: 'reviewed' }),
  view({ slug: 'w-finished', state: 'finished' }),
];

test('Ctrl+R arms on a resumable row and a second Ctrl+R on the same row fires {type:resume}', () => {
  for (const sel of [1, 2, 3]) {
    const target = RESUMABLE[sel];
    const first = dashboardReducer({ ...initialUi(), sel }, { type: 'ctrlR' }, RESUMABLE);
    assert.deepEqual(first.ui.armed, { action: 'resume', slug: target.slug, key: runKey(target) });
    assert.equal(first.intent, null);
    const second = dashboardReducer(first.ui, { type: 'ctrlR' }, RESUMABLE);
    assert.deepEqual(second.intent, { type: 'resume', slug: target.slug, key: runKey(target) });
    assert.equal(second.ui.armed, null);
  }
});

test("the task doc's {type:'key', key:'ctrl+r'} form is the same event", () => {
  const first = dashboardReducer({ ...initialUi(), sel: 1 }, { type: 'key', key: 'ctrl+r' }, RESUMABLE);
  assert.equal(first.ui.armed.action, 'resume');
  const second = dashboardReducer(first.ui, { type: 'key', key: 'ctrl+r' }, RESUMABLE);
  assert.equal(second.intent.type, 'resume');
});

test('Ctrl+R is not offered where canResume is false: running, your go, a plain finished build', () => {
  for (const sel of [0, 4, 5]) {
    const armedBefore = { ...initialUi(), sel, armed: { action: 'stop', slug: 'x', key: 'x' } };
    const r = dashboardReducer(armedBefore, { type: 'ctrlR' }, RESUMABLE);
    assert.equal(r.ui.armed, null, `sel ${sel}: no arm, and a pending arm is cleared`);
    assert.equal(r.intent, null);
  }
});

test('any other key between the two Ctrl+R presses cancels the resume, and a move re-arms from scratch', () => {
  const first = dashboardReducer({ ...initialUi(), sel: 1 }, { type: 'ctrlR' }, RESUMABLE);
  for (const ev of [{ type: 'ctrlS' }, { type: 'ctrlX' }, { type: 'down' }, { type: 'up' }, { type: 'bogus' }]) {
    const other = dashboardReducer(first.ui, ev, RESUMABLE);
    if (ev.type === 'ctrlX') {
      // Ctrl+X on the same stopped row arms remove instead: the resume arm is gone either way.
      assert.equal(other.ui.armed?.action, 'remove');
    } else assert.equal(other.ui.armed, null, ev.type);
    const again = dashboardReducer(other.ui, { type: 'ctrlR' }, RESUMABLE);
    assert.equal(again.intent, null, `${ev.type} then Ctrl+R does not fire`);
  }
  // A Ctrl+S armed on a row then Ctrl+R does not fire resume either.
  const armedStop = { ...initialUi(), sel: 1, armed: { action: 'stop', slug: 'w-stopped', key: 'w-stopped' } };
  assert.equal(dashboardReducer(armedStop, { type: 'ctrlR' }, RESUMABLE).intent, null);
});

test('Ctrl+R is inert outside the list: the live view and the worker view', () => {
  const watching = { ...initialUi(), view: 'watch', sel: 1, openSlug: 'w-stopped', openKey: 'w-stopped' };
  const r = dashboardReducer(watching, { type: 'ctrlR' }, RESUMABLE);
  assert.equal(r.ui.armed, null);
  assert.equal(dashboardReducer({ ...watching, armed: { action: 'resume', slug: 'w-stopped', key: 'w-stopped' } }, { type: 'ctrlR' }, RESUMABLE).intent, null);
  const worker = { ...watching, view: 'worker', openWorker: { taskId: 'T01', workerId: 'w', logPath: null, live: false } };
  assert.equal(dashboardReducer(worker, { type: 'ctrlR' }, RESUMABLE).ui.armed, null);
});

// ---- T12: a planning run's steps view and its go (pir-plan-command §2.8, §2.11). ----

import { findOpen, goOpen, openTasks, repinOpen, runIdentity } from './dashboard.mjs';

const PLAN_REC = { kind: 'plan', label: null, go: null, repo: 'blog', slug: 'dark-mode', pid: 4242, startTime: 'Sat Sep 26 10:00:00 2026' };
const stepRow = (id, phase, worker = null) => ({ id, phase, worker });
function stepsView({ state = 'running', step = 'plan', outcome = null, go = null, steps, key = 'blog__dark-mode', slug = 'dark-mode', label = null } = {}) {
  return {
    key, slug, state, repo: 'blog',
    record: { ...PLAN_REC, slug, go, label },
    snap: { runState: { kind: 'plan', slug, step, outcome, steps: steps ?? [stepRow('plan', 'planning', { id: 'p1', live: true, logPath: '/c/plan-1.ndjson' }), stepRow('review', 'pending'), stepRow('build', 'pending')] } },
  };
}
const reviewedView = (over = {}) =>
  stepsView({ state: 'finished', step: 'done', outcome: 'reviewed', steps: [stepRow('plan', 'done', { id: 'p1', live: false, logPath: '/c/plan-1.ndjson' }), stepRow('review', 'done', { id: 'r1', live: false, logPath: '/c/review-1.ndjson' }), stepRow('build', 'pending')], ...over });
const watching = (views) => dashboardReducer(initialUi(), { type: 'open' }, views).ui;

test('the go keys act only while the open run waits for the go', () => {
  const go = [reviewedView()];
  const ui = watching(go);
  assert.equal(goOpen(go, ui), true);
  assert.deepEqual(dashboardReducer(ui, { type: 'key', key: 'enter' }, go).intent, { type: 'start', slug: 'dark-mode', key: 'blog__dark-mode' });
  assert.deepEqual(dashboardReducer(ui, { type: 'key', key: 'n' }, go).intent, { type: 'decline', slug: 'dark-mode', key: 'blog__dark-mode' });

  // Declined, or still planning: Enter opens the selected step as → does, and `n` does nothing.
  for (const views of [[reviewedView({ go: 'declined' })], [stepsView()]]) {
    const u = watching(views);
    assert.equal(goOpen(views, u), false);
    const enter = dashboardReducer(u, { type: 'key', key: 'enter' }, views);
    assert.equal(enter.intent, null);
    assert.equal(enter.ui.view, 'worker', 'Enter opened the plan step');
    const n = dashboardReducer(u, { type: 'key', key: 'n' }, views);
    assert.equal(n.intent, null);
    assert.equal(n.ui.view, 'watch');
  }
  // On the list the go keys are not the go: Enter opens the row, `n` is inert.
  assert.equal(dashboardReducer(initialUi(), { type: 'key', key: 'enter' }, go).ui.view, 'watch');
  assert.equal(dashboardReducer(initialUi(), { type: 'key', key: 'n' }, go).intent, null);
});

test('leaving the go question writes nothing: ← goes to the list with no intent, and the question is still there on return', () => {
  const go = [reviewedView()];
  const back = dashboardReducer(watching(go), { type: 'back' }, go);
  assert.equal(back.intent, null);
  assert.equal(back.ui.view, 'list');
  assert.equal(goOpen(go, dashboardReducer(back.ui, { type: 'open' }, go).ui), true);
});

test('a step row opens its latest session, read-only when it is not live; a step with none gets a footer note', () => {
  const views = [reviewedView()];
  let ui = watching(views);
  assert.deepEqual(openTasks(views, ui).map((s) => s.id), ['plan', 'review', 'build']);
  assert.equal(ui.taskSel, 2, 'a run waiting for the go opens on its build step');
  ui = dashboardReducer(ui, { type: 'up' }, views).ui;
  const opened = dashboardReducer(ui, { type: 'open' }, views).ui;
  assert.equal(opened.view, 'worker');
  assert.deepEqual(opened.openWorker, { taskId: 'review', workerId: 'r1', logPath: '/c/review-1.ndjson', live: false });

  // Planning: the review step has no session yet, nor does build.
  const planning = [stepsView()];
  let u = watching(planning);
  u = dashboardReducer(u, { type: 'down' }, planning).ui;
  const r = dashboardReducer(u, { type: 'open' }, planning).ui;
  assert.equal(r.view, 'watch');
  assert.match(r.note, /^review has no session yet/);
  u = dashboardReducer(u, { type: 'down' }, planning).ui;
  assert.match(dashboardReducer(u, { type: 'open' }, planning).ui.note, /^build has no conversation here/);
  assert.equal(dashboardReducer(u, { type: 'down' }, planning).ui.taskSel, 2, 'the step rows clamp at build');
});

test('a planning run with no snapshot still has three steps, and none opens', () => {
  const v = { ...stepsView(), snap: null };
  const ui = watching([v]);
  assert.deepEqual(openTasks([v], ui).map((s) => s.id), ['plan', 'review', 'build']);
  assert.match(dashboardReducer(ui, { type: 'open' }, [v]).ui.note, /^plan has no session yet/);
});

test('an open steps view and an open step conversation keep their run through the rename', () => {
  const before = [stepsView({ key: 'blog__plan-3f2a', slug: 'plan-3f2a', label: 'Add dark mode' })];
  const after = [stepsView({ key: 'blog__dark-mode', slug: 'dark-mode', step: 'review' })];
  const ui = watching(before);
  assert.deepEqual(ui.openRun, runIdentity(before[0]));
  assert.equal(findOpen(after, ui), after[0], 'found by its program once its key is gone');
  const repinned = repinOpen(ui, after);
  assert.equal(repinned.openKey, 'blog__dark-mode');
  assert.equal(repinned.openSlug, 'dark-mode');

  // The step conversation, opened before the rename, still finds its run, and ← lands on the steps view.
  const inConv = dashboardReducer(ui, { type: 'open' }, before).ui;
  assert.equal(inConv.view, 'worker');
  assert.equal(findOpen(after, inConv), after[0]);
  const backUi = dashboardReducer(repinOpen(inConv, after), { type: 'back' }, after).ui;
  assert.equal(backUi.view, 'watch');
  assert.equal(findOpen(after, backUi), after[0]);

  // Opened by slug (`pir plan` lands on the run id): the first repin takes its identity, so the rename holds.
  const bySlug = repinOpen({ ...initialUi(), view: 'watch', openSlug: 'plan-3f2a' }, before);
  assert.deepEqual(bySlug.openRun, runIdentity(before[0]));
  assert.equal(findOpen(after, bySlug), after[0]);

  // A different program of the same repo is not mistaken for it.
  const other = [{ ...after[0], record: { ...after[0].record, pid: 1 } }];
  assert.equal(findOpen(other, ui), undefined);
});

test('the go replaces the record under the same key: the open view becomes the build', () => {
  const go = [reviewedView()];
  const ui = watching(go);
  const build = [{ key: 'blog__dark-mode', slug: 'dark-mode', state: 'running', repo: 'blog', record: { repo: 'blog', slug: 'dark-mode', pid: 999, startTime: 'later' }, snap: null }];
  const next = repinOpen(ui, build);
  assert.equal(findOpen(build, next), build[0]);
  assert.deepEqual(next.openRun, { repo: 'blog', pid: 999, startTime: 'later' });
  assert.equal(goOpen(build, next), false);
});

// A build's snapshot with one task in the given shape; the rest of the run is irrelevant to the STATE.
const buildSnap = (task) => ({ runState: { branch: 'pir/x', ceiling: 2, tasks: [{ id: 'T01', slug: 'one', deps: [], done: false, phase: 'building', ...task }] } });

test('runDisplayState: a running build with a worker waiting on the person reads asking-you, by the live view\'s rule', () => {
  const at = (state, task) => runDisplayState(view({ state, snap: buildSnap(task) }));
  assert.equal(at('running', { phase: 'asking' }), 'asking-you', 'a question or decision report');
  assert.equal(at('running', { phase: 'building', asking: 'permission' }), 'asking-you', 'a pending permission request');
  assert.equal(at('running', { phase: 'reviewing', asking: 'questions' }), 'asking-you', 'a pending question set');
  assert.equal(at('running', { phase: 'building' }), 'running', 'nothing asked');
  assert.equal(at('running', { phase: 'asking', conflictSent: true }), 'running', 'fixing a conflict asks nothing of the person');
  assert.equal(at('running', { phase: 'asking', done: true }), 'running', 'a merged task asks nothing');
  assert.equal(at('stopped', { phase: 'asking' }), 'stopped', 'only a running run is asking');
  assert.equal(at('crashed', { phase: 'asking' }), 'crashed');
  assert.equal(runDisplayState(view({ state: 'running', snap: null })), 'running', 'no snapshot yet');
});

test('buildDashboard: an asking build counts in waiting beside your go, not in running', () => {
  const { rows, counts } = buildDashboard([
    view({ slug: 'a', state: 'running', snap: buildSnap({ phase: 'asking' }) }),
    view({ slug: 'b', state: 'running', snap: buildSnap({ phase: 'building' }) }),
    planView({ slug: 'c', state: 'finished', step: 'done', outcome: 'reviewed' }),
  ]);
  assert.deepEqual(rows.map((r) => r.display), ['asking-you', 'running', 'your-go']);
  assert.deepEqual(counts, { running: 1, finished: 0, crashed: 0, stopped: 0, waiting: 2, total: 3 });
});

// --- the coordinator agent (pir-coordinator T06, DESIGN §2.8, §2.10) ------------------------------

test('runDisplayState: a build waiting in ready to merge reads ready-to-merge and counts as waiting; a coordinator-held question does not ask', () => {
  const ready = view({ slug: 'r', state: 'running', snap: { runState: { tasks: [{ id: 'T01', done: true }], handoff: { state: 'ready', reportPath: 'plans/r/REPORT.md' } } } });
  const red = view({ slug: 'd', state: 'running', snap: { runState: { tasks: [{ id: 'T01', done: true }], handoff: { state: 'red' } } } });
  const held = view({ slug: 'h', state: 'running', snap: buildSnap({ phase: 'asking', holder: 'coordinator' }) });
  const passed = view({ slug: 'p', state: 'running', snap: buildSnap({ phase: 'asking', holder: 'person' }) });
  const merged = view({ slug: 'm', state: 'finished', snap: ready.snap });
  const { rows, counts } = buildDashboard([ready, red, held, passed, merged]);
  assert.deepEqual(rows.map((r) => r.display), ['ready-to-merge', 'running', 'running', 'asking-you', 'finished']);
  assert.deepEqual(counts, { running: 2, finished: 1, crashed: 0, stopped: 0, waiting: 2, total: 5 });
});

test('dashboardReducer: `c` in a build\'s live view opens its coordinator agent\'s conversation; ← comes back; no agent → a note', () => {
  const coordinator = { id: 'sess-1', live: true, logPath: '/c/conversations/coordinator-1.ndjson' };
  const withAgent = [view({ slug: 'a', snap: { runState: { tasks: [{ id: 'T01' }], coordinator } } })];
  const watch = { ...initialUi(), view: 'watch', openSlug: 'a', taskSel: 0 };

  const opened = dashboardReducer(watch, { type: 'key', key: 'c' }, withAgent);
  assert.equal(opened.intent, null);
  assert.equal(opened.ui.view, 'worker');
  assert.deepEqual(opened.ui.openWorker, { taskId: 'coordinator', workerId: 'sess-1', logPath: '/c/conversations/coordinator-1.ndjson', live: true });
  const back = dashboardReducer(opened.ui, { type: 'back' }, withAgent);
  assert.equal(back.ui.view, 'watch');
  assert.equal(back.ui.openWorker, null);

  const none = [view({ slug: 'a', snap: { runState: { tasks: [{ id: 'T01' }], coordinator: null } } })];
  const refused = dashboardReducer({ ...watch, armed: { action: 'stop', slug: 'a', key: 'a' } }, { type: 'key', key: 'c' }, none);
  assert.equal(refused.ui.view, 'watch', 'nothing opens');
  assert.match(refused.ui.note, /no coordinator agent/);
  assert.equal(refused.ui.armed, null, 'a stray key still cancels a pending confirm');

  const list = dashboardReducer({ ...initialUi(), sel: 0 }, { type: 'key', key: 'c' }, withAgent);
  assert.equal(list.ui.view, 'list', 'inert on the list');
  assert.equal(list.ui.note, null);
});
