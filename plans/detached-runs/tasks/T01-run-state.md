# T01 — run-state

**Phase:** 1 · **Depends on:** — · **Weight:** light

## Goal

The pure decision that turns a run's recorded facts plus a liveness answer into one of four
states — running, finished, stopped, crashed. This is the rule that stops the dashboard trusting
a claim: a run that recorded "running" but whose process is gone, or whose process number has
been handed to something else, is crashed. Everything else in the front-end reads state through
this one function, so it is pure and exhaustively tested before anything calls it.

## Design sections this implements

DESIGN §2.2 (run identity and state) and §3.3 (the decision function).

## Files

- `src/core/runstate.mjs` — new.
- `src/core/runstate.test.mjs` — new.

## Interface

```
classifyRun({ recordedStartTime, finalState, alive, liveStartTime }) →
  'running' | 'finished' | 'stopped' | 'crashed'
```

- `recordedStartTime` — the process launch time captured at start (string, from `ps -o lstart`).
- `finalState` — `'finished'` | `'stopped'` | `null` (what the coordinator recorded on exit, if any).
- `alive` — boolean, supplied by the shell (`kill(pid,0)`).
- `liveStartTime` — the launch time of the process now at that number, or `null` if not alive.

Order of the checks (a clean final record wins; then aliveness; then the reuse test):

```
finalState === 'finished' | 'stopped'  → finalState
!alive                                 → 'crashed'
liveStartTime !== recordedStartTime    → 'crashed'
otherwise                              → 'running'
```

No clock, no process, no fs — `alive` and `liveStartTime` arrive as arguments (§3.1).

## Tests

- [ ] finalState `finished` → `finished`, even when alive is true (a record wins).
- [ ] finalState `stopped` → `stopped`.
- [ ] no finalState, alive, matching start time → `running`.
- [ ] no finalState, not alive → `crashed`.
- [ ] no finalState, alive, `liveStartTime` differs from `recordedStartTime` → `crashed` (reuse).
- [ ] no finalState, alive, `liveStartTime` null → `crashed` (defensive: alive but no start time).
- [ ] an unknown finalState value is treated as no clean record (falls through to the liveness checks).

## Done when

- [ ] `classifyRun` is a pure function returning exactly one of the four state strings.
- [ ] The reused-process-number case is covered by a test and returns `crashed`.
- [ ] `npm test` passes and `src/core/boundary.test.mjs` still passes (no forbidden imports).
