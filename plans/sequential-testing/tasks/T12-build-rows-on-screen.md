# T12 — build-rows-on-screen

**Phase:** 4 · **Depends on:** T03, T05, T06 · **Weight:** medium

## Goal

Paint what the gate and the stop now report: the three new task row kinds in a build's live view, with
their styles, the end gate's queued footer, and on the dashboard list a build stopped by a third red,
reading `◼ stopped · tests red` with its stale note.

## Design sections this implements

DESIGN §2.4 (row and note), §2.8 (build rows, end gate footer).

## Files

- `src/shell/render.mjs` (style tables for `tests-queued`, `testing`, `fixing-tests`; the queued footer), its test
- `src/shell/pir-tui.mjs` (the stopped row's state text and the stale note from T03), its test
- `src/shell/plan-rig-build-tests.test.mjs` (new)

## Interface

The new kinds are working rows, painted in the active (cyan) style with the spinner; none is amber. The
stopped-tests-red row is dim like any stopped row, with the reason in its stale note.

## Tests

- [ ] render style table has an entry for each new kind; NO_COLOR output carries the same text
- [ ] the stale note for a tests-red stop lists task, reason, log, worktree and the resume line

## Done when

- [ ] The end-to-end tests below are green in `npm test`.
- [ ] Texts match DESIGN §2.4 and §2.8.
- [ ] No existing render or dashboard expectation changes.

## End to end (the worker drives this)

- suite: the plan-rig pseudo-terminal rig, new file `plan-rig-build-tests.test.mjs` · sizes: 60×20, 80×24, 120×40
- fake build snapshots in a scratch `PIR_HOME`
- [ ] a live view with tasks queued 1st and 3rd, one testing, one fixing try 2 → each row's exact text, spinner on all four, none amber, the run not counted as asking
- [ ] an end gate snapshot with testsQueued → the footer's queued text
- [ ] a stopped build with stopReason → the list row reads `◼ stopped · tests red`; opening it shows the stale note
