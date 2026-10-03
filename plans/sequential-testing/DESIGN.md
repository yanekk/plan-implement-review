---
setup:
  - test ! -f package-lock.json || npm ci
test:
  - npm test
---

# Sequential testing — Design

How parallel mode behaves is canonical in `/docs`. This file is build-time rationale for this plan;
T15 carries the resulting behaviour into `/docs` (a new `docs/test-queue.md` and the pages it changes)
and the README. It never edits a finished plan's DESIGN.md.

## 1. Purpose

In a parallel build today every worker runs the whole test suite itself, several at once, and pir runs
it only once, on the finished feature branch. Suites running side by side overload the machine and make
load-sensitive tests flaky (the `fix-load-sensitive-tests` single run, 2026-10-02), and a session's
claim that it ran the suite is not pir's word. A single run already has a pir-owned testing step
(`docs/single-runs.md`); a plan build does not.

This plan gives a plan build the same kind of step, per task and before the merge, and puts every suite
pir runs on this machine into one queue that runs one suite at a time, with a dashboard screen to watch
and steer it. It is for the person running builds on their own machine.

### Success criteria

- No task branch reaches review, or merges into the feature branch, unless pir ran the plan's whole
  suite green on the exact commit being handed on.
- At no moment do two pir-run suites execute at once on the machine, across every repo and run kind.
- A task whose suite is red three times for one worker stops the whole build, with an alert naming the
  task, and a resume gives it three fresh tries.
- The person can see the queue, bump a waiting entry to the front, and kill the running suite.
- Workers no longer run the whole suite in a parallel build; the classic `/pir-work` flow is unchanged.

### Stance

- Green is pir's word, never a session's. This is the single-run rule, extended to builds.
- The machine is protected over throughput: a long queue is accepted; two suites at once is not.
- A worker stays responsible for its own red: pir reports, the worker fixes, pir judges.

---

## 2. Behaviour specification

### 2.1 Where and when pir tests a task

pir runs the plan's suite in the task's worktree, on the task branch, twice per task: after the
implementer's `implemented` report and before the review hand-off, and after the reviewer's `done`
report and before the merge into the feature branch. Testing before the merge keeps a red task off the
feature branch, where every later task would build on it; testing after review too catches what the
reviewer's fixes and its integrate merge of the feature branch broke.

A run is the plan's `setup` lines then its `test` lines, read from the plan's home as `runFeatureTests`
reads them, each through `/bin/sh -c` from the worktree root, stopping at the first failing line.
Setup runs every time because the task may have changed its dependencies, as in a single run.

The reviewer's run is skipped when every commit since the implementer's green sha touches only files
under `plans/{slug}/`. The reviewer always commits its `✅` mark, so "no commits" would never apply; a
change to the plan's own tracking files cannot change what the suite tests.

### 2.2 What a worker does about tests

In a parallel build (the `pir-worker` contract), a worker writes the tests its task needs, picks a
small regression set of existing test files that cover what it touched, and runs only those and its new
ones. It does not run the whole suite: pir does, one suite at a time, and a worker's own suite run is
the load this plan exists to remove. After a red result it reruns only the failing tests while it
fixes them.

It commits, reports `implemented` or `done` as today, and then changes nothing until pir's word
arrives. It stays open and idle while it waits; it is not closed until its test result is green. The
classic `/pir-work` flow keeps "leave the test command green": no pir runs tests there, so the session
is still the only one that can.

### 2.3 The task gate, step by step

1. **Report.** pir accepts the report as today, records the task branch head, and enqueues a suite
   run for it (§2.6). The task's phase becomes `tests`, sub-state `queued` and then `running`.
2. **Green, at the recorded head, clean worktree.** The step is done: the review hand-off or the merge
   goes ahead as today, through the existing idle gate. The green sha is written to the ledger (§3.5).
3. **Green, head moved.** The worker went on committing. pir runs again on the new head.
4. **Green on the recorded head, worktree dirty.** pir sends the leftover message (§2.9) and waits for
   a new report of the same kind. Tests that write files git does not ignore would otherwise travel
   with the merge.
5. **Red.** The worker's try count for this role goes up by one. Below three, pir sends the red message
   (§2.9) and the task returns to `implementing` or `reviewing`, read as `fixing tests`; the worker
   fixes, commits and reports the same kind again, and the gate starts over. At three, the build stops
   (§2.4).

A run is red when a setup or test line exits non-zero, when the time limit kills it, or when the person
kills it from the queue screen. All three use up a try, because each leaves the commit unproven.

A report that arrives while a run for an older head is queued or running cancels that run and enqueues
one for the new head; a result for a head that is no longer the branch head is discarded. The implementer
and the reviewer each have their own three tries, because they are different sessions with different
changes to answer for.

While a task is in `tests` its worker is waiting on pir, not on the person: it never reads `asking you`,
holds no Remote Control, and sends no alert. A permission request or question set it opens anyway still
reads asking, by the existing pending-request rule. A task in `tests` keeps its slot under the ceiling,
because its worker is still alive and may be sent work.

### 2.4 The third red stops the build

On a worker's third red the coordinator stops the whole build, as the person's Stop does: it closes every
worker and the coordinator agent, kills its queued and running suites, leaves every branch and worktree,
and records the final status `stopped` with a reason
`{ kind: 'tests-red', task, taskSlug, role, reason, logPath, tries: 3 }`. The person asked for a stop rather than
a parked task, because other tasks would otherwise build on a broken area unnoticed.

It sends one phone alert, `{slug} · stopped`, body `T{nn} {task-slug}: pir's tests failed 3 times
({role}). {reason}`, when alerts are set up. The dashboard row reads `◼ stopped · tests red`, and the
stale note names the task, the reason, the log, the task worktree, and that a resume gives three fresh
tries. The coordinator agent never sees the third red and cannot override it: it is a rule of the run,
not a question.

### 2.5 Resume after the stop

The person may work in the task worktree while the build is stopped, committing or leaving edits.
Resume is the existing one (`Ctrl+R Ctrl+R`, `pir start {slug}`). Reconciliation reads the ledger:

| Task branch | Green recorded for | Action |
|---|---|---|
| `🔍` | implement, at any sha | review, as today |
| `🔍` | none for implement | a fresh implementer with the retest note |
| `✅` | review, at the branch head | merge, as today |
| `✅` | anything else | a fresh reviewer with the retest note |
| other | — | resume, as today |

The retest note, appended to the worker's opening instruction as the setup note is, says the build was
stopped (or restarted) before pir's tests passed on this task, that the person may have changed the
worktree, and to check `git status` and `git log`, commit what is there if it belongs to the task, run
the tests that failed, and report the same kind again. A fresh worker of the same role is used because
a build restart has no way to reopen a closed worker's session (the unbuilt `resume-dead-worker` plan);
the old conversation stays readable in `conversations/`.

A `🔍` branch whose implement green is older than its head is a review the stop interrupted, the
reviewer's commits on top. A fresh reviewer carries it on; its `done` is tested before the merge, so
nothing merges untested (user, plan review 2026-10-02: cheaper than a fresh implementer re-proving work
that already passed, and the implementer would be holding a reviewer's half-done fixes).

Try counts are not persisted, so every worker starts with three. That gives the person's resume three
fresh tries, as they decided, and a crash restart gets the same, which is harmless. A missing ledger, as
in a run started before this plan, counts as no green: a `🔍` or `✅` branch is retested, never merged
untested.

### 2.6 The machine-wide queue

Every suite pir runs on this machine waits in one queue and runs one at a time: task gate runs, the
end-of-build runs (§2.10), and single runs' test and baseline runs (§2.11). Suites running side by side
are what overload the machine, so the rule spans every repo, run and run kind.

- **Order.** First come, first served by enqueue time. The person may bump one waiting entry to the
  front; a bump moves that entry only and the run's later entries queue normally. A running suite is
  never preempted, since stopping a half-done suite wastes its work and proves nothing.
- **The entry.** One suite run: its run, repo, kind, task and role, try number, worktree, and time
  limit. Waiting in the queue costs nothing: no process runs until the entry holds the slot.
- **The slot.** One holder at a time, taken by the owner process (the coordinator or the single-run
  program) of the first live entry. The owner starts the command, enforces the limit, and releases the
  slot when the command settles.
- **Leaving.** An entry leaves when its run finishes, or is cancelled (the gate re-enqueued for a new
  head, the run stopped or halted, its worker gone), or its owner process is dead.
- **A dead holder.** A process that finds the slot held by a dead owner kills the recorded command group
  (after the pid and start-time identity check, so a reused pid is never signalled) and frees the slot.
  A SIGKILLed coordinator would otherwise block every run on the machine for good.

### 2.7 The time limit and the kill

- **Time limit.** `testTimeoutMinutes` in `.pir/settings.json`, overridable in
  `~/.pir/{repo}/settings.json` like the other keys, default 30, a positive number. It covers setup and
  test together, starts when the suite starts (not while queued), and is read once at run start and
  stored with each entry. On expiry the owner kills the command group and the run is red with
  `timed out after {n} min`. The limit exists because one hung suite would otherwise block every run on
  the machine.
- **Kill.** From the queue screen (§2.8) the person can kill the running suite. The dashboard does not
  signal the process: it writes a kill request naming the entry, and the owner kills its own command,
  keeping the rule that `pir` signals only a run it stops. The run is red with `stopped by you from the
  test queue`, and it counts as a try.

### 2.8 The queue screen

- **Dashboard list.** A pinned line above the runs: `⧗ test queue  running {run} {what} · m:ss / limit
  · {n} waiting`, or `⧗ test queue  idle` when nothing is queued. It is the first selectable row; `↵`,
  `→` or a click opens the queue view.
- **Queue view.** A `RUNNING` section with the running entry (run, repo, task and role or `single ·
  builder`, try, elapsed against the limit) and a `WAITING` table in order (position, run, repo, what,
  try, waited). `↑↓` pick a waiting entry, `b` bumps it to the front, `Ctrl+K Ctrl+K` kills the running
  suite (the first press arms an amber `Ctrl+K again to kill this suite`, any other key disarms), `↵`
  opens the selected entry's run, `←` goes back, `esc` quits. With nothing waiting the table reads
  `nothing waiting`. The view refreshes as the dashboard does.
- **Build rows.** A task in `tests` reads `waiting for tests · {n}th in queue` or `testing · m:ss /
  m:ss`; a task fixing after a red reads `fixing tests · try {n} of 3`. The first two are working rows,
  never asking.
- **End gate.** While the end-of-build suite waits, the footer reads `all N task(s) merged · waiting for
  tests · {n}th in queue`; once it runs, as today.
- **Single runs.** While queued the row reads `● waiting for tests` and the step `waiting for tests ·
  {n}th in queue`; running stays `testing`.

The approved mock is `prototype/index.html` (§7). It is the direction, not the spec.

### 2.9 Messages to the worker

Sent over the worker's line with `platform.send(..., { from: 'pir' })`, as the conflict fix is.

```
pir ran the whole suite on your commit {sha7} and it failed: {reason}. Try {n} of 3; a third failure stops the build.
Log: {logPath}
{last lines of the log}
Rerun only the failing tests while you fix them, commit, and report `{kind}` again.
```

The leftover message follows the single run's: `pir ran the whole suite on your commit {sha7} and it
passed, but the worktree is not clean afterwards:`, the `git status --porcelain` lines, and to commit
its edits or make git ignore files the tests wrote, then report `{kind}` again. Each log is
`tests-T{nn}-{n}.log` in the control folder, counting up across the task's runs.

### 2.10 The end-of-build runs

The feature-branch suite at the end of a build stays: merges and the base sync can break what each task
proved on its own. It waits in the queue like any run and no longer blocks the coordinator's pass while
it waits or runs, so the screen, the inbox and the agent stay live. The time limit and the kill apply;
a red result is handled as today (the test-fix worker's one attempt, the red hand-off).

### 2.11 Single runs

A single run's test runs and its baseline run wait in the queue. The time limit and the kill make a run
red with their reason, which counts as a red round under the single run's own rules (round 4 tells the
session to stop and ask the person; the baseline on first red). Those rules are unchanged: the person
chose to change only the queue and the limit there.

### 2.12 The unhappy paths

- **The owner dies holding the slot.** The next process to look reaps the recorded command group and
  frees the slot (§2.6). A command group whose identity no longer matches is not signalled; the slot is
  freed anyway.
- **An entry whose owner is dead** is skipped and removed by the next process that reads the queue.
- **An unreadable entry or slot file** (a crash mid-write cannot cause one, since writes are
  temp-then-rename) is logged and removed, so a bad file never wedges the queue.
- **Two processes race for a free slot.** Only the owner of the first live entry tries, and the slot
  file is created exclusively, so at most one wins; the loser waits for its turn.
- **A bump of an entry that has just started**, or a kill request for one that has just finished, is a
  no-op.
- **HALT, Stop, Ctrl-C, teardown.** The run's entries are removed and its running command killed, so a
  stopped run never holds the machine's slot.
- **A worker dies while its task is in `tests`.** The existing dead-worker handling applies and the
  entry is cancelled.
- **The laptop sleeps during a suite.** The limit is wall-clock and counts the sleep; a run holds the
  Mac awake with `caffeinate`, so this needs a lid close.

---

## 3. Architecture

### 3.1 The boundary

The project's existing boundary holds: `src/core/` is pure and `src/shell/` touches the world.
`src/core/boundary.test.mjs` scans every core module for forbidden imports; if it fails, the fix is to
move the code, never to relax the test. Everything that decides here (queue order, whose turn, staleness
from given liveness answers, timeout due from a given `now`, the gate's next step, the messages, the
resume table, the rows) is core, so it is tested exhaustively in milliseconds. The shell only reads and
writes files, spawns and kills, and asks the clock.

### 3.2 Modules

- `src/core/testqueue.mjs` (new): queue order, bump order, next entry, stale classification, timeout
  due, the queue view model and the pinned-line text.
- `src/core/tasktests.mjs` (new): the task gate's step decision, the try count, the red, leftover and
  retest texts, and the stop reason.
- `src/core/resume.mjs`: `decideResume` takes the ledger and returns `retest` actions (§2.5).
- `src/core/basebranch.mjs`: parses `testTimeoutMinutes`; `effectiveTimeout` merges the two files.
- `src/core/display.mjs`, `src/core/notify.mjs`, `src/core/dashboard.mjs`: the new rows, the stop alert,
  the stopped-tests-red row and note.
- `src/shell/test-queue.mjs` (new): the queue folder, the slot, kill requests, bump writes, and
  `startQueuedLines`, the queued counterpart of `startLines`.
- `src/shell/loop.mjs`, `src/shell/coordinate.mjs`: the gate in the pass, the ledger, the stop, the
  queued end gate, the construction of the queue client.
- `src/shell/single-run.mjs`: its runs through the queue.
- `src/shell/queue-view.mjs` (new), `src/shell/list-view.mjs`, `src/shell/pir-tui.mjs`,
  `src/shell/render.mjs`: the screen.

### 3.3 The decision functions

`decideTaskTests(facts)` in `tasktests.mjs` is a function of the task's gate state (role, recorded head,
tries, current job state, last result and its head, current head and cleanliness, report seen) and
returns one step: `enqueue`, `wait`, `green`, `rerun`, `leftover`, `red`, or `stop`. `nextEntry(entries,
slot, liveness)` in `testqueue.mjs` returns which entry may take the slot, and which entries and slot are
stale. Neither reads a clock or a file.

### 3.4 Data flow

A report reaches `runPass`, which asks `decideTaskTests` and, for `enqueue`, calls the queue client's
`startQueuedLines`. Each pass polls the job: `queued {position}`, `running {since}`, or a result. The
owner's poll also takes the slot when `nextEntry` says it is its turn, enforces the limit, and handles a
kill request. The coordinator's waker also watches the queue folder, so a freed slot or a kill request
is seen within a moment rather than at the 5 s poll. The run state carries each task's gate sub-state
into the snapshot; the dashboard reads the snapshot for rows and the queue folder for the queue screen.

### 3.5 Storage

- **The queue**, `$PIR_HOME|$HOME/.pir/test-queue/` (machine-wide, beside `runs/`):
  `entries/{id}.json` `{ id, order, enqueuedAt, owner: { pid, startTime }, repo, run, kind:
  'task'|'end'|'single'|'baseline', task, role, try, cwd, limitMs, label }`; `slot.json` `{ entryId,
  owner, command: { pid, startTime } | null, startedAt, limitMs }`, created with an exclusive create;
  `kill/{entryId}` an empty request file. Every rewrite is temp-then-rename, so a crash leaves the old
  file or the new one. `order` is the enqueue time; a bump sets it to one less than the smallest waiting
  order.
- **The ledger**, `plans/{slug}/.parallel/control/tests.json` `{ T{nn}: { implement: { greenSha },
  review: { greenSha } } }`, rewritten temp-then-rename after each green. It is the only thing a restart
  needs from the gate (§2.5).
- **Logs**, `tests-T{nn}-{n}.log` in the control folder; the end gate keeps `tests.log`; single runs
  keep theirs.

---

## 4. Testing

- **Pure** (`npm test`): every queue-order, bump, staleness and timeout case; every gate step, the try
  limit and the stop; every resume row; every row text and the alert; the settings key.
- **Shell with real processes** (`npm test`): the queue client against a scratch `PIR_HOME`: two
  owners in two real child processes never run at once, a dead holder is reaped, a timeout and a kill
  request end the command, teardown frees the slot.
- **The loop with the fake platform** (`npm test`): implemented to tests to review, red to fixing to
  green, the third red stopping the build, head moved, leftover, resume with and without the ledger.
- **The screen** (`npm test`, the plan-rig pseudo-terminal rig): the pinned line, the queue view, bump,
  kill, the rows, at 60×20, 80×24 and 120×40.
- **Real agents** (T16, outside `npm test`): one live build in a scratch repo, proving that real
  workers wait idle for pir, fix a red with only the failing tests, and that the stop fires.

---

## 5. Environment — read this before running anything

| | |
|---|---|
| OS | macOS (Darwin 25.6.0) |
| Language / runtime | Node v22.17.1, npm 11.18.0 (measured 2026-10-02) |
| Toolchain | `node --test`; pi-tui and the Claude Agent SDK from `package-lock.json` |
| Deliberately absent | no TypeScript, no bundler, no test framework beyond `node:test` |

**The test command.** The `test` lines of the block at the top of this file: `npm test`, which runs
`node --test --test-reporter=dot 'src/**/*.test.mjs'` with `FORCE_COLOR=0 NO_COLOR=1` and git's
background maintenance off, printing `TESTS PASSED` or `TESTS FAILED`. Quiet on green, failures in full.
`COLORTERM=truecolor` is set in this shell and the command overrides it. A person debugging runs one file
with `node --test --test-reporter=spec src/shell/loop.test.mjs`. It took 3 min 17 s wall at about 230%
CPU here (2026-10-02), which is the load this plan serializes.

**Setup.** `test ! -f package-lock.json || npm ci`. A checkout without `node_modules` fails two harness
tests (`api-usage-e2e`, `fixtures.test.mjs` "node_modules was linked in"), measured in this planning
worktree.

**Dependencies.** None added. Every piece here is built from what the repo has.

**End to end.** The dashboard is a terminal UI. Its end-to-end tooling exists and is reused: the
pseudo-terminal rig `src/shell/plan-rig.mjs` with `plan-rig-*.test.mjs` suites, in `npm test`, against
fake runs and a scratch `PIR_HOME`. Sizes 60×20, 80×24, 120×40.

### 5.1 What the test command cannot reach

| Cannot be tested automatically | Why it needs a person |
|---|---|
| Whether real workers follow the new contract (wait idle, run only failing tests) | Needs real paid agent sessions; T16 runs it as a `worker` action (§5.3), and the worker judges the transcript |

### 5.2 Seatbelts

| Flag / mechanism | Default | Effect |
|---|---|---|
| `PIR_HOME` | `$HOME` | every test points the queue and the index at a scratch folder, never the real `~/.pir`. This repo's own `npm test` runs inside pir's queue holding the real slot, so a test that enqueued on the real queue would wait on its own outer run until the limit |
| `testTimeoutMinutes` | 30 | bounds every pir-run suite |
| harness wall-clock timeout | per fixture | touches HALT on a hung live run so it cannot run or cost on |

### 5.3 Outside the code — who acts

| Action | Command (exact, wrapped) | Bin | Why this bin | Way back | Expected cost | Login check |
|---|---|---|---|---|---|---|
| Install the locked packages | `test ! -f package-lock.json \|\| npm ci` | worker | exact locked versions only | delete `node_modules` | none | none |
| Live build with real agents (T16) | `perl -e 'alarm 1800; exec @ARGV' node src/shell/harness/run.mjs sequential-testing-live --into /tmp/pir-seqtest-live` | worker | moved down from `ask` by the user at plan review 2026-10-02: bounded by the 30-min alarm, ceiling 2 and a scratch repo, so the spend is small and needs no click; real Claude sessions billed through Bedrock | not reversible (spend); scratch repo only | a few short sessions | `claude auth status` |
| Scratch teardown | `rm -rf /tmp/pir-seqtest-live` | worker | local scratch only | none needed | none | none |
| Refresh the installed engine and skills | `./install.sh` | worker | CLAUDE.md requires it after engine or skill changes; local, idempotent | re-run on the previous commit | none | none |

Credentials, measured 2026-10-02: `claude auth status` reports logged in, `authMethod: third_party`,
`apiProvider: bedrock`. Real sessions are therefore paid usage, not plan limits as earlier plans in this
repo recorded; the user chose to let a worker run the bounded live run without asking anyway. `./install.sh` must not run while a build of this
plan is going: the installed coordinator would change under it. Run it after the plan's branch merges.

---

## 6. Recovery

- **A stuck queue.** Open the queue screen and kill the running suite. By hand: read
  `~/.pir/test-queue/slot.json`, check `ps -p {command.pid} -o lstart=` equals its `startTime`, kill
  that process group, delete `slot.json`. Deleting `entries/*.json` drops waiting entries; their owners
  re-enqueue on their next pass only if their gate still wants a run.
- **A build stopped on tests red.** Fix the task worktree if you like, then resume. Or mark the task `⛔`
  on the feature branch to defer it, as today.

---

## 7. Decisions and rationale

All with the user, 2026-10-02.

- **Slug `sequential-testing`** (the user's name). Tests are pre-merge, on the task branch.
- **Workers run new tests plus a chosen regression set, never the whole suite** (brief). The load of
  parallel suites is the problem; pir's run is the proof.
- **The worker stays alive until green and fixes its own red** (brief).
- **One suite at a time across the whole machine**, not per run or per repo. Protecting the machine was
  the point; queueing behind other runs is accepted.
- **A queue screen with bump**, and bump moves one entry, not a whole run. The user's choice over a
  run-level priority.
- **Both a time limit (30 min default, per repo) and a kill key.** A hung suite blocks the machine.
- **Retries run the whole suite again**, not only the failed tests. Green means the whole suite on that
  commit.
- **Three failed runs per worker, then the whole build stops**, rather than parking only that task.
  Other tasks would otherwise build on a broken area.
- **No baseline comparison for task runs.** Any failure is the worker's to fix. Single runs keep theirs.
- **Resume gives three fresh tries**, and the person may edit the worktree meanwhile, so the fresh worker
  is told to check and commit what it finds.
- **Single runs gain only the queue and the limit**; the end-of-build check stays and is queued; the
  classic flow is unchanged; a waiting worker keeps its slot (played back and approved).
- **Prototype approved**: `prototype/index.html`, the pinned line, the queue view with `b` and
  `Ctrl+K Ctrl+K`, the rows and the stopped row. Non-binding.
- **Survey (Stage 4).** Extended rather than rebuilt: `startLines` and its process-group kill
  (`commands.mjs`), the single run's head-moved and leftover rules and message shape (`singleflow.mjs`),
  the Stop path and `writeRunFinal`, `decideResume`, the alert builders, the display rows, the plan-rig
  rig, `identity.mjs` and `atomic-write.mjs`. New: the machine queue (nothing like it existed; a search
  for lock, mutex, flock and queue found no cross-process lock), the queue screen, the task gate, the
  ledger. Changed: `runFeatureTests`, which blocks the pass with `execFileSync` and cannot wait in a
  queue.
- **A fresh worker on resume**, not the closed worker's session: a build restart cannot reopen a worker
  session today, and building that is `resume-dead-worker`'s job.
- **Start only after `pir/single-finisher` merges to main, and main is merged into `pir/sequential-testing`.**
  It rewrites the end of `single-run.mjs` and may add suite runs, all of which T09 must queue. A build
  does not sync its base at start (`docs/branch-model.md`), so without the merge T09 builds on the old file.
- **Resume sends an interrupted review to a fresh reviewer** (plan review): §2.5.
- **The T16 live run is `worker`, not `ask`** (plan review): §5.3.
- **The reviewer's run is skipped only when its commits touch only `plans/{slug}/`.** A strict "no new
  commits" rule never applies, because the reviewer always commits its mark.

---

## 8. Explicitly out of scope

- **A baseline run for task reds.** The user declined it.
- **Preempting a running suite for a bumped one.** It wastes the half-done run.
- **Running a suite subset in pir.** pir always runs the whole suite; subsets are the worker's tool.
- **Changing the single run's round rules** or the classic flow's test rule. The user kept them.
- **Parsing test output to name failing tests.** The red message carries the log path and its tail, and
  the worker reads the log; parsing would tie pir to one test framework.
- **A per-run priority.** The user chose one-entry bumps.
- **Reopening a closed worker's session on resume.** The `resume-dead-worker` plan.
