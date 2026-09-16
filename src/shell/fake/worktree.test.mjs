import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFakeWorktree, git } from './worktree.mjs';
import { reconcileTaskRow, progressPathFor } from '../../core/progress.mjs';

const SLUG = 'demo';

const PROGRESS = [
  '# Progress',
  '',
  '**Plan reviewed:** 2026-09-08 — reviewed',
  '',
  '| # | Task | Runs | Depends on | State | Notes |',
  '|---|---|---|---|---|---|',
  '| T01 | one | auto | — | ⬜ | |',
  '| T02 | two | auto | — | ⬜ | |',
  '',
].join('\n');

// Commit a code file and a PROGRESS row edit on a task worktree, the way a worker does.
function workerCommit(path, num, state) {
  writeFileSync(join(path, `work-${num}.txt`), `work ${num}\n`);
  const p = join(path, progressPathFor(SLUG));
  writeFileSync(p, reconcileTaskRow(readFileSync(p, 'utf8'), { num, state, notes: 'done' }));
  git(path, ['add', '-A']);
  git(path, ['commit', '-m', `${num}: work`, '--no-edit']);
}

test('openFeature branches from main; createTask branches from the feature branch', (t) => {
  const wt = createFakeWorktree({ progress: PROGRESS });
  t.after(() => wt.cleanup());
  const feature = wt.openFeature('demo');
  assert.equal(feature.branch, 'pir/demo');
  const task = wt.createTask('demo', 'T01');
  assert.equal(task.branch, 'pir/demo-T01');
  assert.ok(wt.branchExists('pir/demo'));
  assert.ok(wt.branchExists('pir/demo-T01'));
  const cut = wt.events.find((e) => e.op === 'createTask');
  assert.equal(cut.from, 'pir/demo');
});

test('a task branch merges into the feature branch and leaves main untouched', (t) => {
  const wt = createFakeWorktree({ progress: PROGRESS });
  t.after(() => wt.cleanup());
  wt.openFeature('demo');
  const task = wt.createTask('demo', 'T01');
  workerCommit(task.path, 'T01', '✅');
  assert.equal(wt.mainCommitCount(), 1);

  const res = wt.mergeTask(task.branch);
  assert.ok(res.ok);
  assert.equal(wt.mainCommitCount(), 1, 'main did not move on a task merge');
  assert.ok(wt.fileOn('pir/demo', 'work-T01.txt').ok, 'the code file reached the feature branch');
});

test("mergeTask keeps the feature's PROGRESS.md and drops the task branch's row edit (DESIGN §2.5)", (t) => {
  const wt = createFakeWorktree({ progress: PROGRESS });
  t.after(() => wt.cleanup());
  const feature = wt.openFeature('demo');
  const task = wt.createTask('demo', 'T01');
  workerCommit(task.path, 'T01', '✅'); // the worker set its row ✅ on the task branch

  wt.mergeTask(task.branch);
  const featureProgress = readFileSync(join(feature.path, progressPathFor(SLUG)), 'utf8');
  assert.ok(featureProgress.includes('| T01 | one | auto | — | ⬜ |'), 'the feature row is still ⬜; only reconcile changes it');
});

test('promote merges the feature branch to main exactly once', (t) => {
  const wt = createFakeWorktree({ progress: PROGRESS });
  t.after(() => wt.cleanup());
  const feature = wt.openFeature('demo');
  const task = wt.createTask('demo', 'T01');
  workerCommit(task.path, 'T01', '✅');
  wt.mergeTask(task.branch);
  assert.equal(wt.mainCommitCount(), 1);

  const res = wt.promote('demo');
  assert.ok(res.ok);
  assert.ok(wt.mainCommitCount() > 1, 'main moved at promotion');
  assert.ok(wt.fileOn('main', 'work-T01.txt').ok, 'promoted work is on main');
});

test('mergeTask reports a real code conflict without touching main', (t) => {
  // Both tasks rewrite the same shared file, so the second merge conflicts on it.
  const wt = createFakeWorktree({ progress: PROGRESS, files: { 'shared.txt': 'base\n' } });
  t.after(() => wt.cleanup());
  wt.openFeature('demo');
  const t1 = wt.createTask('demo', 'T01');
  const t2 = wt.createTask('demo', 'T02');

  writeFileSync(join(t1.path, 'shared.txt'), 'from T01\n');
  git(t1.path, ['commit', '-am', 'T01 edits shared', '--no-edit']);
  writeFileSync(join(t2.path, 'shared.txt'), 'from T02\n');
  git(t2.path, ['commit', '-am', 'T02 edits shared', '--no-edit']);

  assert.ok(wt.mergeTask(t1.branch).ok);
  const res = wt.mergeTask(t2.branch);
  assert.ok(res.conflict, 'the second merge conflicts on the shared file');
  assert.ok(res.files.includes('shared.txt'));
  assert.equal(wt.mainCommitCount(), 1, 'a conflict never reaches main');
});

test('remove tears down a worktree and its branch', (t) => {
  const wt = createFakeWorktree({ progress: PROGRESS });
  t.after(() => wt.cleanup());
  wt.openFeature('demo');
  const task = wt.createTask('demo', 'T01');
  assert.ok(wt.branchExists('pir/demo-T01'));
  wt.remove(task);
  assert.ok(!wt.branchExists('pir/demo-T01'), 'the task branch is gone');
});
