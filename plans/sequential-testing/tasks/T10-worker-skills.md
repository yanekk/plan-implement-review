# T10 — worker-skills

**Phase:** 3 · **Depends on:** T02 · **Weight:** light

## Goal

Tell the workers the new contract. In a parallel build a worker writes its task's tests, picks and runs
a small regression set plus its new tests, never the whole suite, then reports and waits idle for pir's
word; on a red message it reruns only the failing tests while it fixes, commits and reports the same
kind again; a retest note at spawn means checking what the person may have changed. The classic
`/pir-work` flow keeps running the whole suite.

## Design sections this implements

DESIGN §2.2, §2.3 (what the worker sees), §2.5 (the retest note), §2.9.

## Files

- `skills/pir-worker/SKILL.md` (§ The test command; the implemented and done hand-off sections, which now say the session stays open until pir's tests are green; § If a later merge of your branch conflicts, whose "Run the test command" before re-signalling done becomes the subset rule, since pir tests the re-report; a new section on pir's test messages)
- `skills/pir-implement/SKILL.md` (step 5 "Leave the test command green": parallel-mode branch pointing at pir-worker)
- `skills/pir-review/SKILL.md` (check 2 "Tests": parallel-mode branch)
- `src/core/worker-tests-skill.test.mjs` (new), golden tests over the skill text, in the style of `hand-skills.test.mjs`

## Interface

The skills quote the red message's last line and the retest note exactly as T02 words them, so a worker
recognises them. Golden phrases the test asserts (on unwrapped text):

- pir-worker: `do not run the whole suite`, `regression set`, `pir runs the whole suite`, `change nothing until pir's word arrives`, `Rerun only the failing tests while you fix them`, `a third failure stops the build`, the retest note's first sentence.
- pir-implement and pir-review: in a parallel build the whole suite is pir's (pointing at pir-worker); otherwise the old rule stands.
- pir-worker no longer says the implement session is closed straight after the report.

## Tests

- [ ] each golden phrase present in the named skill
- [ ] pir-implement and pir-review still carry the classic "leave the test command green" rule
- [ ] the red message's last line in `tasktests.mjs` appears verbatim in pir-worker (one test reads both)

## Done when

- [ ] The three skills say what DESIGN §2.2 says, for parallel and classic.
- [ ] The golden test is green in `npm test`.
- [ ] No other skill changes.
