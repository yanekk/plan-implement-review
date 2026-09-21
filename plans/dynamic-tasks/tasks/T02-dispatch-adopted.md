# T02 — dispatch-adopted

**Phase:** A · **Depends on:** T01 · **Weight:** medium

## Goal

Make the coordinator act on adoption and prove both scenarios end to end. After T01 the merge
already writes new rows into the feature `PROGRESS.md`, and the loop's next-pass re-parse plus the
unchanged `decideDispatch` already dispatch them — so this task does not change dispatch. What it
adds is the loop consuming `mergeTask`'s `added`/`errors`: narrate each adopted task so the run
tells the person what it picked up, and surface a `bad-plan-change` for each rejected row so a
malformed addition is seen rather than silently dropped. Then it proves scenarios 1 and 2 in the
loop tests.

## Design sections this implements

DESIGN §2.1, §2.3 (visibility timing), §2.5 (bad-plan-change surfaced, run continues), §3.2, §3.4.

## Files

- `src/shell/loop.mjs` — at both merge sites: the live merge in `runPass` (step 3d) and the restart
  merge in `reconcile`. Read `added`/`errors` from `mergeTask`; `record('adopt', { task })` per
  adopted number and `record('surface', { kind: 'bad-plan-change', task, text })` per error. The
  merge, the reconcile of the merged task's own row, and the close are otherwise unchanged.
- `src/shell/loop.test.mjs` — the scenarios and the error case below.
- `src/core/dispatch.mjs` — **no change** (confirm in review; the whole point is the brain is
  untouched).

## Interface

```
// loop records, per merged branch:
record('adopt', { task })                              // one per adopted task number
record('surface', { kind: 'bad-plan-change', task, text })   // one per rejected row; run continues

// no new decideDispatch inputs or outputs.
```

A `bad-plan-change` surface is informational: unlike a merge conflict it does not park the worker
(the introducing task's code is good and has landed). The run continues; the person adds the task by
hand if they still want it (DESIGN §2.5, §6).

## Tests

- [ ] **Scenario 1.** Plan T00,T01,T02 (T01,T02 depend on T00). A fake worker on T01 commits a new
      T03 row (deps T01) on its branch. Drive passes: after T01 is reviewed and merged, a later pass
      spawns T03. T03 is not spawned before T01 merges.
- [ ] **Scenario 2.** A fake worker on T00 commits a new T03 row (deps T00). After T00 merges, the
      same or next pass spawns T01, T02 and T03 together (raise the ceiling so all three fit).
- [ ] An `adopt` action/log line names each adopted task.
- [ ] A branch with a forbidden edit or a bad dependency → a `bad-plan-change` surface is recorded,
      the merge still lands the introducing task as `✅`, and the run continues (not parked, not
      stalled).
- [ ] The adopted task, once dispatched, reviews and merges like any ordinary task (nothing about
      it is special after adoption).
- [ ] A run with no plan change behaves exactly as before (regression guard over existing loop
      tests).

## Done when

- [ ] The loop records `adopt` and `bad-plan-change` from `mergeTask`'s return at both merge sites.
- [ ] Both DESIGN scenarios are green in `loop.test.mjs` against the fake platform and scratch git.
- [ ] `decideDispatch` is unchanged and all existing loop tests still pass.
- [ ] `npm test` is green.
