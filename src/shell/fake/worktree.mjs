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
// A task branch's edits to existing PROGRESS.md rows are never taken at merge time (DESIGN §2.5):
// the coordinator is its single writer on the feature branch via reconcileTaskRow, so mergeTask
// keeps the feature's version of every existing row and single-line field. The one thing it does
// adopt is a genuinely new task row a branch added — a worker-introduced task — folded in with
// adoptNewTaskRows (DESIGN §2.2). That is what lets many task branches fold in without colliding on
// that one shared file, and it is exercised here on every merge, conflict or not.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { progressPathFor, parseProgress, adoptNewTaskRows } from '../../core/progress.mjs';

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

// createFakeWorktree({ progress, files, slug }) → a worktree object plus test introspection.
//   progress — the initial PROGRESS.md text committed on `main` (the fake plan the loop drains).
//   files    — optional extra { path: content } committed on `main`, e.g. a shared file two tasks
//              both touch to force a real merge conflict in a test.
//   slug     — the plan slug, so PROGRESS.md is placed at plans/{slug}/PROGRESS.md exactly where the
//              loop and worker read it (progressPathFor). Must match the plan passed to openFeature.
// The repo is created under a fresh temp dir; call cleanup() to remove it.
export function createFakeWorktree({ progress, files = {}, slug = 'demo' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pir-fake-'));
  const repo = join(dir, 'repo');
  const progressRel = progressPathFor(slug);
  const events = [];

  git(dir, ['init', '-b', 'main', 'repo']);
  configure(repo);
  mkdirSync(join(repo, dirname(progressRel)), { recursive: true });
  writeFileSync(join(repo, progressRel), progress ?? '');
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

  // Reuses an existing branch and worktree exactly as the real createTask does, so a resumed task
  // (restart reconciliation) is handed the work already on its branch rather than a fresh one.
  function createTask(plan, task) {
    if (!feature) throw new Error('createTask before openFeature');
    const branch = `pir/${plan}-${task}`;
    const existing = taskWorktreeHandle(plan, task);
    if (existing) {
      events.push({ op: 'createTask', branch, path: existing.path, from: feature.branch, reused: true });
      return existing;
    }
    const path = join(dir, `wt-${task}`);
    if (!git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).ok) {
      git(repo, ['branch', branch, feature.branch]);
    }
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
  // is protected: every existing row and single-line field keeps the feature's version, so the
  // coordinator stays PROGRESS.md's single writer (DESIGN §2.5). New task rows a branch added are
  // adopted onto the feature's copy via adoptNewTaskRows (DESIGN §2.2), so a worker-introduced task
  // lands. A code conflict anywhere else aborts and returns { conflict } — the loop then surfaces it
  // and never leaves a dirty feature branch. Mirrors the real worktree.mjs on the same inputs.
  function mergeTask(taskBranch) {
    if (!feature) throw new Error('mergeTask before openFeature');
    const progressPath = join(feature.path, progressRel);
    const savedProgress = existsSync(progressPath) ? readFileSync(progressPath, 'utf8') : '';

    // The branch's committed PROGRESS.md, read clean off its tip (not the post-merge working tree),
    // so it parses even on a PROGRESS.md-only conflict.
    const shown = git(feature.path, ['show', `${taskBranch}:${progressRel}`]);
    const branchText = shown.ok ? shown.stdout : null;

    const res = git(feature.path, ['merge', '--no-commit', '--no-ff', taskBranch]);
    if (!res.ok) {
      const unmerged = git(feature.path, ['diff', '--name-only', '--diff-filter=U']).stdout
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      const other = unmerged.filter((f) => f !== progressRel);
      if (other.length > 0) {
        git(feature.path, ['merge', '--abort']);
        events.push({ op: 'mergeTask', branch: taskBranch, into: feature.branch, conflict: true });
        return { conflict: true, files: other };
      }
      // A PROGRESS.md-only conflict is resolved by adopting onto the feature's version (below).
    }

    // Keep the feature's PROGRESS.md, adopting any new task rows from the branch, whether the merge
    // was clean or conflicted only on PROGRESS.md.
    const adopt = branchText !== null ? adoptNewTaskRows(savedProgress, branchText) : { text: savedProgress, added: [], errors: [] };
    writeFileSync(progressPath, adopt.text);
    git(feature.path, ['add', progressRel]);

    const merging = git(feature.path, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']).ok;
    if (merging) git(feature.path, ['commit', '--no-edit', '-m', `merge ${taskBranch}`]);
    events.push({ op: 'mergeTask', branch: taskBranch, into: feature.branch });
    return { ok: true, added: adopt.added, errors: adopt.errors, blockEdges: adopt.blockEdges ?? [] };
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

  // Read a task branch's committed glyph without checking it out (DESIGN §2.2), the same signal the
  // real worktree.mjs reads, so T03's reconciliation and its loop tests ask git the same question the
  // same way over this scratch repo. `git show` is read-only; null on an absent branch/file or a
  // missing row is the classifier's "not started" answer (DESIGN §2.3), never a throw.
  function taskBranchState(plan, task) {
    const res = git(repo, ['show', `pir/${plan}-${task}:${progressPathFor(plan)}`]);
    if (!res.ok) return null;
    const row = parseProgress(res.stdout).tasks.find((t) => t.num === task);
    return row ? row.state : null;
  }

  // The registered worktree path and branch for pir/{plan}-T{nn}, or null if none is checked out —
  // read from git, not the events log, so it matches the real module's answer.
  function taskWorktreeHandle(plan, task) {
    const branch = `pir/${plan}-${task}`;
    for (const rec of git(repo, ['worktree', 'list', '--porcelain']).stdout.split('\n\n')) {
      const lines = rec.split('\n');
      const wt = lines.find((l) => l.startsWith('worktree '));
      if (wt && lines.some((l) => l === `branch refs/heads/${branch}`)) {
        return { path: wt.slice('worktree '.length).trim(), branch };
      }
    }
    return null;
  }

  // --- test introspection (not part of the shell interface the loop uses) ---
  const commitCount = (ref) => Number((git(repo, ['rev-list', '--count', ref]).stdout || '0').trim());
  const mainCommitCount = () => commitCount('main');
  const branchExists = (branch) => git(repo, ['rev-parse', '--verify', branch]).ok;
  const progressOn = (ref) => git(repo, ['show', `${ref}:${progressRel}`]).stdout;
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
    taskBranchState,
    taskWorktreeHandle,
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
