// What the dashboard has open, as a small published object (the `PIR_DASHBOARD_STATE` file, version 1).
// Another program — the agentic-ide cockpit — follows it to point its diff viewer, file browser and
// terminals at the run or worker the person is looking at, the way it already follows `claude agents`.
// This is the pure half: the dashboard's navigation state plus the loaded rows in, the object out. The
// shell (dashboard-publish.mjs) decides when to write it and does the write.
//
// Two things the object needs are facts about the disk — the main worktree of a repo, and whether a
// worktree folder exists yet — so they arrive as injected functions and this module stays testable
// without a filesystem or git.

import { findOpen, openTasks, isPlan } from './dashboard.mjs';

export const DASHBOARD_STATE_VERSION = 1;

// The dashboard's view names map onto the published ones: its 'watch' is the file's 'run'.
const VIEW = { list: 'list', watch: 'run', worker: 'worker' };

// A planning run's sessions are the planner and the reviewer (plan-run.mjs ROLE); the file speaks the
// build's two roles, so the planner, the session that writes, publishes as `implement`.
const ROLE = { implement: 'implement', review: 'review', planner: 'implement', reviewer: 'review' };

// runWorktreeNames(view) → the folder names under `<main>/.claude/worktrees` the run's shared worktree may
// have, most likely first. A build's is `pir-{slug}` (worktree.mjs). A planning run's is `pir-{runId}` until
// the rename and `pir-{slug}` after, and the rename moves the folder, the branch and the index entry in
// separate steps (plan-run.mjs §2.6), so every name any of them currently implies is a candidate: the
// record's slug (the run id before the index moves), the snapshot's slug (set as soon as it is chosen),
// and the branch's `pir/x` spelled as a folder.
export function runWorktreeNames(view) {
  const r = view?.record ?? {};
  const names = [];
  const add = (n) => {
    if (n && !names.includes(n)) names.push(n);
  };
  if (r.slug ?? view?.slug) add(`pir-${r.slug ?? view.slug}`);
  if (isPlan(view) && view?.snap?.runState?.slug) add(`pir-${view.snap.runState.slug}`);
  if (typeof r.branch === 'string' && r.branch.startsWith('pir/')) add(`pir-${r.branch.slice(4)}`);
  return names;
}

// runCwd(view, { mainWorktree, exists }) → the absolute path of the run's shared worktree, or null when no
// candidate folder exists yet (or the main worktree cannot be found).
export function runCwd(view, { mainWorktree, exists }) {
  const repoPath = view?.record?.repoPath;
  if (!repoPath) return null;
  const main = mainWorktree(repoPath);
  if (!main) return null;
  for (const name of runWorktreeNames(view)) {
    const path = `${main.replace(/\/+$/, '')}/.claude/worktrees/${name}`;
    if (exists(path)) return path;
  }
  return null;
}

// buildDashboardState({ ui, rows, pid, updatedAt, mainWorktree, exists }) → the version-1 object.
//
//   ui        the dashboard's navigation state (dashboardReducer's ui)
//   rows      loadDashboard's rows: the resolved views, each with its record and snapshot
//   pid       the dashboard's own process id, so a reader can tell a file a crash left behind
//   updatedAt an ISO timestamp, passed in (core never reads the clock)
//
// `run` is set in the 'run' and 'worker' views, `worker` only in 'worker'. An open run whose row has gone
// (removed under the view) publishes the view with a null run rather than a stale one.
export function buildDashboardState({ ui, rows = [], pid, updatedAt, mainWorktree, exists }) {
  const view = VIEW[ui?.view] ?? 'list';
  let run = null;
  let worker = null;
  if (view !== 'list') {
    const open = findOpen(rows, ui);
    if (open) {
      const r = open.record ?? {};
      run = {
        key: open.key ?? `${r.repo ?? open.repo}__${r.slug ?? open.slug}`,
        kind: isPlan(open) ? 'plan' : 'work',
        slug: r.slug ?? open.slug ?? null,
        repo: r.repo ?? open.repo ?? null,
        repoPath: r.repoPath ?? null,
        branch: r.branch ?? null,
        cwd: runCwd(open, { mainWorktree, exists }),
      };
    }
    if (view === 'worker' && ui.openWorker) worker = workerState(rows, ui);
  }
  return { version: DASHBOARD_STATE_VERSION, pid, view, run, worker, updatedAt };
}

// The open worker as the file names it. Its role and folder come from the snapshot's entry for it (the
// task's `workers`, all of them live or exited, and `worker`, the one the row opens), so a finished worker
// still names the folder its read-only conversation ran in.
function workerState(rows, ui) {
  const { taskId, workerId } = ui.openWorker;
  const task = openTasks(rows, ui).find((t) => t.id === taskId);
  const entries = [task?.worker, ...(task?.workers ?? [])].filter((w) => w?.id === workerId);
  const pick = (field) => entries.map((w) => w[field]).find((v) => v != null) ?? null;
  return {
    id: workerId,
    task: taskId ?? null,
    role: ROLE[pick('role')] ?? null,
    cwd: pick('cwd'),
  };
}

// sameDashboardState(a, b) → whether two states would tell a reader the same thing. updatedAt is ignored:
// the file is rewritten only when what it says changes, never on a refresh tick or a cursor move, because
// the reader moves terminal panes on every write.
export function sameDashboardState(a, b) {
  if (!a || !b) return false;
  const strip = ({ updatedAt, ...rest }) => rest;
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}
