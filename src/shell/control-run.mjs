// The front-end side of stopping and removing a run (DESIGN §2.6, §2.7, §5.2). Two operations:
//
//   stopRun   — end a run now. Signal the coordinator to shut down (it closes its own workers as
//               part of a clean stop, T10); if it does not exit within a grace period, force-kill it.
//               Either way, once it is gone, reap any worker it recorded in workers.json that is still
//               alive (live-workers T06, DESIGN §2.12), so a wedged or crashed coordinator can never
//               strand a run half-stopped with its workers still burning tokens (§2.6).
//   removeRun — clear a non-running run's bookkeeping: its index pointer (T06), its status snapshot
//               (T07) and its conversation logs (live-workers §2.3). The plan documents under
//               plans/{slug}/ are never touched (§2.7).
//
// This is the caller that drives stop and the safety net when the coordinator does not answer; the
// coordinator's cooperative half — catching the signal, closing its workers, recording the `stopped`
// final status — is T10. So stopRun deliberately does NOT write the record: on the clean path the
// coordinator owns that fact, and on the escalated path the coordinator is dead and the run reads as
// crashed, which resume handles (§2.6, §6). One owner per fact.
//
// Everything the timeline and the reap touch is injected — `kill`, `now`, `sleep`, `reap` — so the
// tests drive the whole stop sequence without real signals, exactly as identity.mjs injects its process
// boundary (DESIGN §3.1, §5.1).

import * as nodeFs from 'node:fs';
import { join } from 'node:path';
import { removeRecord, indexDir } from './index-store.mjs';
import { snapshotPath } from './snapshot-store.mjs';
import { terminate } from './terminate.mjs';
import { reapRecorded } from './reap.mjs';

// The default grace before a signalled coordinator is force-killed (§5.2, task interface). 4 s: long
// enough for the coordinator's own stop handler (T10) to close its workers and exit, short enough that
// a stop still feels immediate. It is the one open `how` the plan left to the implementer.
const DEFAULT_GRACE_MS = 4000;

// How often aliveness is re-checked while waiting out the grace period. Injectable so a test can
// shorten it; the timeline itself is driven by the injected `now`/`sleep`.
const DEFAULT_POLL_MS = 100;

// stopRun(record, { kill, now, sleep, graceMs, pollMs, reap }) → { stopped:true, escalated:boolean }
//
// The sequence (task interface, §2.6; live-workers §2.12):
//   1. terminate() the coordinator: SIGTERM at once, SIGKILL if it is still alive after graceMs. An
//      already-gone pid is never signalled, so a second stop, or a stop of a run that already exited,
//      never signals a reused process number (DESIGN §3.3). escalated is true when SIGKILL was needed.
//   2. Once it is gone, on every path, reap the workers it recorded in record.controlDir/workers.json.
//      A clean coordinator's teardown only SIGTERMs its children without waiting, and a crashed or
//      SIGKILLed one closed nothing, so a survivor is possible on every path. The reap checks each
//      pid's start time, so an already-reaped or reused pid is skipped.
//   3. Never remove a worktree — the next `pir {slug}` reconciles them from git (§2.6, §6).
export async function stopRun(
  record,
  {
    kill = process.kill,
    now = Date.now,
    sleep,
    graceMs = DEFAULT_GRACE_MS,
    pollMs = DEFAULT_POLL_MS,
    reap = (controlDir) => reapRecorded(controlDir, { kill, now, wait: sleep }),
  } = {},
) {
  const { escalated } = await terminate(record.pid, { graceMs: 0, killMs: graceMs, kill, now, sleep, pollMs });
  if (record.controlDir) await reap(record.controlDir);
  return { stopped: true, escalated };
}

// removeRun(record, { fs, dir }) → { removed:true }
//
// Clear a non-running run's bookkeeping and nothing else (§2.7):
//   - removeRecord (T06) deletes the index pointer under ~/.pir/runs.
//   - the status snapshot at controlDir/status.json (T07) is unlinked.
//   - controlDir/conversations/, the workers' logs (live-workers §2.3, §2.12), is deleted.
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

  // The conversation logs belong to the run, not the plan; `force` makes an absent folder a no-op.
  fs.rmSync(join(record.controlDir, 'conversations'), { recursive: true, force: true });

  return { removed: true };
}
