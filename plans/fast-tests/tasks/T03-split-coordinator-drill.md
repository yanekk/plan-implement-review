# T03 — split-coordinator-drill

**Phase:** 1 · **Depends on:** — · **Weight:** light

## Goal

Split `src/shell/coordinator-drill.test.mjs` (6 tests, 2 sizes × 3 drills, about 206 s serial) into files
node runs side by side, so the file's cost becomes its longest single test. Every test is kept unchanged.

## Design sections this implements

DESIGN §2.4.

## Files

- `src/shell/coordinator-drill.test.mjs` — removed, or kept holding one drill.
- `src/shell/coordinator-drill-*.test.mjs` — one file per drill × size (about six), named by drill and size.
- `src/shell/coordinator-drill-helpers.mjs` — the shared helpers (`drillRig`, `recordFrames`, `select`,
  `assertAgentRow` and whatever else more than one new file uses). Not a test file.

## Interface

No product interface. The helper module exports exactly the helpers the split files import, with the
same signatures they have in the file today.

## Tests

- [ ] Before the split, save the sorted test names:
      `node --test --test-reporter=spec src/shell/coordinator-drill.test.mjs` (names only, sorted).
- [ ] After, the same command over `src/shell/coordinator-drill*.test.mjs` gives an identical sorted list.
- [ ] Each new file passes alone.

## Done when

- [ ] The sorted test-name lists before and after are identical, and both are quoted in the commit (or
      their diff is shown empty).
- [ ] `npm test` is green and no test body or assertion changed (only `import`s and file placement).
- [ ] No new file takes longer alone than the longest test of the original file plus 10 %, quiet machine.
