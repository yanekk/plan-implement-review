# T12 — task-selection

**Phase:** 3 · **Depends on:** T09, T11 · **Weight:** light

## Goal

Make the run live view's task rows selectable, the one intended change to the existing screens, and
route → / Enter on a row to a third view that T13 fills. A task with no worker yet explains itself in
the footer instead of opening.

## Design sections this implements

DESIGN §2.11 (second and last bullets).

## Files

- `src/core/dashboard.mjs` and its test (ui gains `taskSel`, view `'worker'`, `openWorker`)
- `src/shell/pir-tui.mjs` `buildWatchFrame` (selection bar on the task row) and its test

## Interface

```js
ui = { view: 'list' | 'watch' | 'worker', sel, openSlug, taskSel, openWorker: null | { taskId, workerId, logPath, live }, armed }
// events in 'watch': up/down move taskSel; open → 'worker' if the row has a worker, else a footer note;
// back → 'list' as today. In 'worker': back → 'watch' with taskSel kept.
```

## Tests

- [ ] up/down clamp to the task rows; selection survives a refresh that adds or removes rows (by task id)
- [ ] open on a task with a live worker, with only finished workers (read-only), with none (footer note)
- [ ] the selection bar draws on the selected row in the same style as the list's
- [ ] Ctrl+S in watch still arms stop for the open run; nothing else in list/watch behaviour changes

## Done when

- [ ] `npm test` green with the tests above
- [ ] opening a worker yields `openWorker` with the log path from the snapshot (T09)
- [ ] the list view is byte-identical to T11's for the same input
