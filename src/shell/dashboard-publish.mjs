// The dashboard state file's writer (PIR_DASHBOARD_STATE). Bare `pir` hands it the navigation state and
// the rows after every repaint; it rebuilds the object (core/dashboard-state.mjs) and writes it only when
// what it says has changed, since the reader — the agentic-ide cockpit — moves terminal panes on every
// write. `pir plan` and `pir start` never create one.
//
// A failure here must never disturb the dashboard: nothing throws out of update() or close(). The first
// failure is kept and reported once, on stderr, after the screen is gone (`report`), because a write to
// stderr while pi-tui owns the alternate screen would tear the frame.

import * as nodeFs from 'node:fs';
import { isAbsolute } from 'node:path';
import { buildDashboardState, sameDashboardState } from '../core/dashboard-state.mjs';
import { writeJsonAtomic } from './atomic-write.mjs';
import { git } from './worktree.mjs';

// The primary worktree of the repo at `repoPath` (the first `worktree` line git lists), or null. Worktree
// folders hang off the main checkout, not off whichever checkout a run was started from.
function mainWorktreeOf(repoPath) {
  const out = git(repoPath, ['worktree', 'list', '--porcelain']);
  if (!out.ok) return null;
  const first = out.stdout.split('\n').find((l) => l.startsWith('worktree '));
  return first ? first.slice('worktree '.length).trim() : null;
}

// createDashboardPublisher({ env, pid, now, fs, mainWorktree }) → { update(ui, rows), close(), report(stderr) }
// or null when PIR_DASHBOARD_STATE is unset. A value that is not an absolute path publishes nothing and
// is reported once at exit, rather than writing somewhere relative to wherever `pir` was run.
export function createDashboardPublisher({
  env = process.env,
  pid = process.pid,
  now = Date.now,
  fs = nodeFs,
  mainWorktree = mainWorktreeOf,
} = {}) {
  const path = env.PIR_DASHBOARD_STATE;
  if (path == null || path === '') return null;

  let failure = isAbsolute(path) ? null : `PIR_DASHBOARD_STATE must be an absolute path, got '${path}'; nothing was published`;
  const disabled = failure != null;
  let last = null;
  let wrote = false;
  // The main worktree of a repo does not change while the dashboard is open; git is asked once per repo.
  const mains = new Map();
  const cachedMain = (repoPath) => {
    if (!mains.has(repoPath)) {
      let m = null;
      try {
        m = mainWorktree(repoPath);
      } catch {
        m = null;
      }
      mains.set(repoPath, m);
    }
    return mains.get(repoPath);
  };
  const exists = (p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  };

  return {
    path,
    update(ui, rows) {
      if (disabled) return;
      try {
        const next = buildDashboardState({ ui, rows, pid, updatedAt: new Date(now()).toISOString(), mainWorktree: cachedMain, exists });
        if (sameDashboardState(last, next)) return;
        // `last` moves only on a successful write, so a failed one is retried on the next repaint.
        writeJsonAtomic(path, next, { fs });
        last = next;
        wrote = true;
      } catch (err) {
        failure ??= `could not write the dashboard state to ${path}: ${err?.message ?? err}`;
      }
    },
    close() {
      if (disabled || !wrote) return;
      try {
        fs.rmSync(path, { force: true });
      } catch (err) {
        failure ??= `could not remove the dashboard state file ${path}: ${err?.message ?? err}`;
      }
    },
    report(stderr = process.stderr) {
      if (failure) stderr.write(`pir: ${failure}\n`);
    },
  };
}
