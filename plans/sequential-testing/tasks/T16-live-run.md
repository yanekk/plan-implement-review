# T16 — live-run

**Phase:** 5 · **Depends on:** T13, T14, T15 · **Weight:** medium

## Goal

One real build with real Claude workers in a scratch repo, so the part no fake can prove is seen: that
real workers follow the new contract (run only a subset, wait idle for pir, fix a red running only the
failing tests) and that their suites never overlap. The worker runs it, reads the result and the
transcripts, and records what it saw.

## Design sections this implements

DESIGN §2.2, §2.3, §2.6, §5.1.

## Files

- `plans/sequential-testing/FINDINGS.md` (the result, dated)

## Outside actions

- Live build with real agents (T16) — `worker` (moved down by the user at plan review, DESIGN §5.3)
- Scratch teardown — `worker`

## Environment (the worker owns this)

```
claude auth status                       # login check; logged in, any provider
perl -e 'alarm 1800; exec @ARGV' node src/shell/harness/run.mjs sequential-testing-live --into /tmp/pir-seqtest-live
rm -rf /tmp/pir-seqtest-live             # teardown; confirm the folder is gone
```

## Automated checks (the worker runs these)

The harness's facts from T14 on the real flow log: `suitesNeverOverlapped`, `workerWaitedIdle`,
`workerRanSubset`, `redFixedWithinTries`, `reachedHandoff`. The worker records each pass or fail as
observed and reads the implementer's transcript to confirm it ran only the failing tests after the red.

## Done when

- [ ] The live run was made, and every fact's result is recorded in FINDINGS.md with the date.
- [ ] The scratch folder is removed and confirmed gone.
- [ ] A failed fact is either fixed with a test or recorded as a finding the person has seen.
