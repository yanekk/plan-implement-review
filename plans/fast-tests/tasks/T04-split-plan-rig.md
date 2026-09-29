# T04 — split-plan-rig

**Phase:** 1 · **Depends on:** — · **Weight:** medium

## Goal

Split `src/shell/plan-rig.test.mjs` (61 top-level tests, about 271 s serial; the largest 25 s, about twelve
at 8–10 s) into files of roughly 35–45 s each, so node runs them side by side. The file already has section
headers by the feature that added them (T11, T14, dashboard-plan-box T05, box-commands, …): split along
those. Every test is kept unchanged.

## Design sections this implements

DESIGN §2.4.

## Files

- `src/shell/plan-rig.test.mjs` — removed, or kept holding one section.
- `src/shell/plan-rig-*.test.mjs` — about 6–8 files, each named for its section.
- `src/shell/plan-rig-helpers.mjs` — the shared test helpers (`until`, `startRigPlan`, `rigWithTeardown`,
  `chordTwice`, `typeSettled`, `rowOf`/`clickRow`, and any other helper more than one new file uses). Not
  a test file, and distinct from `plan-rig.mjs`, which is the rig itself and is not changed here.

## Interface

No product interface. The helper module exports exactly the helpers the split files import, with the same
signatures they have in the file today. A `for` loop that generates tests stays whole inside one file.

## Tests

- [ ] Before the split, save the sorted test names of `src/shell/plan-rig.test.mjs` (spec reporter).
- [ ] After, the same over `src/shell/plan-rig*.test.mjs` gives an identical sorted list.
- [ ] Each new file passes alone.

## Done when

- [ ] The sorted test-name lists before and after are identical, shown in the commit.
- [ ] `npm test` is green and no test body or assertion changed (only `import`s and file placement; the
      fixed `pause()` calls are T06's, not this task's).
- [ ] No new file takes longer than 50 s alone, quiet machine, with the per-file times in the commit.
