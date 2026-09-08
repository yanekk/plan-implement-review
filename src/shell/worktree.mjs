// The real git plumbing behind the T05 fake (src/shell/fake/worktree.mjs), operating on the real
// project's git instead of a scratch repo. It implements the branch model of DESIGN §2.9: one
// feature branch `pir/{plan}` cut from `main` in its own worktree (the coordinator works there, so
// the user's main checkout stays on `main`); task branches `pir/{plan}-T{nn}` cut from the feature
// branch and merged back into it, serialized; and `main` touched exactly once, at promotion. It is
// the recovery half of the machine (DESIGN §6) and is built before any live agent, so a runaway or
// abandoned worker can always be torn down.
//
// Two surfaces, one behaviour:
//   - Module-level functions (openFeature/createTask/integrate/mergeTask/promote/remove) are the
//     T06.md interface, stateless — each derives every path it needs from git, so they can be
//     called directly. The hand-verify snippet in T06.md does exactly this: `m.openFeature('demo')`.
//   - createWorktree({ root }) returns the same methods bound to one repo root, plus a stateful
//     commitFeature(message). It is the drop-in the coordinator loop injects in T08, mirroring the
//     fake's createFakeWorktree(...). commitFeature (the reconcile commit, added for the loop —
//     FINDINGS 2026-09-08) is not in the T06.md interface and cannot be stateless: the loop calls it
//     with a message only, so the factory remembers the feature worktree opened this run and commits
//     there.
//
// Why derive paths from git rather than hold state: a coordinator can crash and restart, and the
// truth of which worktrees and branches exist is git's, not a remembered object's. Reuse (a restart
// re-opening the same feature worktree) and recovery both fall out of asking git each time.
//
// The task-branch separator is `-`, not `/`: git will not hold a ref `pir/{plan}` and a ref
// `pir/{plan}/T{nn}` at once (a directory/file clash it rejects outright). Task branches sit beside
// the feature branch. Found building T05; the user chose the dash (2026-09-08). Do not tidy it back.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// gpgsign is forced off on every commit-creating call (merge, commit, promote). An automated
// coordinator has no one to type a passphrase, and a repo with commit.gpgsign=true set globally
// would otherwise hang the run. `-c` is a per-invocation override; it does not mutate repo config,
// so the user's own signing setting is untouched for their own commits.
const NOSIGN = ['-c', 'commit.gpgsign=false'];

// Run one git command in cwd, returning a value (never throwing) so a conflict or a missing ref is
// something the caller inspects, not an exception it must wrap. Mirrors the fake's helper so both
// read the same way. Exported because the tests drive a scratch repo with it.
export function git(cwd, args) {
  try {
    const stdout = execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { ok: true, stdout, stderr: '', status: 0 };
  } catch (e) {
    return { ok: false, stdout: e.stdout ?? '', stderr: e.stderr ?? String(e), status: e.status ?? 1 };
  }
}

// The primary (main) worktree of the repo: `git worktree list --porcelain` names it first, wherever
// it is called from. Feature and task worktrees are created relative to it, and promotion runs there
// because that is the checkout sitting on `main`.
function mainWorktree(root) {
  const out = git(root, ['worktree', 'list', '--porcelain']).stdout;
  const first = out.split('\n').find((l) => l.startsWith('worktree '));
  if (!first) throw new Error(`not a git repo: ${root}`);
  return first.slice('worktree '.length).trim();
}

// Where coordinator-created worktrees live: <main>/.claude/worktrees, the same place Claude Code
// puts its own linked worktrees in this repo (this very session runs from one). A registered
// worktree directory is excluded from the parent repo's status by git itself, so nothing here shows
// up as an untracked file on `main`.
function worktreesBase(root) {
  return join(mainWorktree(root), '.claude', 'worktrees');
}

function branchExists(root, branch) {
  return git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).ok;
}

// The registered worktree path checked out on `branch`, or null. Porcelain records are separated by
// a blank line; within a record the `branch refs/heads/<b>` line pairs with the record's `worktree`
// line.
function worktreeForBranch(root, branch) {
  const records = git(root, ['worktree', 'list', '--porcelain']).stdout.split('\n\n');
  for (const rec of records) {
    const lines = rec.split('\n');
    const wt = lines.find((l) => l.startsWith('worktree '));
    const onBranch = lines.some((l) => l === `branch refs/heads/${branch}`);
    if (wt && onBranch) return wt.slice('worktree '.length).trim();
  }
  return null;
}

function unmergedFiles(cwd) {
  return git(cwd, ['diff', '--name-only', '--diff-filter=U']).stdout
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

const featureBranchOf = (plan) => `pir/${plan}`;
const taskBranchOf = (plan, task) => `pir/${plan}-${task}`;

// A task branch pir/{plan}-T{nn} → its feature branch pir/{plan}. The plan may itself contain
// dashes, so anchor on the trailing -T{digits}.
function featureOfTaskBranch(taskBranch) {
  const m = taskBranch.match(/^(pir\/.+)-T\d+$/);
  if (!m) throw new Error(`not a task branch: ${taskBranch}`);
  return m[1];
}

// Open (or re-open) the feature branch for a plan in its own worktree. Reuses both branch and
// worktree if they already exist, so a coordinator restart lands on the same feature worktree rather
// than a duplicate. The `git branch ... main` cuts the branch off main WITHOUT switching the user's
// checkout; `git worktree add` checks it out in a linked worktree, leaving main where it was.
export function openFeature(plan, { root = process.cwd() } = {}) {
  const branch = featureBranchOf(plan);
  const existing = worktreeForBranch(root, branch);
  if (existing) return { path: existing, branch };
  if (!branchExists(root, branch)) {
    const r = git(root, ['branch', branch, 'main']);
    if (!r.ok) throw new Error(`openFeature: could not create ${branch}: ${r.stderr}`);
  }
  const path = join(worktreesBase(root), `pir-${plan}`);
  const add = git(root, ['worktree', 'add', path, branch]);
  if (!add.ok) throw new Error(`openFeature: worktree add failed: ${add.stderr}`);
  return { path, branch };
}

// Create a task worktree on `pir/{plan}-T{nn}` cut from the FEATURE branch (not main), so the worker
// starts from siblings already merged into the feature branch. Reuses an existing branch/worktree
// for the same restart-safety as openFeature.
export function createTask(plan, task, { root = process.cwd() } = {}) {
  const branch = taskBranchOf(plan, task);
  const existing = worktreeForBranch(root, branch);
  if (existing) return { path: existing, branch };
  if (!branchExists(root, branch)) {
    const r = git(root, ['branch', branch, featureBranchOf(plan)]);
    if (!r.ok) throw new Error(`createTask: could not create ${branch}: ${r.stderr}`);
  }
  const path = join(worktreesBase(root), `pir-${plan}-${task}`);
  const add = git(root, ['worktree', 'add', path, branch]);
  if (!add.ok) throw new Error(`createTask: worktree add failed: ${add.stderr}`);
  return { path, branch };
}

// Bring a task worktree up to date with its feature branch (the worker does this before it signals
// done, DESIGN §2.5). Merges the FEATURE branch INTO the task branch at `path`. Never auto-resolves:
// on conflict it aborts and returns the conflicting files for the worker to resolve or escalate.
export function integrate(path) {
  const taskBranch = git(path, ['symbolic-ref', '--short', 'HEAD']).stdout.trim();
  const feature = featureOfTaskBranch(taskBranch);
  const res = git(path, [...NOSIGN, 'merge', '--no-edit', '--no-ff', feature]);
  if (!res.ok) {
    const files = unmergedFiles(path);
    git(path, ['merge', '--abort']);
    return { conflict: true, files };
  }
  return { ok: true };
}

// Merge one task branch into the feature branch, serialized by the caller (the loop, one per pass).
// PROGRESS.md is protected: the coordinator is its single writer on the feature branch (DESIGN §2.5),
// so whatever the task branch did to it is discarded and the feature's version kept — whether the
// merge was clean or conflicted only on PROGRESS.md. A code conflict anywhere else aborts and returns
// { conflict, files }, leaving the feature branch clean. featurePath lets the factory pass the
// remembered feature worktree; stateless callers derive it from the task branch.
export function mergeTask(taskBranch, { root = process.cwd(), featurePath } = {}) {
  const feature = featureOfTaskBranch(taskBranch);
  const path = featurePath ?? worktreeForBranch(root, feature);
  if (!path) throw new Error(`mergeTask: no worktree for ${feature}`);

  const progressPath = join(path, 'PROGRESS.md');
  const saved = existsSync(progressPath) ? readFileSync(progressPath, 'utf8') : null;

  const res = git(path, [...NOSIGN, 'merge', '--no-commit', '--no-ff', taskBranch]);
  if (!res.ok) {
    const other = unmergedFiles(path).filter((f) => f !== 'PROGRESS.md');
    if (other.length > 0) {
      git(path, ['merge', '--abort']);
      return { conflict: true, files: other };
    }
    // A PROGRESS.md-only conflict is resolved below by keeping the feature's version.
  }
  if (saved !== null) {
    writeFileSync(progressPath, saved);
    git(path, ['add', 'PROGRESS.md']);
  }
  const merging = git(path, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']).ok;
  if (merging) git(path, [...NOSIGN, 'commit', '--no-edit', '-m', `merge ${taskBranch}`]);
  return { ok: true };
}

// Commit whatever the coordinator has written into the feature worktree (a reconciled PROGRESS.md
// row). Kept separate from mergeTask so the reconcile is its own commit on the feature branch. Not
// part of the T06.md interface; added for the loop (FINDINGS 2026-09-08). Pass featurePath (the
// factory does) or plan so it can find the feature worktree.
export function commitFeature({ root = process.cwd(), featurePath, plan, message } = {}) {
  const path = featurePath ?? (plan ? worktreeForBranch(root, featureBranchOf(plan)) : null);
  if (!path) throw new Error('commitFeature: no feature worktree (pass featurePath or plan)');
  git(path, ['add', '-A']);
  const res = git(path, [...NOSIGN, 'commit', '-m', message, '--no-edit']);
  return { ok: res.ok };
}

// Promote the feature branch to main: the one and only merge to main (DESIGN §2.9). Runs in the main
// worktree, which has stayed on main throughout (the feature and task branches live in linked
// worktrees), so this is the first time main moves. Never auto-resolves.
export function promote(plan, { root = process.cwd() } = {}) {
  const branch = featureBranchOf(plan);
  const main = mainWorktree(root);
  const res = git(main, [...NOSIGN, 'merge', '--no-edit', '--no-ff', branch]);
  if (!res.ok) {
    const files = unmergedFiles(main);
    git(main, ['merge', '--abort']);
    return { conflict: true, files };
  }
  return { ok: true };
}

// Tear down a worktree and its branch (DESIGN §2.3 close, §2.9, §6). `--force` twice, not once: a
// single `--force` removes a dirty worktree but git refuses a LOCKED one ("cannot remove a locked
// working tree; use 'remove -f -f'"), and a lock is exactly the abandoned-worker state this must
// recover from — `claude rm` keeps a worktree with a lock (FINDINGS.md), which is why remove exists.
// Doubling the flag is a superset: it still removes the dirty and clean cases. The branch is deleted
// with -D for the same recover-anyway reason.
export function remove({ path, branch } = {}, { root = process.cwd() } = {}) {
  if (path) git(root, ['worktree', 'remove', '--force', '--force', path]);
  if (branch) git(root, ['branch', '-D', branch]);
  return { ok: true };
}

// The stateful drop-in the coordinator loop injects in T08, mirroring the fake's createFakeWorktree.
// It binds every operation to one repo root and remembers the feature worktree opened this run, so
// commitFeature (message-only, as the loop calls it) knows where to commit.
export function createWorktree({ root = process.cwd() } = {}) {
  let feature = null;
  return {
    openFeature: (plan) => (feature = openFeature(plan, { root })),
    createTask: (plan, task) => createTask(plan, task, { root }),
    integrate: (path) => integrate(path),
    mergeTask: (taskBranch) => mergeTask(taskBranch, { root, featurePath: feature?.path }),
    commitFeature: (message) => commitFeature({ root, featurePath: feature?.path, message }),
    promote: (plan) => promote(plan, { root }),
    remove: (target) => remove(target, { root }),
    get feature() {
      return feature;
    },
  };
}
