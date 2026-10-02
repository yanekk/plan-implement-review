# T08 — queued-end-gate

**Phase:** 2 · **Depends on:** T02, T03, T04 · **Weight:** medium

## Goal

The end-of-build feature-branch suite (`runFeatureTests`) blocks the coordinator with `execFileSync`,
so it cannot wait in a queue, honour a limit or a kill, or keep the screen live. Make every end-gate run
(the first, after the test-fix worker, after the base sync) a queued job polled each pass, with the
same red handling as today.

## Design sections this implements

DESIGN §2.7, §2.10, §2.8 (end gate footer).

## Files

- `src/shell/coordinate.mjs` (`runFeatureTests`, `showTesting`, `runEndTests`, the `endPass` steps), `src/shell/coordinate.test.mjs`
- `src/shell/loop.mjs` (step 3f), `src/shell/loop.test.mjs`

## Interface

- `runFeatureTests` becomes `startFeatureTests(featurePath) → job` on T04's client with `meta.kind 'end'`,
  logging to `tests.log` as today (setup rewrites, tests append).
- Step 3f and the `endPass` steps that ran tests hold a pending job and poll it each pass; while queued
  the run state carries `testsQueued: { position }`, while running `testing: { since }` as today.
- A result maps to today's `{ ok, reason }`: a timeout or kill reads as red with T02's `failureReason`
  text and goes the existing red route (the test-fix worker's one attempt, the red hand-off).
- `showTesting`'s blocking paint is removed: the pass returns and the renderer paints the queued or
  running state like any other.

## Tests

- [ ] the end gate waits behind another owner's running suite, then runs, then hands off green
- [ ] while it waits the coordinator keeps passing: the inbox is read and the snapshot is rewritten
- [ ] red → test-fix worker as today; timeout → red with 'timed out after 30 min'; kill → red with the kill reason
- [ ] the base-sync rerun also queues
- [ ] HALT while the end gate is queued or running cancels it and frees the slot

## Done when

- [ ] No call path in `coordinate.mjs` runs the suite with `runLines`.
- [ ] The listed tests and the existing end-of-run tests are green in `npm test`.
- [ ] The footer reads DESIGN §2.8's queued text while waiting.
