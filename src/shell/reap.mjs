// Reap the workers a previous coordinator recorded in control/workers.json (plans/live-workers DESIGN
// §2.12). A worker is a child of the coordinator, but a child mid-command outlives a SIGKILLed parent
// (measured 22 s, 2026-09-24; T00 re-measured through the SDK), and since T05 no listing can find it:
// `createPlatform().list()` holds only this process's own children. The coordinator rewrites
// workers.json on every spawn and exit, so the file a dead coordinator leaves is exactly the pids its
// successor or the dashboard's stop must reap.
//
// A pid alone is not an identity: macOS reuses numbers, so a recorded pid is only signalled when the
// process at that number still has the recorded launch time (identity.mjs `startTimeOf`, §3.3). A
// record whose startTime is null (the read failed at spawn) can never match, so it is skipped: an
// unverifiable pid is never killed.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isAlive as isAliveReal, startTimeOf as startTimeOfReal } from './identity.mjs';
import { terminate } from './terminate.mjs';

// SIGTERM at once, SIGKILL 3 s later (task interface). The recorded worker's coordinator is gone, so
// there is no input queue to end first and no reason to wait before the SIGTERM.
const REAP_KILL_MS = 3000;

// readWorkersFile(controlDir) → [{ id, task, role, pid, startTime }]; [] when the file is absent,
// unparsable or not a list, and entries without a positive integer pid are dropped. It never throws:
// the reap runs on startup and stop, and a torn or hand-edited file must not stop either.
export function readWorkersFile(controlDir) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(join(controlDir, 'workers.json'), 'utf8'));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((w) => w && Number.isInteger(w.pid) && w.pid > 0);
}

// reapRecorded(controlDir, { isAlive, startTimeOf, kill, wait, now, killMs }) → { reaped, skipped }
//
// Every recorded pid that is alive AND still carries its recorded start time is terminated (SIGTERM,
// then SIGKILL after killMs if it is still alive) and listed in `reaped`; every other pid is listed in
// `skipped` and never signalled. `wait` is the sleep terminate polls with; it and `now` are injected
// so the tests play the 3 s escalation out on a fake clock. The pids are terminated in parallel, so a
// stop with four stuck workers takes 3 s, not 12.
export async function reapRecorded(
  controlDir,
  {
    kill = process.kill,
    isAlive = (pid) => isAliveReal(pid, { kill }),
    startTimeOf = (pid) => startTimeOfReal(pid),
    wait,
    now,
    killMs = REAP_KILL_MS,
  } = {},
) {
  const reaped = [];
  const skipped = [];
  const kills = [];
  for (const w of readWorkersFile(controlDir)) {
    if (w.startTime == null || !isAlive(w.pid) || startTimeOf(w.pid) !== w.startTime) {
      skipped.push(w.pid);
      continue;
    }
    reaped.push(w.pid);
    kills.push(terminate(w.pid, { graceMs: 0, killMs, kill, isAlive, now, sleep: wait }));
  }
  await Promise.all(kills);
  return { reaped, skipped };
}
