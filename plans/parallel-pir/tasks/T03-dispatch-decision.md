# T03 — `decideDispatch` — spawn / review / merge / close

**Phase:** 1 · **Depends on:** T02 · **Weight:** light · **Runs:** auto

## Goal

The one place the whole behaviour comes together: given the parsed task table, the current worker
assignments, the worker ceiling and whether the kill switch is thrown, decide what to do this
pass — which ready tasks to spawn a worker for (each tagged `auto` or `you`, so the loop knows to
spawn a builder or a hands-on scribe), which implemented task needs a fresh review session, which
finished branch to merge, and which workers to close. A pure function of its arguments and nothing
else, which is what lets the whole dispatch logic be proven before any agent exists.

## Design sections this implements

DESIGN §3.3 (the decision function), §2.1 (spawn ready, then fresh review), §2.3 (close), §2.4
(the ceiling and halted), §2.5 (serialized merge, crash cleanup), §2.6 (`auto` vs `you`: a `you`
task spawns a hands-on worker and skips review), §2.8 (the agent-name helpers), §2.9 (merge into
the feature branch; `promoteToMain` at completion).

## Files

- `src/core/dispatch.mjs` — `decideDispatch`.
- `src/core/dispatch.test.mjs`.
- `src/core/naming.mjs` — the agent-name helpers of DESIGN §2.8 (pure string work).
- `src/core/naming.test.mjs`.

## Interface

```
decideDispatch({ tasks, assignments, maxWorkers, halted }) → { spawn, review, merge, close, promoteToMain }

  tasks       : [ { num, name, deps, runs, state } ]                 // from parseProgress; runs: auto|you
  assignments : [ { workerId, task, phase, live } ]
                // phase: implementing | review-ready | reviewing | awaiting-answer | done | dead
  maxWorkers  : number     // the ceiling (4)
  halted      : boolean     // kill-switch flag present

  spawn   : [ { num, runs } ] // ready ⬜: deps ✅, not assigned, lowest first, live+spawn ≤ max.
                            //   runs auto → autonomous builder; runs you → hands-on scribe (§2.6).
                            //   BOTH count against maxWorkers.
  review  : [ workerId ]    // workers in phase "review-ready" (implemented, need a fresh reviewer).
                            //   Only auto workers reach this; a you worker skips review (§2.6)
  merge   : [ taskBranch ]  // workers in phase "done", AT MOST ONE per pass — merged into the
                            //   FEATURE branch, not main (DESIGN §2.9)
  close   : [ workerId ]    // workers whose task merged; the implement session when its task is
                            //   handed a fresh reviewer (closed as review starts, §2.1); plus any
                            //   assignment with live=false
  promoteToMain : boolean   // true only when every task is ✅ and no worker is live: promote the
                            //   feature branch to main (the one merge to main)
```

`spawn` carries every ready task, `auto` and `you` alike, each with its `runs` marker so the loop
spawns the right kind; both kinds count against `maxWorkers` and compete for slots lowest-number
first. `promoteToMain` is the single signal that the plan is complete. When `halted`: `spawn`,
`review`, `merge` are empty, `promoteToMain` is false, and `close` is every live worker. A task
held by a live worker is never re-spawned. A dead worker (live=false or phase "dead") is always
closed, so it stops holding a slot under the ceiling.

The agent-name helpers (DESIGN §2.8), pure string work the loop uses to name workers at spawn and
to rebuild `assignments` from `claude agents --json`:

```
coordinatorName({ repo, plan }) → "@{repo} / {plan}"
workerName({ repo, plan, task }) → "@{repo} / {plan} / {task}"     // task e.g. "T05"
parseAgentName(name) → { repo, plan, task } | { repo, plan, task: null }  // coordinator ⇒ task null
```

`parseAgentName` is the inverse of the builders and tolerates the surrounding spaces; a name that
does not match the convention is reported (task null and a flag), not guessed.

## Tests

- [ ] Spawns only ⬜ tasks whose deps are all ✅; a task with a 🔍 or ⬜ dependency is not spawned.
- [ ] Each `spawn` entry carries its `runs` marker: an `auto` task yields `{num, runs:'auto'}`, a
      `you` task `{num, runs:'you'}`.
- [ ] A ready `you` task IS spawned (as a hands-on entry) and counts against the ceiling, competing
      with `auto` tasks lowest-number first.
- [ ] Never exceeds the ceiling: with 3 live and maxWorkers 4, at most 1 is spawned (auto or you).
- [ ] Lowest task number first when more are ready than the ceiling allows.
- [ ] A review-ready worker appears in `review`; it is not spawned again or merged yet.
- [ ] A `you` worker (a hands-on task's assignment) that reports done is never put in `review`; it
      goes straight to `merge`/`close`.
- [ ] The implement session of a review-ready task is in `close` (closed as its reviewer spawns),
      so a task in review holds one worker slot, not two.
- [ ] Merge is at most one task branch per pass even when two workers are done (into the feature branch).
- [ ] `promoteToMain` is false while any task is not ✅ or any worker is live, and true only when
      all ✅ and none live.
- [ ] A dead worker is closed and its slot freed.
- [ ] halted=true yields empty spawn/review/merge and closes every live worker.
- [ ] A task already assigned to a live worker is not spawned again.
- [ ] `workerName`/`coordinatorName` produce the `@{repo} / {plan}[ / T{nn}]` forms of §2.8.
- [ ] `parseAgentName` round-trips both forms; a coordinator name yields `task: null`.
- [ ] A name not matching the convention is reported, not silently parsed into a wrong task.

## Done when

- [ ] `decideDispatch` returns correct spawn (tagged auto/you) / review / merge / close for the
      cases above.
- [ ] The naming helpers build and parse the §2.8 forms and report a non-matching name.
- [ ] Both modules read no clock and no filesystem; `halted` and all state arrive as arguments.
- [ ] `npm test` is green.
