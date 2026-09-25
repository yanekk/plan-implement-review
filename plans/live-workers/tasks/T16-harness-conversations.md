# T16 — harness-conversations

**Phase:** 4 · **Depends on:** T05, T06 · **Weight:** heavy

## Goal

The live-scenario harness watched workers through `claude agents --json` and copied their transcripts
from `~/.claude/projects`. Live workers write their own conversation logs, so the harness captures those
instead, tears down through `workers.json`, and its assertions read the logs. Without this the live
checks in T13 and T18 have no evidence to show.

## Design sections this implements

DESIGN §2.3, §2.12, §4.

## Files

- `src/shell/harness/capture.mjs` (capture `conversations/` and `workers.json`; the `agents --json` timeline
  becomes a timeline of `workers.json` plus each worker's activity from its log, one entry per tick)
- `src/shell/harness/run.mjs` (`teardownScenario` reaps via T06, not `platform.list/close`)
- `src/shell/harness/assertions.mjs` (`loadTranscripts`/`sendMessagesOf` read conversation logs; every fact that
  reads the agents timeline is re-sourced from the new one: `noHelloEver`, `noCloseBeforeIdle`, `ceilingHeld`,
  `reachedWidth`, `killSwitchStoppedAll`, `leftoverSessionsReaped`, `mergeConflictResolved`,
  `parkedWorkerHoldsSlot`)
- their tests; fixtures only if a fixture relies on `claude agents` fields

## Tests

- [ ] capture bundles every `conversations/*.ndjson` and `workers.json` of the run
- [ ] assertions that counted transcript messages give the same answers from conversation logs
- [ ] each re-sourced timeline fact passes and fails on the same recorded cases as before
- [ ] teardown reaps recorded pids and leaves no worker alive (fake pids in tests)
- [ ] no harness path calls `claude agents` any more

## Done when

- [ ] `npm test` green
- [ ] `grep -rn "agents --json" src/shell/harness` finds nothing live
- [ ] a harness dry scenario produces a bundle with conversation logs in it
