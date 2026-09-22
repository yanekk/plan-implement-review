// The shell side of run identity (DESIGN §2.2, §3.3, §5). Two facts about a process number, plus the
// pair that classifyRun (src/core/runstate.mjs) wants: is the process alive, and what is the exact
// launch time of whatever process holds that number right now. classifyRun is pure and reads no
// process; it takes those two answers as arguments. This module is where they are measured.
//
// macOS, not Linux: there is no /proc, no pidfd (DESIGN §5). Liveness is `kill(pid, 0)` and launch
// time is `ps -p {pid} -o lstart=`. Both the signal and the exec are injected so the tests never
// touch a real process — the one live smoke test excepted.

import { execFileSync } from 'node:child_process';

// isAlive(pid, { kill = process.kill }) → boolean
//
// `kill(pid, 0)` sends no signal; it only asks the kernel whether the number is signalable.
//   - returns without throwing → the process exists and is ours → alive.
//   - throws ESRCH            → no such process → not alive.
//   - throws EPERM            → the process exists but is owned by another user → still alive.
//     Calling it dead would be wrong; for our own detached runs it will normally be ours anyway.
// Any other throw (an unexpected errno) is treated as not alive — the safe default is to not claim
// a process is running on the strength of an error we did not anticipate.
export function isAlive(pid, { kill = process.kill } = {}) {
  try {
    kill(pid, 0);
    return true;
  } catch (e) {
    if (e && e.code === 'EPERM') return true;
    return false;
  }
}

// The default launch-time reader: `ps -p {pid} -o lstart=`. The trailing `=` on the field suppresses
// the column header, so stdout is the bare launch time (e.g. `Tue Sep 22 08:27:37 2026`, FINDINGS
// 2026-09-22) or empty when the number is gone. execFileSync throws on a non-zero exit — which is
// exactly what `ps` does for a number that no longer exists — so that is caught and reported as a
// failed read rather than thrown on up. Returns the same { ok, stdout } shape platform.mjs uses.
function defaultExec(pid) {
  try {
    const stdout = execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { ok: true, stdout };
  } catch (e) {
    return { ok: false, stdout: e && e.stdout ? e.stdout : '' };
  }
}

// startTimeOf(pid, { exec = defaultExec }) → string | null
//
// The trimmed `lstart` of the process at that number, or null when the process is gone or `ps`
// yields nothing. A non-zero `ps` exit and an empty output both mean "no launch time to report" and
// both collapse to null — the recorded value is compared for equality by classifyRun, and null can
// never equal a recorded time, so a missing reading correctly reads as "not the same process".
export function startTimeOf(pid, { exec = defaultExec } = {}) {
  const r = exec(pid);
  if (!r || !r.ok) return null;
  const trimmed = (r.stdout ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

// resolveLiveness(pid, { kill, exec }) → { alive, liveStartTime }
//
// The pair classifyRun consumes, measured in one call. The launch time is only read when the process
// is alive: a dead number has no launch time, and classifyRun returns 'crashed' on !alive regardless
// of liveStartTime, so reading `ps` for a number we already know is gone would be wasted work.
export function resolveLiveness(pid, { kill = process.kill, exec } = {}) {
  const alive = isAlive(pid, { kill });
  const liveStartTime = alive ? startTimeOf(pid, { exec }) : null;
  return { alive, liveStartTime };
}
