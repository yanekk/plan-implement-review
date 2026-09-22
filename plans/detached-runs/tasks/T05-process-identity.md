# T05 — process-identity

**Phase:** 2 · **Depends on:** T01 · **Weight:** medium

## Goal

The shell side of run identity: tell whether a process is alive, and read the exact launch time of
the process now at a given number. These two answers feed `classifyRun` (T01), which turns them
into a state. This is the module that makes "is this run really running?" honest against reused
process numbers — the thing a bare aliveness check gets wrong.

## Design sections this implements

DESIGN §2.2 (run identity), §3.3 (the decision function's inputs), §5 (macOS: `ps`/`kill`, no `/proc`).

## Files

- `src/shell/identity.mjs` — new.
- `src/shell/identity.test.mjs` — new.

## Interface

```
isAlive(pid, { kill = process.kill } = {}) → boolean
  // process.kill(pid, 0): true if it exists and is signalable; false on ESRCH; true on EPERM
  // (exists but not ours — still alive).

startTimeOf(pid, { exec } = {}) → string | null
  // `ps -p {pid} -o lstart=` trimmed; null if the process is gone or ps yields nothing.

resolveLiveness(pid, { kill, exec } = {}) → { alive, liveStartTime }
  // the pair classifyRun wants, in one call.
```

`exec` is injected (default a small `execFileSync('ps', …)` wrapper) so the tests never depend on a
real process. Reason `isAlive` treats `EPERM` as alive: a process owned by another user still
exists, and calling it dead would be wrong; for our own detached runs it will normally be ours.

## Tests

- [ ] `isAlive` true when the injected `kill` returns without throwing.
- [ ] `isAlive` false when `kill` throws `ESRCH`.
- [ ] `isAlive` true when `kill` throws `EPERM`.
- [ ] `startTimeOf` returns the trimmed `lstart` string from a faked `ps`.
- [ ] `startTimeOf` returns `null` when `ps` exits non-zero or prints nothing.
- [ ] `resolveLiveness` composes the two; feeding its output plus a matching `recordedStartTime`
      into `classifyRun` yields `running`, and a mismatching one yields `crashed`.
- [ ] one live-process smoke test against `process.pid` with the real `ps`/`kill` (not faked),
      asserting `alive === true` and a non-empty `liveStartTime`.

## Done when

- [ ] `isAlive` and `startTimeOf` work with injected `kill`/`exec` and are covered for the alive,
      gone, and not-ours cases.
- [ ] `resolveLiveness` output plugs straight into `classifyRun` (a test asserts both directions).
- [ ] `npm test` passes.
