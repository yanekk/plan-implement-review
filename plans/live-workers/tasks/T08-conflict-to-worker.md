# T08 — conflict-to-worker

**Phase:** 2 · **Depends on:** T05 · **Weight:** light

## Goal

When the coordinator's merge of a task branch conflicts and that task's worker is live, send it the
resolution prompt over the line instead of printing it for the person to paste. A side-choice that needs
a judgement comes back to the person as the worker's own question.

## Design sections this implements

DESIGN §2.10.

## Files

- `src/core/conflict.mjs` and its test (a worker-addressed variant)
- `src/shell/loop.mjs` step 3d and its test
- `src/shell/coordinate.mjs` `buildRunState` (carry `conflictSent` on the task) and the conflict print (it
  prints every surface carrying a `prompt`; a sent conflict records `conflict-sent` and prints nothing), and
  their tests
- `src/core/display.mjs`, `src/shell/render.mjs`, `src/shell/pir-tui.mjs` `buildWatchFrame` and their tests
  (the sent-conflict row; DESIGN §2.10)

## Interface

```js
buildConflictPrompt({ …existing, audience: 'person' | 'worker' })
// 'worker': no copy markers (the KEEP: blank is already gone for both, f3d4b8f); says merge <feature> in, resolve, run the test command,
// commit, signal done again, and ask the person if choosing a side needs a judgement.
// 'person': unchanged text, but the printed path now always has no live worker, so loop.mjs passes
//   workerName: null and the prompt never says "attach in `claude agents`" (conflict.mjs's no-worker wording).
```

runState task gains `conflictSent: boolean`. display: an asking task with a prompt and `conflictSent` is row
kind `fixing-conflict`, label `fixing conflict`, style active, no footer; without `conflictSent` it is
today's orange `conflict` row, whose footer (render.mjs) drops "(`claude agents`)". `summary.conflicts`
excludes `conflictSent` tasks. `buildWatchFrame` draws the paste block only for the unsent kind.

Loop step 3d: live worker → `platform.send(workerId, prompt, { from: 'pir' })`, record `conflict-sent`
in the control log, park the task as today until the worker re-signals done. No live worker → today's
printed prompt.

## Tests

- [ ] worker variant names the branch and files, has no copy markers, tells it to ask the person
- [ ] person variant is byte-for-byte what it was (existing tests unchanged)
- [ ] fake conflict with a live worker: the prompt is sent once, not re-sent on later passes
- [ ] the merge is retried only after the worker re-signals done, as today
- [ ] restart-reconcile conflict with no live worker still prints
- [ ] a sent conflict renders `fixing conflict` in the active style, counts as running not as a conflict, and
      draws no paste block; an unsent one is unchanged from f3d4b8f

## Done when

- [ ] `npm test` green with the tests above
- [ ] the coordinator no longer prints the paste block when a live worker exists
- [ ] the control log shows `conflict-sent` with the task id
