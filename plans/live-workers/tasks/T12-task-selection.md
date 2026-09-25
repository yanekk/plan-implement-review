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
- `src/shell/pir-tui.mjs` `buildWatchFrame` (selection bar on the task row) and `runTui` (it pins the list
  selection by run key on refresh with `selectedKey`, and forwards `back` only in watch; both learn the task
  row and the `'worker'` view), and its test

## Interface

```js
ui = { view: 'list' | 'watch' | 'worker', sel, openSlug, openKey, taskSel, openWorker: null | { taskId, workerId, logPath, live }, armed }
// openKey (runKey, 535dd27) stays: it is how two runs of one slug from two repos are told apart.
// Task rows are the watch block's lines 1..n (line 0 is the header), in the display's row order; the bar
// replaces a row's leading '  ' with the list's '▎ ' span, so the block is no longer byte-for-byte the
// coordinator's display, on purpose.
// events in 'watch': up/down move taskSel; open → 'worker' if the row has a worker, else a footer note;
// back → 'list' as today. In 'worker': back → 'watch' with taskSel kept.
```

## Tests

- [ ] up/down clamp to the task rows; selection survives a refresh that adds or removes rows (by task id)
- [ ] ↑↓ in watch move `taskSel` only; the list's `sel` does not drift
- [ ] with two runs of one slug open in turn, the task selection belongs to the run by `openKey`
- [ ] open on a task with a live worker, with only finished workers (read-only), with none (footer note)
- [ ] the selection bar draws on the selected row in the same style as the list's
- [ ] Ctrl+S in watch still arms stop for the open run; nothing else in list/watch behaviour changes

## Done when

- [ ] `npm test` green with the tests above
- [ ] opening a worker yields `openWorker` with the log path from the snapshot (T09)
- [ ] the list view is byte-identical to T11's for the same input
