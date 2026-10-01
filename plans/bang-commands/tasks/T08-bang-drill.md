# T08 — bang-drill

**Phase:** 2 · **Depends on:** T06, T07 · **Weight:** medium

## Goal

A worker uses the whole feature as the person would, in each kind of session, at every size, and judges
the screens against DESIGN §2 and the prototype: a build worker, the coordinator agent (`!` only), a
planner, and a single run's builder. It fixes what has one right answer, each fix with a test, and brings
the person only choices with two defensible answers.

## Design sections this implements

DESIGN §2 whole; §2.5 in particular (every session kind).

## Files

- `src/shell/plan-rig-*.test.mjs` (new file `plan-rig-bang-drill.test.mjs`) — `!` in a planner's and a
  single builder's conversation through `startPlanRig`/`startSingle`, and a hand request from the planner.
- `src/shell/coordinator-drill-*.test.mjs` or a new rig test — `!` in the coordinator agent's
  conversation (opened with `c`), and a worker's hand request showing `asking you`, never `asking
  coordinator`, with the agent up.
- Whatever T06/T07 code a drill finding fixes, with its test.
- `plans/bang-commands/FINDINGS.md` — what the drill saw, written as worker-driven.

## Tests

- [ ] `!` runs in the planner's worktree and the single run's worktree (the block shows `pwd` output naming it).
- [ ] the coordinator agent's `!` runs in the feature worktree and the agent receives the message.
- [ ] a worker's hand request with the agent on: row `asking you · run a command`, the agent's conversation shows no answer to it.
- [ ] closing the screen while `sleep 3; echo done` runs, reopening: the block shows `done` and `sent to …` (the host kept it).

## Done when

- [ ] The drill ran at 60×20, 80×24 and 120×40 in each session kind; its tests are in `npm test`.
- [ ] FINDINGS has a dated worker-driven row; every one-answer issue is fixed with a test.

## End to end (the worker drives this)

- suite: `plan-rig`, `conversation-rig` and the coordinator drill · sizes: 60×20, 80×24, 120×40
- [ ] every interaction of T06 and T07 once more in each session kind, judged against DESIGN §2.8 and the prototype.
