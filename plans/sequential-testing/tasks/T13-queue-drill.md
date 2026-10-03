# T13 — queue-drill

**Phase:** 4 · **Depends on:** T07, T08, T09, T11, T12 · **Weight:** medium

## Goal

A worker uses the whole flow on screen, as a person would, at every size: a scratch build and a scratch
single run competing for the queue against the fake Claude, the pinned line and queue view moving as
suites start and finish, a bump, a kill, a task going red and back, a third red stopping the build, and
a resume. It judges the screens against DESIGN §2.8 and the prototype, fixes what has one right answer
with a test each, and brings the person only choices with two defensible answers.

## Design sections this implements

DESIGN §2.3, §2.4, §2.5, §2.8, §2.11, through `pir-e2e § 3`.

## Files

- `src/shell/plan-rig-test-queue-drill.test.mjs` (new), plus fixes in whichever screen file the drill finds wrong

## Tests

- [ ] each drill step below becomes an assertion in the new suite, so the drill is repeatable in `npm test`

## Done when

- [ ] Every interaction below was driven at all three sizes and its result recorded in the drill suite.
- [ ] Each one-right-answer defect found is fixed with a test.
- [ ] Any two-answer choice was put to the person and their answer recorded in FINDINGS.md.

## End to end (the worker drives this)

- suite: the plan-rig rig, fake Claude (`src/shell/fake/`), scratch repos and `PIR_HOME` · sizes: 60×20, 80×24, 120×40
- each test line is a short `sleep` plus a pass or fail chosen by the scenario, so suites take seconds
- [ ] a build with two tasks and a single run report at once → only one suite runs; the pinned line and queue view show the other two waiting in report order
- [ ] bump the last entry → it runs next
- [ ] kill the running suite → its task row reads `fixing tests · try 1 of 3`; the worker received the kill reason
- [ ] a task red twice then green → rows go testing → fixing try 1 → testing → fixing try 2 → testing → review
- [ ] a task red three times → the build stops; the list row reads `◼ stopped · tests red`; the note names the task
- [ ] a commit in the stopped task's worktree, then `Ctrl+R Ctrl+R` → a fresh worker with the retest note, a green run, the build goes on
- [ ] a limit of a few seconds set in the scratch repo's settings → a hung test line times out and is reported as such
