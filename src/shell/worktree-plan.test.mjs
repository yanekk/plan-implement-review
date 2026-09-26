// pir-plan-command T04 — the planning run's branch and worktree (openPlanBranch, slugTaken,
// renamePlanBranch), exercised against throwaway git repos under a temp dir. Never the real project.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git, openPlanBranch, slugTaken, renamePlanBranch } from './worktree.mjs';

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
  const r = openPlanBranch('plan-3f9a', { root: s.repo });
  assert.equal(r.branch, 'pir/plan-3f9a');
  assert.ok(r.path.endsWith(join('.claude', 'worktrees', 'pir-plan-3f9a')), r.path);
  assert.ok(existsSync(r.path));
  assert.equal(headOf(r.path), 'pir/plan-3f9a');
  assert.equal(shaOf(s.repo, 'pir/plan-3f9a'), shaOf(s.repo, 'main'), "cut at main's commit");
  assert.deepEqual(mainState(s.repo), before);
  assert.deepEqual(openPlanBranch('plan-3f9a', { root: s.repo }), r, 'a second call reuses both');
});

test('openPlanBranch: cuts from main even when the main checkout sits on another branch', (t) => {
  const s = scratchRepo();
  t.after(s.cleanup);
  git(s.repo, ['checkout', '-q', '-b', 'side']);
  writeFileSync(join(s.repo, 'side.txt'), 'side\n');
  git(s.repo, ['add', '-A']);
  git(s.repo, ['commit', '-q', '-m', 'side']);
  const before = mainState(s.repo);
  openPlanBranch('plan-0001', { root: s.repo });
  assert.equal(shaOf(s.repo, 'pir/plan-0001'), shaOf(s.repo, 'main'));
  assert.deepEqual(mainState(s.repo), before, 'the person stays on their own branch');
});

test('openPlanBranch: no main throws no-main and leaves the repo unchanged', (t) => {
  const s = scratchRepo({ branch: 'trunk' });
  t.after(s.cleanup);
  const before = { ...mainState(s.repo), refs: branches(s.repo), wts: worktreeList(s.repo) };
  assert.throws(() => openPlanBranch('plan-3f9a', { root: s.repo }), (e) => e.message === 'no-main' && e.code === 'no-main');
  assert.deepEqual({ ...mainState(s.repo), refs: branches(s.repo), wts: worktreeList(s.repo) }, before);
  assert.equal(existsSync(join(s.repo, '.claude')), false, 'no worktrees folder created');
});

test('slugTaken: branch, plan committed on main, index entry, and free', (t) => {
  const s = scratchRepo({ files: { 'plans/on-main/PROGRESS.md': '# Progress\n' } });
  t.after(s.cleanup);
  git(s.repo, ['branch', 'pir/has-branch', 'main']);
  const index = new Set(['in-index']);
  const indexHas = (slug) => index.has(slug);
  const opts = { root: s.repo, indexHas };
  const before = mainState(s.repo);
  assert.equal(slugTaken('has-branch', opts), 'branch');
  assert.equal(slugTaken('on-main', opts), 'main-plan');
  assert.equal(slugTaken('in-index', opts), 'index');
  assert.equal(slugTaken('free-name', opts), null);
  assert.equal(slugTaken('free-name', { root: s.repo }), null, 'indexHas defaults to empty');
  assert.deepEqual(mainState(s.repo), before);
});

test('slugTaken: a plan only on a side branch or only uncommitted on disk is not main-plan', (t) => {
  const s = scratchRepo();
  t.after(s.cleanup);
  mkdirSync(join(s.repo, 'plans', 'loose'), { recursive: true });
  writeFileSync(join(s.repo, 'plans', 'loose', 'PROGRESS.md'), '# Progress\n');
  assert.equal(slugTaken('loose', { root: s.repo }), null, 'uncommitted file is not a plan on main');
});

test('renamePlanBranch: moves branch and worktree; the worktree reports pir/{slug}', (t) => {
  const s = scratchRepo();
  t.after(s.cleanup);
  const before = mainState(s.repo);
  const opened = openPlanBranch('plan-3f9a', { root: s.repo });
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
  const opened = openPlanBranch('plan-3f9a', { root: s.repo });
  git(s.repo, ['branch', '-m', 'pir/plan-3f9a', 'pir/screen-time']); // crash after step 1
  const r = renamePlanBranch('plan-3f9a', 'screen-time', { root: s.repo });
  assert.deepEqual(r.done, { branch: false, worktree: true });
  assert.equal(headOf(r.path), 'pir/screen-time');
  assert.equal(existsSync(opened.path), false);
});

test('renamePlanBranch: re-run after both steps is a no-op', (t) => {
  const s = scratchRepo();
  t.after(s.cleanup);
  openPlanBranch('plan-3f9a', { root: s.repo });
  const first = renamePlanBranch('plan-3f9a', 'screen-time', { root: s.repo });
  const wts = worktreeList(s.repo);
  const again = renamePlanBranch('plan-3f9a', 'screen-time', { root: s.repo });
  assert.deepEqual(again, { ...first, done: { branch: false, worktree: false } });
  assert.equal(worktreeList(s.repo), wts);
});

test('renamePlanBranch: an existing target branch is refused and nothing moves', (t) => {
  const s = scratchRepo();
  t.after(s.cleanup);
  const opened = openPlanBranch('plan-3f9a', { root: s.repo });
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
  const opened = openPlanBranch('plan-3f9a', { root: s.repo });
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
  const opened = openPlanBranch('plan-3f9a', { root: s.repo });
  rmSync(opened.path, { recursive: true, force: true });
  const before = { refs: branches(s.repo), wts: worktreeList(s.repo) };
  assert.throws(() => renamePlanBranch('plan-3f9a', 'screen-time', { root: s.repo }), /missing/);
  assert.deepEqual({ refs: branches(s.repo), wts: worktreeList(s.repo) }, before);
  assert.equal(branchExists(s.repo, 'pir/plan-3f9a'), true);
});
