# T10 — harness-fixture-block

**Phase:** 3 · **Depends on:** T01 · **Weight:** light

## Goal

The harness fixtures declare their block, so live harness runs pass the new start check and can end
green, and the harness's green-hand-off fact actually notices a red gate. Today every fixture run ends
red on "no test command found" and no fact sees it (FINDINGS 2026-09-24).

## Design sections this implements

DESIGN §2.1, §2.5.

## Files

- `src/shell/harness/fixtures/common.mjs` — `commonPlanFiles` DESIGN starts with
  `setup: none` / `test: - npm test`
- `src/shell/harness/fixtures.test.mjs` — every fixture's DESIGN parses ok
- `src/shell/harness/run.mjs` — the coordinator child's stdout goes to
  `plans/<slug>/.parallel/control/coordinator.out` in the scratch repo instead of `ignore`
- `src/shell/harness/assertions.mjs` — `handedOffGreenBranch` also fails when that file carries the
  red hand-off line or lacks the green one
- matching tests

## Tests

- [ ] Every fixture id installs a DESIGN.md for which `parseTestBlock` is ok with test `['npm test']`.
- [ ] `handedOffGreenBranch` fails on a captured red hand-off, passes on a green one, fails on a
      missing file.
- [ ] `spawnCoordinator` writes stdout to the given file (fake spawn).

## Done when

- [ ] All fixtures carry a valid block, tested.
- [ ] The green-hand-off fact reads the coordinator's own verdict, tested against both outcomes.
