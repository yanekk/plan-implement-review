# T14 — live-concurrent-check

**Phase:** 3 · **Depends on:** T12, T13 · **Weight:** medium

Added after T09 with the person's approval (2026-09-28). T09 ran two tasks that could have asked at the
same time, but nothing recorded whether they did; the fake agent handles one message at a time, so the
real agent receiving several briefs at once, or one mid-turn, has never been observed.

## Goal

On a real run with the real agent: two workers ask at the same time and the agent answers both, each with
its own decision; and the hold limit (T13) fires for real on a question the agent is told to leave alone,
handing it to the person, who answers it.

## Design sections this implements

DESIGN §2.3, §2.11 (hold limit), §5.1, §5.2, §5.3.

## Files

- `src/shell/harness/fixtures/pir-coordinator-concurrent.mjs` (new), registered in `fixtures.mjs`, with
  `coordinator: true`, env `PARALLEL_COORDINATOR_HOLD_MS=60000`, and a project rules file
  `.claude/pir-coordinator.md` in the fixture repo.
- `src/shell/harness/fixtures.test.mjs` if fixtures are enumerated there.
- `src/shell/harness/assertions.mjs`, test: checks read from the capture bundle (below).
- `src/shell/harness/capture.mjs` only if the bundle lacks the agent's conversation log or the ledger's
  `timeout` lines.

## Fixture

Three independent tasks at ceiling 3, harness timeout 20 min, scratch repo:

- T01 and T02: each asks, as the first action of its first turn, an AskUserQuestion the fixture's
  DESIGN.md answers (different questions). At ceiling 3 both workers start on the same pass, so the two
  briefs reach the agent together or while its turn for the other is running.
- T03: asks, as its first action, a question about a topic the rules file tells the agent to hold ("For
  questions about the release date, write no decision and do not pass them on; wait."). The project file
  wins over the skill, so the agent holds it; after 60 s the hold limit hands it to the person, and the
  harness answerer (personOnly) answers it as the person.

## Tests

- [ ] The fixture parses and registers.
- [ ] Assertions on a recorded bundle: overlap detection, one decision per item, a `timeout` ledger line
      for T03 before any answer to it.

## Done when

- [ ] Run captured, and the capture shows:
  - [ ] T01's and T02's briefs were both sent before the agent's decision for either was applied
        (conversation log and ledger timestamps). If they were not, the fixture is changed and the run
        repeated; a run without the overlap does not close this task.
  - [ ] T01 and T02 each answered by the agent, two separate ledger lines, neither ever `asking you` in a
        status snapshot.
  - [ ] T03 `asking coordinator` for about 60 s, then `asking you` with Remote Control on, a `timeout`
        ledger line, the agent's pointer in its conversation after the hand-over message, and the
        harness's answer applied.
  - [ ] The run reaches `ready to merge` with `REPORT.md` committed.
- [ ] FINDINGS.md has the dated row of what the run showed.

## Environment (the worker owns this)

```
node src/shell/harness/run.mjs pir-coordinator-concurrent --into /tmp/pir-coordinator-concurrent
# teardown: the harness tears down on finish or timeout; then confirm no worker or agent is left
touch /tmp/pir-coordinator-concurrent/plans/*/.parallel/control/HALT 2>/dev/null; rm -rf /tmp/pir-coordinator-concurrent
```

## Outside actions

- Live harness run — `worker` (DESIGN §5.3).

## Needs a person

Nothing. The harness answers T03 as the person; the phone was verified in T09.
