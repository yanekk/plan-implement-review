// The dashboard model, exercised exhaustively without a terminal (DESIGN §2.3, §2.6, §2.7, §4). The
// in-place painting and the real key handling are the front-end's (T12) and are hand-verified; every
// rule a person could otherwise only check by eye — which run opens, when a confirm is armed, that a
// running run cannot be removed and a stopped one cannot be stopped — is pinned here, in milliseconds.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDashboard, dashboardReducer, initialUi } from './dashboard.mjs';

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
  assert.deepEqual(counts, { running: 2, finished: 1, crashed: 1, stopped: 1, total: 5 });
});

test('buildDashboard on no runs gives all-zero counts and an empty list', () => {
  assert.deepEqual(buildDashboard([]), {
    rows: [],
    counts: { running: 0, finished: 0, crashed: 0, stopped: 0, total: 0 },
  });
  // Called with nothing at all behaves the same (a fresh machine, §2.3's empty dashboard).
  assert.deepEqual(buildDashboard().counts, { running: 0, finished: 0, crashed: 0, stopped: 0, total: 0 });
});

test('buildDashboard counts an unknown state in total only, never as one of the four', () => {
  // A stale index entry can classify as unreachable (§2.8); it is still a run in the total but is not
  // one of the four coloured tallies, so it must not land in any of them.
  const { counts } = buildDashboard([view({ state: 'unreachable' }), view({ state: 'running' })]);
  assert.deepEqual(counts, { running: 1, finished: 0, crashed: 0, stopped: 0, total: 2 });
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
