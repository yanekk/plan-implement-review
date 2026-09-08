// The fake worktree: a real scratch git repo standing in for the branch model of DESIGN §2.9.
// It is a fake only in that it runs against a throwaway repo in a temp dir instead of the real
// project — every branch, worktree and merge here is genuine git, so the loop's branch model is
// proven for real (DESIGN §4: "a fake platform ... and a scratch git repo"), not asserted against
// a mock's own bookkeeping. This lives in src/shell/ and so may use child_process, fs and git;
// the boundary test guards only src/core/.
//
// The model (DESIGN §2.9): one feature branch `pir/{plan}` cut from `main`; task branches
// `pir/{plan}-T{nn}` cut from the feature branch, merging back into it; `main` touched exactly
// once, at the end, when the feature branch is promoted. `main` holds no half-finished plan.
//
// Why the task-branch separator is `-` and not `/`: git will not hold a ref `pir/{plan}` and a ref
// `pir/{plan}/T01` at once — the first is a file, the second needs a directory of the same name, a
// directory/file conflict git rejects outright ("cannot lock ref ... exists"). So task branches sit
// beside the feature branch, `pir/{plan}-T{nn}`, not under it. Found building T05; the user chose
// the dash (2026-09-08). Do not "tidy" it back to a slash.
//
// PROGRESS.md is never taken from a task branch at merge time (DESIGN §2.5): the coordinator is
// its single writer on the feature branch via reconcileTaskRow, so mergeTask deliberately drops
// the task branch's PROGRESS.md and keeps the feature's. That is what lets many task branches fold
// in without colliding on that one shared file, and it is exercised here on every merge, conflict
// or not.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Run one git command in cwd. Returns { ok, stdout, stderr, status } rather than throwing, so a
// non-zero exit (a merge conflict, a missing ref) is a value the caller inspects, not an
// exception it must wrap. Exported so the fake platform commits worker work with the same helper
// (both are fakes over the same scratch repo).
export function git(cwd, args) {
  try {
    const stdout = execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { ok: true, stdout, stderr: '', status: 0 };
  } catch (e) {
    return { ok: false, stdout: e.stdout ?? '', stderr: e.stderr ?? String(e), status: e.status ?? 1 };
  }
}

// A committer identity and no signing, so the scratch repo commits regardless of the machine's
// global git config (a missing user.email would otherwise fail every commit).
function configure(repo) {
  git(repo, ['config', 'user.email', 'coordinator@test.local']);
  git(repo, ['config', 'user.name', 'PIR Test']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
}

// createFakeWorktree({ progress, files }) → a worktree object plus test introspection.
//   progress — the initial PROGRESS.md text committed on `main` (the fake plan the loop drains).
//   files    — optional extra { path: content } committed on `main`, e.g. a shared file two tasks
//              both touch to force a real merge conflict in a test.
// The repo is created under a fresh temp dir; call cleanup() to remove it.
export function createFakeWorktree({ progress, files = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pir-fake-'));
  const repo = join(dir, 'repo');
  const events = [];

  git(dir, ['init', '-b', 'main', 'repo']);
  configure(repo);
  writeFileSync(join(repo, 'PROGRESS.md'), progress ?? '');
  for (const [p, content] of Object.entries(files)) writeFileSync(join(repo, p), content);
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-m', 'initial: fake plan', '--no-edit']);

  let feature = null;

  function openFeature(plan) {
    const branch = `pir/${plan}`;
    const path = join(dir, 'wt-feature');
    git(repo, ['branch', branch, 'main']);
    git(repo, ['worktree', 'add', path, branch]);
    configure(path);
    feature = { path, branch };
    events.push({ op: 'openFeature', branch, path });
    return { path, branch };
  }

  function createTask(plan, task) {
    if (!feature) throw new Error('createTask before openFeature');
    const branch = `pir/${plan}-${task}`;
    const path = join(dir, `wt-${task}`);
    git(repo, ['branch', branch, feature.branch]);
    git(repo, ['worktree', 'add', path, branch]);
    configure(path);
    events.push({ op: 'createTask', branch, path, from: feature.branch });
    return { path, branch };
  }

  // Bring a task branch up to date with the feature branch (the worker does this before it signals
  // done, DESIGN §2.5). A code conflict is returned as { conflict } after aborting; the worker (not
  // this helper) is what resolves or escalates it in the real system.
  function integrate(taskPath, featureBranch = feature?.branch) {
    const res = git(taskPath, ['merge', '--no-edit', '--no-ff', featureBranch]);
    if (!res.ok) {
      const unmerged = git(taskPath, ['diff', '--name-only', '--diff-filter=U']).stdout.trim();
      git(taskPath, ['merge', '--abort']);
      events.push({ op: 'integrate', branch: featureBranch, into: taskPath, conflict: true });
      return { conflict: true, files: unmerged.split('\n').filter(Boolean) };
    }
    events.push({ op: 'integrate', branch: featureBranch, into: taskPath });
    return { ok: true };
  }

  // Merge one task branch into the feature branch, serialized by the loop (one per pass). PROGRESS.md
  // is protected: whatever the task branch did to it is discarded and the feature's version kept, so
  // the coordinator stays PROGRESS.md's single writer (DESIGN §2.5). A code conflict anywhere else
  // aborts and returns { conflict } — the loop then surfaces it and never leaves a dirty feature branch.
  function mergeTask(taskBranch) {
    if (!feature) throw new Error('mergeTask before openFeature');
    const progressPath = join(feature.path, 'PROGRESS.md');
    const savedProgress = existsSync(progressPath) ? readFileSync(progressPath, 'utf8') : '';

    const res = git(feature.path, ['merge', '--no-commit', '--no-ff', taskBranch]);
    if (!res.ok) {
      const unmerged = git(feature.path, ['diff', '--name-only', '--diff-filter=U']).stdout
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      const other = unmerged.filter((f) => f !== 'PROGRESS.md');
      if (other.length > 0) {
        git(feature.path, ['merge', '--abort']);
        events.push({ op: 'mergeTask', branch: taskBranch, into: feature.branch, conflict: true });
        return { conflict: true, files: other };
      }
      // A PROGRESS.md-only conflict is resolved by keeping the feature's version (below).
    }

    // Drop the task branch's PROGRESS.md, keep the feature's, whether it merged cleanly or conflicted.
    writeFileSync(progressPath, savedProgress);
    git(feature.path, ['add', 'PROGRESS.md']);

    const merging = git(feature.path, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']).ok;
    if (merging) git(feature.path, ['commit', '--no-edit', '-m', `merge ${taskBranch}`]);
    events.push({ op: 'mergeTask', branch: taskBranch, into: feature.branch });
    return { ok: true };
  }

  // Commit whatever the coordinator has written into the feature worktree (a reconciled PROGRESS.md
  // row). Kept separate from mergeTask so the reconcile is its own commit on the feature branch.
  function commitFeature(message) {
    if (!feature) throw new Error('commitFeature before openFeature');
    git(feature.path, ['add', '-A']);
    const res = git(feature.path, ['commit', '-m', message, '--no-edit']);
    return { ok: res.ok };
  }

  // Promote the feature branch to main: the one and only merge to main (DESIGN §2.9). Runs in the
  // main repo checkout, which stays on main throughout (the feature and task branches live in
  // linked worktrees), so this is the first time main moves.
  function promote(plan) {
    const branch = `pir/${plan}`;
    const res = git(repo, ['merge', '--no-edit', '--no-ff', branch]);
    if (!res.ok) {
      git(repo, ['merge', '--abort']);
      events.push({ op: 'promote', branch, conflict: true });
      return { conflict: true };
    }
    events.push({ op: 'promote', branch });
    return { ok: true };
  }

  // Tear down a worktree and its branch (DESIGN §2.3 close, §2.9). Force-remove because a task
  // worktree may hold committed work already merged; the branch is deleted with -D for the same reason.
  function remove({ path, branch }) {
    if (path) git(repo, ['worktree', 'remove', '--force', path]);
    if (branch) git(repo, ['branch', '-D', branch]);
    events.push({ op: 'remove', path, branch });
  }

  // --- test introspection (not part of the shell interface the loop uses) ---
  const commitCount = (ref) => Number((git(repo, ['rev-list', '--count', ref]).stdout || '0').trim());
  const mainCommitCount = () => commitCount('main');
  const branchExists = (branch) => git(repo, ['rev-parse', '--verify', branch]).ok;
  const progressOn = (ref) => git(repo, ['show', `${ref}:PROGRESS.md`]).stdout;
  const fileOn = (ref, path) => git(repo, ['show', `${ref}:${path}`]);
  const worktrees = () => git(repo, ['worktree', 'list']).stdout;
  const cleanup = () => rmSync(dir, { recursive: true, force: true });

  return {
    // shell interface (mirrors the real worktree.mjs of T06)
    openFeature,
    createTask,
    integrate,
    mergeTask,
    commitFeature,
    promote,
    remove,
    // introspection
    dir,
    repo,
    events,
    commitCount,
    mainCommitCount,
    branchExists,
    progressOn,
    fileOn,
    worktrees,
    cleanup,
    get feature() {
      return feature;
    },
  };
}
