# T08 — harness-worker-death

**Phase:** 4 · **Depends on:** T04, T06 · **Weight:** medium

## Goal

A live-scenario harness fixture that kills one worker mid-task while the coordinator keeps running,
and facts that prove the branch was kept, the conversation revived, and the task finished, so the
live proof is a machine check rather than a person's reading of logs.

## Files

- `src/shell/harness/run.mjs`, `src/shell/harness/run.test.mjs`
- `src/shell/harness/fixtures/worker-death.mjs`, `src/shell/harness/fixtures.mjs`
- `src/shell/harness/assertions.mjs`, `src/shell/harness/assertions.test.mjs`
- `src/shell/harness/capture.mjs`, `src/shell/harness/capture.test.mjs` (drop `parseAgentsForCapture`
  for T02's `parseAgents`, which now keeps `sessionId` and `pid`; DESIGN §7)

## Interface

```js
fixture.killWorker = { waitFor: { task: 'T01', commit: 'T01: part 1' }, times: 1 | 2 }
// two fixtures runnable by name: worker-death (times 1), worker-death-twice (times 2)
// run.mjs: reuse waitForTarget/restartTargetReached; find the worker pid by parseAgentName
// (task, role implement) in the capture tick; process.kill(pid, 'SIGKILL'); keep waiting on the same
// coordinator; record { task, head, sessionId } as kill-point.json in the bundle
facts: branchKeptAfterDeath, revivedSameSession, fellBackAfterSecondDeath, neverTwoSessionsPerTask,
       taskCompleted
```

## Tests

- [ ] Each fact passes and fails on hand-built bundles (non-vacuous), in `npm test`.
- [ ] The kill step targets only the named task's implementer, via a fake capture tick.
- [ ] Capture tests pass unchanged against `parseAgents`; `parseAgentsForCapture` no longer exists.

## Done when

- [ ] `node src/shell/harness/run.mjs worker-death` and `worker-death-twice` exist and their facts are unit-tested.
- [ ] Every test passes in `npm test`.
