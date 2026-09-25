// The one SIGTERM-wait-SIGKILL escalation (plans/live-workers DESIGN §2.12, §3.2), extracted from the
// inline loop in control-run.mjs `stopRun` so a worker's close (worker-proc.mjs), T06's reap and, once
// T06 moves it over, stopRun share one copy (user 2026-09-25, plan review).
//
// The timeline is measured from the call:
//   0 … graceMs         wait for the process to leave on its own (a worker whose input just closed
//                       exits in under a second, T00); graceMs 0 signals at once, as stopRun does
//   graceMs             SIGTERM
//   graceMs … killMs    wait again
//   killMs              SIGKILL
// Everything that touches a process or a clock is injected, in the shape stopRun's tests already use,
// so the tests drive the whole escalation in microseconds without a real signal.

import { isAlive as isAliveReal } from './identity.mjs';

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// terminate(pid, opts) → Promise<{ escalated, signal }>. `escalated` is true when SIGKILL was needed;
// `signal` is the last signal sent, or null when the process was gone before any was. A pid that is
// already dead is a no-op, so a reused number is never signalled on the strength of a stale record.
export async function terminate(
  pid,
  {
    graceMs = 5000,
    killMs = 10000,
    kill = process.kill,
    isAlive = (p) => isAliveReal(p, { kill }),
    now = Date.now,
    sleep = defaultSleep,
    pollMs = 50,
  } = {},
) {
  const start = now();
  const waitUntil = async (deadline) => {
    while (isAlive(pid)) {
      if (now() - start >= deadline) return false;
      await sleep(pollMs);
    }
    return true;
  };

  if (!isAlive(pid)) return { escalated: false, signal: null };
  if (await waitUntil(graceMs)) return { escalated: false, signal: null };
  send(kill, pid, 'SIGTERM');
  if (await waitUntil(killMs)) return { escalated: false, signal: 'SIGTERM' };
  send(kill, pid, 'SIGKILL');
  return { escalated: true, signal: 'SIGKILL' };
}

// A process that exits between the check and the signal makes kill throw ESRCH; that is the outcome
// we wanted, not an error.
function send(kill, pid, sig) {
  try {
    kill(pid, sig);
  } catch {
    // already gone
  }
}
