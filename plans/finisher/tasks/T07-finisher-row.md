# T07 — finisher-row

**Phase:** 3 · **Depends on:** T05 · **Weight:** medium

## Goal

Show the finisher in `pir`: its pinned row in the build's live view where the coordinator agent's was,
its conversation on `c` and on the row, the footer pointing at it while it waits for the go, and the
runs list reading `ready for your go`. The conversation view itself is unchanged.

## Design sections this implements

DESIGN §2.11.

## Files

- `src/core/display.mjs`: a `FINISHER_ID` row built from `runState.finisher`; words per phase; amber and
  counted in `askingCount` for `awaiting-go`, `stuck` and `asking you`; the footer line.
- `src/core/display.test.mjs`
- `src/shell/coordinate.mjs` `buildRunState`: `finisher` carried into `status.json`.
- `src/shell/pir-tui.mjs`: `c` and →/Enter open the finisher's conversation when it is the run's agent.
- `src/shell/list-view.mjs` (and `dashboard-state.mjs` if the list state is derived there):
  `● ready for your go` in amber, counted in `waiting for you`.
- `src/shell/conversation-rig.mjs`: a `finisher` scenario (a fake finisher that writes a `ready` status,
  asks the `Go` question, and on `Go` writes `done`).
- Their tests, including `pir-tui.test.mjs` and `list-view.test.mjs`.

## Tests

- [ ] Row words for each phase and for `restarting` and `given-up`; no clock; not counted in `n/m done`.
- [ ] `awaiting-go` and `stuck` count in the `asking you` tally and turn the runs list amber.
- [ ] A status.json written before this plan (no `finisher`) renders as today.
- [ ] Footer text in `awaiting-go`.
- [ ] `c` opens the finisher's conversation; with neither agent nor finisher `c` does nothing.

## End to end (the worker drives this)

- suite: the conversation rig, scenario `finisher` · sizes: 80×24, 120×40
- [ ] start the rig → live view shows `◆ finisher  waiting for your go` in amber, footer names `c`
- [ ] `c` → the conversation shows the ready summary, the steps and the `Go` question
- [ ] pick `Go` → row reads `finishing`, then `done`; the run ends `finished`
- [ ] dashboard → the run lists `● ready for your go` while waiting

## Done when

- [ ] The tests and the end-to-end cases above pass.
- [ ] `./install.sh` run and the installed `display.mjs` has the finisher row.
