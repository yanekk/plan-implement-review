# T09 — live-coordinator-check

**Phase:** 3 · **Depends on:** T07, T08 · **Weight:** medium

## Goal

See the whole feature on a real run with real workers and the real agent: routine items answered by the
agent, a reserved one reaching the person, a pass reaching the person's phone only then, and the run
ending in `ready to merge` with a committed report. This is the final deliverable.

## Design sections this implements

DESIGN §1 success criteria, §5.1, §5.2, §5.3.

## Files

- `src/shell/harness/fixtures/pir-coordinator.mjs` (new), registered in `fixtures.mjs`, with
  `coordinator: true`, and a project rules file `.claude/pir-coordinator.md` in the fixture repo.
- `src/shell/harness/fixtures.test.mjs` if fixtures are enumerated there.
- `src/shell/harness/answerer.mjs`, test: with the agent on, answer only items the run state shows held
  by the person (today it answers every request at once and would race the agent); a scenario may type
  a `deny` for a permission (today it always allows).
- `src/shell/harness/scenario.mjs`, `run.mjs`, tests: a scenario step that commits to the scratch repo's
  main once a named task has merged (no mid-run main commit exists today).

## Fixture

Two independent tasks at ceiling 2, harness timeout 20 min, scratch repo with
`permissions.ask: ["Bash(git push:*)"]` in `.claude/settings.json`:

- T01: its DESIGN answers a naming question; the worker asks it with AskUserQuestion. The agent should
  answer it from DESIGN.
- T02: the worker runs `git push origin HEAD` (no remote: fails harmlessly) → reserved, the person's;
  then drops a `question` report and asks in plain text (not AskUserQuestion, so the harness answerer
  leaves it alone) a question the plan leaves open, which the fixture rules file says to pass on ("pass questions about the
  public API to the person") → the agent passes it.
- Main gets one extra commit touching a file T01 edits, made by the fixture after T01 merges, so the
  end sync meets a conflict.

## Tests

- [ ] The fixture parses and registers.
- [ ] Answerer: an item held by the coordinator is left alone; a typed `deny` is sent as a deny.
- [ ] The main-commit step fires once, after the named task's merge, in a fake run.

## Done when

- [ ] Run captured: T01's question answered by the agent (ledger line, no `asking you` snapshot for T01).
- [ ] T02's push reached the person; T02's passed question switched its Remote Control on only after the
      pass (conversation log timestamps), and the person answered it on the phone.
- [ ] The run reached `ready to merge` with `REPORT.md` committed on the fixture's feature branch, the
      conflict resolved, tests green; FINDINGS.md has the dated verified-by-hand row.

## Environment (the worker owns this)

```
node src/shell/harness/run.mjs pir-coordinator --into /tmp/pir-coordinator-live
# teardown: the harness tears down on finish or timeout; then confirm no worker or agent is left
touch /tmp/pir-coordinator-live/plans/*/.parallel/control/HALT 2>/dev/null; rm -rf /tmp/pir-coordinator-live
```

## Automated checks (the worker runs these)

- From the capture bundle: the ledger, status snapshots and conversation logs confirm each Done-when
  line with timestamps. The T02 push request is answered by the harness answerer (deny), not by a person.

## Outside actions

- Live harness run — `worker` (DESIGN §5.3).

## Needs a person

- When T02 reads `asking you` for the passed question: "Open the coordinator's session on your phone,
  follow its pointer to T02's session, and answer there."
  Expect: the pointer names T02 with a reason and a suggestion; T02's session appears on the phone only
  now. Tell me: whether T02 appeared on the phone only after the pointer, and when you answered.
