# T05 — live-asking-check

**Phase:** 3 · **Depends on:** T04 · **Weight:** medium

## Goal

See the whole rule on a real run: rows turn `asking you` only when a worker is waiting, and come back
off it at the right moment for each way the person answers, while a background wake-up leaves the row
asking. This is the final deliverable.

## Design sections this implements

DESIGN §1 success criteria, §5.2, §5.3.

## Files

- `src/shell/harness/fixtures/real-asking.mjs` (new), registered in `src/shell/harness/fixtures.mjs`.
- `src/shell/harness/fixtures.test.mjs` if fixtures are enumerated there.
- `src/shell/harness/answerer.mjs`, `answerer.test.mjs`: a scenario option that answers a report-parked
  task with a plain message through the inbox (`from: 'person'`, as the screen sends it), after a named
  condition: here, once the task's worker has had a turn after a `task_notification`. Today the answerer
  answers only pending requests (`answerPending`).
- `src/shell/harness/capture.mjs`, `capture.test.mjs` (and `run.mjs` if the tick needs it): each poll also
  copies `control/status.json` with its time into the bundle, so the row history survives the run.
  status.json alone is rewritten every half second and keeps none.

## Fixture

Two independent tasks at ceiling 2, harness timeout 15 min:

- T01: its wording is unspecified; the worker drops a `question` report, keeps working briefly (writes a
  placeholder file), then asks the person in plain text and ends its turn.
- T02: the worker starts a background `node -e "setTimeout(() => {}, 60000)"` (not `sleep`, which the Bash
  tool refuses), then drops a `question` report asking for a choice and
  ends its turn; the timer finishes and wakes it.

## Tests

- [ ] The fixture parses and registers (`fixtures.test.mjs`).
- [ ] Answerer: a parked task is answered only after its post-`task_notification` turn, never before.
- [ ] Capture: a tick records the status snapshot with its time; a missing status.json records nothing.

## Done when

- [ ] Run captured: T01 read `building` until its turn ended, then `asking you`; after the phone answer,
      `building` within one pass (from the status snapshots in the capture bundle).
- [ ] T02 stayed `asking you` during and after the wake-up turn, and left it within one pass of the
      harness's inbox answer (same snapshots).
- [ ] FINDINGS.md has the dated verified-by-hand row.

## Environment (the worker owns this)

```
node src/shell/harness/run.mjs real-asking --into /tmp/real-asking-live
# teardown: the harness tears down on finish or timeout; then confirm no worker is left
touch /tmp/real-asking-live/plans/real-asking/.parallel/control/HALT 2>/dev/null; rm -rf /tmp/real-asking-live
```

## Automated checks (the worker runs these)

- Read the bundle's status snapshots, the flow log and the conversation logs, and confirm each transition
  above with timestamps: T01's turn end against its first `asking` snapshot; Remote Control's switch-on
  (`remote_control` in T01's log) after that turn end, not before.
- T02 is answered by the harness (answerer option above); nobody types in `pir`.

## Outside actions

- Live harness run, `worker` bin (DESIGN §5.3).

## Needs a person

- When T01 reads `asking you`: "Answer T01's question on your phone, in the Claude app session named
  after T01." Tell me: when you sent it.
- Tell me: whether your phone was notified for T01 only once its turn had ended, not while it was
  still working.

Only the phone answer and what the phone showed need the person (user, plan review 2026-09-26); the T02
answer and the row history are the worker's.
