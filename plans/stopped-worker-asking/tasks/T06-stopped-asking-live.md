# T06 — stopped-asking-live

**Phase:** 2 · **Depends on:** T01, T02 · **Weight:** medium

## Goal

See the rule on real workers: a worker that asks in plain text without a report reads
`asking you` as soon as its turn ends, and a follow-up question after an answer reads `asking you`
again; a worker idle behind its own background job reads `building` until the job's wake-up turn ends.
Judged by this task's worker from the run's status snapshots; no person needed.

## Design sections this implements

DESIGN §1 success criteria, §2.1, §2.2, §5.2, §5.3.

## Files

- `src/shell/harness/fixtures/stopped-asking.mjs` (new), registered in `src/shell/harness/fixtures.mjs`.
- `src/shell/harness/fixtures.test.mjs` if fixtures are enumerated there.
- `src/shell/harness/answerer.mjs`, `answerer.test.mjs`: extend the existing canned `replies` (today only
  for planning logs, `dueReplies`) so a scenario can give a build task's implementer a sequence of
  replies, one per turn it ends idle on its own text (`replyTurn`), e.g.
  `answerPending: { taskReplies: { T01: ['Hello there', 'yes'] } }`, sent `from: 'person'` through the
  inbox as the screen sends it.

## Fixture

Two independent tasks at ceiling 2, harness timeout 15 min, `statusSnapshots: true`:

- T01: wording unspecified. The worker asks the person in plain text for the wording **without dropping
  a report**, and ends its turn. After the answer, it asks one follow-up in plain text (whether to add a
  trailing full stop), again without a report, and ends its turn; then finishes. The task doc forbids the
  report on purpose, to prove the engine rule alone; T04's skill line would otherwise mask it.
- T02: the worker starts a background `node -e "setTimeout(() => {}, 60000)"` (not `sleep`), says in one
  line that it is waiting for the timer, ends its turn, and when woken writes its file. Then it starts a
  Monitor on `node -e "setTimeout(() => console.log('done'), 45000)"`, says in one line that it is waiting
  for the monitor, ends its turn, and when woken finishes. It never asks the person. The Monitor wait
  measures whether a Monitor job appears in `background_tasks_changed` (plan review, user 2026-09-27):
  pir-worker tells workers to use Monitor when they must background something.

## Tests

- [ ] The fixture parses and registers.
- [ ] Answerer: a build implementer idle on its own text gets the next reply in its sequence, once per
      turn, and none after the sequence is spent.
- [ ] Answerer: a task with no `taskReplies` entry (T02) gets nothing.
- [ ] Answerer: planning `replies` behave as before.

## Done when

- [ ] Run captured. T01's rows (status snapshots): `asking` within one pass of each of its two asking
      turns ending, `building` within one pass of each reply; `remote_control` on after each asking turn
      ended, off after the reply.
- [ ] The flow log has no `surface` line for T01. If the worker dropped a report anyway, the run proved
      the report park, not the stopped rule: tighten the task doc and run again.
- [ ] T02's rows never read `asking` during the timer; `building` through its wake-up turn.
- [ ] T02's conversation log shows whether the Monitor's job was listed in `background_tasks_changed`,
      and with which `task_type`; recorded in the FINDINGS row. If it was not listed, T02 read `asking`
      during the monitor: stop and bring that to the user before T05, since the rule then misreads every
      worker waiting on a Monitor.
- [ ] The run hands off a green branch (`handedOffGreenBranch`) with ceiling 2 held.
- [ ] FINDINGS.md has a dated worker-driven row with the transition times.

## Environment (the worker owns this)

```
node src/shell/harness/run.mjs stopped-asking --into /tmp/stopped-asking-live
# teardown: the harness tears down on finish or timeout; then confirm no worker is left
touch /tmp/stopped-asking-live/plans/stopped-asking/.parallel/control/HALT 2>/dev/null; rm -rf /tmp/stopped-asking-live
```

## Automated checks (the worker runs these)

- Read the bundle's status snapshots, the flow log and the conversation logs, and match each row
  transition above to the turn's `result` time in the conversation log.

## Outside actions

- Live harness run, `worker` bin (DESIGN §5.3).
