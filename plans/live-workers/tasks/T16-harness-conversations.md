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
- `src/shell/harness/run.mjs` (`teardownScenario` goes through the coordinator's `teardownRun` today; it
  also reaps via T06. `defaultRunClaude` and the `createPlatform({ root, runClaude })` call go. The restart
  runner's wait for a live worker reads `snap.agents` and moves to the new timeline)
- `src/shell/harness/fixtures.mjs` `carrySource`: the scratch repo runs its copied
  `src/shell/coordinate.mjs`, which from T04 imports the SDK, and the scratch has no `node_modules`. The
  carried engine must resolve its packages (for example a `node_modules` symlink to the source repo's, kept
  out of the scratch's git), or every live harness run fails at import
- `src/shell/harness/assertions.mjs` (`loadTranscripts`/`sendMessagesOf` read conversation logs; every fact that
  reads the agents timeline or transcript session ids is re-sourced from the new one: `noCloseBeforeIdle`,
  `ceilingHeld`, `reachedWidth`, `killSwitchStoppedAll`, `leftoverSessionsReaped`, `mergeConflictResolved`,
  `parkedWorkerHoldsSlot`, `handedOffGreenBranch` (through `runIdentity`; with an empty timeline it silently
  skips its main-untouched check), and `resumedNotRebuilt` and `noRebuildFrom` (through
  `implementSessionIds`). `noHelloEver` reads only the flow log and stays. Comments describing attach and
  paste are reworded)
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
- [ ] a scratch repo from `installFixture` imports the SDK from its carried `src/shell/`
