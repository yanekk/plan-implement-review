import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { planHome, validSlug } from './plan-home.mjs';
import { readReviewGate, readTestBlockGate, runFeatureTests } from './coordinate.mjs';
import { startRun } from './launch.mjs';

// planHome against real git in scratch repos (pir-plan-command DESIGN §2.9, §4): a plan in the main
// checkout's working tree, a plan committed only on pir/{slug}, both, and neither.

const REVIEWED = '# Progress\n\n**Plan reviewed:** 2026-09-26 — 2 fixed\n';
const UNREVIEWED = '# Progress\n\n**Plan reviewed:** not yet\n';
const design = (testLine) => `---\nsetup: none\ntest:\n  - ${testLine}\n---\n# Design\n`;

function git(cwd, ...args) {
  return execFileSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

// A scratch repo on `main` with one commit and no plan.
function scratch(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pir-planhome-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '-q', '-b', 'main');
  writeFileSync(join(root, 'README.md'), 'scratch\n');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'init');
  return root;
}

function writePlan(dir, slug, { progress = REVIEWED, designText = design('echo main') } = {}) {
  mkdirSync(join(dir, 'plans', slug), { recursive: true });
  writeFileSync(join(dir, 'plans', slug, 'PROGRESS.md'), progress);
  if (designText != null) writeFileSync(join(dir, 'plans', slug, 'DESIGN.md'), designText);
}

// Commit a plan on pir/{slug} without touching main's working tree: a worktree on the branch, the plan
// committed there. Returns the worktree path so a test can leave an uncommitted edit in it.
function commitOnBranch(t, root, slug, opts) {
  const wt = join(root, '..', `${slug}-wt-${Math.random().toString(36).slice(2)}`);
  t.after(() => rmSync(wt, { recursive: true, force: true }));
  git(root, 'worktree', 'add', '-q', '-b', `pir/${slug}`, wt, 'main');
  writePlan(wt, slug, opts);
  git(wt, 'add', '.');
  git(wt, 'commit', '-q', '-m', `plan(${slug})`);
  return wt;
}

test('plan only on main: where main, and the gates read as before', (t) => {
  const root = scratch(t);
  writePlan(root, 'demo'); // uncommitted: the working tree is what counts
  const home = planHome('demo', { root });
  assert.equal(home.where, 'main');
  assert.equal(home.read('PROGRESS.md'), REVIEWED);
  assert.equal(home.read('NOPE.md'), null, 'a missing file reads null');
  assert.equal(readReviewGate('demo', { root }).reviewed, true);
  assert.deepEqual(readTestBlockGate('demo', { root }), { ok: true, setup: [], test: ['echo main'] });
});

test('plan only committed on pir/{slug}: where branch, gate and test block read from the branch', (t) => {
  const root = scratch(t);
  commitOnBranch(t, root, 'demo', { designText: design('echo branch') });
  assert.equal(existsSync(join(root, 'plans', 'demo')), false, 'main\'s working tree has no plan');
  const home = planHome('demo', { root });
  assert.equal(home.where, 'branch');
  assert.equal(home.read('PROGRESS.md'), REVIEWED);
  assert.equal(home.read('FINDINGS.md'), null, 'a file absent from the branch reads null');
  assert.deepEqual(readReviewGate('demo', { root }), { reviewed: true, note: '2026-09-26 — 2 fixed', missing: false });
  assert.deepEqual(readTestBlockGate('demo', { root }), { ok: true, setup: [], test: ['echo branch'] });

  // An unreviewed plan on the branch is refused as not reviewed, not as missing.
  const root2 = scratch(t);
  commitOnBranch(t, root2, 'demo', { progress: UNREVIEWED });
  assert.deepEqual(readReviewGate('demo', { root: root2 }), { reviewed: false, note: 'not yet', missing: false });
  // A branch plan with no DESIGN.md refuses the block gate.
  const root3 = scratch(t);
  commitOnBranch(t, root3, 'demo', { designText: null });
  assert.deepEqual(readTestBlockGate('demo', { root: root3 }), { ok: false, reason: 'no DESIGN.md' });
});

test('plan on both: main wins, including an uncommitted edit on main', (t) => {
  const root = scratch(t);
  commitOnBranch(t, root, 'demo', { designText: design('echo branch') });
  writePlan(root, 'demo', { progress: UNREVIEWED, designText: design('echo main-edit') });
  assert.equal(planHome('demo', { root }).where, 'main');
  assert.equal(readReviewGate('demo', { root }).reviewed, false, 'main\'s uncommitted unreviewed copy is the one read');
  assert.deepEqual(readTestBlockGate('demo', { root }).test, ['echo main-edit']);
});

test('an uncommitted edit in the branch\'s worktree is not seen', (t) => {
  const root = scratch(t);
  const wt = commitOnBranch(t, root, 'demo', { designText: design('echo committed') });
  writeFileSync(join(wt, 'plans', 'demo', 'DESIGN.md'), design('echo uncommitted'));
  writeFileSync(join(wt, 'plans', 'demo', 'PROGRESS.md'), UNREVIEWED);
  assert.equal(planHome('demo', { root }).where, 'branch');
  assert.deepEqual(readTestBlockGate('demo', { root }).test, ['echo committed']);
  assert.equal(readReviewGate('demo', { root }).reviewed, true);
});

test('neither: none, and startRun refuses no-plan without spawning', (t) => {
  const root = scratch(t);
  git(root, 'branch', 'pir/demo'); // a branch with no plan on it is still no plan
  const home = planHome('demo', { root });
  assert.equal(home.where, 'none');
  assert.equal(home.read('PROGRESS.md'), null);
  assert.equal(readReviewGate('demo', { root }).missing, true);
  const nogit = realpathSync(mkdtempSync(join(tmpdir(), 'pir-nogit-')));
  t.after(() => rmSync(nogit, { recursive: true, force: true }));
  assert.equal(planHome('demo', { root: nogit }).where, 'none', 'not a git repo at all');

  const home2 = realpathSync(mkdtempSync(join(tmpdir(), 'pir-planhome-home-')));
  t.after(() => rmSync(home2, { recursive: true, force: true }));
  const calls = [];
  const r = startRun('demo', { cwd: root, spawn: (...a) => calls.push(a), exec: () => ({ ok: false }), kill: () => {}, env: { PIR_HOME: home2 } });
  assert.deepEqual(r, { started: false, reason: 'no-plan' });
  assert.equal(calls.length, 0);
});

test('a branch-home plan passes startRun\'s pre-flight', (t) => {
  const root = scratch(t);
  commitOnBranch(t, root, 'demo');
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'pir-planhome-home-')));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const calls = [];
  const spawn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return { pid: 4242, unref() {} };
  };
  const fs = { mkdirSync() {}, openSync: () => 77 };
  const r = startRun('demo', {
    cwd: root, spawn, fs, exec: () => ({ ok: true, stdout: 'Tue Sep 22 08:27:37 2026\n' }), kill: () => {},
    env: { PIR_HOME: home }, now: () => new Date('2026-09-26T00:00:00Z'),
  });
  assert.equal(r.started, true, JSON.stringify(r));
});

test('runFeatureTests on a branch-home plan reads the block from the branch', (t) => {
  const root = scratch(t);
  commitOnBranch(t, root, 'demo', { designText: design('touch from-branch') });
  const feature = realpathSync(mkdtempSync(join(tmpdir(), 'pir-planhome-feature-')));
  t.after(() => rmSync(feature, { recursive: true, force: true }));
  const logPath = join(feature, 'tests.log');
  const r = runFeatureTests(feature, { slug: 'demo', root, logPath });
  assert.equal(r.ok, true, r.reason);
  assert.equal(existsSync(join(feature, 'from-branch')), true, 'the branch\'s test line ran in the feature worktree');
  assert.match(readFileSync(logPath, 'utf8'), /\$ touch from-branch/);
});

test('a slug containing .. or / is refused before any git or file call', () => {
  const calls = [];
  const exec = (args) => {
    calls.push(['exec', args]);
    return '';
  };
  const fs = {
    existsSync: (p) => (calls.push(['exists', p]), true),
    readFileSync: (p) => (calls.push(['read', p]), REVIEWED),
  };
  for (const slug of ['..', '../x', 'a/b', 'x/../y', 'a..b', 'a\\b', '', undefined, null]) {
    const home = planHome(slug, { root: '/nowhere', exec, fs });
    assert.equal(home.where, 'none', `slug ${JSON.stringify(slug)}`);
    assert.equal(home.read('PROGRESS.md'), null);
    assert.equal(readReviewGate(slug, { root: '/nowhere', exec, fs }).missing, true);
  }
  assert.deepEqual(calls, [], 'no exec and no fs call for a refused slug');
  assert.equal(validSlug('pir-plan-command'), true);
});

test('read refuses a file name that walks out of the plan folder', (t) => {
  const root = scratch(t);
  writePlan(root, 'demo');
  const home = planHome('demo', { root });
  assert.equal(home.read('../../README.md'), null);
  const b = scratch(t);
  commitOnBranch(t, b, 'demo');
  assert.equal(planHome('demo', { root: b }).read('../../README.md'), null);
});

test('the branch lookup is the local branch only: a tag named pir/{slug} is not read', (t) => {
  const root = scratch(t);
  const wt = commitOnBranch(t, root, 'demo');
  // A commit carrying plans/tagged/, reachable only through the tag pir/tagged — there is no such branch.
  writePlan(wt, 'tagged');
  git(wt, 'add', '.');
  git(wt, 'commit', '-q', '-m', 'tagged plan');
  git(wt, 'tag', 'pir/tagged');
  git(wt, 'reset', '-q', '--hard', 'HEAD~1');
  assert.equal(planHome('tagged', { root }).where, 'none');
});
