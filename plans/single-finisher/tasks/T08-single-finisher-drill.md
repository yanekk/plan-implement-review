# T08 — single-finisher-drill

**Phase:** 3 · **Depends on:** T06, T07 · **Weight:** medium

## Goal

A worker uses the whole new ending through `pir`'s real screen, at every size, against the fake Claude,
and judges it against DESIGN §2.11 and the build finisher's screens the person already knows. It fixes
what has one right answer, with a test each, and brings the person only choices with two defensible
answers (`pir-e2e`).

## Design sections this implements

DESIGN §2.2–§2.12.

## Files

- `src/shell/plan-rig-single-finisher-drill-{60x20,80x24,120x40}.test.mjs` (new), using
  `plan-rig-single-drill-helpers.mjs` (extended, not copied)
- any file a found defect needs, with its test

## End to end (the worker drives this)

- suite: the single-run pty rig · sizes: 60×20, 80×24, 120×40
- [ ] happy path: `@repo/single …` → build → review → sync up to date → finisher ready → `Go` in the conversation view → `◌ finished`; the main checkout's base holds the change.
- [ ] base moved, clean merge → sync merge commit → tests → finisher.
- [ ] base moved, conflict → resolve helper asks the person a question; answer it in the view; resolved → finisher.
- [ ] red after sync → fix helper → still red → `✗ not ready`; then the base moves (a commit in the scratch repo) → re-sync → green → finisher.
- [ ] before the go, the base moves → finisher back to preparing, then a fresh ready; an old `Go` does nothing.
- [ ] `Not yet`, then `Go` → finishes.
- [ ] stop (`Ctrl+S Ctrl+S`) while waiting for the go, resume (`Ctrl+R Ctrl+R`) → finisher back, `Go` works.
- [ ] the person merges by hand in the scratch repo while the finisher waits → `◌ merged`, finisher closed.
- [ ] fallback (fake finisher that exits four times) → `● ready to merge` with the merge line.
- [ ] each screen at each size judged: words match DESIGN §2.11, amber where the person is needed and nowhere else, nothing cut mid-word.

## Done when

- [ ] The drill tests pass at all three sizes and are in `npm test`.
- [ ] FINDINGS has one row per defect fixed and per choice brought to the person, with their answer.
- [ ] `npm test` green.
