# T14 — harness-fixture

**Phase:** 5 · **Depends on:** T05, T06, T07, T10 · **Weight:** medium

## Goal

The fixture the live run (T16) uses, built and checked without spending anything: a scratch plan whose
suite has a test the task's natural first implementation breaks, so a real implementer will get a red
from pir and have to fix it; the facts the run must establish; and their assertions proven against
recorded or synthetic flow logs in `npm test`.

## Design sections this implements

DESIGN §2.2, §2.3, §4 (the real-agents layer).

## Files

- `src/shell/harness/fixtures/sequential-testing-live.mjs` (new)
- `src/shell/harness/assertions.mjs` and its test (new facts)
- `src/shell/harness/fixtures.test.mjs` (the fixture installs and its plan has a valid setup/test block)

## Interface

- The scratch plan: two tasks at ceiling 2; a `test` line that is a small `node --test` suite of a few
  files, one of which a straightforward T01 change breaks, plus a 3 s sleep so two suites at once would
  be visible.
- Facts: `suitesNeverOverlapped` (from the queue's start and end records in the flow log),
  `workerWaitedIdle` (no worker tool call between its report and pir's result), `workerRanSubset` (no
  worker command ran the whole suite line), `redFixedWithinTries`, `reachedHandoff`.

## Tests

- [ ] the fixture installs into a temp scratch repo with skills and src carried
- [ ] each fact passes on a synthetic good flow log and fails on a crafted bad one

## Done when

- [ ] The fixture installs and its assertions run in `npm test` without spawning a real agent (the harness's existing no-live-agent path, as `fixtures.test.mjs` uses for the other fixtures).
- [ ] The listed tests are green in `npm test`.
- [ ] The fixture's wall-clock timeout touches HALT.
