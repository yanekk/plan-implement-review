# T08 — mouse-drill

**Phase:** 2 · **Depends on:** T05, T06, T07 · **Weight:** medium

## Goal

A worker uses the whole dashboard with the mouse, under the pty rig at every size, and judges it against
DESIGN §2, the spike in `prototype/` and the docs from T07. Anything with one right answer it fixes with a
test; any choice with two defensible answers it brings to the person. Then the engine is installed once
the code is on `main`.

## Design sections this implements

DESIGN §2, §5 (install), §5.1.

## Files

- whatever the drill's fixes touch, each with a test; `src/shell/plan-rig.test.mjs` for the drill's kept cases

## Tests

- [ ] every drill interaction below that found a defect is kept as a pty case

## Done when

- [ ] Every interaction below was driven at 80×24, 120×40 and 80×12 and matches DESIGN §2 and the docs.
- [ ] Defects found are fixed with tests; open choices were put to the person and their answers recorded in FINDINGS.
- [ ] `./install.sh` run once on `main` with no run live (or, built in parallel, the install noted under PROGRESS "Blocked on the user").

## End to end (the worker drives this)

- suite: `plan-rig.test.mjs` · sizes: 80×24, 120×40, 80×12
- [ ] list: hover each kind of row (running, crashed, finished dim), click to open, ← back, wheel through a long list
- [ ] build live view: hover and click tasks with and without a worker; wheel the task selection
- [ ] planning run: steps view and the go question; a click on a step never starts the build
- [ ] conversation: wheel through history in a live and a read-only worker; click in the box
- [ ] new-plan box: type a brief, click a run, ←, the brief is still there; click an `@repo` pop-up entry
- [ ] drag across rows: nothing opens, the injected copy receives the text
- [ ] every key from `docs/detached-runs.md`'s table still does what it says
- [ ] under `TMUX=1` in the environment: hover still bolds the row under the pointer
- [ ] quit, and SIGTERM: modes all off afterwards

## Outside actions

- Refresh the installed engine — `worker`
