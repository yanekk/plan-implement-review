# T07 — coordinator-drill

**Phase:** 3 · **Depends on:** T06 · **Weight:** medium

## Goal

Use the whole coordinator flow on the real `pir` screen, against the fake run, as the person would:
from a run starting, through the agent answering, passing one on, the person answering and talking to
the agent, to the report and `ready to merge`, at every size. Judge it against DESIGN §2, fix what has
one right answer with a test each, and bring the person only the choices with two defensible answers.

## Design sections this implements

DESIGN §2.3 to §2.10 as seen on screen; `pir-e2e` drill.

## Files

- `src/shell/conversation-rig.mjs` (or a sibling drill test): one scripted scenario covering the flow.
- Whatever the drill fixes, each with its test.

## The flow to drive

1. A run with three tasks and the agent on; the agent allows one permission (row never reads `asking you`).
2. A reserved request: row `asking you` at once; the agent's pointer in its conversation.
3. A pass: the pointer, then the person answers in the worker's conversation; row back to working.
4. The person opens the agent, gives an instruction, sees it delivered.
5. The run ends: `preparing` shows while the sync and report run, then `ready to merge` and the report path.
6. `--no-coordinator` run: the same screens as before this plan.

At 80×24 and 120×40. Judge: is it obvious who is waiting on whom, where to answer, and what to do at the
end? Does any label, note or line truncate or mislead?

## Tests

- [ ] The drill scenario passes in `npm test` at both sizes.
- [ ] One test per defect the drill fixed.

## Done when

- [ ] The flow above is driven end to end and passes.
- [ ] FINDINGS.md lists what the drill fixed and any choice put to the person with the answer.
- [ ] Nothing the person is asked is about how the screen looks; only choices with two defensible answers.
