# T08 — The coordinator loop over the fake world

**Phase:** 2 · **Depends on:** T07 · **Weight:** medium

## Goal

Wire the pure decisions to the (fake) shell in one loop and prove the whole thing drains a plan.
Each pass: gather state (parse `PROGRESS.md`, list agents, read the mailbox, read the control
flag), call `decideDispatch`, execute its spawn / merge / close actions through the shell
interface, apply caps to every send, fold merged results back with `reconcileTaskRow`, and log
every cap hit and lifecycle event. Run against the T07 fakes, a fake plan of several tasks with
dependencies drains to all-`✅` with no real agent. This is the end-to-end proof of the wiring
before anything real.

## Design sections this implements

DESIGN §3.3 (the decision function in its loop), §3.4 (data flow), §2.4 (caps applied to sends),
§2.5 (serialized merge, halted behaviour).

## Files

- `src/shell/loop.mjs` — the coordinator cycle, taking its shell as an injected dependency.
- `src/shell/loop.test.mjs` — run against the T07 fakes.

## Interface

```
runPass({ shell, slug, limits, now }) → { actions, log }
  // one pass: gather → decideDispatch → execute → reconcile → return what happened + log lines.
  // `shell` is the injected interface (fake in tests, real in T11+). `now` is passed in.

drain({ shell, slug, limits, clock }) → summary
  // repeat runPass until no ready tasks and no live workers, or halted. `clock` is injected.
```

The loop calls `checkRate` before every send and skips (and logs) a send that would breach it.
When the control flag is present the loop dispatches nothing, closes every worker, and stops.

## Tests

- [ ] A fake plan of e.g. 5 tasks with a dependency chain drains to all-`✅`.
- [ ] Two independent ready tasks are worked concurrently (two fake workers live at once).
- [ ] The worker ceiling is respected across passes (never more than maxWorkers live).
- [ ] Merges are serialized: two done workers do not both merge in one pass.
- [ ] A cap breach is logged and the send skipped, not silently dropped.
- [ ] Setting the control flag mid-drain stops dispatch and closes every fake worker.
- [ ] A fake worker's question pauses that task and a supplied answer resumes it.

## Done when

- [ ] `drain` takes a fake plan to all-`✅` with dependencies and the ceiling both respected.
- [ ] Caps and the kill switch are honoured in the loop and every event is logged.
- [ ] `npm test` is green.
