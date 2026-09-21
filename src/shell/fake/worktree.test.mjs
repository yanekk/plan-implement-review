import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
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

// --- T02: reading a task branch's committed state (DESIGN §2.2) ---

test('taskBranchState reads the glyphs a worker committed on its branch: 🔍 from implement, ✅ from review', (t) => {
  const wt = createFakeWorktree({ progress: PROGRESS });
  t.after(() => wt.cleanup());
  wt.openFeature('demo');
  const task = wt.createTask('demo', 'T01');
  workerCommit(task.path, 'T01', '🔍'); // an auto implement hands off at 🔍
  assert.equal(wt.taskBranchState('demo', 'T01'), '🔍');

  // review advances the same branch to ✅, the way pir-review commits it
  const p = join(task.path, progressPathFor(SLUG));
  writeFileSync(p, reconcileTaskRow(readFileSync(p, 'utf8'), { num: 'T01', state: '✅', notes: 'reviewed' }));
  git(task.path, ['add', '-A']);
  git(task.path, ['commit', '-m', 'T01 review: clean', '--no-edit']);
  assert.equal(wt.taskBranchState('demo', 'T01'), '✅');
});

test('taskBranchState returns null for a branch that does not exist', (t) => {
  const wt = createFakeWorktree({ progress: PROGRESS });
  t.after(() => wt.cleanup());
  wt.openFeature('demo');
  assert.equal(wt.taskBranchState('demo', 'T99'), null);
});

test('taskWorktreeHandle returns the handle for a checked-out task, null before it is created', (t) => {
  const wt = createFakeWorktree({ progress: PROGRESS });
  t.after(() => wt.cleanup());
  wt.openFeature('demo');
  assert.equal(wt.taskWorktreeHandle('demo', 'T01'), null);
  const task = wt.createTask('demo', 'T01');
  const h = wt.taskWorktreeHandle('demo', 'T01');
  assert.equal(h.branch, 'pir/demo-T01');
  assert.equal(realpathSync(h.path), realpathSync(task.path));
});

// --- T01: the fake mergeTask adopts new task rows, matching the real worktree.mjs (DESIGN §2.2) ---
//
// A full multi-row table with single-line fields, seeded on main so both feature and task branches
// start from it. The PROGRESS constant above has no Depends-on column and a Runs column; this one
// carries the columns adoptNewTaskRows reads, to prove adoption and that the fields survive a merge.
// Kept byte-identical to ADOPT_TABLE in ../worktree.test.mjs so the real/fake cross-check compares
// the same inputs.
const ADOPT_TABLE = [
  '# Progress',
  '',
  '**Status:** building',
  '**Next pir-work will:** implement T02',
  '',
  '| # | Task | Depends on | State | Notes |',
  '|---|---|---|---|---|',
  '| T01 | one | — | ⬜ | |',
  '| T02 | two | T01 | ⬜ | |',
  '',
  '**Review queue:** empty',
  '',
].join('\n');

test('fake mergeTask adopts a branch-added new task row as ⬜ and keeps the feature fields', (t) => {
  const wt = createFakeWorktree({ progress: ADOPT_TABLE });
  t.after(() => wt.cleanup());
  const feature = wt.openFeature('demo');
  const task = wt.createTask('demo', 'T02');
  // The worker marked its own row and added T03 (deps T01), plus code.
  const branchProgress = ADOPT_TABLE.replace(
    '| T02 | two | T01 | ⬜ | |\n',
    '| T02 | two | T01 | 🔍 | building |\n| T03 | three | T01 | ⬜ | a new task |\n',
  );
  writeFileSync(join(task.path, progressPathFor(SLUG)), branchProgress);
  writeFileSync(join(task.path, 'work.txt'), 'x\n');
  git(task.path, ['add', '-A']);
  git(task.path, ['commit', '-m', 'T02 work + adds T03', '--no-edit']);

  const res = wt.mergeTask(task.branch);
  assert.deepEqual(res.added, ['T03']);
  assert.deepEqual(res.errors, []);
  const featureProgress = readFileSync(join(feature.path, progressPathFor(SLUG)), 'utf8');
  assert.match(featureProgress, /\| T03 \| three \| T01 \| ⬜ \|/, 'T03 landed as ⬜');
  assert.ok(featureProgress.includes('| T02 | two | T01 | ⬜ | |'), "T02 kept the feature's ⬜, not the branch's 🔍");
  assert.ok(featureProgress.includes('**Status:** building'), 'single-line fields kept');
});

test('fake mergeTask on a forbidden edit merges the code, returns errors, and leaves the feature table unchanged', (t) => {
  const wt = createFakeWorktree({ progress: ADOPT_TABLE });
  t.after(() => wt.cleanup());
  const feature = wt.openFeature('demo');
  const task = wt.createTask('demo', 'T02');
  const before = readFileSync(join(feature.path, progressPathFor(SLUG)), 'utf8');
  const branchProgress = ADOPT_TABLE.replace('| T01 | one | — | ⬜ | |', '| T01 | one | T02 | ⬜ | |');
  writeFileSync(join(task.path, progressPathFor(SLUG)), branchProgress);
  writeFileSync(join(task.path, 'work.txt'), 'x\n');
  git(task.path, ['add', '-A']);
  git(task.path, ['commit', '-m', 'edits T01 deps', '--no-edit']);

  const res = wt.mergeTask(task.branch);
  assert.ok(res.ok);
  assert.deepEqual(res.added, []);
  assert.ok(res.errors.length > 0, 'the forbidden edit is reported');
  assert.equal(readFileSync(join(feature.path, progressPathFor(SLUG)), 'utf8'), before, 'feature table byte-identical');
  assert.ok(wt.fileOn('pir/demo', 'work.txt').ok, 'the code still merged');
});
