// pir-plan-command T04 — the planning run's branch and worktree (openPlanBranch, slugTaken,
// renamePlanBranch), exercised against throwaway git repos under a temp dir. Never the real project.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  git, openPlanBranch, slugTaken, renamePlanBranch, openFeature, recordRunBase, readRunBase, syncBase, baseContains, baseTip,
} from './worktree.mjs';

function scratchRepo({ branch = 'main', files = { 'README.md': 'x\n' } } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pir-plan-t04-'));
  const repo = join(dir, 'repo');
  git(dir, ['init', '-b', branch, 'repo']);
  git(repo, ['config', 'user.email', 't04@test.local']);
  git(repo, ['config', 'user.name', 'T04 Test']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  for (const [p, content] of Object.entries(files)) {
    mkdirSync(join(repo, p, '..'), { recursive: true });
    writeFileSync(join(repo, p), content);
  }
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-m', 'init', '--no-edit']);
  return { dir, repo, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const out = (cwd, args) => git(cwd, args).stdout.trim();
const headOf = (cwd) => out(cwd, ['symbolic-ref', '--short', 'HEAD']);
const shaOf = (cwd, ref) => out(cwd, ['rev-parse', ref]);
const branchExists = (repo, b) => git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${b}`]).ok;
const branches = (repo) => out(repo, ['for-each-ref', '--format=%(refname)', 'refs/heads']);
const worktreeList = (repo) => out(repo, ['worktree', 'list', '--porcelain']);
// The main checkout's branch, HEAD commit and tracked status: every call must leave all three alone.
// Untracked is excluded because a scratch repo lists the new .claude/ folder (FINDINGS 2026-09-26).
const mainState = (repo) => ({ head: headOf(repo), sha: shaOf(repo, 'HEAD'), status: out(repo, ['status', '--porcelain', '--untracked-files=no']) });

test('openPlanBranch: cuts pir/{runId} at main in .claude/worktrees; main checkout untouched; reusable', (t) => {
  const s = scratchRepo();
  t.after(s.cleanup);
  const before = mainState(s.repo);
  const r = openPlanBranch('plan-3f9a', { root: s.repo, base: 'main' });
  assert.equal(r.branch, 'pir/plan-3f9a');
  assert.ok(r.path.endsWith(join('.claude', 'worktrees', 'pir-plan-3f9a')), r.path);
  assert.ok(existsSync(r.path));
  assert.equal(headOf(r.path), 'pir/plan-3f9a');
  assert.equal(shaOf(s.repo, 'pir/plan-3f9a'), shaOf(s.repo, 'main'), "cut at main's commit");
  assert.deepEqual(mainState(s.repo), before);
  assert.deepEqual(openPlanBranch('plan-3f9a', { root: s.repo, base: 'main' }), r, 'a second call reuses both');
});

test('openPlanBranch: cuts from main even when the main checkout sits on another branch', (t) => {
  const s = scratchRepo();
  t.after(s.cleanup);
  git(s.repo, ['checkout', '-q', '-b', 'side']);
  writeFileSync(join(s.repo, 'side.txt'), 'side\n');
  git(s.repo, ['add', '-A']);
  git(s.repo, ['commit', '-q', '-m', 'side']);
  const before = mainState(s.repo);
  openPlanBranch('plan-0001', { root: s.repo, base: 'main' });
  assert.equal(shaOf(s.repo, 'pir/plan-0001'), shaOf(s.repo, 'main'));
  assert.deepEqual(mainState(s.repo), before, 'the person stays on their own branch');
});

test('openPlanBranch: a base that does not exist throws no-base-branch and leaves the repo unchanged', (t) => {
  const s = scratchRepo({ branch: 'trunk' });
  t.after(s.cleanup);
  const before = { ...mainState(s.repo), refs: branches(s.repo), wts: worktreeList(s.repo) };
  assert.throws(() => openPlanBranch('plan-3f9a', { root: s.repo, base: 'main' }), (e) => e.code === 'no-base-branch');
  assert.deepEqual({ ...mainState(s.repo), refs: branches(s.repo), wts: worktreeList(s.repo) }, before);
  assert.equal(existsSync(join(s.repo, '.claude')), false, 'no worktrees folder created');
});

test('slugTaken: branch, plan committed on main, index entry, and free', (t) => {
  const s = scratchRepo({ files: { 'plans/on-main/PROGRESS.md': '# Progress\n' } });
  t.after(s.cleanup);
  git(s.repo, ['branch', 'pir/has-branch', 'main']);
  const index = new Set(['in-index']);
  const indexHas = (slug) => index.has(slug);
  const opts = { root: s.repo, base: 'main', indexHas };
  const before = mainState(s.repo);
  assert.equal(slugTaken('has-branch', opts), 'branch');
  assert.equal(slugTaken('on-main', opts), 'base-plan');
  assert.equal(slugTaken('in-index', opts), 'index');
  assert.equal(slugTaken('free-name', opts), null);
  assert.equal(slugTaken('free-name', { root: s.repo, base: 'main' }), null, 'indexHas defaults to empty');
  assert.deepEqual(mainState(s.repo), before);
});

test('slugTaken: a plan only on a side branch or only uncommitted on disk is not base-plan', (t) => {
  const s = scratchRepo();
  t.after(s.cleanup);
  mkdirSync(join(s.repo, 'plans', 'loose'), { recursive: true });
  writeFileSync(join(s.repo, 'plans', 'loose', 'PROGRESS.md'), '# Progress\n');
  assert.equal(slugTaken('loose', { root: s.repo, base: 'main' }), null, 'uncommitted file is not a plan on main');
});

test('renamePlanBranch: moves branch and worktree; the worktree reports pir/{slug}', (t) => {
  const s = scratchRepo();
  t.after(s.cleanup);
  const before = mainState(s.repo);
  const opened = openPlanBranch('plan-3f9a', { root: s.repo, base: 'main' });
  const r = renamePlanBranch('plan-3f9a', 'screen-time', { root: s.repo });
  assert.equal(r.branch, 'pir/screen-time');
  assert.equal(r.path, opened.path.replace(/pir-plan-3f9a$/, 'pir-screen-time'));
  assert.deepEqual(r.done, { branch: true, worktree: true });
  assert.ok(existsSync(r.path));
  assert.equal(existsSync(opened.path), false, 'the old worktree folder is gone');
  assert.equal(headOf(r.path), 'pir/screen-time');
  assert.equal(branchExists(s.repo, 'pir/plan-3f9a'), false);
  assert.deepEqual(mainState(s.repo), before);
});

test('renamePlanBranch: re-run after the branch rename only finishes the worktree move', (t) => {
  const s = scratchRepo();
  t.after(s.cleanup);
  const opened = openPlanBranch('plan-3f9a', { root: s.repo, base: 'main' });
  git(s.repo, ['branch', '-m', 'pir/plan-3f9a', 'pir/screen-time']); // crash after step 1
  const r = renamePlanBranch('plan-3f9a', 'screen-time', { root: s.repo });
  assert.deepEqual(r.done, { branch: false, worktree: true });
  assert.equal(headOf(r.path), 'pir/screen-time');
  assert.equal(existsSync(opened.path), false);
});

test('renamePlanBranch: re-run after both steps is a no-op', (t) => {
  const s = scratchRepo();
  t.after(s.cleanup);
  openPlanBranch('plan-3f9a', { root: s.repo, base: 'main' });
  const first = renamePlanBranch('plan-3f9a', 'screen-time', { root: s.repo });
  const wts = worktreeList(s.repo);
  const again = renamePlanBranch('plan-3f9a', 'screen-time', { root: s.repo });
  assert.deepEqual(again, { ...first, done: { branch: false, worktree: false } });
  assert.equal(worktreeList(s.repo), wts);
});

test('renamePlanBranch: an existing target branch is refused and nothing moves', (t) => {
  const s = scratchRepo();
  t.after(s.cleanup);
  const opened = openPlanBranch('plan-3f9a', { root: s.repo, base: 'main' });
  git(s.repo, ['branch', 'pir/screen-time', 'main']);
  const before = { ...mainState(s.repo), refs: branches(s.repo), wts: worktreeList(s.repo) };
  assert.throws(() => renamePlanBranch('plan-3f9a', 'screen-time', { root: s.repo }), /already exists/);
  assert.deepEqual({ ...mainState(s.repo), refs: branches(s.repo), wts: worktreeList(s.repo) }, before);
  assert.equal(headOf(opened.path), 'pir/plan-3f9a');
});

test('renamePlanBranch: a target branch not ours (old branch gone, checked out elsewhere) is refused', (t) => {
  const s = scratchRepo();
  t.after(s.cleanup);
  git(s.repo, ['branch', 'pir/screen-time', 'main']);
  const elsewhere = join(s.dir, 'elsewhere');
  git(s.repo, ['worktree', 'add', elsewhere, 'pir/screen-time']);
  const before = { refs: branches(s.repo), wts: worktreeList(s.repo) };
  assert.throws(() => renamePlanBranch('plan-3f9a', 'screen-time', { root: s.repo }), /not ours/);
  assert.deepEqual({ refs: branches(s.repo), wts: worktreeList(s.repo) }, before);
});

test('renamePlanBranch: an existing target path is refused and nothing moves', (t) => {
  const s = scratchRepo();
  t.after(s.cleanup);
  const opened = openPlanBranch('plan-3f9a', { root: s.repo, base: 'main' });
  const target = opened.path.replace(/pir-plan-3f9a$/, 'pir-screen-time');
  mkdirSync(target);
  writeFileSync(join(target, 'stray.txt'), 'someone else\n');
  const before = { refs: branches(s.repo), wts: worktreeList(s.repo) };
  assert.throws(() => renamePlanBranch('plan-3f9a', 'screen-time', { root: s.repo }), /already exists/);
  assert.deepEqual({ refs: branches(s.repo), wts: worktreeList(s.repo) }, before);
  assert.deepEqual(readdirSync(target), ['stray.txt']);
});

test('renamePlanBranch: a worktree folder deleted by hand is refused before the branch is renamed', (t) => {
  const s = scratchRepo();
  t.after(s.cleanup);
  const opened = openPlanBranch('plan-3f9a', { root: s.repo, base: 'main' });
  rmSync(opened.path, { recursive: true, force: true });
  const before = { refs: branches(s.repo), wts: worktreeList(s.repo) };
  assert.throws(() => renamePlanBranch('plan-3f9a', 'screen-time', { root: s.repo }), /missing/);
  assert.deepEqual({ refs: branches(s.repo), wts: worktreeList(s.repo) }, before);
  assert.equal(branchExists(s.repo, 'pir/plan-3f9a'), true);
});

// ---- base-branch T03: cut from a given commit, record pirBase, base as an argument ----

// A second commit on `dev` so "the given sha" and "dev's tip" differ.
function devRepo(t) {
  const s = scratchRepo({ branch: 'dev' });
  t.after(s.cleanup);
  const first = shaOf(s.repo, 'dev');
  writeFileSync(join(s.repo, 'later.txt'), 'later\n');
  git(s.repo, ['add', '-A']);
  git(s.repo, ['commit', '-q', '-m', 'later']);
  return { ...s, first, tip: shaOf(s.repo, 'dev') };
}

test('openFeature and openPlanBranch cut from the given sha, not the base tip, and record pirBase', (t) => {
  const s = devRepo(t);
  const plan = openPlanBranch('plan-0a0a', { root: s.repo, base: 'dev', from: s.first });
  assert.equal(shaOf(s.repo, plan.branch), s.first);
  assert.equal(readRunBase(s.repo, plan.branch), 'dev');
  const feat = openFeature('built', { root: s.repo, base: 'dev', from: s.first });
  assert.equal(shaOf(s.repo, feat.branch), s.first);
  assert.equal(readRunBase(s.repo, feat.branch), 'dev');
  const dflt = openFeature('tipcut', { root: s.repo, base: 'dev' });
  assert.equal(shaOf(s.repo, dflt.branch), s.tip, 'no from: the local base tip');
});

test('openPlanBranch: a from that does not resolve throws no-base-branch and creates nothing', (t) => {
  const s = devRepo(t);
  const before = { refs: branches(s.repo), wts: worktreeList(s.repo) };
  assert.throws(() => openPlanBranch('plan-0b0b', { root: s.repo, base: 'dev', from: 'refs/remotes/origin/dev' }), (e) => e.code === 'no-base-branch');
  assert.deepEqual({ refs: branches(s.repo), wts: worktreeList(s.repo) }, before);
  assert.throws(() => openFeature('x', { root: s.repo }), /no base branch given/, 'a cut names its base');
});

test('reusing an existing branch does not rewrite its pirBase', (t) => {
  const s = devRepo(t);
  git(s.repo, ['branch', 'pir/kept', 'dev']);
  recordRunBase(s.repo, 'pir/kept', 'stage');
  openFeature('kept', { root: s.repo, base: 'dev' });
  assert.equal(readRunBase(s.repo, 'pir/kept'), 'stage');
  const p = openPlanBranch('plan-0c0c', { root: s.repo, base: 'dev' });
  assert.deepEqual(openPlanBranch('plan-0c0c', { root: s.repo, base: 'prod' }), p);
  assert.equal(readRunBase(s.repo, p.branch), 'dev');
});

test('renamePlanBranch keeps pirBase (git branch -m carries the config section)', (t) => {
  const s = devRepo(t);
  openPlanBranch('plan-0d0d', { root: s.repo, base: 'dev' });
  const r = renamePlanBranch('plan-0d0d', 'named', { root: s.repo });
  assert.equal(readRunBase(s.repo, r.branch), 'dev');
  assert.equal(readRunBase(s.repo, 'pir/plan-0d0d'), null);
});

test('readRunBase is null for a branch with no pirBase', (t) => {
  const s = devRepo(t);
  git(s.repo, ['branch', 'pir/old', 'dev']);
  assert.equal(readRunBase(s.repo, 'pir/old'), null);
  assert.equal(readRunBase(s.repo, 'pir/absent'), null);
});

test('slugTaken finds a plan committed on dev when base is dev, and ignores one only on main', (t) => {
  const s = scratchRepo({ branch: 'dev', files: { 'plans/on-dev/PROGRESS.md': '# Progress\n' } });
  t.after(s.cleanup);
  git(s.repo, ['checkout', '-q', '-b', 'main']);
  mkdirSync(join(s.repo, 'plans', 'on-main'), { recursive: true });
  writeFileSync(join(s.repo, 'plans', 'on-main', 'PROGRESS.md'), '# Progress\n');
  git(s.repo, ['add', '-A']);
  git(s.repo, ['commit', '-q', '-m', 'main plan']);
  assert.equal(slugTaken('on-dev', { root: s.repo, base: 'dev' }), 'base-plan');
  assert.equal(slugTaken('on-main', { root: s.repo, base: 'dev' }), null);
  assert.throws(() => slugTaken('on-dev', { root: s.repo }), /no base branch given/);
});

test('syncBase merges the given sha with the base-named message; a conflict is left in progress', (t) => {
  const s = devRepo(t);
  const f = openFeature('synced', { root: s.repo, base: 'dev', from: s.first });
  writeFileSync(join(f.path, 'mine.txt'), 'x\n');
  git(f.path, ['add', '-A']);
  git(f.path, ['commit', '-q', '-m', 'feature work']);
  assert.deepEqual(syncBase(f.path, { baseSha: s.tip, base: 'dev' }), { state: 'merged', baseSha: s.tip });
  assert.equal(out(f.path, ['log', '-1', '--format=%s']), 'sync dev into pir/synced');
  assert.equal(syncBase(f.path, { baseSha: s.tip, base: 'dev' }).state, 'up-to-date');
  assert.throws(() => syncBase(f.path, { baseSha: null, base: 'dev' }), /no commit of dev/);

  // A conflict: the base changes the file the feature changed.
  writeFileSync(join(f.path, 'README.md'), 'feature\n');
  git(f.path, ['commit', '-q', '-am', 'feature readme']);
  writeFileSync(join(s.repo, 'README.md'), 'dev\n');
  git(s.repo, ['commit', '-q', '-am', 'dev readme']);
  const devTip = shaOf(s.repo, 'dev');
  assert.deepEqual(syncBase(f.path, { baseSha: devTip, base: 'dev' }), { state: 'conflict', baseSha: devTip, files: ['README.md'] });
  assert.ok(git(f.path, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']).ok, 'left in progress');
});

test('baseContains is true when only the second ref contains the tip; baseTip reads a ref', (t) => {
  const s = devRepo(t);
  git(s.repo, ['branch', 'pir/merged', 'dev']);
  git(s.repo, ['branch', 'stale', s.first]);
  assert.equal(baseContains('pir/merged', { root: s.repo, refs: ['refs/heads/stale'] }), false);
  assert.equal(baseContains('pir/merged', { root: s.repo, refs: ['refs/heads/stale', 'refs/heads/dev'] }), true);
  assert.equal(baseContains('pir/merged', { root: s.repo, refs: [] }), false);
  assert.equal(baseTip({ root: s.repo, ref: 'refs/heads/dev' }), s.tip);
  assert.equal(baseTip({ root: s.repo, ref: 'refs/remotes/origin/dev' }), null);
});
