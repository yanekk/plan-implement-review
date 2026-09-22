// The run-state decision (DESIGN §2.2, §3.3). One pure function turns a run's recorded facts plus a
// liveness answer into exactly one of four states — running, finished, stopped, crashed. Everything in
// the front-end reads a run's state through here, so a run that *claims* to be running is never trusted
// on that claim alone: it is running only if its recorded process is still alive AND is the same process
// we started.
//
// No clock, no process, no fs (DESIGN §3.1). `alive` and `liveStartTime` are measured in src/shell/
// (identity.mjs — `kill(pid,0)` and `ps -p {pid} -o lstart=`) and handed in as arguments, which is what
// keeps the one subtle rule here — the reused-process-number test — exhaustively testable without a live
// process.
//
// The order of the checks matters (DESIGN §3.3):
//   1. A clean final record wins. If the coordinator recorded that the run finished or was stopped, that
//      is the truth regardless of what is alive at the recorded number now — a finished run's number may
//      well have been handed to something else by the time we look.
//   2. Then aliveness. No recorded process alive, and no final record, means it died without recording an
//      end: a crash, a reboot, a kill switch, a tripped safety-brake (DESIGN §2.2 lists these). Red, not
//      dim `finished`, is the deliberate signal that something went wrong.
//   3. Then the reuse test. Process numbers are reused, so "alive" is not enough: we recorded the exact
//      launch time at start, and a process alive at that number whose launch time no longer matches is a
//      *different* process on a reused number. That run is crashed, not running — reporting it running
//      would point the user at a live view that never updates (DESIGN §2.2).
//
// Only 'finished' and 'stopped' are recognised as clean final records; any other finalState value
// (including null, or a corrupted string) falls through to the liveness checks, so a malformed record can
// never mask a crashed run as a clean end.

const CLEAN_FINAL_STATES = new Set(['finished', 'stopped']);

// classifyRun({ recordedStartTime, finalState, alive, liveStartTime }) →
//   'running' | 'finished' | 'stopped' | 'crashed'
//
//   recordedStartTime — the process's launch time captured at start (string, from `ps -o lstart`).
//   finalState        — 'finished' | 'stopped' | null: what the coordinator recorded on exit, if any.
//   alive             — boolean, from the shell's `kill(pid,0)`.
//   liveStartTime     — the launch time of the process now at that number, or null if not alive.
export function classifyRun({ recordedStartTime, finalState, alive, liveStartTime }) {
  if (CLEAN_FINAL_STATES.has(finalState)) return finalState;
  if (!alive) return 'crashed';
  // Alive, but is it the same process? A launch time that no longer matches — including a null one, the
  // defensive case of alive-but-no-start-time — means the number was reused (DESIGN §3.3).
  if (liveStartTime !== recordedStartTime) return 'crashed';
  return 'running';
}
