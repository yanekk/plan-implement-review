# T11 — single-drill

**Phase:** 3 · **Depends on:** T06, T09, T10 · **Weight:** medium

## Goal

Use the whole single-run flow as a person would, in the rig, at every size, and judge it against
DESIGN §2.1 and §2.8 and against the planning run's screens it is patterned on: start from the box,
answer the builder, watch a red round, follow into the reviewer, see `ready to merge`, merge, see
`merged`; also drop, stop and resume. Fix what has one right answer with a test each; bring the person
only choices with two defensible answers.

## Design sections this implements

DESIGN §2.1, §2.5, §2.8, §2.10, §2.11 (as the person meets them).

## Files

- whatever the drill's fixes touch among T09's and T10's files, each with a test
- `src/shell/plan-rig.test.mjs` (one drill scenario test that walks the full flow)

## End to end (the worker drives this)

- suite: the planning rig (T08) · sizes: 80×24, 120×40, and a narrow 60×20 to see truncation
- [ ] full flow with `single-asks` then `single-red`: every screen reads as DESIGN says, nothing overflows or wraps mid-word, amber where the person is wanted
- [ ] `single-dropped`: the row reads finished with `build ✗`, the footer gives the reason
- [ ] `single-taken`: the builder's check message is visible in its conversation, the second name wins
- [ ] the fake ntfy publisher (T06) records the asking alert and the ready alert with the right titles
- [ ] a planning run and a build beside the single run on the list read as before

## Done when

- [ ] the drill scenario test walks the full flow and is green
- [ ] every fix made has its own test; any two-answer choice was put to the person and the answer recorded in FINDINGS.md
- [ ] `npm test` green
