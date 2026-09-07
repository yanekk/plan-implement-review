# T03 — `decideDispatch` — spawn / merge / close decisions

**Phase:** 1 · **Depends on:** T02 · **Weight:** medium

## Goal

The one place the whole behaviour comes together: given the parsed task table, the current
worker assignments, the worker ceiling and whether the kill switch is thrown, decide what to do
this pass — which tasks to spawn a worker for, which finished branch to merge, and which
workers to close. It is a pure function of its arguments and nothing else, which is what lets
the entire dispatch logic be proven in the test run before any agent exists.

## Design sections this implements

DESIGN §3.3 (the decision function), §2.1 (spawn ready tasks up to the ceiling), §2.3 (close),
§2.5 (serialized merge, crash cleanup).

## Files

- `src/core/dispatch.mjs` — add `decideDispatch`.
- `src/core/dispatch.test.mjs`.

## Interface

```
decideDispatch({ tasks, assignments, maxWorkers, halted }) → { spawn, merge, close }

  tasks       : [ { num, name, deps, state } ]                  // from parseProgress
  assignments : [ { workerId, task, phase, live } ]             // phase: implementing |
                                                                //  reviewing | awaiting-answer |
                                                                //  done ; live: boolean
  maxWorkers  : number    // the ceiling (4)
  halted      : boolean    // kill-switch flag present

  spawn : [ taskNum ]      // ready ⬜ tasks: all deps ✅, not already assigned,
                           //   lowest number first, capped so live+spawn ≤ maxWorkers
  merge : [ branch ]       // workers with phase "done", AT MOST ONE per pass (serialized)
  close : [ workerId ]     // workers whose task is merged, plus any assignment with live=false
```

When `halted`: `spawn` and `merge` are empty and `close` is every live worker. A task already
held by a live worker is never re-spawned. A dead worker (live=false) is always in `close`, so
it stops holding a slot under the ceiling.

## Tests

- [ ] Spawns only ⬜ tasks whose deps are all ✅; a task with a 🔍 or ⬜ dependency is not spawned.
- [ ] Never exceeds the ceiling: with 3 live and maxWorkers 4, at most 1 is spawned.
- [ ] Lowest task number first when more are ready than the ceiling allows.
- [ ] Merge is at most one branch per pass even when two workers are done.
- [ ] A done worker's task appears in merge; after merge (next pass) the worker appears in close.
- [ ] A dead worker (live=false) is closed and its slot freed.
- [ ] halted=true yields empty spawn and merge and closes every live worker.
- [ ] A task already assigned to a live worker is not spawned again.

## Done when

- [ ] `decideDispatch` returns correct spawn/merge/close for the cases above.
- [ ] It reads no clock and no filesystem; `halted` and all state arrive as arguments.
- [ ] `npm test` is green.
