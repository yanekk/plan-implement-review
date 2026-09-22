// T06 — the real worktree.mjs, exercised against a throwaway git repo under a temp dir (the
// seatbelt: never the real project, no agent spawned). Every branch, worktree and merge here is
// genuine git, so the branch model of DESIGN §2.9 is proven for real, not asserted against a mock.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  git,
  openFeature,
  createTask,
  integrate,
  mergeTask,
  commitFeature,
  remove,
  taskBranchState,
  taskWorktreeHandle,
  createWorktree,
} from './worktree.mjs';
import { progressPathFor } from '../core/progress.mjs';
import { createFakeWorktree } from './fake/worktree.mjs';

// Every test here uses the plan 'demo', so PROGRESS.md lives at plans/demo/PROGRESS.md.
const SLUG = 'demo';
const PROGRESS_REL = progressPathFor(SLUG);

// A scratch repo with one commit on `main`, plus any extra files that later force merge conflicts.
function scratchRepo(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pir-t06-'));
  const repo = join(dir, 'repo');
  git(dir, ['init', '-b', 'main', 'repo']);
  git(repo, ['config', 'user.email', 't06@test.local']);
  git(repo, ['config', 'user.name', 'T06 Test']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  mkdirSync(join(repo, dirname(PROGRESS_REL)), { recursive: true });
  writeFileSync(join(repo, PROGRESS_REL), '# Progress\n\n| T01 | one | auto | — | ⬜ | |\n');
  for (const [p, content] of Object.entries(files)) writeFileSync(join(repo, p), content);
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-m', 'init', '--no-edit']);
  return { dir, repo, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const headOf = (cwd) => git(cwd, ['symbolic-ref', '--short', 'HEAD']).stdout.trim();
const branchExists = (repo, b) => git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${b}`]).ok;
const mainCommits = (repo) => Number(git(repo, ['rev-list', '--count', 'main']).stdout.trim());
const countWorktrees = (repo, branch) =>
  git(repo, ['worktree', 'list', '--porcelain']).stdout
    .split('\n\n')
    .filter((rec) => rec.split('\n').some((l) => l === `branch refs/heads/${branch}`)).length;

test('openFeature: branch off main, own worktree, checkout stays on main, second call reuses', (t) => {
  const s = scratchRepo();
  t.after(s.cleanup);
  const f = openFeature('demo', { root: s.repo });
  assert.equal(f.branch, 'pir/demo');
  assert.ok(existsSync(f.path), 'the feature worktree exists on disk');
  assert.equal(headOf(f.path), 'pir/demo', 'the worktree is on the feature branch');
  assert.equal(headOf(s.repo), 'main', "the user's main checkout was not switched");

  const again = openFeature('demo', { root: s.repo });
  assert.equal(again.path, f.path, 'a second call returns the same worktree');
  assert.equal(countWorktrees(s.repo, 'pir/demo'), 1, 'no duplicate feature worktree');
});

test('openFeature: a restart with the branch present but its worktree gone re-adds the worktree', (t) => {
  const s = scratchRepo();
  t.after(s.cleanup);
  const f = openFeature('demo', { root: s.repo });
  git(s.repo, ['worktree', 'remove', '--force', f.path]); // simulate a killed coordinator's leak
  assert.ok(branchExists(s.repo, 'pir/demo'), 'the branch survives');
  assert.equal(countWorktrees(s.repo, 'pir/demo'), 0, 'the worktree is gone');

  const reopened = openFeature('demo', { root: s.repo });
  assert.equal(reopened.branch, 'pir/demo');
  assert.ok(existsSync(reopened.path), 'the feature worktree is back');
  assert.equal(countWorktrees(s.repo, 'pir/demo'), 1);
});

test('createTask: worktree on pir/{plan}-T{nn} cut from the FEATURE branch, not main', (t) => {
  const s = scratchRepo();
  t.after(s.cleanup);
  const f = openFeature('demo', { root: s.repo });
  // A commit that exists only on the feature branch: if the task branch is cut from it, the file
  // is present in the task worktree; if cut from main, it is not.
  writeFileSync(join(f.path, 'feature-only.txt'), 'from the feature branch\n');
  git(f.path, ['add', '-A']);
  git(f.path, ['commit', '-m', 'feature-only commit', '--no-edit']);

  const w = createTask('demo', 'T01', { root: s.repo });
  assert.equal(w.branch, 'pir/demo-T01');
  assert.ok(existsSync(join(w.path, 'feature-only.txt')), 'the task branch carries the feature-only commit');
});

test('integrate: brings a diverged feature branch into the task branch cleanly', (t) => {
  const s = scratchRepo();
  t.after(s.cleanup);
  const f = openFeature('demo', { root: s.repo });
  const w = createTask('demo', 'T01', { root: s.repo });
  // The feature branch moves after the task branch was cut.
  writeFileSync(join(f.path, 'sibling.txt'), 'a sibling merged first\n');
  git(f.path, ['add', '-A']);
  git(f.path, ['commit', '-m', 'sibling work on feature', '--no-edit']);

  const res = integrate(w.path);
  assert.ok(res.ok, 'a clean integrate reports ok');
  assert.ok(existsSync(join(w.path, 'sibling.txt')), "the sibling's work is now in the task worktree");
});

test('integrate: reports the conflicting files and leaves the task worktree clean', (t) => {
  const s = scratchRepo({ 'shared.txt': 'base\n' });
  t.after(s.cleanup);
  const f = openFeature('demo', { root: s.repo });
  const w = createTask('demo', 'T01', { root: s.repo });
  // Both the feature branch and the task branch edit the same line of the same file.
  writeFileSync(join(f.path, 'shared.txt'), 'feature version\n');
  git(f.path, ['commit', '-am', 'feature edits shared', '--no-edit']);
  writeFileSync(join(w.path, 'shared.txt'), 'task version\n');
  git(w.path, ['commit', '-am', 'task edits shared', '--no-edit']);

  const res = integrate(w.path);
  assert.ok(res.conflict, 'the integrate conflicts');
  assert.ok(res.files.includes('shared.txt'), 'the conflicting file is named');
  assert.equal(git(w.path, ['status', '--porcelain']).stdout.trim(), '', 'the merge was aborted; the worktree is clean');
});

test('mergeTask: a clean task branch lands on the feature branch and main does not move', (t) => {
  const s = scratchRepo();
  t.after(s.cleanup);
  const f = openFeature('demo', { root: s.repo });
  const w = createTask('demo', 'T01', { root: s.repo });
  writeFileSync(join(w.path, 'work-T01.txt'), 'work\n');
  git(w.path, ['add', '-A']);
  git(w.path, ['commit', '-m', 'T01 work', '--no-edit']);
  assert.equal(mainCommits(s.repo), 1);

  const res = mergeTask(w.branch, { root: s.repo });
  assert.ok(res.ok);
  assert.equal(mainCommits(s.repo), 1, 'main did not move on a task merge');
  assert.ok(git(s.repo, ['show', 'pir/demo:work-T01.txt']).ok, 'the work reached the feature branch');
});

test("mergeTask: keeps the feature's PROGRESS.md and drops the task branch's row edit (DESIGN §2.5)", (t) => {
  const s = scratchRepo();
  t.after(s.cleanup);
  const f = openFeature('demo', { root: s.repo });
  const w = createTask('demo', 'T01', { root: s.repo });
  writeFileSync(join(w.path, PROGRESS_REL), '# Progress\n\n| T01 | one | auto | — | ✅ | worker wrote this |\n');
  writeFileSync(join(w.path, 'work-T01.txt'), 'work\n');
  git(w.path, ['add', '-A']);
  git(w.path, ['commit', '-m', 'T01 sets its own row', '--no-edit']);

  mergeTask(w.branch, { root: s.repo });
  const featureProgress = git(s.repo, ['show', `pir/demo:${PROGRESS_REL}`]).stdout;
  assert.ok(featureProgress.includes('⬜'), "the feature's PROGRESS.md is unchanged; only reconcile edits it");
  assert.ok(!featureProgress.includes('worker wrote this'), "the task branch's row edit did not win");
});

test('mergeTask: reports a real code conflict without touching main', (t) => {
  const s = scratchRepo({ 'shared.txt': 'base\n' });
  t.after(s.cleanup);
  const f = openFeature('demo', { root: s.repo });
  const t1 = createTask('demo', 'T01', { root: s.repo });
  const t2 = createTask('demo', 'T02', { root: s.repo });
  writeFileSync(join(t1.path, 'shared.txt'), 'from T01\n');
  git(t1.path, ['commit', '-am', 'T01 edits shared', '--no-edit']);
  writeFileSync(join(t2.path, 'shared.txt'), 'from T02\n');
  git(t2.path, ['commit', '-am', 'T02 edits shared', '--no-edit']);

  assert.ok(mergeTask(t1.branch, { root: s.repo }).ok);
  const res = mergeTask(t2.branch, { root: s.repo });
  assert.ok(res.conflict, 'the second merge conflicts on the shared file');
  assert.ok(res.files.includes('shared.txt'));
  assert.equal(git(f.path, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']).ok, false, 'no merge is left in progress on the feature branch');
  assert.equal(git(f.path, ['status', '--porcelain']).stdout.trim(), '', 'the feature worktree is clean after abort');
  assert.equal(mainCommits(s.repo), 1, 'a conflict never reaches main');
});

test('two mergeTask calls run one after another, both landing on the feature branch', (t) => {
  const s = scratchRepo();
  t.after(s.cleanup);
  openFeature('demo', { root: s.repo });
  const t1 = createTask('demo', 'T01', { root: s.repo });
  const t2 = createTask('demo', 'T02', { root: s.repo });
  writeFileSync(join(t1.path, 'a.txt'), 'a\n');
  git(t1.path, ['add', '-A']);
  git(t1.path, ['commit', '-m', 'T01', '--no-edit']);
  writeFileSync(join(t2.path, 'b.txt'), 'b\n');
  git(t2.path, ['add', '-A']);
  git(t2.path, ['commit', '-m', 'T02', '--no-edit']);

  // The caller serializes; a second merge starts only after the first returns.
  assert.ok(mergeTask(t1.branch, { root: s.repo }).ok);
  assert.ok(mergeTask(t2.branch, { root: s.repo }).ok);
  assert.ok(git(s.repo, ['show', 'pir/demo:a.txt']).ok, "T01's work is on the feature branch");
  assert.ok(git(s.repo, ['show', 'pir/demo:b.txt']).ok, "T02's work is on the feature branch");
});

test('the plan assembles on the feature branch and main is never touched — there is no promote (DESIGN §2.4)', (t) => {
  const s = scratchRepo();
  t.after(s.cleanup);
  openFeature('demo', { root: s.repo });
  const w = createTask('demo', 'T01', { root: s.repo });
  writeFileSync(join(w.path, 'work-T01.txt'), 'work\n');
  git(w.path, ['add', '-A']);
  git(w.path, ['commit', '-m', 'T01', '--no-edit']);
  mergeTask(w.branch, { root: s.repo });

  assert.ok(git(s.repo, ['show', 'pir/demo:work-T01.txt']).ok, 'the work is assembled on the feature branch');
  assert.equal(mainCommits(s.repo), 1, 'main is untouched — the run never merges to main');
  assert.ok(!git(s.repo, ['show', 'main:work-T01.txt']).ok, 'the work never reaches main; the person merges pir/demo by hand');
  assert.equal(headOf(s.repo), 'main', 'the checkout stays on main throughout');
});

test('remove: deletes the worktree and branch, including one with uncommitted changes', (t) => {
  const s = scratchRepo();
  t.after(s.cleanup);
  openFeature('demo', { root: s.repo });
  const w = createTask('demo', 'T01', { root: s.repo });
  writeFileSync(join(w.path, 'dirty.txt'), 'uncommitted, simulating an abandoned worker\n');
  assert.ok(branchExists(s.repo, 'pir/demo-T01'));

  remove(w, { root: s.repo });
  assert.ok(!existsSync(w.path), 'the worktree directory is gone despite being dirty');
  assert.ok(!branchExists(s.repo, 'pir/demo-T01'), 'the task branch is gone');
});

test('remove: tears down a LOCKED worktree, the state claude rm cannot clear (FINDINGS)', (t) => {
  const s = scratchRepo();
  t.after(s.cleanup);
  openFeature('demo', { root: s.repo });
  const w = createTask('demo', 'T01', { root: s.repo });
  // A locked worktree is the abandoned-worker case remove must recover from; git refuses a single
  // --force on it ("cannot remove a locked working tree"). This test fails if remove drops to one.
  git(s.repo, ['worktree', 'lock', w.path]);

  remove(w, { root: s.repo });
  assert.ok(!existsSync(w.path), 'the locked worktree directory is gone');
  assert.ok(!branchExists(s.repo, 'pir/demo-T01'), 'the task branch is gone');
});

test('createWorktree factory: drives the loop path open → create → merge → commitFeature → remove; main untouched', (t) => {
  const s = scratchRepo();
  t.after(s.cleanup);
  const wt = createWorktree({ root: s.repo });
  const f = wt.openFeature('demo');
  const w = wt.createTask('demo', 'T01');
  writeFileSync(join(w.path, 'work-T01.txt'), 'work\n');
  git(w.path, ['add', '-A']);
  git(w.path, ['commit', '-m', 'T01', '--no-edit']);

  assert.ok(wt.mergeTask(w.branch).ok);
  // commitFeature takes only a message (the loop's call); the factory remembers f.path.
  writeFileSync(join(f.path, PROGRESS_REL), '# Progress\n\n| T01 | one | auto | — | ✅ | reconciled |\n');
  assert.ok(wt.commitFeature('reconcile T01 → ✅').ok);
  assert.ok(git(s.repo, ['show', `pir/demo:${PROGRESS_REL}`]).stdout.includes('reconciled'), 'the reconcile commit is on the feature branch');

  // The whole plan is assembled on the feature branch; the run hands it off there (DESIGN §2.4). There is
  // no promote() — main is never touched, and the factory exposes no promote method.
  assert.ok(git(s.repo, ['show', 'pir/demo:work-T01.txt']).ok, 'the whole plan is assembled on the feature branch');
  assert.equal(mainCommits(s.repo), 1, 'main is untouched — the person merges pir/demo by hand');
  assert.equal(wt.promote, undefined, 'the factory no longer exposes promote()');
  wt.remove(w);
  assert.ok(!branchExists(s.repo, 'pir/demo-T01'));
});

test('commitFeature: without a feature worktree it refuses rather than guessing', () => {
  assert.throws(() => commitFeature({ root: process.cwd(), message: 'x' }), /no feature worktree/);
});

// --- T02: reading a task branch's committed state (DESIGN §2.2) ---

// A full task-table PROGRESS.md carrying one row at a given glyph. The scratchRepo seed above has no
// header/separator, so a taskBranchState test writes a real table onto the branch first.
function progressWith(num, state) {
  return [
    '# Progress',
    '',
    '| # | Task | Runs | Depends on | State | Notes |',
    '|---|---|---|---|---|---|',
    `| ${num} | one | auto | — | ${state} | |`,
    '',
  ].join('\n');
}

// Commit a full-table PROGRESS.md onto an existing task worktree, the row set to `state`.
function commitRow(path, num, state) {
  writeFileSync(join(path, PROGRESS_REL), progressWith(num, state));
  git(path, ['add', '-A']);
  git(path, ['commit', '-m', `${num} row ${state}`, '--no-edit']);
}

test('taskBranchState returns the committed glyph for 🔍/✅/🟡/⬜ branches', (t) => {
  const s = scratchRepo();
  t.after(s.cleanup);
  openFeature('demo', { root: s.repo });
  const cases = [['T01', '🔍'], ['T02', '✅'], ['T03', '🟡'], ['T04', '⬜']];
  for (const [num, glyph] of cases) commitRow(createTask('demo', num, { root: s.repo }).path, num, glyph);
  for (const [num, glyph] of cases) {
    assert.equal(taskBranchState('demo', num, { root: s.repo }), glyph, `${num} reads back ${glyph}`);
  }
});

test('taskBranchState: a task number with no branch at all → null, no throw', (t) => {
  const s = scratchRepo();
  t.after(s.cleanup);
  openFeature('demo', { root: s.repo });
  assert.equal(taskBranchState('demo', 'T99', { root: s.repo }), null);
});

test('taskBranchState: a branch that exists but has no PROGRESS.md on it → null', (t) => {
  const s = scratchRepo();
  t.after(s.cleanup);
  openFeature('demo', { root: s.repo });
  const w = createTask('demo', 'T01', { root: s.repo });
  rmSync(join(w.path, PROGRESS_REL));
  git(w.path, ['add', '-A']);
  git(w.path, ['commit', '-m', 'drop progress', '--no-edit']);
  assert.equal(taskBranchState('demo', 'T01', { root: s.repo }), null);
});

test('taskBranchState: a table with no row for that task number → null', (t) => {
  const s = scratchRepo();
  t.after(s.cleanup);
  openFeature('demo', { root: s.repo });
  const w = createTask('demo', 'T01', { root: s.repo });
  commitRow(w.path, 'T02', '🔍'); // the table lists T02, we ask about T01
  assert.equal(taskBranchState('demo', 'T01', { root: s.repo }), null);
});

test('taskWorktreeHandle returns { path, branch } for a checked-out task, null when none is registered', (t) => {
  const s = scratchRepo();
  t.after(s.cleanup);
  openFeature('demo', { root: s.repo });
  assert.equal(taskWorktreeHandle('demo', 'T01', { root: s.repo }), null);
  const w = createTask('demo', 'T01', { root: s.repo });
  const h = taskWorktreeHandle('demo', 'T01', { root: s.repo });
  assert.equal(h.branch, 'pir/demo-T01');
  assert.equal(realpathSync(h.path), realpathSync(w.path));
});

test('taskBranchState reads without modifying the branch tip or the worktree', (t) => {
  const s = scratchRepo();
  t.after(s.cleanup);
  openFeature('demo', { root: s.repo });
  const w = createTask('demo', 'T01', { root: s.repo });
  commitRow(w.path, 'T01', '🔍');
  const tipBefore = git(s.repo, ['rev-parse', 'pir/demo-T01']).stdout.trim();
  const statusBefore = git(w.path, ['status', '--porcelain']).stdout;

  taskBranchState('demo', 'T01', { root: s.repo });
  assert.equal(git(s.repo, ['rev-parse', 'pir/demo-T01']).stdout.trim(), tipBefore, 'branch tip unchanged');
  assert.equal(git(w.path, ['status', '--porcelain']).stdout, statusBefore, 'worktree unchanged');
});

// --- T01: mergeTask adopts a merging branch's new task rows (DESIGN §2.2, §3.1) ---
//
// A real multi-row table with single-line fields, so adoptNewTaskRows can locate it and so a test can
// prove those fields survive a merge. The scratchRepo seed above is deliberately headerless (no table
// to adopt into), which is why the pre-T01 mergeTask tests are a no-op for adoption and still pass.
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

// Seed the feature branch with a full task table, then cut a task branch from it, so both start from
// ADOPT_TABLE. Returns the created task worktree/branch. The task branch then commits whatever the
// scenario needs before mergeTask folds it back.
function featureWithTable(repo, task = 'T02') {
  const f = openFeature('demo', { root: repo });
  writeFileSync(join(f.path, PROGRESS_REL), ADOPT_TABLE);
  git(f.path, ['add', '-A']);
  git(f.path, ['commit', '-m', 'seed full table', '--no-edit']);
  return { f, w: createTask('demo', task, { root: repo }) };
}

test('mergeTask adopts a branch-added new task row as ⬜; added names it (T01)', (t) => {
  const s = scratchRepo();
  t.after(s.cleanup);
  const { w } = featureWithTable(s.repo);
  // The worker added T03 (deps T01) to its own PROGRESS.md and did some code work.
  const branchProgress = ADOPT_TABLE.replace(
    '| T02 | two | T01 | ⬜ | |\n',
    '| T02 | two | T01 | 🔍 | building |\n| T03 | three | T01 | ⬜ | a new task |\n',
  );
  writeFileSync(join(w.path, PROGRESS_REL), branchProgress);
  writeFileSync(join(w.path, 'work.txt'), 'x\n');
  git(w.path, ['add', '-A']);
  git(w.path, ['commit', '-m', 'T02 work + adds T03', '--no-edit']);

  const res = mergeTask(w.branch, { root: s.repo });
  assert.deepEqual(res.added, ['T03'], 'T03 adopted');
  assert.deepEqual(res.errors, []);
  const featureProgress = git(s.repo, ['show', `pir/demo:${PROGRESS_REL}`]).stdout;
  assert.match(featureProgress, /\| T03 \| three \| T01 \| ⬜ \|/, 'T03 landed on the feature branch as ⬜');
  assert.ok(git(s.repo, ['show', 'pir/demo:work.txt']).ok, 'the code work reached the feature branch');
});

test("mergeTask leaves the feature's existing rows and single-line fields byte-identical when it adopts", (t) => {
  const s = scratchRepo();
  t.after(s.cleanup);
  const { w } = featureWithTable(s.repo);
  const branchProgress = ADOPT_TABLE.replace(
    '| T02 | two | T01 | ⬜ | |\n',
    '| T02 | two | T01 | ✅ | done |\n| T03 | three | — | ⬜ | |\n',
  );
  writeFileSync(join(w.path, PROGRESS_REL), branchProgress);
  git(w.path, ['add', '-A']);
  git(w.path, ['commit', '-m', 'adds T03, marks its own row', '--no-edit']);

  mergeTask(w.branch, { root: s.repo });
  const featureProgress = git(s.repo, ['show', `pir/demo:${PROGRESS_REL}`]).stdout;
  assert.ok(featureProgress.includes('**Status:** building'), 'Status field kept');
  assert.ok(featureProgress.includes('**Next pir-work will:** implement T02'), 'Next field kept');
  assert.ok(featureProgress.includes('**Review queue:** empty'), 'Review queue kept');
  assert.ok(featureProgress.includes('| T02 | two | T01 | ⬜ | |'), "T02 kept the feature's ⬜, not the branch's ✅");
});

test('mergeTask on a branch with no plan change adopts nothing (added empty), feature PROGRESS unchanged', (t) => {
  const s = scratchRepo();
  t.after(s.cleanup);
  const { f, w } = featureWithTable(s.repo);
  const before = git(s.repo, ['show', `pir/demo:${PROGRESS_REL}`]).stdout;
  // Only code, PROGRESS untouched on the branch.
  writeFileSync(join(w.path, 'work.txt'), 'x\n');
  git(w.path, ['add', '-A']);
  git(w.path, ['commit', '-m', 'T02 code only', '--no-edit']);

  const res = mergeTask(w.branch, { root: s.repo });
  assert.deepEqual(res.added, []);
  assert.deepEqual(res.errors, []);
  assert.equal(git(s.repo, ['show', `pir/demo:${PROGRESS_REL}`]).stdout, before, 'feature PROGRESS byte-identical');
});

test('mergeTask on a branch that edits an existing row still merges the code, returns errors, feature PROGRESS unchanged', (t) => {
  const s = scratchRepo();
  t.after(s.cleanup);
  const { w } = featureWithTable(s.repo);
  const before = git(s.repo, ['show', `pir/demo:${PROGRESS_REL}`]).stdout;
  // Forbidden edit: change T01's deps (— → T02). Plus real code so the merge lands.
  const branchProgress = ADOPT_TABLE.replace('| T01 | one | — | ⬜ | |', '| T01 | one | T02 | ⬜ | |');
  writeFileSync(join(w.path, PROGRESS_REL), branchProgress);
  writeFileSync(join(w.path, 'work.txt'), 'x\n');
  git(w.path, ['add', '-A']);
  git(w.path, ['commit', '-m', 'edits T01 deps', '--no-edit']);

  const res = mergeTask(w.branch, { root: s.repo });
  assert.ok(res.ok, 'the merge still lands');
  assert.equal(res.added.length, 0, 'nothing adopted');
  assert.ok(res.errors.length > 0, 'the forbidden edit is reported');
  assert.ok(git(s.repo, ['show', 'pir/demo:work.txt']).ok, 'the code still merged');
  assert.equal(git(s.repo, ['show', `pir/demo:${PROGRESS_REL}`]).stdout, before, 'feature PROGRESS byte-identical');
});

test('mergeTask: a non-PROGRESS.md code conflict still returns { conflict, files } and leaves the feature branch clean', (t) => {
  const s = scratchRepo({ 'shared.txt': 'base\n' });
  t.after(s.cleanup);
  const f = openFeature('demo', { root: s.repo });
  const t1 = createTask('demo', 'T01', { root: s.repo });
  const t2 = createTask('demo', 'T02', { root: s.repo });
  writeFileSync(join(t1.path, 'shared.txt'), 'from T01\n');
  git(t1.path, ['commit', '-am', 'T01 edits shared', '--no-edit']);
  writeFileSync(join(t2.path, 'shared.txt'), 'from T02\n');
  git(t2.path, ['commit', '-am', 'T02 edits shared', '--no-edit']);

  assert.ok(mergeTask(t1.branch, { root: s.repo }).ok);
  const res = mergeTask(t2.branch, { root: s.repo });
  assert.ok(res.conflict, 'the second merge conflicts on the shared file');
  assert.ok(res.files.includes('shared.txt'));
  assert.equal(git(f.path, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']).ok, false, 'no merge left in progress');
  assert.equal(git(f.path, ['status', '--porcelain']).stdout.trim(), '', 'the feature worktree is clean after abort');
});

test('the real worktree.mjs and the fake adopt identically on the same scratch inputs (T03)', (t) => {
  // Same feature table, same branch-added T03 on both surfaces → same added/errors and same adopted
  // PROGRESS.md, so the fake the loop is proven against matches the module the run actually uses.
  const branchProgress = ADOPT_TABLE.replace(
    '| T02 | two | T01 | ⬜ | |\n',
    '| T02 | two | T01 | 🔍 | building |\n| T03 | three | T01 | ⬜ | a new task |\n',
  );

  // Real.
  const s = scratchRepo();
  t.after(s.cleanup);
  const { w } = featureWithTable(s.repo);
  writeFileSync(join(w.path, PROGRESS_REL), branchProgress);
  writeFileSync(join(w.path, 'work.txt'), 'x\n');
  git(w.path, ['add', '-A']);
  git(w.path, ['commit', '-m', 'adds T03', '--no-edit']);
  const realRes = mergeTask(w.branch, { root: s.repo });
  const realProgress = git(s.repo, ['show', `pir/demo:${PROGRESS_REL}`]).stdout;

  // Fake.
  const wt = createFakeWorktree({ progress: ADOPT_TABLE });
  t.after(() => wt.cleanup());
  const feature = wt.openFeature('demo');
  const task = wt.createTask('demo', 'T02');
  writeFileSync(join(task.path, PROGRESS_REL), branchProgress);
  writeFileSync(join(task.path, 'work.txt'), 'x\n');
  git(task.path, ['add', '-A']);
  git(task.path, ['commit', '-m', 'adds T03', '--no-edit']);
  const fakeRes = wt.mergeTask(task.branch);
  const fakeProgress = readFileSync(join(feature.path, PROGRESS_REL), 'utf8');

  assert.deepEqual(realRes.added, fakeRes.added, 'same rows adopted');
  assert.deepEqual(realRes.errors, fakeRes.errors, 'same errors');
  assert.deepEqual(realRes.added, ['T03']);
  assert.equal(realProgress, fakeProgress, 'the adopted feature PROGRESS.md is byte-identical');
});
