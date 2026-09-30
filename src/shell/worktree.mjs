// The real git plumbing behind the T05 fake (src/shell/fake/worktree.mjs), operating on the real
// project's git instead of a scratch repo. It implements the branch model of DESIGN §2.9: one
// feature branch `pir/{plan}` cut from the run's base branch in its own worktree (the coordinator
// works there, so the user's own checkout is not moved); task branches `pir/{plan}-T{nn}` cut from the
// feature branch and merged back into it, serialized; and the base never written — the finished
// feature branch is handed to the person to merge by hand (DESIGN §2.4).
//
// Nothing here names a base branch (base-branch T03): every cut, sync and "has the person merged"
// check takes the base and the commit as arguments, and the base a branch was cut from is recorded on
// it as `branch.<branch>.pirBase` in git config (base-branch DESIGN §2.5), which `git branch -m`
// carries along to the renamed branch. It is the recovery half of the machine
// (DESIGN §6) and is built before any live agent, so a runaway or abandoned worker can always be
// torn down.
//
// Two surfaces, one behaviour:
//   - Module-level functions (openFeature/createTask/integrate/mergeTask/remove) are the
//     T06.md interface, stateless — each derives every path it needs from git, so they can be
//     called directly. The hand-verify snippet in T06.md does exactly this: `m.openFeature('demo')`.
//   - createWorktree({ root, base, from }) returns the same methods bound to one repo root (and the
//     base/commit a new feature branch is cut from), plus a stateful
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
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { progressPathFor, parseProgress, adoptNewTaskRows } from '../core/progress.mjs';
import { prepareBase } from './base-branch.mjs';

// gpgsign is forced off on every commit-creating call (merge, commit). An automated
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

// The primary worktree of the repo: `git worktree list --porcelain` names it first, wherever it is
// called from. Feature and task worktrees are created relative to it; it is the person's own checkout,
// which the run leaves untouched (the person merges the feature branch by hand, DESIGN §2.4).
function primaryWorktree(root) {
  const out = git(root, ['worktree', 'list', '--porcelain']).stdout;
  const first = out.split('\n').find((l) => l.startsWith('worktree '));
  if (!first) throw new Error(`not a git repo: ${root}`);
  return first.slice('worktree '.length).trim();
}

// Where coordinator-created worktrees live: <primary>/.claude/worktrees, the same place Claude Code
// puts its own linked worktrees in this repo (this very session runs from one). A registered
// worktree directory is excluded from the parent repo's status by git itself, so nothing here shows
// up as an untracked file in the person's checkout.
function worktreesBase(root) {
  return join(primaryWorktree(root), '.claude', 'worktrees');
}

function branchExists(root, branch) {
  return git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).ok;
}

// The commit a ref names, or null. `^{commit}` so a tag or a tree-ish that is not a commit is refused
// here rather than by a later `git branch`.
function commitOf(root, ref) {
  return git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).stdout.trim() || null;
}

function noBaseBranch(from) {
  const e = new Error(`no-base-branch: ${from} does not resolve to a commit`);
  e.code = 'no-base-branch';
  return e;
}

// Create `branch` at the commit `from` names (default: the tip of the local `base`) and record the
// base on it. Resolved to a sha first, so the branch is cut from exactly the commit the caller chose
// (base-branch DESIGN §2.3 hands a prepared sha, which may be ahead of the local base). Both are
// checked before anything is created, so a refusal leaves the repo as it was. `pirBase` is written
// after the branch: a crash between the two leaves a branch without it, which DESIGN §2.5's fallback
// handles.
function cutBranch(root, branch, { base, from }, who) {
  if (!base) throw new Error(`${who}: no base branch given for ${branch}`);
  const ref = from ?? `refs/heads/${base}`;
  const sha = commitOf(root, ref);
  if (!sha) throw noBaseBranch(ref);
  const r = git(root, ['branch', branch, sha]);
  if (!r.ok) throw new Error(`${who}: could not create ${branch}: ${r.stderr}`);
  recordRunBase(root, branch, base);
}

// recordRunBase(root, branch, base) — `git config branch.<branch>.pirBase <base>` (DESIGN §2.5).
export function recordRunBase(root, branch, base) {
  const r = git(root, ['config', `branch.${branch}.pirBase`, base]);
  if (!r.ok) throw new Error(`recordRunBase: could not record ${base} on ${branch}: ${r.stderr}`);
}

// readRunBase(root, branch) → the base recorded on `branch`, or null (a branch cut before pirBase
// existed, or none at all: `git config --get` exits 1 for a missing key).
export function readRunBase(root, branch) {
  const r = git(root, ['config', '--get', `branch.${branch}.pirBase`]);
  return (r.ok && r.stdout.trim()) || null;
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
// than a duplicate; a reused branch keeps the pirBase it has. A new branch is cut from `from` (default
// the local `base`) WITHOUT switching the user's checkout; `git worktree add` checks it out in a
// linked worktree, leaving the person's checkout where it was.
export function openFeature(plan, { root = process.cwd(), base, from } = {}) {
  const branch = featureBranchOf(plan);
  const existing = worktreeForBranch(root, branch);
  if (existing) return { path: existing, branch };
  if (!branchExists(root, branch)) cutBranch(root, branch, { base, from }, 'openFeature');
  const path = join(worktreesBase(root), `pir-${plan}`);
  const add = git(root, ['worktree', 'add', path, branch]);
  if (!add.ok) throw new Error(`openFeature: worktree add failed: ${add.stderr}`);
  return { path, branch };
}

// Cut pir/{plan} from `from` (default the local `base`) and record pirBase, without a worktree
// (base-branch DESIGN §2.7): `pir start` cuts a hand-made plan's feature branch before the detached
// coordinator starts, and the coordinator's openFeature then reuses the branch. A branch that already
// exists is left exactly as it is. Returns the branch name.
export function cutFeatureBranch(plan, { root = process.cwd(), base, from } = {}) {
  const branch = featureBranchOf(plan);
  if (!branchExists(root, branch)) cutBranch(root, branch, { base, from }, 'cutFeatureBranch');
  return branch;
}

// Create a task worktree on `pir/{plan}-T{nn}` cut from the FEATURE branch (not the base), so the worker
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
// PROGRESS.md is protected but no longer restored verbatim: the coordinator stays its single writer
// on the feature branch (DESIGN §2.5), so every existing row and single-line field keeps the
// feature's version, but a merging branch may have added genuinely new task rows — a worker-introduced
// task — and those are adopted onto the feature's copy via adoptNewTaskRows (DESIGN §2.2, §3.1, §3.3).
// This one path serves both the live merge and the restart-reconcile merge, since both call mergeTask.
// A code conflict anywhere but PROGRESS.md aborts and returns { conflict, files }, leaving the feature
// branch clean — adoption only happens on a merge that otherwise lands. featurePath lets the factory
// pass the remembered feature worktree; stateless callers derive it from the task branch.
export function mergeTask(taskBranch, { root = process.cwd(), featurePath } = {}) {
  const feature = featureOfTaskBranch(taskBranch);
  const path = featurePath ?? worktreeForBranch(root, feature);
  if (!path) throw new Error(`mergeTask: no worktree for ${feature}`);

  // PROGRESS.md lives at plans/{plan}/PROGRESS.md, not the repo root (progressPathFor). The plan is
  // the feature branch with its `pir/` prefix stripped. `git`-reported unmerged paths and `git add`
  // are both repo-relative, so this same forward-slash string serves for the filter and the add.
  const progressRel = progressPathFor(feature.slice('pir/'.length));
  const progressPath = join(path, progressRel);
  const saved = existsSync(progressPath) ? readFileSync(progressPath, 'utf8') : null;

  // Read the merging branch's PROGRESS.md from its committed tip, not the post-merge working tree:
  // the committed copy is clean and parses even when the merge conflicts on PROGRESS.md itself.
  const shown = git(path, ['show', `${taskBranch}:${progressRel}`]);
  const branchText = shown.ok ? shown.stdout : null;

  const res = git(path, [...NOSIGN, 'merge', '--no-commit', '--no-ff', taskBranch]);
  if (!res.ok) {
    const other = unmergedFiles(path).filter((f) => f !== progressRel);
    if (other.length > 0) {
      git(path, ['merge', '--abort']);
      return { conflict: true, files: other };
    }
    // A PROGRESS.md-only conflict is resolved below by adopting onto the feature's version.
  }
  let added = [];
  let errors = [];
  let blockEdges = [];
  if (saved !== null) {
    // Adopt any new task rows onto the feature's copy; with no branch copy there is nothing to
    // adopt, so the feature's version stands unchanged (the old verbatim-restore behaviour).
    const adopt = branchText !== null ? adoptNewTaskRows(saved, branchText) : { text: saved, added: [], errors: [] };
    added = adopt.added;
    errors = adopt.errors;
    blockEdges = adopt.blockEdges ?? [];
    writeFileSync(progressPath, adopt.text);
    git(path, ['add', progressRel]);
  }
  const merging = git(path, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']).ok;
  if (merging) git(path, [...NOSIGN, 'commit', '--no-edit', '-m', `merge ${taskBranch}`]);
  return { ok: true, added, errors, blockEdges };
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

// ---- End of run: bring the base into the feature branch (pir-coordinator DESIGN §2.9, §2.10, T05) ----
//
// The run hands the person a branch that merges cleanly, so before the hand-off (and again whenever the
// base moves while the run waits) the base commit is merged INTO the feature branch, in the feature
// worktree. The base itself is only read, never written. Which commit is merged is the caller's choice
// (base-branch DESIGN §2.8: the prepared base, possibly the remote's newer copy), so it arrives as a sha.
// A conflict is left in progress for a worker to finish (the main-sync prompt, core/conflict.mjs), so it
// is not aborted here.

const merging = (cwd) => git(cwd, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']).ok;

// syncBase(featurePath, { baseSha, base }) → { state: 'up-to-date'|'merged'|'conflict', baseSha, files? }.
// `base` is the branch name, used only in the merge message. A merge already in progress (a restart
// while a main-sync worker was resolving) is reported as the conflict it still is, with its unmerged
// files, rather than a second merge being started on top of it.
export function syncBase(featurePath, { baseSha, base } = {}) {
  if (!baseSha) throw new Error(`syncBase: no commit of ${base ?? 'the base branch'} to merge`);
  if (merging(featurePath)) return { state: 'conflict', baseSha, files: unmergedFiles(featurePath) };
  if (git(featurePath, ['merge-base', '--is-ancestor', baseSha, 'HEAD']).ok) return { state: 'up-to-date', baseSha };
  const branch = git(featurePath, ['symbolic-ref', '--short', 'HEAD']).stdout.trim() || 'the feature branch';
  const res = git(featurePath, [...NOSIGN, 'merge', '--no-ff', '-m', `sync ${base} into ${branch}`, baseSha]);
  if (res.ok) return { state: 'merged', baseSha };
  if (!merging(featurePath)) {
    // git refused before merging anything (an untracked file in the way): nothing is left in progress,
    // and a worker told to finish a merge would find none. Surfaced as an error the caller reports.
    throw new Error(`syncBase: git merge ${base} failed: ${res.stderr.trim()}`);
  }
  return { state: 'conflict', baseSha, files: unmergedFiles(featurePath) };
}

// baseContains(branch, { root, refs }) → whether ANY of `refs` already holds `branch`'s tip: the person
// merged it (DESIGN §2.10: `git merge-base --is-ancestor pir/{slug} <base>`). Several refs because a
// merge done on the remote shows up only in the remote-tracking copy (base-branch DESIGN §2.8).
export function baseContains(branch, { root = process.cwd(), refs = [] } = {}) {
  return refs.some((ref) => git(root, ['merge-base', '--is-ancestor', `refs/heads/${branch}`, ref]).ok);
}

// baseTip({ root, ref }) → the commit `ref` names, or null.
export function baseTip({ root = process.cwd(), ref } = {}) {
  return ref ? commitOf(root, ref) : null;
}

// syncPending(featurePath) → whether a base-sync merge is still in progress in the feature worktree:
// the worker that was to finish it reported done without committing, or exited.
export function syncPending(featurePath) {
  return merging(featurePath);
}

// abortSync(featurePath) → abandon an unfinished base-sync merge, so the feature branch is left at its
// last clean commit (DESIGN §2.11: the conflict could not be resolved; the report says so).
export function abortSync(featurePath) {
  if (merging(featurePath)) git(featurePath, ['merge', '--abort']);
  return { ok: !merging(featurePath) };
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

// Read how far a task got straight from its own task branch, without checking it out: the committed
// glyph in pir/{plan}-T{nn}:plans/{plan}/PROGRESS.md, which reconciliation reads at restart (DESIGN
// §2.2). `git show <branch>:<path>` reads the committed file with no worktree touched, so this stays
// cheap and never disturbs a worktree that review may still need. Parse rather than grep, so a
// reordered or reformatted table still reads correctly — the same parser the rest of the system
// trusts. Null, not throw, on a missing branch, a missing file, or no row for the task: a restart
// routinely asks about tasks whose branch never existed, and that is the classifier's "not started"
// answer (DESIGN §2.3), not an error. git() already returns { ok:false } rather than throwing.
export function taskBranchState(plan, task, { root = process.cwd() } = {}) {
  const res = git(root, ['show', `${taskBranchOf(plan, task)}:${progressPathFor(plan)}`]);
  if (!res.ok) return null; // branch or file absent — a normal answer, not an error.
  const row = parseProgress(res.stdout).tasks.find((t) => t.num === task);
  return row ? row.state : null;
}

// The registered worktree path and branch for pir/{plan}-T{nn}, or null if none is checked out. Lets
// reconciliation (T03) hand an existing task worktree to remove()/spawn without re-deriving the path.
export function taskWorktreeHandle(plan, task, { root = process.cwd() } = {}) {
  const branch = taskBranchOf(plan, task);
  const path = worktreeForBranch(root, branch);
  return path ? { path, branch } : null;
}

// The stateful drop-in the coordinator loop injects in T08, mirroring the fake's createFakeWorktree.
// It binds every operation to one repo root and remembers the feature worktree opened this run, so
// commitFeature (message-only, as the loop calls it) knows where to commit. `base`/`from` are what
// openFeature cuts a new feature branch from: the loop calls openFeature(plan) with the plan alone.
export function createWorktree({ root = process.cwd(), base, from } = {}) {
  let feature = null;
  return {
    openFeature: (plan, opts = {}) => (feature = openFeature(plan, { base, from, ...opts, root })),
    createTask: (plan, task) => createTask(plan, task, { root }),
    integrate: (path) => integrate(path),
    mergeTask: (taskBranch) => mergeTask(taskBranch, { root, featurePath: feature?.path }),
    commitFeature: (message) => commitFeature({ root, featurePath: feature?.path, message }),
    remove: (target) => remove(target, { root }),
    taskBranchState: (plan, task) => taskBranchState(plan, task, { root }),
    taskWorktreeHandle: (plan, task) => taskWorktreeHandle(plan, task, { root }),
    syncBase: (featurePath, opts) => syncBase(featurePath, opts),
    baseContains: (branch, opts) => baseContains(branch, { ...opts, root }),
    baseTip: (opts) => baseTip({ ...opts, root }),
    // The end-of-run sync prepares the base before merging it (base-branch DESIGN §2.8).
    prepareBase: (base, opts) => prepareBase(root, base, opts),
    syncPending: (featurePath) => syncPending(featurePath),
    abortSync: (featurePath) => abortSync(featurePath),
    get feature() {
      return feature;
    },
  };
}

// ---- Planning-run branch (pir-plan-command T04, DESIGN §2.2, §2.5, §2.6) ----
//
// A planning run works on a temporary branch pir/{runId} (runId = plan-{hex4}) in its own worktree,
// renamed to pir/{slug} once the planner has named the plan. The renamed worktree lands exactly on the
// build's feature worktree path, so openFeature later reuses it. Nothing here runs `checkout` in the
// primary worktree: a planning run must never move the person's
// own checkout (DESIGN §2.2 pre-flight 2). No call here creates a commit, so NOSIGN is not needed.

// Cut pir/{runId} from `from` (default the local `base`), record pirBase, and check it out in
// <primary>/.claude/worktrees/pir-{runId}. Throws code 'no-base-branch' when `from` does not resolve,
// before anything is created. Reuses the branch and worktree when they already exist, as openFeature
// does, so a relaunch is harmless.
export function openPlanBranch(runId, { root = process.cwd(), base, from } = {}) {
  const branch = featureBranchOf(runId);
  const existing = worktreeForBranch(root, branch);
  if (existing) return { path: existing, branch };
  if (!branchExists(root, branch)) cutBranch(root, branch, { base, from }, 'openPlanBranch');
  const path = join(worktreesBase(root), `pir-${runId}`);
  const add = git(root, ['worktree', 'add', path, branch]);
  if (!add.ok) throw new Error(`openPlanBranch: worktree add failed: ${add.stderr}`);
  return { path, branch };
}

// Why a slug cannot be taken for a new plan, or null when it is free (DESIGN §2.5): a branch
// pir/{slug}, a plan already committed on the run's base branch, or a dashboard index entry. The index
// lives outside git, so its lookup is injected (indexHas(slug) → boolean) and this stays a git-only
// function.
export function slugTaken(slug, { root = process.cwd(), base, indexHas = () => false } = {}) {
  if (!base) throw new Error('slugTaken: no base branch given');
  if (branchExists(root, featureBranchOf(slug))) return 'branch';
  if (git(root, ['cat-file', '-e', `refs/heads/${base}:${progressPathFor(slug)}`]).ok) return 'base-plan';
  if (indexHas(slug)) return 'index';
  return null;
}

// Rename pir/{runId} → pir/{slug} and move its worktree pir-{runId} → pir-{slug} (DESIGN §2.6 steps
// 1–2; the control folder and index entry are the caller's). Each sub-step is skipped when already
// done, so a resume after a crash between them finishes the job. `done` says which sub-steps THIS
// call performed. Every refusal is decided before either step runs, so a refusal moves nothing.
//
// "Ours" is judged from git alone: a pir/{slug} that exists while pir/{runId} is gone is taken as
// our earlier rename only when it is checked out at our old or new worktree path; anything else is
// somebody else's branch and is refused.
export function renamePlanBranch(runId, slug, { root = process.cwd() } = {}) {
  const from = featureBranchOf(runId);
  const to = featureBranchOf(slug);
  const base = worktreesBase(root);
  const oldPath = join(base, `pir-${runId}`);
  const newPath = join(base, `pir-${slug}`);
  const fromExists = branchExists(root, from);
  const toExists = branchExists(root, to);

  if (fromExists && toExists) throw new Error(`renamePlanBranch: ${to} already exists`);
  if (!fromExists && !toExists) throw new Error(`renamePlanBranch: neither ${from} nor ${to} exists`);

  const branchDone = !fromExists;
  const current = branchDone ? to : from;
  const wt = worktreeForBranch(root, current);
  if (wt !== oldPath && wt !== newPath) {
    // Either the branch has no worktree, or it is checked out somewhere we never put it.
    if (branchDone) throw new Error(`renamePlanBranch: ${to} exists and is not ours`);
    throw new Error(`renamePlanBranch: ${from} is not checked out at ${oldPath}`);
  }
  const worktreeDone = wt === newPath;
  // git still lists a worktree whose folder was deleted by hand, and `worktree move` then fails —
  // after the branch rename, leaving a half-done rename. Refuse up front instead.
  if (!worktreeDone && !existsSync(oldPath)) throw new Error(`renamePlanBranch: worktree ${oldPath} is missing (git worktree prune)`);
  if (!worktreeDone && existsSync(newPath)) throw new Error(`renamePlanBranch: ${newPath} already exists`);

  if (!branchDone) {
    const r = git(root, ['branch', '-m', from, to]);
    if (!r.ok) throw new Error(`renamePlanBranch: branch rename failed: ${r.stderr}`);
  }
  if (!worktreeDone) {
    const r = git(root, ['worktree', 'move', oldPath, newPath]);
    if (!r.ok) throw new Error(`renamePlanBranch: worktree move failed: ${r.stderr}`);
  }
  return { path: newPath, branch: to, done: { branch: !branchDone, worktree: !worktreeDone } };
}

// ---- Single-run baseline worktree (single-runs T04, DESIGN §2.5) ----
//
// The first red test run of a single run is checked against the untouched starting point: the same
// setup and test lines, in a throwaway worktree at the run's starting commit. It is detached, so it
// creates no branch and cannot be mistaken for a run's own worktree.

const baselinePath = (root, runId) => join(worktreesBase(root), `pir-${runId}-base`);

// A detached worktree at `from` in <primary>/.claude/worktrees/pir-{runId}-base. A leftover one from a
// killed program is removed first, so the baseline always runs on a fresh checkout. Throws when `from`
// does not resolve or git refuses the add; the caller words that as "could not be tested".
export function openBaseline(runId, { root = process.cwd(), from } = {}) {
  const sha = from ? commitOf(root, from) : null;
  if (!sha) throw new Error(`openBaseline: ${from} does not resolve to a commit`);
  removeBaseline(runId, { root });
  const path = baselinePath(root, runId);
  const add = git(root, ['worktree', 'add', '--detach', path, sha]);
  if (!add.ok) throw new Error(`openBaseline: worktree add failed: ${add.stderr.trim()}`);
  return { path };
}

// Remove that worktree; a no-op when there is none. `--force` twice for the reason `remove` gives. A
// folder git no longer lists (the add died half-way, or the registration was pruned) is deleted
// outright: the path is pir's own throwaway and nothing else is ever written there.
export function removeBaseline(runId, { root = process.cwd() } = {}) {
  const path = baselinePath(root, runId);
  git(root, ['worktree', 'remove', '--force', '--force', path]);
  if (existsSync(path)) rmSync(path, { recursive: true, force: true });
  git(root, ['worktree', 'prune']);
}
