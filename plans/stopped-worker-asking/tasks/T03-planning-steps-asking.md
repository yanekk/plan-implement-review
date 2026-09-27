# T03 — planning-steps-asking

**Phase:** 2 · **Depends on:** T02 · **Weight:** light

## Goal

Give a planning run (`pir plan`) the same reading: a planner or plan reviewer that has stopped, with
nothing running and its report not yet accepted, shows its step as `asking` and stops its step clock,
exactly as a pending request does today.

## Design sections this implements

DESIGN §2.3.

## Files

- `src/shell/plan-run.mjs`: `planRunState` and the `stoppedAt` loop in `runState` use `stoppedOnPerson`.
- `src/shell/plan-run.test.mjs`.

## Interface

`planRunState(state, session)` keeps its signature. A step's live session is asking when its activity
state is a request kind (today), or when `stoppedOnPerson(activity)` and `state.accepted` is not set for
that step. `asking` on the step row is then `'question'` for a stopped session (the request kind as
today otherwise). `runState()`'s `stoppedAt[step]` is set on the first paint that reads the step asking
by either rule and cleared when it stops.

## Tests

- [ ] Planner live, idle, `background: []`, no accepted report → step `asking`, `asking: 'question'`,
      `stoppedAt` carried.
- [ ] Planner idle with a job running → `planning`.
- [ ] Planner idle after its `planned` report is accepted → `planning` (pir's checks and close, not the
      person).
- [ ] Reviewer stopped → review step `asking`; reviewer busy → `reviewing`.
- [ ] Pending request still reads its request kind.
- [ ] A session activity without `background` → not asking (today's reading).
- [ ] `stoppedAt` set when the stopped reading starts, cleared when the next turn opens.

## Done when

- [ ] A stopped planning session reads `asking` through `stoppedOnPerson`, with no copy of the rule in
      `plan-run.mjs`.
- [ ] The tests above pass and `npm test` is green.
