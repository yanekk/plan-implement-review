// T06 — the real worktree.mjs, exercised against a throwaway git repo under a temp dir (the
// seatbelt: never the real project, no agent spawned). Every branch, worktree and merge here is
// genuine git, so the branch model of DESIGN §2.9 is proven for real, not asserted against a mock.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  git,
  openFeature,
  createTask,
  integrate,
  mergeTask,
  commitFeature,
  promote,
  remove,
  createWorktree,
} from './worktree.mjs';

// A scratch repo with one commit on `main`, plus any extra files that later force merge conflicts.
function scratchRepo(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pir-t06-'));
  const repo = join(dir, 'repo');
  git(dir, ['init', '-b', 'main', 'repo']);
  git(repo, ['config', 'user.email', 't06@test.local']);
  git(repo, ['config', 'user.name', 'T06 Test']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(repo, 'PROGRESS.md'), '# Progress\n\n| T01 | one | auto | — | ⬜ | |\n');
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
  writeFileSync(join(w.path, 'PROGRESS.md'), '# Progress\n\n| T01 | one | auto | — | ✅ | worker wrote this |\n');
  writeFileSync(join(w.path, 'work-T01.txt'), 'work\n');
  git(w.path, ['add', '-A']);
  git(w.path, ['commit', '-m', 'T01 sets its own row', '--no-edit']);

  mergeTask(w.branch, { root: s.repo });
  const featureProgress = git(s.repo, ['show', 'pir/demo:PROGRESS.md']).stdout;
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

test('promote: merges the feature branch to main exactly once, and not before', (t) => {
  const s = scratchRepo();
  t.after(s.cleanup);
  openFeature('demo', { root: s.repo });
  const w = createTask('demo', 'T01', { root: s.repo });
  writeFileSync(join(w.path, 'work-T01.txt'), 'work\n');
  git(w.path, ['add', '-A']);
  git(w.path, ['commit', '-m', 'T01', '--no-edit']);
  mergeTask(w.branch, { root: s.repo });
  assert.equal(mainCommits(s.repo), 1, 'main is untouched until promote');
  assert.ok(!git(s.repo, ['show', 'main:work-T01.txt']).ok, 'the work is not on main yet');

  const res = promote('demo', { root: s.repo });
  assert.ok(res.ok);
  assert.ok(mainCommits(s.repo) > 1, 'main moved at promotion');
  assert.ok(git(s.repo, ['show', 'main:work-T01.txt']).ok, 'promoted work is on main');
  assert.equal(headOf(s.repo), 'main', 'the checkout is still on main after promotion');
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

test('createWorktree factory: drives the loop path open → create → merge → commitFeature → promote', (t) => {
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
  writeFileSync(join(f.path, 'PROGRESS.md'), '# Progress\n\n| T01 | one | auto | — | ✅ | reconciled |\n');
  assert.ok(wt.commitFeature('reconcile T01 → ✅').ok);
  assert.ok(git(s.repo, ['show', 'pir/demo:PROGRESS.md']).stdout.includes('reconciled'), 'the reconcile commit is on the feature branch');

  assert.ok(wt.promote('demo').ok);
  assert.ok(git(s.repo, ['show', 'main:work-T01.txt']).ok, 'the whole plan reached main in one promotion');
  wt.remove(w);
  assert.ok(!branchExists(s.repo, 'pir/demo-T01'));
});

test('commitFeature: without a feature worktree it refuses rather than guessing', () => {
  assert.throws(() => commitFeature({ root: process.cwd(), message: 'x' }), /no feature worktree/);
});
