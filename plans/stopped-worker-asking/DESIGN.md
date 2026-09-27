---
setup:
  - test ! -f package-lock.json || npm ci
test:
  - npm test
---

# Stopped worker asking — Design

How parallel mode behaves is canonical in `/docs`. This file is build-time rationale for this plan;
T05 carries the resulting behaviour into `/docs` and `README.md`. It never edits a finished plan's
DESIGN.md.

**Base.** This plan extends `real-asking-state` (the `waitingOn` predicate in `src/core/asking.mjs`, the
turn-cause fold in `src/core/stream.mjs`, `resumeAnswered` in `src/shell/loop.mjs`). At planning time
that plan was finished and reviewed on `pir/real-asking-state` but not merged to `main`. It must be merged
before the first task starts; a task that finds `src/core/asking.mjs` missing stops and says so.

## 1. Purpose

A row in `pir` reads `asking you` when a worker is waiting on the person. Today that needs one of two
things: the worker dropped a `question`/`decision` report and ended its turn, or it has a permission
request or question set pending. A worker that asks in plain text and ends its turn without a report
reads `building`, its clock runs, and Remote Control stays off, so the person has no sign they are needed.

The incident (real-asking-state run, 2026-09-27, T00 worker): after a background wake-up un-parked the
task (the bug `real-asking-state` T03 fixed), the worker asked the person twice more in plain text
without a fresh report, believing its first report still stood, and read `building` both times. After
`real-asking-state`, the wake-up no longer un-parks, but the same thing still happens on any follow-up
question asked after a real answer, and on any question asked with no report at all. The worker cannot
see that pir un-parked it, so the skill's report rule alone cannot close this.

The same gap exists in a planning run (`pir plan`): a planner or plan reviewer that asks in plain text
reads `planning`/`reviewing`, because its step reads `asking` only while a request is pending.

### Success criteria

- A build worker that ends its turn with nothing running in the background, without having reported its
  phase finished, reads `asking you · a question`, its clock stops and Remote Control switches on, on
  the first pass after its turn ends; whether or not it dropped a report, and whether it is the first
  question or a follow-up.
- A build worker that ends its turn with a background job still running reads `building`/`reviewing`
  unless it dropped a question report; when the job's wake-up turn ends with nothing running, it reads
  `asking you`.
- A planner or plan reviewer that ends its turn with nothing running, before its report is accepted,
  reads `asking`, and its step clock stops.
- Seen on a real harness run with real workers (T06), judged by the worker from the run's status
  snapshots.

## 2. Behaviour specification

### 2.1 When a build task is waiting on the person

`waitingOn(task, activity)` (real-asking-state §2.1) keeps both of its clauses and gains a third:

- a pending request (activity state `permission` or `questions`), as today; or
- a report park whose asking turn has ended, as today; or
- **stopped**: the task's phase is `implementing` or `reviewing`, its live worker's activity state is
  `idle` (its last turn ended and nothing is pending), and the activity reports no background job
  running (`activity.background` is an array and is empty). It returns `question`.

Why phase `implementing`/`reviewing` only: in every other phase the worker's stop means something else.
`review-ready` and `done` are a worker idle after its `implemented`/`done` report, which the idle gate
and the merge wait for; `awaiting-answer` is already covered by the report-park clause, and a
conflict-sent park (`decision.sent`) is pir's own fix in flight; `preparing` has no worker.

Why `idle` means waiting on the person: in a pir run a worker ends its turn only when it has finished
(and then it has reported, which moved the phase), when it is waiting on a background job, or when it
is waiting on the person (pir-worker skill: "end the turn with the question put to the person and
nothing running"). With the first two excluded, what is left is the person.

Why a stopped worker with no real question also reads `asking you` (user 2026-09-27): a worker that
ended its turn by mistake ("I'll wait for the tests" with nothing running) is indistinguishable from
outside. Reading its last words to tell them apart is guesswork that can hide a real question, which is
the bug this plan closes. The person opens it, finds no question, and types "carry on"; learning at once
that a worker has stopped is itself worth the false alarm.

Why a background job means not asking (user 2026-09-27): a worker waiting on its own tests or build
would otherwise flash `asking you`, stop the clock and switch Remote Control on for nothing, every time.
The known miss is a worker that asks the person while a job of its own still runs and forgets the
report; it reads `building` until the job's wake-up turn ends, then `asking you`. The skill line (§2.4)
covers it when the worker obeys.

A worker absent from the listing, or a listing without the `background` field (some test fakes, and any
activity not folded from a conversation log), gets no stopped reading: the third clause needs
`Array.isArray(activity.background)`. Guessing `asking` for a worker whose background state pir cannot
see would flip every fake-driven test that parks a worker idle, and would call a worker waiting on its
own job `asking` with no evidence.

The same predicate already drives the row's phase and asking kind, the clock and Remote Control
(real-asking-state §2.1), so all three follow the new clause with no second copy of the rule. The
display phase of a stopped worker is `asking`, and the row reads `asking you · a question`, exactly as a
report park; the footer names who is asking and never shows question text, so there is nothing a report
would have added to the row.

The loop's own phase is not changed: a stopped worker stays `implementing`/`reviewing` in
`coordinator.state.tasks`. `decideDispatch` and the idle gate key on that phase, and when the person
answers, the worker's next turn makes it `busy` and the row reads `building` again with no un-park step.
There is nothing to un-park, which is why no report bookkeeping (`askEnd`, `answerFrom`) is involved.

### 2.2 What `background` is

`workerActivity` gains `background`: the task ids of the worker's background jobs still running, from
the latest `system/background_tasks_changed` event's `tasks` array (Claude Code 2.1.283 sends the full
current list each time, and `[]` when the last one ends; measured in `src/core/fixtures/
remote-answer-sample.ndjson` case 5 and the 2026-09-27 run logs). Before any such event it is `[]`: a
worker that never started a job has none. A `resumed` note clears it, because the jobs died with the old
process, as the note already clears pending requests.

A job that leaves the list stays in `background` until the worker's next turn opens or its open turn
ends (`result`). Why: the CLI sends the shrunken list, then `system/task_notification`, then the
wake-up turn's `init` (fixture case 5: the list and the notification 1 ms apart, the turn after). Between
the list and the `init` the worker is idle with nothing listed, so dropping the job at once would read
`asking you` for that moment and could switch Remote Control on and off. A job that ends while a turn is
open is absorbed by that turn, so it drops at that turn's `result`.

Measured so far only for `task_type: local_bash` (13 sightings across 12 run logs, 2026-09-27). Whether a
Monitor, a background subagent or another kind appears in the same list is unmeasured. If one does not,
the only effect is a worker waiting on it reading `asking you`: the false-alarm direction the person
accepted in §2.1, never a hidden question.

### 2.3 When a planning step is waiting on the person

A planning run's step (`planRunState` in `src/shell/plan-run.mjs`) reads `asking` while its live session
has a request pending (today), or while the session is stopped: activity state `idle`, `background`
empty, and no report of that step accepted (`state.accepted` unset for the current step). The same
`stoppedAt` clock that a pending request stops today stops for a stopped session.

Why not before the report: a planner idle after dropping `planned` is waiting for pir's checks and
close, not for the person. `state.accepted` is set on the pass that drains the report, so at most one
paint between the turn's end and that pass can read `asking`; pir drains reports before it builds the
run state in the same pass, so in practice none does.

Remote Control is not touched: a planning session has it on from spawn (`plan-run.mjs`), not following
the predicate.

The rule is one pure function shared with §2.1 (`stoppedOnPerson(activity)` in `src/core/asking.mjs`),
so the build and planning readings of "stopped" cannot drift.

### 2.4 The worker contract

`pir-worker` § "When a stock skill would ask the user and wait" gains one sentence: every time you end a
turn waiting on the person, drop a fresh `question` or `decision` report first, including a follow-up
after the person answered an earlier one, because the earlier report no longer holds once pir has seen
the answer. This is belt and braces beside §2.1: it names the question in the log and covers the
background-job miss.

### 2.5 The nudge plan

`nudge-quiet-worker` (reviewed, not built) nudged any `implementing`/`reviewing` worker with no pending
request after about 15 minutes of no progress. A stopped worker now reads `asking you`, and a nudge
would open a turn, flip the row to `building`, switch Remote Control off, and flip both back seconds
later. Its DESIGN §2.4 is amended in this plan's commit (user 2026-09-27): never nudge while `waitingOn`
is non-null. The nudge then reaches only workers in a wait-loop or idle behind a background job.

### 2.6 The unhappy paths

- **The person interrupts a worker**: the turn ends (`error_during_execution`), the worker is idle with
  nothing running, and it reads `asking you`. That is right: after an interrupt the worker waits for
  the person.
- **A background job's wake-up**: a stopped worker has no job running by definition, so a wake-up only
  reaches a worker that read `building` behind its job. The ended job stays in `background` until the
  wake-up turn opens (§2.2), the row reads `building` through that turn, and `asking you` when it ends
  with nothing running. A report-parked worker keeps real-asking-state's behaviour and stays asking.
- **The worker exits**: it leaves the listing; the dead-worker path handles it, unchanged.
- **HALT**: unchanged; workers are stopped and leave the listing.
- **The implementer's `implemented` report and its turn's end land in one pass**: the loop drains the
  report before the run state is built (`coordinate.mjs`), so the phase is already `review-ready`.

## 3. Architecture

### 3.1 The boundary

`src/core/` is pure: no clock, no fs, no network, no package import; `src/core/boundary.test.mjs`
enforces it. If that test fails the fix is to move the code, never to relax the test.

`stoppedOnPerson`, the extended `waitingOn` and the `background` fold are pure and live in `src/core/`.
The wiring stays in `src/shell/coordinate.mjs` and `src/shell/plan-run.mjs`.

### 3.2 Modules

| Module | Side | Change |
|---|---|---|
| `src/core/stream.mjs` | pure | `workerActivity` returns `background` (T01) |
| `src/shell/fake/claude-stream.mjs` | test fake | emits `background_tasks_changed` for a scripted background job (T01) |
| `src/core/asking.mjs` | pure | `stoppedOnPerson(activity)`; `waitingOn` third clause (T02) |
| `src/shell/coordinate.mjs` | shell | `displayPhaseFor` returns `asking` for a stopped `implementing`/`reviewing` task (T02) |
| `src/shell/plan-run.mjs` | shell | `planRunState` and the `stoppedAt` tracking use `stoppedOnPerson` (T03) |
| `skills/pir-worker/SKILL.md` | skill | §2.4 (T04) |
| `src/shell/harness/fixtures/stopped-asking.mjs` | harness | the live check (T06) |

### 3.3 Data flow

Per pass, unchanged from real-asking-state §3.3: `platform.workers()` gives each live worker's
`activity`, now carrying `background`; `coordinator.state.tasks` gives each task's phase. `waitingOn`
combines the two per task. The planning program folds its own session's activity each paint and
passes it to `planRunState`.

## 4. Testing

`npm test` runs every `src/**/*.test.mjs` with the dot reporter and colour off (`FORCE_COLOR=0
NO_COLOR=1`, set in `package.json`); a pass prints a few lines of dots and exits 0, a failure prints its
assertion and stack. Run one file with `node --test src/core/asking.test.mjs` for detail.

The fold is tested against the recorded fixtures (`src/core/fixtures/*.ndjson`) and hand-built entries.
The predicate and the wiring are tested with hand-built activity objects in `asking.test.mjs`,
`coordinate.test.mjs` and `plan-run.test.mjs`. No new screen is drawn: the rows, labels and colours
exist, so the behaviour is asserted on the run state, not by driving the terminal. T06 sees it on real
workers.

## 5. Environment — read this before running anything

Measured 2026-09-27: Node 24.2.0 (engines 22.19+), Claude Code 2.1.283, `@anthropic-ai/claude-agent-sdk`
0.3.282. `npm test` passes on a fresh detached worktree of `pir/real-asking-state` after `npm ci` and
leaves it clean.

### 5.1 What the test command cannot reach

| Cannot be tested automatically | Why |
|---|---|
| Real workers' rows turning `asking you` on a plain-text ask and staying `building` behind a background job | Paid workers (T06); judged by the worker from the status snapshots, no person needed |

### 5.2 Seatbelts

| Mechanism | Effect |
|---|---|
| Fixture ceiling 2, harness timeout 15 min (T06) | Bounded paid run |
| Scratch repo (`--into`) for T06 | Never the canonical checkout |
| `HALT` | Stops every worker of a run |

### 5.3 Outside the code — who acts

| Action | Command | Bin | Why this bin | Way back | Cost |
|---|---|---|---|---|---|
| Live harness run (T06) | `node src/shell/harness/run.mjs stopped-asking --into <scratch>` | `worker` | Same bin earlier plans set for harness runs: bounded ceiling and timeout, scratch only | HALT; scratch deleted | a few dollars |
| `./install.sh` | refresh the installed engine and skills after the plan merges | `worker` | Local, idempotent; never while a parallel run is live | Re-run from the previous commit | none |

Nothing in this plan needs the person's hands: Remote Control's switching was verified by hand in
real-asking-state T05, and T06's answers come from the harness.

## 6. Recovery

A wrong reading is display-only and self-correcting on the next pass; nothing persists. To back the
change out, revert the task commits and run `./install.sh`.

## 7. Decisions and rationale

All user decisions 2026-09-27 unless marked.

- **A separate plan after real-asking-state, not a task added to it** (user, during that run). It kept
  the live plan unchanged while it was being built.
- **Reverse real-asking-state §7 "Narrow scope"**, which said a worker idle without a report is not
  asking. The T00 incident showed the report rule alone leaves follow-up questions invisible.
- **Any stopped worker reads `asking you`, mistaken stops included** (§2.1). Chosen over reading the
  worker's last message (guesswork that can hide a question) and over nudging the worker to re-report
  first (relies on the worker obeying, which is what failed).
- **A running background job means not asking unless reported** (§2.1). Chosen over always asking,
  which would false-alarm on every worker waiting on its own tests.
- **Planning sessions get the same rule** (§2.3). Same gap, and small there: no reports or phases to
  reconcile.
- **Amend nudge-quiet-worker now** (§2.5), in this plan's commit, rather than leaving a finding its
  build review would not act on.
- **Extend `waitingOn`, do not add a second predicate** (planning). One rule for row, clock and Remote
  Control is what real-asking-state built; a parallel "stopped" check in the shell would let them drift.
- **No loop phase change and no un-park** (planning). The stopped reading is derived each pass from the
  activity, so an answer needs no bookkeeping: the next turn simply makes the worker busy.
- **No probe task** (planning). The `background` signal is already in recorded logs, and the unmeasured
  job kinds can only err towards a false alarm, which the person accepted.

## 8. Explicitly out of scope

- Telling a real question from a mistaken stop by reading the worker's words.
- Push notifications to the person's phone (real-asking-state FINDINGS 2026-09-27: not driven by pir).
- Anything `nudge-quiet-worker` does, beyond the §2.5 amendment to its eligibility.
- A park or a stopped reading surviving a coordinator restart.
