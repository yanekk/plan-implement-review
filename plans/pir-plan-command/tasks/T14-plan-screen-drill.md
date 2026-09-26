# T14 — plan-screen-drill

**Phase:** 2 · **Depends on:** T11, T12, T13 · **Weight:** medium

## Goal

A worker uses the whole planning flow through the real screen, at both sizes, and judges it against
DESIGN §2.10–§2.14 and the approved prototype: every state readable, every key doing what its hint
says, nothing clipped or misaligned, no dead end. It fixes what has one right answer, with a test each,
and brings the person only a choice with two defensible answers.

## Design sections this implements

DESIGN §2.8, §2.10–§2.14, §2.16 (as seen on screen); `pir-e2e` drill.

## Files

- `src/shell/plan-rig.test.mjs` (a drill test per fix)
- whichever screen file a fix lands in

## The drill

Under the T10 rig, at 80×24 and 120×40, drive and read each of:

- `pir plan` box → landing → answer the question → `←` → steps view → dashboard row while planning.
- The rename as seen in the steps view and in the list (label → slug).
- Reviewer asking a permission (script variant) → answered from the conversation.
- The go: start → build view → green hand-off; not now → finished note; `pir start {slug}` afterwards.
- Stop mid-review, resume with Ctrl+R Ctrl+R, the conversation continuing.
- Script variants 'no-plan', 'taken-slug', 'crash-planner': what the row, the steps and the footer say.
- `pir {slug}`, `pir start` with no slug, `pir start` on an unreviewed branch plan: the messages.

## Tests

- [ ] One end-to-end drill test per defect fixed, named after what it proves.

## Done when

- [ ] Every item of the drill driven at both sizes; findings (fixed or raised) in `FINDINGS.md`.
- [ ] No open defect with one right answer; choices with two answers raised with the person and settled.
- [ ] `npm test` green.

## End to end (the worker drives this)

- suite: `src/shell/plan-rig.test.mjs` · sizes: 80×24, 120×40
- [ ] The drill above, each path to its end state.
