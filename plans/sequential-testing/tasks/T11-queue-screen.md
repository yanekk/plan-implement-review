# T11 — queue-screen

**Phase:** 4 · **Depends on:** T01, T04 · **Weight:** heavy

## Goal

The person's handle on the queue: a pinned line above the runs on the dashboard list, and a queue view
it opens, showing the running suite and the waiting list, with `b` to bump the selected entry to the
front and `Ctrl+K Ctrl+K` to kill the running suite. It reads the queue folder through T04's read-only
client and writes only bump and kill requests.

## Design sections this implements

DESIGN §2.7 (kill), §2.8 (pinned line, queue view), the prototype `prototype/index.html` as direction.

## Files

- `src/shell/queue-view.mjs` (new), `src/shell/queue-view.test.mjs` (new)
- `src/shell/list-view.mjs` (the pinned line as the first selectable row, click and keys), its test
- `src/shell/pir-tui.mjs` (constructs the read-only client, routes to the view, refresh), its test
- `src/shell/render.mjs` or `palette.mjs` only for the view's styles
- `src/shell/plan-rig-test-queue.test.mjs` (new), using `plan-rig.mjs` and `plan-rig-helpers.mjs`

## Interface

- List: the pinned line is row 0 of the selection; `↑` from the first run selects it; `↵`, `→` or a click
  opens the queue view. The empty-list line `No runs yet …` still shows below it.
- Queue view: `RUNNING` and `WAITING` sections from T01's `queueView`; keys `↑↓` pick, `b` bump
  (`client.bump(id)`), `Ctrl+K` arms and a second `Ctrl+K` calls `client.requestKill(runningId)`, any
  other key disarms, `↵` opens the selected entry's run (its live view or steps view), `←` back, `esc`
  quit. Footer lists the keys. `nothing waiting` when empty.
- Refresh on the dashboard's tick and on a change in the queue folder.

## Tests

- [ ] queue-view model to frame: running and waiting rows, empty queue, long names clipped at 60 columns
- [ ] key handling: bump calls the client with the selected id; Ctrl+K once arms, twice kills, once then another key disarms
- [ ] `↵` on a waiting entry opens its run

## Done when

- [ ] The end-to-end tests below are green in `npm test`.
- [ ] The view matches DESIGN §2.8's texts and keys.
- [ ] The dashboard never signals a process from this view.

## End to end (the worker drives this)

- suite: the plan-rig pseudo-terminal rig, new file `plan-rig-test-queue.test.mjs` · sizes: 60×20, 80×24, 120×40
- scratch `PIR_HOME` seeded with a slot and three entries from fake owners (fake identity, real files)
- [ ] dashboard opens → the pinned line shows the running entry and `3 waiting`; with an empty queue it reads `idle`
- [ ] `↑` to the pinned line and `↵` → the queue view with the running entry and three waiting rows in order
- [ ] `↓↓` then `b` → the third entry moves to position 1 on screen and in its file's `order`
- [ ] `Ctrl+K` → the amber arm line; `Ctrl+K` → a `kill/{id}` file exists; `Ctrl+K` then `↓` → no file
- [ ] a click on the pinned line opens the view; `←` returns to the list with the line selected
- [ ] at 60×20 the waiting table clips without wrapping and the footer stays on screen
