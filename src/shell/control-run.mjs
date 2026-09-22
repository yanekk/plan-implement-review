// The front-end side of stopping and removing a run (DESIGN §2.6, §2.7, §5.2). Two operations:
//
//   stopRun   — end a run now. Signal the coordinator to shut down (it closes its own workers as
//               part of a clean stop, T10); if it does not exit within a grace period, force-kill it
//               and reap the run's workers directly, so a wedged coordinator can never strand a run
//               half-stopped with its workers still burning tokens (§2.6).
//   removeRun — clear a non-running run's bookkeeping: its index pointer (T06) and its status
//               snapshot (T07). The plan documents under plans/{slug}/ are never touched (§2.7).
//
// This is the caller that drives stop and the safety net when the coordinator does not answer; the
// coordinator's cooperative half — catching the signal, closing its workers, recording the `stopped`
// final status — is T10. So stopRun deliberately does NOT write the record: on the clean path the
// coordinator owns that fact, and on the escalated path the coordinator is dead and the run reads as
// crashed, which resume handles (§2.6, §6). One owner per fact.
//
// Everything the timeline and the reap touch is injected — `kill`, `now`, `sleep`, `platform` — so
// the tests drive the whole stop sequence without real signals or a real `claude agents` call, exactly
// as identity.mjs and platform.mjs inject their process boundary (DESIGN §3.1, §5.1). The one thing no
// test reaches — a real coordinator refusing to die and a real reap of real sessions — is the paid,
// live edge a person watches (§5.2), never asserted here.

import * as nodeFs from 'node:fs';
import { isAlive } from './identity.mjs';
import { removeRecord, indexDir } from './index-store.mjs';
import { snapshotPath } from './snapshot-store.mjs';
import { isWorkerOf } from '../core/naming.mjs';

// The default grace before a signalled coordinator is force-killed (§5.2, task interface). 4 s: long
// enough for the coordinator's own stop handler (T10) to close its workers and exit, short enough that
// a stop still feels immediate. It is the one open `how` the plan left to the implementer.
const DEFAULT_GRACE_MS = 4000;

// How often aliveness is re-checked while waiting out the grace period. Not part of the documented
// interface — an internal cadence — but injectable so a test can shorten it; the timeline itself is
// driven by the injected `now`/`sleep`, so the exact value never changes a test's outcome.
const DEFAULT_POLL_MS = 100;

// The real delay: a promise that resolves after `ms`. Injected in tests by a fake that advances a fake
// clock instead of waiting, so the grace loop runs in microseconds while still exercising every branch.
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// stopRun(record, { kill, now, sleep, graceMs, pollMs, platform }) → { stopped:true, escalated:boolean }
//
// The sequence (task interface, §2.6):
//   1. If the coordinator pid is already gone, there is nothing to stop — return stopped, not
//      escalated. This makes stop idempotent: a second stop, or a stop of a run that already exited,
//      is a no-op that never signals a reused process number.
//   2. Otherwise SIGTERM the coordinator and poll its aliveness until it exits or graceMs elapses.
//   3. If it is still alive past the grace: SIGKILL it, then enumerate THIS run's workers by name —
//      isWorkerOf(w.name, { repo, plan: slug }) — and close each, so nothing is left running. That is
//      escalated:true.
//   4. Never remove a worktree — the next `pir {slug}` reconciles them from git (§2.6, §6).
//
// `exec` and `fs` are intentionally not accepted: stop reads no process launch time (only aliveness,
// via `kill`) and touches no files (it leaves the worktrees in place), so injecting them would be dead
// surface. Removing files is removeRun's job, below.
export async function stopRun(
  record,
  {
    kill = process.kill,
    now = Date.now,
    sleep = defaultSleep,
    graceMs = DEFAULT_GRACE_MS,
    pollMs = DEFAULT_POLL_MS,
    platform,
  } = {},
) {
  const pid = record.pid;

  // 1. Already gone → idempotent no-op. No signal is sent to a number that may since have been reused
  //    by an unrelated process (DESIGN §3.3: a bare pid is not a safe identity).
  if (!isAlive(pid, { kill })) {
    return { stopped: true, escalated: false };
  }

  // 2. Ask it to stop, then wait out the grace, re-checking aliveness each pass.
  signal(kill, pid, 'SIGTERM');
  const start = now();
  while (isAlive(pid, { kill })) {
    if (now() - start >= graceMs) break;
    await sleep(pollMs);
  }

  // 3. It exited cleanly within grace → done, cooperative path.
  if (!isAlive(pid, { kill })) {
    return { stopped: true, escalated: false };
  }

  // 3b. Still alive past grace → the coordinator is wedged. Force-kill it and reap its workers by name
  //     ourselves, the same name-matching the coordinator would have used (§2.6). Only this run's
  //     workers: a sibling plan's workers share the git dir and appear in the same list (naming.mjs),
  //     and killing them would stop the wrong run.
  signal(kill, pid, 'SIGKILL');
  const workers = platform
    .list()
    .filter((w) => isWorkerOf(w.name, { repo: record.repo, plan: record.slug }));
  for (const worker of workers) {
    platform.close(worker.id);
  }
  return { stopped: true, escalated: true };
}

// Send a real signal, swallowing the throw the kernel raises when the process died between the check
// and the signal (ESRCH). A stop racing the coordinator's own exit is expected, not an error: the goal
// is that the process is gone, and it already is.
function signal(kill, pid, sig) {
  try {
    kill(pid, sig);
  } catch {
    // The process exited in the window since we last checked — the signal has nothing to reach, which
    // is the outcome we wanted anyway.
  }
}

// removeRun(record, { fs, dir }) → { removed:true }
//
// Clear a non-running run's two pieces of bookkeeping and nothing else (§2.7):
//   - removeRecord (T06) deletes the index pointer under ~/.pir/runs.
//   - the status snapshot at controlDir/status.json (T07) is unlinked.
// The plan documents under plans/{slug}/ — PLAN.md, DESIGN.md, PROGRESS.md, FINDINGS.md, tasks/ — are
// never touched: the record is process bookkeeping, not the plan (§2.7). The caller is responsible for
// only removing a run that is not running (§2.7: a running run must be stopped first); this function is
// the mechanism, not that guard.
//
// `dir` (the index directory) defaults to the real ~/.pir/runs via indexDir() and is forwarded to
// removeRecord; it is accepted so a test can point the index at a scratch directory without mutating
// the environment, matching how index-store.mjs itself is tested. `fs` is injectable the same way.
export function removeRun(record, { fs = nodeFs, dir = indexDir() } = {}) {
  removeRecord({ repo: record.repo, slug: record.slug }, { dir, fs });

  // Delete the run's live snapshot. It may never have been written (a run that stopped before its
  // first coordinator pass), so an absent file is a no-op, not an error — exactly the tolerance
  // removeRecord gives an absent index entry.
  try {
    fs.unlinkSync(snapshotPath(record.controlDir));
  } catch (err) {
    if (!err || err.code !== 'ENOENT') throw err;
  }

  return { removed: true };
}
