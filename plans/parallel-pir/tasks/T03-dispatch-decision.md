# T03 — `decideDispatch` — spawn / review / merge / close / surface

**Phase:** 1 · **Depends on:** T02 · **Weight:** light · **Runs:** auto

## Goal

The one place the whole behaviour comes together: given the parsed task table, the current worker
assignments, the worker ceiling and whether the kill switch is thrown, decide what to do this
pass — which `auto` tasks to spawn a worker for, which ready `you` tasks to surface to the user
instead of dispatching, which implemented task needs a fresh review session, which finished branch
to merge, and which workers to close. A pure function of its arguments and nothing else, which is
what lets the whole dispatch logic be proven before any agent exists.

## Design sections this implements

DESIGN §3.3 (the decision function), §2.1 (spawn ready, then fresh review), §2.3 (close), §2.4
(the ceiling and halted), §2.5 (serialized merge, crash cleanup), §2.6 (surface `you` tasks).

## Files

- `src/core/dispatch.mjs` — `decideDispatch`.
- `src/core/dispatch.test.mjs`.

## Interface

```
decideDispatch({ tasks, assignments, maxWorkers, halted }) → { spawn, surface, review, merge, close }

  tasks       : [ { num, name, deps, runs, state } ]                 // from parseProgress; runs: auto|you
  assignments : [ { workerId, task, phase, live } ]
                // phase: implementing | review-ready | reviewing | awaiting-answer | done | dead
  maxWorkers  : number     // the ceiling (4)
  halted      : boolean     // kill-switch flag present

  spawn   : [ taskNum ]     // ready auto ⬜: deps ✅, not assigned, lowest first, live+spawn ≤ max
  surface : [ taskNum ]     // ready you ⬜: deps ✅, not done — surfaced to the user, never spawned
  review  : [ workerId ]    // workers in phase "review-ready" (implemented, need a fresh reviewer)
  merge   : [ branch ]      // workers in phase "done", AT MOST ONE per pass (serialized)
  close   : [ workerId ]    // workers whose task merged, plus any assignment with live=false
```

A `you` task is never in `spawn`; it goes to `surface` and does not count against `maxWorkers`.
When `halted`: `spawn`, `surface`, `review` and `merge` are empty and `close` is every live
worker. A task held by a live worker is never re-spawned. A dead worker (live=false or phase
"dead") is always closed, so it stops holding a slot under the ceiling.

## Tests

- [ ] Spawns only ⬜ tasks whose deps are all ✅; a task with a 🔍 or ⬜ dependency is not spawned.
- [ ] Never exceeds the ceiling: with 3 live and maxWorkers 4, at most 1 is spawned.
- [ ] Lowest task number first when more are ready than the ceiling allows.
- [ ] A review-ready worker appears in `review`; it is not spawned again or merged yet.
- [ ] Merge is at most one branch per pass even when two workers are done.
- [ ] A dead worker is closed and its slot freed.
- [ ] halted=true yields empty spawn/review/merge and closes every live worker.
- [ ] A task already assigned to a live worker is not spawned again.

## Done when

- [ ] `decideDispatch` returns correct spawn/review/merge/close for the cases above.
- [ ] It reads no clock and no filesystem; `halted` and all state arrive as arguments.
- [ ] `npm test` is green.
