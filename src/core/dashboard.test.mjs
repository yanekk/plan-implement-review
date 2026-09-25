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
