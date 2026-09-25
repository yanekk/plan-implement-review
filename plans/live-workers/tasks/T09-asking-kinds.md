# T09 — asking-kinds

**Phase:** 2 · **Depends on:** T05, T08 · **Weight:** light

## Goal

The run's snapshot and live view say not only that a worker is asking the person but what kind of
answer it wants, and carry what the `pir` screen needs to open a worker: its id, whether it is live, and
its conversation log path.

## Design sections this implements

DESIGN §2.4, §2.11 (row labels, what the task row opens).

## Files

- `src/core/display.mjs` and its test (asking sub-kinds and their labels)
- `src/shell/render.mjs` and its test (the asking footer: `open it (→) to answer`, DESIGN §2.4)
- `src/shell/coordinate.mjs` start banner (the `claude agents` line → answer in `pir`)
- `src/shell/coordinate.mjs` `buildRunState`/`displayPhaseFor` (fill the new fields), and its test
- `src/core/snapshot.mjs` only if its schema needs a version bump (say so in the commit)

## Interface

```js
// runState task gains:
{ …, asking: null | 'question' | 'permission' | 'questions',
  worker: null | { id, live: boolean, logPath } , workers: [{ id, role, n, logPath }] }
// display row labels: 'asking you · a question' (report or questions), 'asking you · allow a command?'
```

A task is `asking` when it has a question/decision/conflict report (today) or its live worker's activity
is `permission` or `questions`. Report and pending request together show the request's label.

## Tests

- [ ] each asking source maps to its label; no source → the phase label as today
- [ ] summary counts `asking you` for request-only askers too
- [ ] the asking footer and the start banner name `pir`, never `claude agents` or attaching
- [ ] `worker` is the live one, else the latest; `workers` lists all of the task's in order
- [ ] an old snapshot without the new fields still reads (the dashboard of an older run does not crash)

## Done when

- [ ] `npm test` green with the tests above
- [ ] the snapshot of a fake run with a pending permission shows `asking: 'permission'` and a log path
- [ ] the existing live-view row text is unchanged for every non-asking row
