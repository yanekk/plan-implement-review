// The dashboard state object (PIR_DASHBOARD_STATE, version 1): which view, run and worker it names for a
// given navigation state and set of rows, the run's worktree across a planning run's rename, and the rule
// that only a change in what it says counts as a change.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDashboardState, runCwd, runWorktreeNames, sameDashboardState } from './dashboard-state.mjs';
import { initialUi } from './dashboard.mjs';

const MAIN = '/src/shop';
const WT = `${MAIN}/.claude/worktrees`;
const mainWorktree = (repoPath) => (repoPath.startsWith(MAIN) ? MAIN : null);
const existing = (...paths) => (p) => paths.includes(p);

const build = {
  key: 'shop__search',
  slug: 'search',
  repo: 'shop',
  state: 'running',
  record: { kind: 'work', slug: 'search', repo: 'shop', repoPath: MAIN, branch: 'pir/search' },
  snap: {
    runState: {
      tasks: [
        {
          id: 'T03',
          worker: { id: 'w-rev', live: true, logPath: '/c/T03-review-1.ndjson', cwd: `${WT}/pir-search-T03` },
          workers: [
            { id: 'w-imp', role: 'implement', n: 1, logPath: '/c/T03-implement-1.ndjson', cwd: `${WT}/pir-search-T03` },
            { id: 'w-rev', role: 'review', n: 1, logPath: '/c/T03-review-1.ndjson', cwd: `${WT}/pir-search-T03` },
          ],
        },
        { id: 'T04', worker: { id: 'w-old', live: false, logPath: '/c/T04.ndjson' }, workers: [{ id: 'w-old', role: 'implement', n: 1 }] },
      ],
    },
  },
};

const plan = (over = {}) => ({
  key: 'shop__plan-3f2a',
  slug: 'plan-3f2a',
  repo: 'shop',
  state: 'running',
  record: { kind: 'plan', slug: 'plan-3f2a', repo: 'shop', repoPath: MAIN, branch: 'pir/plan-3f2a' },
  snap: {
    runState: {
      kind: 'plan',
      slug: null,
      steps: [
        { id: 'plan', worker: { id: 's-plan', live: true, cwd: `${WT}/pir-plan-3f2a` }, workers: [{ id: 's-plan', role: 'planner', cwd: `${WT}/pir-plan-3f2a` }] },
        { id: 'review', worker: null, workers: [] },
      ],
    },
  },
  ...over,
});

const state = (ui, rows, exists = existing(`${WT}/pir-search`)) =>
  buildDashboardState({ ui, rows, pid: 99, updatedAt: '2026-09-27T10:00:00.000Z', mainWorktree, exists });

test('the list names no run and no worker', () => {
  assert.deepEqual(state(initialUi(), [build]), { version: 1, pid: 99, view: 'list', run: null, worker: null, updatedAt: '2026-09-27T10:00:00.000Z' });
});

test("a build's watch view is 'run', with its record's fields and its shared worktree", () => {
  const ui = { ...initialUi(), view: 'watch', openKey: 'shop__search', openSlug: 'search' };
  const s = state(ui, [build]);
  assert.equal(s.view, 'run');
  assert.deepEqual(s.run, { key: 'shop__search', kind: 'work', slug: 'search', repo: 'shop', repoPath: MAIN, branch: 'pir/search', cwd: `${WT}/pir-search` });
  assert.equal(s.worker, null);
});

test('run.cwd is null until the worktree folder exists', () => {
  const ui = { ...initialUi(), view: 'watch', openKey: 'shop__search' };
  assert.equal(state(ui, [build], existing()).run.cwd, null);
});

test('the worktree hangs off the main checkout, not the checkout the run was started from', () => {
  const v = { ...build, record: { ...build.record, repoPath: `${MAIN}/.claude/worktrees/elsewhere` } };
  assert.equal(runCwd(v, { mainWorktree, exists: existing(`${WT}/pir-search`) }), `${WT}/pir-search`);
  assert.equal(runCwd(v, { mainWorktree: () => null, exists: () => true }), null, 'no main worktree, no path');
});

test("the worker view names the worker, its task, role and spawn folder; the run stays set", () => {
  const ui = { ...initialUi(), view: 'worker', openKey: 'shop__search', openWorker: { taskId: 'T03', workerId: 'w-imp', logPath: null, live: false } };
  const s = state(ui, [build]);
  assert.equal(s.view, 'worker');
  assert.equal(s.run.key, 'shop__search');
  assert.deepEqual(s.worker, { id: 'w-imp', task: 'T03', role: 'implement', cwd: `${WT}/pir-search-T03` });
  const rev = state({ ...ui, openWorker: { taskId: 'T03', workerId: 'w-rev' } }, [build]);
  assert.equal(rev.worker.role, 'review');
});

test('a worker whose snapshot recorded no folder publishes cwd null', () => {
  const ui = { ...initialUi(), view: 'worker', openKey: 'shop__search', openWorker: { taskId: 'T04', workerId: 'w-old' } };
  assert.deepEqual(state(ui, [build]).worker, { id: 'w-old', task: 'T04', role: 'implement', cwd: null });
});

test('an open run whose row has gone publishes the view with a null run', () => {
  const ui = { ...initialUi(), view: 'watch', openKey: 'shop__gone' };
  assert.deepEqual([state(ui, [build]).view, state(ui, [build]).run], ['run', null]);
});

test('a planning run: kind plan, its planning worktree, and the planner publishes as implement', () => {
  const ui = { ...initialUi(), view: 'worker', openKey: 'shop__plan-3f2a', openWorker: { taskId: 'plan', workerId: 's-plan' } };
  const s = state(ui, [plan()], existing(`${WT}/pir-plan-3f2a`));
  assert.equal(s.run.kind, 'plan');
  assert.equal(s.run.cwd, `${WT}/pir-plan-3f2a`);
  assert.deepEqual(s.worker, { id: 's-plan', task: 'plan', role: 'implement', cwd: `${WT}/pir-plan-3f2a` });
});

test("a planning run's worktree is found under its new name at every step of the rename", () => {
  // The snapshot has the slug, the folder has moved, the branch and the index entry have not yet.
  const midway = plan({ snap: { runState: { kind: 'plan', slug: 'dark-mode', steps: [] } } });
  assert.deepEqual(runWorktreeNames(midway), ['pir-plan-3f2a', 'pir-dark-mode']);
  assert.equal(runCwd(midway, { mainWorktree, exists: existing(`${WT}/pir-dark-mode`) }), `${WT}/pir-dark-mode`);
  // The index entry has moved but the branch still has the old name.
  const indexed = plan({ record: { kind: 'plan', slug: 'dark-mode', repo: 'shop', repoPath: MAIN, branch: 'pir/plan-3f2a' } });
  assert.equal(runCwd(indexed, { mainWorktree, exists: existing(`${WT}/pir-plan-3f2a`) }), `${WT}/pir-plan-3f2a`);
});

test('sameDashboardState ignores updatedAt and nothing else', () => {
  const ui = { ...initialUi(), view: 'watch', openKey: 'shop__search' };
  const a = state(ui, [build]);
  assert.ok(sameDashboardState(a, { ...a, updatedAt: 'later' }));
  assert.ok(!sameDashboardState(a, { ...a, run: { ...a.run, cwd: null } }));
  assert.ok(!sameDashboardState(null, a), 'nothing written yet is always a change');
});

// ---- A single run (single-runs T10). ----

const single = (over = {}) => ({
  key: 'shop__single-ab12',
  slug: 'single-ab12',
  repo: 'shop',
  state: 'running',
  record: { kind: 'single', slug: 'single-ab12', repo: 'shop', repoPath: MAIN, branch: 'pir/single-ab12' },
  snap: {
    runState: {
      kind: 'single',
      name: null,
      steps: [
        { id: 'build', worker: { id: 's-build', live: true, cwd: `${WT}/pir-single-ab12` }, workers: [{ id: 's-build', role: 'builder', cwd: `${WT}/pir-single-ab12` }] },
        { id: 'review', worker: { id: 's-rev', live: true, cwd: `${WT}/pir-fix-typo` }, workers: [{ id: 's-rev', role: 'reviewer', cwd: `${WT}/pir-fix-typo` }] },
        { id: 'merge', worker: null, workers: [] },
      ],
    },
  },
  ...over,
});

test('a single run publishes kind single, its worktree across the rename, and its builder and reviewer as implement and review', () => {
  const ui = { ...initialUi(), view: 'watch', openSlug: 'single-ab12', openKey: 'shop__single-ab12' };
  const before = state(ui, [single()], existing(`${WT}/pir-single-ab12`));
  assert.deepEqual(before.run, { key: 'shop__single-ab12', kind: 'single', slug: 'single-ab12', repo: 'shop', repoPath: MAIN, branch: 'pir/single-ab12', cwd: `${WT}/pir-single-ab12` });
  // Mid-rename: the folder has moved, the index entry has not. The snapshot's name finds it.
  const mid = single({ snap: { runState: { kind: 'single', name: 'fix-typo', steps: [] } } });
  assert.deepEqual(runWorktreeNames(mid), ['pir-single-ab12', 'pir-fix-typo']);
  assert.equal(state(ui, [mid], existing(`${WT}/pir-fix-typo`)).run.cwd, `${WT}/pir-fix-typo`);

  const inBuild = state({ ...ui, view: 'worker', openWorker: { taskId: 'build', workerId: 's-build' } }, [single()], existing(`${WT}/pir-single-ab12`));
  assert.deepEqual(inBuild.worker, { id: 's-build', task: 'build', role: 'implement', cwd: `${WT}/pir-single-ab12` });
  const inReview = state({ ...ui, view: 'worker', openWorker: { taskId: 'review', workerId: 's-rev' } }, [single()], existing(`${WT}/pir-single-ab12`));
  assert.deepEqual(inReview.worker, { id: 's-rev', task: 'review', role: 'review', cwd: `${WT}/pir-fix-typo` });
});
