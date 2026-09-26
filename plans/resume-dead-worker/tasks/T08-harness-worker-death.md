# T08 — harness-worker-death

**Phase:** 4 · **Depends on:** T04, T06 · **Weight:** medium

## Goal

A live-scenario harness fixture that kills one worker mid-task while the coordinator keeps running,
and facts that prove the branch was kept, the conversation revived, and the task finished, so the
live proof is a machine check rather than a reading of logs.

## Files

- `src/shell/harness/run.mjs`, `src/shell/harness/run.test.mjs`
- `src/shell/harness/fixtures/worker-death.mjs`, `src/shell/harness/fixtures/worker-death-twice.mjs`
  (one fixture per file, as `restart-review.mjs` / `restart-implement.mjs`), `src/shell/harness/fixtures.mjs`
- `src/shell/harness/assertions.mjs`, `src/shell/harness/assertions.test.mjs`

## Interface

```js
fixture.killWorker = { waitFor: { task: 'T01', commit: 'T01: part 1' }, times: 1 | 2 }
// two fixtures runnable by name: worker-death (times 1), worker-death-twice (times 2)
// run.mjs: reuse waitForTarget/restartTargetReached; read the scratch run's control/workers.json for
// the named task's implement worker ({ id, task, role, pid, startTime }), check the pid's start time
// (identity.mjs) and process.kill(pid, 'SIGKILL'); keep waiting on the same coordinator; record
// { task, head, id } as kill-point.json in the bundle. The second kill waits for the revived worker
// to appear in workers.json under the same id.
facts: branchKeptAfterDeath, revivedSameSession, fellBackAfterSecondDeath, neverTwoWorkersPerTask,
       taskCompleted
// revivedSameSession reads the task's conversation log: an `exited` note, a `revived` note, and later
// `init` events carrying the same session id as before the kill.
```

## Tests

- [ ] Each fact passes and fails on hand-built bundles (non-vacuous), in `npm test`.
- [ ] The kill step targets only the named task's implementer, and never a pid whose start time differs from its record.
- [ ] The existing "no harness module calls `claude agents`" test still passes.

## Done when

- [ ] `node src/shell/harness/run.mjs worker-death` and `worker-death-twice` exist and their facts are unit-tested.
- [ ] Every test passes in `npm test`.
