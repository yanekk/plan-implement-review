import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { scanPlans } from './plan-scan.mjs';

// scanPlans against real git in scratch repos (box-commands DESIGN §2.3, T02).

const DESIGN = '---\nsetup: none\ntest:\n  - npm test\n---\n# Design\n';

function progress(states, reviewed = '2026-09-28 — clean') {
  const rows = states.map((s, i) => `| T0${i + 1} | task-${i + 1} | — | ${s} | |`).join('\n');
  return (
    `# Progress\n\n**Plan reviewed:** ${reviewed}\n\n## Tasks\n\n` +
    `| # | Task | Depends on | State | Notes |\n|---|---|---|---|---|\n${rows}\n`
  );
}

function git(cwd, ...args) {
  return execFileSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

function tempDir(t, prefix) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A scratch repo on `main` with one commit and no plans/.
function scratch(t) {
  const root = tempDir(t, 'pir-planscan-');
  git(root, 'init', '-q', '-b', 'main');
  writeFileSync(join(root, 'README.md'), 'scratch\n');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'init');
  return root;
}

function writePlan(dir, slug, { states = ['⬜'], reviewed, design = DESIGN } = {}) {
  mkdirSync(join(dir, 'plans', slug), { recursive: true });
  writeFileSync(join(dir, 'plans', slug, 'PROGRESS.md'), progress(states, reviewed));
  if (design != null) writeFileSync(join(dir, 'plans', slug, 'DESIGN.md'), design);
}

// Commit plans on a new branch without touching main's working tree. `plans` is [slug, opts] pairs, so a
// branch can hold a plan under a name other than its own (or none).
function commitOnBranch(t, root, branch, plans) {
  const wt = tempDir(t, 'pir-planscan-wt-');
  rmSync(wt, { recursive: true, force: true });
  git(root, 'worktree', 'add', '-q', '-b', branch, wt, 'main');
  for (const [slug, opts] of plans) writePlan(wt, slug, opts);
  writeFileSync(join(wt, 'marker'), branch);
  git(wt, 'add', '.');
  git(wt, 'commit', '-q', '-m', `plan on ${branch}`);
  git(root, 'worktree', 'remove', '--force', wt);
}

test('scanPlans: a plan in the working tree only', (t) => {
  const root = scratch(t);
  writePlan(root, 'packing', { states: ['✅', '⬜', '🔍'] });
  assert.deepEqual(scanPlans(root), [{ slug: 'packing', done: 1, total: 3 }]);
});

test('scanPlans: a plan committed only on pir/{slug}', (t) => {
  const root = scratch(t);
  commitOnBranch(t, root, 'pir/garden', [['garden', { states: ['⬜', '⬜'] }]]);
  assert.deepEqual(scanPlans(root), [{ slug: 'garden', done: 0, total: 2 }]);
});

test('scanPlans: the same slug in both, the working tree wins', (t) => {
  const root = scratch(t);
  commitOnBranch(t, root, 'pir/both', [['both', { states: ['⬜', '⬜', '⬜'] }]]);
  writePlan(root, 'both', { states: ['✅', '✅', '⬜', '⬜'] });
  assert.deepEqual(scanPlans(root), [{ slug: 'both', done: 2, total: 4 }]);
});

test('scanPlans: finished, unreviewed and test-block-less plans are left out', (t) => {
  const root = scratch(t);
  writePlan(root, 'finished', { states: ['✅', '✅'] });
  writePlan(root, 'unreviewed', { reviewed: 'not yet' });
  writePlan(root, 'no-block', { design: '# Design\n' });
  writePlan(root, 'ok');
  commitOnBranch(t, root, 'pir/branch-done', [['branch-done', { states: ['✅'] }]]);
  commitOnBranch(t, root, 'pir/branch-unreviewed', [['branch-unreviewed', { reviewed: 'not yet' }]]);
  assert.deepEqual(scanPlans(root), [{ slug: 'ok', done: 0, total: 1 }]);
});

test('scanPlans: a planning branch pir/plan-a1b2 with no plan under its own name is left out', (t) => {
  const root = scratch(t);
  // Its plan sits under the slug the planner chose, and pir/other does not exist: nothing is offered.
  commitOnBranch(t, root, 'pir/plan-a1b2', [['other', {}]]);
  assert.deepEqual(scanPlans(root), []);
});

test('scanPlans: a folder under plans/ without PROGRESS.md is not a candidate', (t) => {
  const root = scratch(t);
  mkdirSync(join(root, 'plans', 'empty'), { recursive: true });
  writeFileSync(join(root, 'plans', 'README.md'), 'not a plan\n');
  assert.deepEqual(scanPlans(root), []);
});

test('scanPlans: a repo with no plans/ and no pir/* branches → []', (t) => {
  assert.deepEqual(scanPlans(scratch(t)), []);
});

test('scanPlans: a path that is not a repo → [], no throw', (t) => {
  const dir = tempDir(t, 'pir-planscan-norepo-');
  assert.deepEqual(scanPlans(dir), []);
  assert.deepEqual(scanPlans(join(dir, 'missing')), []);
});

test('scanPlans: a folder that is not a repo still lists its working-tree plans', (t) => {
  // planHome reads the working tree before it ever calls git, so a plain folder with plans/ is read.
  const dir = tempDir(t, 'pir-planscan-plain-');
  writePlan(dir, 'loose');
  assert.deepEqual(scanPlans(dir), [{ slug: 'loose', done: 0, total: 1 }]);
});

test('scanPlans: sorted by slug across both sources', (t) => {
  const root = scratch(t);
  writePlan(root, 'zebra');
  writePlan(root, 'apple');
  commitOnBranch(t, root, 'pir/mango', [['mango', {}]]);
  commitOnBranch(t, root, 'pir/banana', [['banana', {}]]);
  assert.deepEqual(
    scanPlans(root).map((p) => p.slug),
    ['apple', 'banana', 'mango', 'zebra'],
  );
});

test('scanPlans: a failing exec or fs is swallowed, never thrown', () => {
  const exec = () => {
    throw new Error('boom');
  };
  const fs = {
    readdirSync() {
      throw new Error('boom');
    },
    existsSync: () => false,
    readFileSync() {
      throw new Error('boom');
    },
  };
  assert.deepEqual(scanPlans('/nowhere', { exec, fs }), []);
  // An fs whose existsSync itself throws mid-scan still yields [].
  const fs2 = { readdirSync: () => [{ name: 'x', isDirectory: () => true }], existsSync() { throw new Error('boom'); }, readFileSync: () => '' };
  assert.deepEqual(scanPlans('/nowhere', { exec, fs: fs2 }), []);
});
