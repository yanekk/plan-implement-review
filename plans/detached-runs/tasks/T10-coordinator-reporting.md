# T10 — coordinator-reporting

**Phase:** 3 · **Depends on:** T07 · **Weight:** heavy

## Goal

Make the coordinator report on itself when it was launched by `pir` (detached, nobody attached). It
writes its live snapshot each pass, records its own final status on every exit path, and handles
the stop signal by closing its workers, marking the run stopped, and leaving the worktrees. All of
this is gated on `PIR_RUN` so a foreground `pir-coordinate` run behaves exactly as it does today —
this task must not disturb the classic path.

## Design sections this implements

DESIGN §2.4 (the live view is fed by this), §2.6 (the coordinator's half of stop), §3.4/§3.5 (data
flow and storage), §3.5 (the `PIR_RUN` marker).

## Files

- `src/shell/coordinate.mjs` — edit: snapshot write per pass, final-status write on exit, stop handler.
- `src/shell/coordinate.test.mjs` or the existing harness under `src/shell/harness/` — extend.
- Reuses `src/core/snapshot.mjs` (T03), `src/shell/snapshot-store.mjs` (T07),
  `src/shell/index-store.mjs` (T06) to update `finalState`.

## Interface

Behaviour added to `main`/the pass loop, all behind `if (process.env.PIR_RUN)`:

```
each pass, after the run state for the live display is built:
  writeSnapshot(controlDir, {
    version:1,
    proc: { pid, startTime, slug, repo, branch, startedAt },
    finalState: null,
    runState,                       // the same object handed to buildDisplay this pass
  })

on every exit path (hand-off green, red branch, stall/quiet, runaway, error):
  writeSnapshot(... finalState:'finished' ...)   // the run ended on its own
  update the index entry's finalState to 'finished'

on the stop signal (SIGTERM while PIR_RUN):
  close this run's in-flight workers (the existing teardown's worker-close, NOT the worktree removal)
  writeSnapshot(... finalState:'stopped' ...); update the index entry to 'stopped'
  exit — leaving the task worktrees in place (§2.6)
```

- `startTime` for `proc` is the launch time captured by T08 and carried in the index entry; the
  coordinator reads it from the entry (or is passed it) rather than re-deriving. Reason: one
  recorded launch time, so the snapshot's identity matches the index's.
- The stop handler differs from the classic Ctrl-C teardown in one way: it does **not** remove
  worktrees (§2.6). The worker-close is the same. Keep the classic SIGINT/Ctrl-C path for a
  foreground run unchanged.
- A true crash (SIGKILL, power loss) writes no final status by design; the front-end infers crashed
  from the dead process (T01). Do not try to catch SIGKILL.

## Tests

- [ ] with `PIR_RUN` set, a pass writes a `status.json` that `parseSnapshot` accepts and whose
      `runState` matches what the display was given that pass.
- [ ] without `PIR_RUN`, no snapshot is written and no index entry is touched (classic path intact).
- [ ] a clean end writes `finalState:'finished'` to both the snapshot and the index entry.
- [ ] the stop signal writes `finalState:'stopped'`, closes workers, and does **not** remove worktrees.
- [ ] the classic SIGINT/Ctrl-C foreground path is unchanged (existing harness/tests still green).

## Done when

- [ ] A detached run writes a valid live snapshot each pass and a correct final status on exit.
- [ ] Stop leaves worktrees and marks `stopped`; the classic foreground path is untouched.
- [ ] `npm test` passes, including the existing coordinator/harness tests.
