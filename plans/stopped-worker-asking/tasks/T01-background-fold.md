# T01 — background-fold

**Phase:** 1 · **Depends on:** — · **Weight:** light

## Goal

Let pir see whether a worker still has a background job running, so a stopped worker waiting on its own
job is not read as waiting on the person. `workerActivity` gains a `background` field folded from the
CLI's `system/background_tasks_changed` events, holding an ended job until the wake-up turn opens so the
gap between the list shrinking and the wake-up's `init` never reads as stopped.

## Design sections this implements

DESIGN §2.2, §3.2.

## Files

- `src/core/stream.mjs`: `readEntry` yields a `background` event for `system/background_tasks_changed`;
  `workerActivity` folds it.
- `src/core/stream.test.mjs`.
- `src/shell/fake/claude-stream.mjs`: a helper that emits `background_tasks_changed` for a scripted job
  starting and ending, and `wakeUp()` emits the shrunken list before its `task_notification`, in the
  order the real CLI does (fixture case 5).

## Interface

```js
// src/core/stream.mjs
// readEntry: an `in` entry whose event is { type:'system', subtype:'background_tasks_changed', tasks:[…] }
//   yields { kind:'background', ids: string[] }  (tasks[].task_id, non-strings dropped)
//
// workerActivity(entries) → { …as today…, background: string[] }
//   background: ids of jobs listed in the latest background_tasks_changed, plus any id that left the list
//   since the last turn opened or ended (it is held until the next turn opens, or the open turn's
//   `result`). [] before any such event. A `resumed` note clears it.
```

```js
// src/shell/fake/claude-stream.mjs
// backgroundTasks(ids) → the background_tasks_changed event the real CLI sends with `ids` running
```

## Tests

- [ ] No `background_tasks_changed` in the log → `background: []`.
- [ ] A job listed, turn ended → `background: ['id']`, state `idle`.
- [ ] Job leaves the list while idle, no turn yet → still `['id']`.
- [ ] Then the wake-up turn's `init` → `[]` (and state `busy`); after its `result` → `[]`, `idle`.
- [ ] Job leaves the list while a turn is open → `[]` after that turn's `result`.
- [ ] Two jobs, one ends and its wake-up turn runs → the other stays listed.
- [ ] `resumed` note → `[]`.
- [ ] `src/core/fixtures/remote-answer-sample.ndjson` case 5 folded per case: `background` holds the timer
      while the worker is idle before its wake-up, `[]` after.
- [ ] `stream-sample.ndjson` still folds to the same state, turns and pending as before.
- [ ] Fake `wakeUp()` log folds like the real case-5 sequence.

## Done when

- [ ] `workerActivity` returns `background` as specified, and every existing field is unchanged for the
      existing fixtures.
- [ ] The tests above pass and `npm test` is green.
