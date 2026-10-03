# T06 — stop-on-third-red

**Phase:** 2 · **Depends on:** T03, T05 · **Weight:** medium

## Goal

When the pass reports `stopTests`, the coordinator stops the whole build the way the person's Stop does,
records why, and tells the person: the final status is `stopped` with the stop reason, the snapshot and
index carry it so the dashboard row and stale note can show it, and one phone alert is sent.

## Design sections this implements

DESIGN §2.4, §2.12 (teardown frees the slot).

## Files

- `src/shell/coordinate.mjs`, `src/shell/coordinate.test.mjs`
- `writeRunFinal` (also in `coordinate.mjs`) and `src/shell/index-store.mjs` if the index record needs the `stopReason` field, with their tests

## Interface

- `stopOnTests(stopReason)` in `coordinate.mjs`, sharing `tornDown` with `stopDetached` and
  `teardownOnce`: closes the person inbox and the coordinator agent, runs `teardownRun` (which cancels
  the run's queue entries, T05), writes `writeRunFinal({ reason: 'stop', stopReason, ... })`, puts
  `stopReason` on the last run state and snapshot, sends T03's `testsStopAlert` through `runNotify`
  awaited inside `notifyExitNow(extra)`, prints the reason, and exits non-zero.
- Run in the foreground (not `PIR_RUN`), it prints the same reason and the resume command and exits the
  same way.
- The index record and `status.json` carry `stopReason`, so `classifyRun` still reads `stopped` and the
  dashboard can read the reason.

## Tests

- [ ] pass result stopTests → every worker closed, the agent closed, final status stopped with stopReason
- [ ] the alert is sent once with T03's text; with no notify config nothing is sent and the stop still happens
- [ ] the snapshot's run state carries stopReason; `classifyRun` reads stopped
- [ ] branches and worktrees are left; the queue has no entry or slot of this run afterwards
- [ ] a Ctrl-C during the stop does not run a second teardown

## Done when

- [ ] A third red in the loop tests ends the coordinator as stopped with the reason on disk.
- [ ] The alert text and the record fields match DESIGN §2.4.
- [ ] The listed tests are green in `npm test`.
