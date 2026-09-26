---
setup:
  - test ! -f package-lock.json || npm ci
test:
  - npm test
---

# Real asking state — Design

How parallel mode behaves is canonical in `/docs`. This file is build-time rationale for this plan;
T04 carries the resulting behaviour into `/docs` and `README.md`. It never edits a finished plan's
DESIGN.md.

## 1. Purpose

A task row in `pir` reads `asking you` to tell the person that a worker is waiting on them. It must be
true: a row that says `asking you` while the worker is working sends the person to a conversation with
nothing to answer, stops the task's clock, and switches Remote Control on for nothing.

The incident (live-workers run, 2026-09-25): T10 dropped a `kind=question` report before an `ask`-bin
`npm i`, as the `pir-worker` skill tells it to, expecting a permission prompt. Auto mode allowed the
command with no prompt, T10 kept working in the same turn, and its row read `asking you` until its
`implemented` report. At the time nothing un-parked a report-parked task before `implemented`/`done`.

Most of the un-park has since landed outside any plan (bda34a5, 5b899df, 2026-09-26, beside Remote
Control): `resumeAnswered` in `src/shell/loop.mjs` returns a report-parked task to its role's phase
once the worker opens a turn after the asking turn, or once a request seen pending while parked is
answered; `worker-proc.mjs` logs a request answered over Remote Control as `answered-remotely`, and
`workerActivity` drops it. This plan closes what is left:

1. A worker that drops its report and keeps working in the same turn (T10) still reads `asking you`
   until that turn ends.
2. The skill still tells workers to drop a question report before an `ask`-bin action.
3. Any turn opening after the asking turn counts as the answer, so a background job's wake-up clears
   the park although the person has not answered.

### Success criteria

- A worker that drops a question report and keeps working reads `building`/`reviewing`, its clock
  runs and Remote Control stays off, until its turn ends; then it reads `asking you`.
- A worker woken by a background job while parked stays `asking you`; one answered in `pir`, typed to
  on the phone, or answered in a picker or permission on the phone returns to work within one pass.
- Seen live with the person in a fixture run (T05).

## 2. Behaviour specification

### 2.1 When a task is asking

A task is **waiting on the person** when either holds:

- its live worker has a permission request or question set pending (activity state `permission` or
  `questions`), or
- it is parked on its own report (phase `awaiting-answer`, `decision.sent` not set) and its worker's
  turn is not open (activity `open` false).

Why the second clause looks at `open`: a worker drops its report from inside a turn and then ends that
turn with the question put to the person (pir-worker skill), so the park is only real once the turn
has ended. While the turn is open the worker is working, whatever report it dropped (user 2026-09-26).

A report-parked task whose turn is open reads `building` (implementer) or `reviewing` (reviewer),
plain, with no hint of the pending report (user 2026-09-26: the row says only what needs the person
now). Its clock runs. When the turn ends with the park still standing, the row turns `asking you` and
the clock stops, exactly as today.

The same predicate drives all three consumers so they cannot disagree: the row's display phase and
`asking` kind (`buildRunState`), the clock (`advanceTiming`'s asking set), and Remote Control
(`remoteWanted`). Remote Control therefore also switches on only when the turn has ended.

The loop's own phase is not changed: a report-parked task stays `awaiting-answer` while its asking turn
runs. `decideDispatch` counts that phase as a held slot, and `nudge-quiet-worker` (planned, §2.4 of
its DESIGN) never nudges a parked task. Only the reading of the phase for the person changes.

A worker absent from the listing, or a listing without the activity fold (some test fakes), keeps
today's reading: parked reads `asking you`. Guessing `building` for a worker pir cannot see would hide
a real question.

A merge-conflict fix pir sent (`decision.sent`) is not asking and keeps reading `fixing conflict`.

### 2.2 What un-parks a report park

Today `resumeAnswered` un-parks on any turn opened after the asking turn. This plan narrows that to a
turn opened by an answer:

| Turn opened by | Answer? |
|---|---|
| A message pir sent with `from: 'person'` (typed in `pir`) | yes |
| Remote Control input: a message typed on claude.ai or the phone | yes |
| A request answered in `pir`, by a grant, or `answered-remotely`, with the turn still open | yes (5b899df, kept) |
| A background job's `task_notification` wake-up | no |
| A message pir sent with `from: 'pir'` | no |
| Anything T00 finds that is neither | no, until the person decides otherwise |

Why narrow it: a wake-up that is not an answer leaves the question unanswered, and the row must keep
telling the person so. Why not simply wait for a message pir saw from the person: Remote Control input
does not appear in pir's stream (measured 2026-09-26, Claude Code 2.1.283), so that rule would leave a
phone-answered worker `asking you` for good, the original bug in a new place.

How pir tells a Remote Control message from a wake-up is what T00 measures. The candidates, from the
installed SDK 0.3.282 types:

1. The stream alone: a background job's wake-up is preceded by `system/task_notification` (T01 probe of
   live-workers), a pir send is logged `out`. A turn opened with neither may be Remote Control input.
2. An SDK `UserPromptSubmit` hook callback on the worker's `query()`: its input carries `source`
   (`user` / `sdk` / `system` / …). Whether it fires for Remote Control input, and with which source, is
   unmeasured.
3. The replay option (`SDKUserMessageReplay`, `isReplay: true`): whether Remote Control input is
   replayed into the SDK output, and how the option is switched on headless, is unmeasured.

T03 builds on whichever T00 shows is reliable. If none is, T03 does not build the narrowing; it adds the
skill line "if you stop still waiting on the person, drop a fresh question report", and the person is
asked before T03 starts (user 2026-09-26, option A as the fallback).

A turn that is not an answer moves the park's reference point forward, so a later answering turn is
still recognised: the answer is any answering turn opened after the latest non-answer turn.

### 2.3 The worker contract

The `pir-worker` skill's "Actions on the outside world" paragraph no longer tells the worker to drop a
`kind=question` report before an `ask`-bin action. pir shows a pending permission request as
`asking you · allow a command?` by itself (live-workers §2.4), and in auto mode the prompt may never
come, which is what left T10's row asking. The worker explains the action and runs it; the permission
rule stops the session if it applies.

### 2.4 The unhappy paths

- **The asking turn never ends** (the worker drops a report and works on to `implemented`): the row
  reads `building` throughout and the `implemented` report moves it on, as for any worker.
- **A request is pending inside the asking turn**: the row reads `asking you · …` for the request (the
  first clause of §2.1), then `building` once it is answered and the turn continues.
- **The worker exits while parked**: unchanged, the dead-worker path handles it.
- **pir restarts while a task is parked**: unchanged and out of scope; `reports/` is cleared at startup,
  so the park is lost as it is today.
- **Two reports in one turn**: the later one replaces `decision`, as today; the rule reads the phase, not
  the count.

## 3. Architecture

### 3.1 The boundary

`src/core/` is pure: no clock, no fs, no network, no package import; `src/core/boundary.test.mjs`
enforces it. If that test fails the fix is to move the code, never to relax the test.

The §2.1 predicate and the §2.2 turn-cause fold are pure and go in `src/core/`. The wiring into the
display, the clock and Remote Control stays in `src/shell/coordinate.mjs`; the un-park stays in
`src/shell/loop.mjs`; any new capture (a hook callback, a replay flag) goes in
`src/shell/worker-proc.mjs`, which logs it as a conversation-log entry so the pure fold can read it.

### 3.2 Modules

| Module | Side | Change |
|---|---|---|
| `src/core/asking.mjs` (new) | pure | `waitingOn(task, activity)`: the §2.1 predicate and the asking kind |
| `src/core/stream.mjs` | pure | `workerActivity` gains the cause of each turn it opens (T03) |
| `src/shell/coordinate.mjs` | shell | `displayPhaseFor`/`buildRunState`, `requestingTasks`/`advanceTiming`, `remoteWanted` call `waitingOn` |
| `src/shell/loop.mjs` | shell | `resumeAnswered` un-parks only on an answering turn (T03) |
| `src/shell/worker-proc.mjs` | shell | captures and logs the signal T00 picks, if it is not already in the stream (T03) |
| `skills/pir-worker/SKILL.md` | skill | §2.3 (T01), and the fallback line if T00 finds nothing (T03) |

### 3.3 Data flow

Per pass: `platform.workers()` gives each live worker's `activity` (folded from its conversation log);
`coordinator.state.tasks` gives each task's phase and `decision`. `waitingOn` combines the two per task.
`resumeAnswered` reads the same activity at the start of the pass.

## 4. Testing

`npm test` runs every `src/**/*.test.mjs` with the dot reporter and colour off (`FORCE_COLOR=0
NO_COLOR=1`, set in `package.json`); a pass prints a few lines of dots and exits 0, a failure
prints its assertion and stack. Run one file with `node --test src/core/asking.test.mjs` for detail.

The fake worker (`src/shell/fake/claude-stream.mjs`, `src/shell/fake/platform.mjs`) scripts turns,
requests and `task_notification`s, so every row of §2.2 except real Remote Control input is testable in
`loop.test.mjs` and `coordinate.test.mjs`. T00 records real entries into a fixture so the Remote Control
row is tested against what the real CLI emits.

No new screen is drawn: the rows, labels and colours exist. The behaviour is asserted on the run state
(`buildRunState`, `status.json` via the harness), not by driving the terminal. The live check (T05) is
where the person sees it.

## 5. Environment — read this before running anything

Measured 2026-09-26: Node 22.19+ (engines), Claude Code 2.1.283, `@anthropic-ai/claude-agent-sdk`
0.3.282. `npm test` passes in a fresh detached worktree after `npm ci` and leaves it clean.

### 5.1 What the test command cannot reach

| Cannot be tested automatically | Why |
|---|---|
| What the real CLI emits when the person types, picks or allows on the phone over Remote Control | Needs the person's phone and a real worker (T00) |
| A real run's rows turning `asking you` and back at the right moments | Paid workers and the person's phone (T05) |

### 5.2 Seatbelts

| Mechanism | Effect |
|---|---|
| `perl -e 'alarm 900; exec @ARGV'` around the T00 probe | The probe dies at 15 min |
| Scratch repo for T00 and T05 | Never the canonical checkout |
| `live-workers-demo`-style fixture ceiling 2, harness timeout 15 min (T05) | Bounded paid run |
| `HALT` | Stops every worker of a run |
| `enableRemoteControl(false)` on probe exit, `close()` switches off first (bda34a5) | No Remote Control session left open |

### 5.3 Outside the code — who acts

| Action | Command | Bin | Why this bin | Way back | Cost |
|---|---|---|---|---|---|
| Probe worker (T00) | `perl -e 'alarm 900; exec @ARGV' node <probe script>` in a scratch repo, one SDK worker with Remote Control on | `worker` | Minutes of model time, one worker, scratch only; the Remote Control session is visible only in the person's own account | Kill the pid; the script switches Remote Control off; delete scratch | under a dollar |
| Live harness run (T05) | `node src/shell/harness/run.mjs <fixture> --into <scratch>` | `worker` | Same bin the live-workers plan set for harness runs: bounded ceiling and timeout, scratch only | HALT; scratch deleted | a few dollars |
| `./install.sh` | refresh the installed engine and skills after T01 and after T03 | `worker` | Local, idempotent; never while a parallel run is live | Re-run from the previous commit | none |

The person's part in T00 and T05 is their phone: answering the worker there. That is a device only they
hold, not a command they run.

## 6. Recovery

A wrong reading is display-only and self-correcting on the next pass; nothing persists. To back the
change out, revert the task commits and run `./install.sh`.

## 7. Decisions and rationale

All user decisions 2026-09-26.

- **Plain `building`/`reviewing` while a report is pending and the worker works** (user). The row says
  only what needs the person now; a hint would be a false alarm in the T10 case.
- **Narrow scope** (user): a worker idle without any report is not `asking you`; that is
  `nudge-quiet-worker`'s ground.
- **Measure a Remote Control signal first (T00) rather than only telling workers to re-report** (user,
  option B). The re-report line stays as the fallback if T00 finds no signal.
- **Extend `resumeAnswered`, do not replace it.** It already carries the turn bookkeeping (`askEnd`,
  `asked`) and the Remote Control coupling; a second un-park mechanism would split one rule in two.
  The peer session that built it suggested the same.
- **One predicate for display, clock and Remote Control.** Three copies of "is it waiting" is how the
  row and the phone notification would come to disagree.
- **The loop phase stays `awaiting-answer` while the asking turn runs.** Dispatch and the nudge plan key
  on it; only the person-facing reading changes.
- **Remote Control input cannot be recognised by a pir-side message** (measured by the
  `pir-remote-control` session, 2026-09-26): no `user` message and no `bridge_state` on input.

## 8. Explicitly out of scope

- Workers idle without a report (`nudge-quiet-worker`).
- A park surviving a coordinator restart (`coordinator-restart-resume`, `resume-dead-worker`).
- Switching Remote Control on or off beyond following §2.1 (built in bda34a5).
- Relaying Remote Control input into pir's conversation log.
