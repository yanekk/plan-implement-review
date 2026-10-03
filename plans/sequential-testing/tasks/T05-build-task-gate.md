# T05 — build-task-gate

**Phase:** 2 · **Depends on:** T02, T03, T04 · **Weight:** heavy

## Goal

Wire the per-task test gate into the build's pass. An `implemented` or `done` report no longer goes
straight to the review hand-off or the merge: the task enters phase `tests`, pir runs the plan's setup
and test lines in the task worktree through the queue, and only a green result at a clean head lets the
existing hand-off or merge go ahead. A red result goes back to the live worker as a message, with its try
count. This is the task that makes a build's green pir's word.

## Design sections this implements

DESIGN §2.1, §2.3, §2.9, §2.12 (worker death, HALT and teardown), §3.4, §3.5 (ledger, logs).

## Files

- `src/shell/loop.mjs`, `src/shell/loop.test.mjs`
- `src/shell/coordinate.mjs`, `src/shell/coordinate.test.mjs`
- `src/core/dispatch.mjs` and `src/core/asking.mjs` only if `tests` needs naming there (it must not be in `WORKING`)

## Interface

- New phase `TESTS = 'tests'` in `loop.mjs`. `applyMessages`: `implemented` and `done` set `phase = 'tests'`
  and `t.gate = { role, report: { kind, head } }` instead of `review-ready` / `done`.
- Each pass, for every task in `tests` (and for a task in `implementing`/`reviewing` whose new report
  arrived), the loop reads head and cleanliness through `worktree`, calls T02's `decideTaskTests`, and:
  `enqueue`/`rerun`/`requeue` → `tests.startQueuedLines(block.setup + block.test lines, { cwd: worktree,
  logPath: control/tests-T{nn}-{n}.log, meta, limitMs })`; `green`/`skip` → ledger write, then
  `review-ready` (role implement) or `done` (role review), so today's 3c/3d steps run unchanged;
  `leftover` → send `leftoverMessage`; `red` → send `redMessage`, `t.tries++`, `t.fixing = { tryNo }`,
  phase back to `implementing`/`reviewing`; `stop` → the pass result carries `stopTests: stopReason(...)`
  (acted on by T06; until then the loop treats it as a halt).
- `onlyPlanFiles` is `git diff --name-only {greenImplementSha} {head}` listing only paths under
  `plans/{slug}/`. Not `git log --name-only`, which omits a merge commit's changes, so the reviewer's
  integrate merge of the feature branch would wrongly skip the run.
- `runPass` options gain `tests` (the queue client) and `ledger` (`{ read(), write(num, role, sha) }`,
  backed by `control/tests.json`, temp-then-rename).
- `buildRunState` / `displayPhaseFor` carry `tests` and `fixing` onto each task (T03's shape).
- HALT and `teardownRun` call `tests.cancelAll()`; a task whose worker dies cancels its job.
- `coordinate.mjs` constructs the client (`createTestQueue({ owner: this process })`), reads the limit
  with T01's `effectiveTimeout` from the repo's settings at start, and adds `tests.watchPath` to the
  waker's watched folders.

## Tests

- [ ] fake platform: implemented → tests (queued, then running) → green → reviewer spawned; done → tests → green → merged
- [ ] red once → worker sent the try-1 message, row fixing tests try 1; re-report → green → onward
- [ ] three reds for the implementer → pass result stopTests with the T02 reason; implementer's 2 reds do not count for the reviewer
- [ ] head moved after a green → rerun; dirty after green → leftover message sent once, waits for a new report
- [ ] a new report while queued for an older head → old job cancelled, new one queued
- [ ] reviewer commits touching only plans/{slug}/ → skip, no run, merge goes ahead; a reviewer merge of the feature branch that brings code → no skip
- [ ] a task in tests never reads asking and its worker gets no Remote Control; a pending permission request still reads asking
- [ ] HALT and teardown cancel queued and running jobs and free the slot
- [ ] ledger written on each green; the log names count up per task
- [ ] the coordinator's waker wakes on a slot change in the queue folder

## Done when

- [ ] A build in the loop tests never hands a task to review or merges it without a green run at its head.
- [ ] Every test above is green in `npm test`, with a scratch `PIR_HOME`.
- [ ] No test, new or existing, reaches the real `~/.pir/test-queue`: `coordinate` takes an injected
  queue client or dir, and every existing test that now reaches the gate gets a scratch one (DESIGN §5.2).
- [ ] The existing loop and coordinate tests pass, updated only where a report now passes through `tests`.
