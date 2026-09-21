# T17 — resilient-report-watch

**Phase:** 4 · **Runs:** auto · **Depends on:** T05 · **Weight:** small

## Goal

Stop a single `fs.watch` failure from killing a whole coordinator run, and stop the harness from
reporting a crashed coordinator as a clean `completed`. Both were found on 2026-09-21 driving the live
`merge-conflict` attended run (PM asked for the fix; FINDINGS 2026-09-21): the coordinator crashed
~2.4s in, right after spawning its two workers, on its first `waitForReport`, with

```
Error: EMFILE: too many open files, watch
  at FSWatcher._handle.onchange
Emitted 'error' event on FSWatcher instance
```

and the run.mjs harness then labelled the crash `completed` (no conflict ever surfaced, greeting.txt
untouched). Neither half of the plan (T13's fixture/assertion, the coordinator's conflict path) is
wrong — the run never got far enough to exercise them, because the coordinator process died on an
unhandled watcher error event. This makes the live attended verification of T13 impossible to reach on
a machine under file-descriptor pressure (several Claude sessions at once push `fs.watch` past a limit
the OS then refuses).

## The two defects

1. **`waitForReport` crashes on an async watcher error (coordinate.mjs ~line 552).** It wraps
   `watch(reportsDir, …)` in a `try/catch`, but `fs.watch` reports a *runtime* failure (EMFILE, ENOSPC,
   a watch that dies later) by emitting an **`error` event** on the returned `FSWatcher` — not by
   throwing synchronously. The watcher has no `error` listener, so Node re-throws it as an unhandled
   `error` event and the whole coordinator process exits. The function already has the right fallback in
   mind — the `setTimeout(finish, POLL_MS)` backstop is meant to cover a missed/absent watch (its own
   comment, and the sync-`catch` branch, say exactly this) — but an async watch error defeats it by
   killing the process first.

2. **The harness treats a crash as `completed` (run.mjs `runOutcome`, ~line 116).** `runOutcome` maps
   *any* coordinator process exit with no `halt-close` flow tag to `completed`, ignoring the exit code
   and signal. So a coordinator that crashed (`exit 1`) is scored identically to one that ran to a clean
   hand-off. That is why this failure was near-silent: the run printed `run reached: completed` and only
   the fact FAILing ("no task surface") hinted anything was wrong. A non-zero / signalled exit with no
   `halt-close` is a crash, and the harness must say so.

## Design sections this implements

DESIGN §2.2 (the coordinator watches `reports/` and wakes on a worker's up-report; `POLL_MS` is only a
backstop), §5.2 (a live run must not run — or die — unsupervised in a way that hides a crash). No design
rule changes; this closes robustness/honesty gaps in the two shell files.

## Files

- `src/shell/coordinate.mjs` — in `waitForReport`, attach an `error` handler to the `FSWatcher` so a
  runtime watch failure degrades to the `POLL_MS` (5s) timeout backstop instead of crashing the run.
  On the error: close the watcher and null it, and do **not** call `finish()` (resolving immediately
  would busy-spin the pass loop into re-watching every pass); let the existing `setTimeout(finish,
  timeoutMs)` fire, so the loop falls back to paced 5s polling. Each later pass re-attempts a fresh
  `watch()` — if the OS is still refusing, it keeps falling back, which is correct. To test this without
  a real EMFILE, make the `watch` function injectable (a defaulted parameter, as `gitRun`/`spawn` are
  elsewhere) so a fake watcher can emit `error`.
- `src/shell/harness/run.mjs` — thread the coordinator's exit result (code/signal, already captured by
  `spawnCoordinator`'s `child.on('exit', …)`) into `runOutcome`, and return a distinct crash terminal
  (e.g. `crashed`) when the process exited non-zero or on a signal with no `halt-close`. A crash must not
  pass `reachedExpectedTerminal({ expectedTerminal: 'completed' })`, so a crashed live run FAILs loudly
  with a crash label rather than a confusing green-shaped `completed`. Keep the clean-exit path
  (`code 0`, no `halt-close`) reporting `completed` exactly as today.

## Interface

- `waitForReport(reportsDir, timeoutMs, { watch } = {})` — same resolve-on-report-or-timeout contract; a
  watcher `error` now resolves via the timeout, never by crashing. Injectable `watch` for the test.
- `runOutcome({ flowText, exited, exitCode, signal })` (or an equivalent exit descriptor) → adds a
  `crashed` reason for a non-zero/signalled exit with no `halt-close`; `completed` and `halted` unchanged.

## Acceptance criteria — done when

- [ ] A unit test drives `waitForReport` with a fake `watch` whose watcher emits an `error` event, and
      asserts the promise still resolves (via the timeout) and nothing throws — i.e. the coordinator
      would not crash. A second case: the sync `catch` path (watch throws) still falls back, unchanged.
- [ ] `runOutcome` has a case that returns `crashed` (not `completed`) for a non-zero / signalled exit
      with no `halt-close`, and its existing `completed`/`halted` cases still pass. `reachedExpectedTerminal`
      rejects a `crashed` run under `expectedTerminal: 'completed'`.
- [ ] `npm test` is green.
- [ ] Because the original trigger (EMFILE from fd pressure) is a live, environment-dependent condition
      no unit test reproduces, the real proof is a live `run.mjs merge-conflict` that now reaches the
      parked conflict instead of dying at `spawn` — that is the PM's hand-verification of T13, unblocked
      by this task, and is recorded there, not asserted here.

## Notes for the building session

- Do not "fix" the EMFILE by raising a limit or serialising sessions — the machine's `ulimit -n` is
  already ~1M; the point is that the coordinator must survive the OS refusing a watch, whatever the
  cause, because a live run can always meet fd pressure. The resilience is the fix, not the fd count.
- `POLL_MS` is `PARALLEL_POLL_MS ?? 5000`. The fallback cadence is already sane; do not shorten it on
  error (that would re-approach a busy spin).
- This task exists only because it blocks T13's live run. Keep it small — two focused edits and their
  tests. Anything else the crash made you notice about the harness goes in FINDINGS, not here.
