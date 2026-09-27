---
setup:
  - test ! -f package-lock.json || npm ci
test:
  - npm test
---

# Nudge a quiet worker — Design

How parallel mode behaves is canonical in `/docs`. This file is build-time rationale for this plan;
T07 carries the resulting behaviour into `/docs` and `README.md`. It never edits a finished plan's
DESIGN.md.

**Re-planned 2026-09-26 on `live-workers`.** The first version (2026-09-24, reviewed the same day) was
designed on `claude --bg` workers: a note file shown by hooks passed at spawn, stop-and-resume as the
idle fallback, and a loop detector reading Claude's own session transcript. `live-workers` has since
made every worker a child of the coordinator driven through the Agent SDK, with a direct line down
(`platform.send`) and a conversation log pir writes itself. This version sends the nudge over that
line and reads activity from that log. The behaviour the person decided (§7) is unchanged; the
mechanism under it is replaced, and the probe task that was to prove the hooks is gone.

## 1. Purpose

In a parallel run a worker can stop making progress without ever dropping a report: a background
command, a Monitor, a file-watcher or an `until … sleep` wait-loop holds it, it ended its turn and
forgot the report, or it is looping on a check that will never pass. Today the coordinator never
notices and the worker holds its slot for ever. The only related guard, `AWAIT_IDLE_TIMEOUT_MS` /
`force-idle` (`src/shell/loop.mjs`), fires only after a worker has already dropped `implemented`/`done`.
A real run held T05 about 1h on its implementer and 4h on its reviewer on a leaked test-suite daemon.

This plan has the coordinator notice a worker that has made no progress for about 15 minutes and send
it one fixed, pre-written nudge over the worker's line, so the worker can free itself. It is for the
person running a plan in parallel, who does not want to babysit workers and does not want to be
pulled in by this feature at all.

### Success criteria

- A worker stuck in a needless wait-loop, or idle behind a leftover background job, receives a nudge
  within about one quiet period plus one pass, and in the live drill frees itself and finishes.
- A worker that keeps not progressing is nudged at most twice per stuck stretch and then shown as
  `stuck` on the dashboard and in the log; nothing is ever killed by this feature.
- A worker waiting on the person (a question report, or an unanswered permission request or question
  set), a worker past its report, and every worker while HALT is present are never nudged.
- The nudge text is a constant from `src/core/`, identical every time for the same settings, and a
  guard test fails if `loop.mjs` sends a worker any text other than the conflict prompt or a
  `nudgeMessage(` result.

### Stance

- The nudge is deterministic machinery, not a conversation. No helper agent, no model-written text.
  A thinking helper that reads the worker's conversation and talks it through is a possible
  follow-up, not this plan (§8).
- The nudge never involves the person. It is not a question, it asks for no reply, and it tells the
  worker not to ask the person about it. The person can see it in the worker's conversation view, as
  a message from pir, like the conflict fix.
- Report, never kill. After two nudges the coordinator labels the task `stuck` and keeps its slot; a
  kill would throw away work the person may still want and cannot undo a detached daemon anyway.

---

## 2. Behaviour specification

### 2.1 The channel: `platform.send`, the line `live-workers` built

The nudge is `platform.send(workerId, text, { from: 'pir' })`, the call the loop already uses for the
merge-conflict fix (`loop.mjs` 3d). `worker-proc` appends it to the conversation log as
`{ dir:"out", from:"pir", kind:"message", text }`, pushes it into the worker's input queue, and the
conversation view shows it marked as pir's. `send` returns `{ ok:false }` when the worker's process has
exited, after logging an `undelivered` note.

What is already measured, so nothing here needs a probe (live-workers FINDINGS):

- A message sent mid-turn is taken into the open turn (2026-09-24, 2.1.281). A worker cycling a
  tool-call wait-loop therefore sees the nudge at its next tool boundary.
- A message to an idle worker opens a new turn; that is how every opening instruction and conflict fix
  already reaches a worker.
- A worker whose turn ended with a background job still running reads `idle` from the stream
  (`workerActivity`), and the job's `task_notification` later opens a turn unasked (2026-09-25). The
  nudge reaches it like any idle worker.
- A worker blocked inside one long foreground tool call sees the nudge when that call returns. The Bash
  tool caps a foreground command at 10 minutes, below the quiet period.

What is not measured is how a real worker reacts to the text. Only the live drill (T09) shows that.

Rejected, with the reason:

- **Hooks and a note file** (the 2026-09-24 design): needed only because a `--bg` worker had no line
  down. It would add a hook script, a notes folder, spawn-time `--settings` and a probe, all to reach a
  worker pir can now simply message.
- **Interrupt before nudging**: would free a worker hung in one foreground call at once, but ends its
  turn and cancels its pending requests. A nudge should not destroy work in flight; out of scope (§8).
- **Posting into the session's inbox socket**: already rejected at the first plan review; moot now.

The `live-workers` Stance withdrew "the coordinator routes nothing to a worker". What stays true is that
pir sends a worker only fixed text it built itself: the opening instruction, the conflict prompt, and
now the nudge. The person's words reach a worker only through the person inbox, logged `from:"person"`.

### 2.2 What counts as progress

A worker is making progress while either of two signals moves. Both are read by the coordinator each
pass.

- **Real output**: its task worktree changed (HEAD moved, or a file was created, edited or deleted),
  or it dropped a report. The worktree is where every task's work lands, so no real progress happens
  without it changing eventually.
- **Varied work**: its conversation log shows a new action of its own, meaning a `tool-use` event (as
  `core/stream.mjs readEntry` reads an assistant `tool_use` block) whose signature it has not used in
  the preceding quiet window. This keeps a worker that is reading, thinking or running assorted
  commands from being nudged just because it has not saved a file yet.

A wait-loop is exactly the case the second signal must not count (user decision 2026-09-24): an
`until … sleep` poll made of repeated tool calls grows the log every round while achieving nothing. So
a repeated action, one whose signature already appeared in the window, is not activity. Only the
worker's own `tool-use` events count: tool results, `system` events (background-task starts and
notifications included), messages sent in, requests and notes are things that happen to the worker,
and assistant text is excluded because a looping worker narrates ("still waiting") in varying words.
A Monitor's events reach only the model, never the stream (live-workers FINDINGS 2026-09-26); the
worker's reaction to one is a `tool-use` like any other and is judged by the same rule.

The signature of an action is its tool name plus its input with volatile parts normalised: digit runs
collapsed, whitespace collapsed, and the Bash `description` field dropped because the model rewrites it
freely. It is a pure function in `src/core/` with its own tests, so what counts as "the same action"
is one reviewable rule.

The action's time is its log entry's `t`, stamped by `worker-proc` when the SDK yielded it. A single
long-running tool call appends nothing until it returns; that correctly counts as no activity.

Why not `workerActivity`'s `busy`/`idle`: a worker in a tool-call wait-loop is `busy` for ever, and an
idle worker behind a background job is `idle` while nothing is wrong with the flag. Neither state says
whether the worker is getting anywhere.

### 2.3 When to nudge, and when to call it stuck

Per eligible worker the coordinator tracks `lastActivityAt` (the last real output or varied work),
`nudges` (count in this stuck stretch), `lastNudgeAt`, and `stuck`.

- **Quiet period**: `PARALLEL_NUDGE_MS`, default 15 minutes, read like `PARALLEL_POLL_MS`. It is a
  setting because the live drill needs a short one (§5.2) and because 15 minutes is a first guess to be
  tuned on real runs. It exceeds the 10-minute Bash tool cap on purpose, so one legitimate long
  foreground command can never trigger a nudge by itself.
- **First nudge**: when `now - lastActivityAt >= quietMs` and `nudges == 0`.
- **Second nudge**: when `now - max(lastActivityAt, lastNudgeAt) >= quietMs` and `nudges == 1`. The
  clock restarts at each nudge so the worker gets a full quiet period to act on it.
- **Stuck**: when the same condition holds and `nudges == 2` (user decision 2026-09-24: at most two
  nudges per stuck stretch). The task is labelled `stuck`, a `stuck` line is logged once, and no more
  nudges are sent. Its slot stays held and nothing is closed.
- **Varied work** restarts the quiet clock only. **Real output** (worktree change or a report) also
  resets `nudges` to 0 and clears `stuck` (user decision 2026-09-24). The reason: a nudge itself
  provokes a burst of varied work (the worker inspects what is running, kills something). If that
  burst reset the count, a worker that pokes around and drops back into its loop would be nudged every
  quiet period for ever and never reach `stuck`.
- When a nudged or stuck worker produces real output, an `unstuck` line is logged so the log shows
  the nudge worked.

The decision is one pure function (§3.3) taking `now` and the tracked values as arguments.

### 2.4 Who is eligible

A worker in `platform.list()` (its process is live) whose task is in one of these states:

- phase `implementing` or `reviewing`, meaning it has not dropped the report for its current phase; or
- phase `awaiting-answer` with `decision.sent` true: pir sent it the merge-conflict fix and it is working
  on it (the `fixing conflict` row). It is waiting on nobody, so it can be stuck like any worker. This
  follows from the 2026-09-24 rule's own reason ("parked on the person"); the conflict-sent park did not
  exist when that rule was written.

And never:

- while its `workerActivity` state is `permission` or `questions`: an unanswered request is the worker
  waiting on the person, shown `asking you · …`. A nudge cannot answer it and the text would reach the
  worker only after the person has. The quiet clock restarts when the request is answered, so the
  worker does not come back from the person already overdue.
- while parked on a question, decision or conflict report of its own (`awaiting-answer` without
  `decision.sent`). A nudge would push it to guess.
- past `implemented`/`done` (`review-ready`, `done`). That is `force-idle`'s case, and its work is
  already reported.
- while HALT is present. HALT means stop acting on workers; nothing is read or sent.
- while `waitingOn(task, activity)` (`src/core/asking.mjs`) is non-null, whatever the reason: the row
  reads `asking you`. Since `stopped-worker-asking` (DESIGN §2.5 there, user 2026-09-27) that includes an
  `implementing`/`reviewing` worker idle with no background job running, which is how a worker that
  asked in plain text and forgot its report now looks. A nudge would open a turn and flip the row and
  Remote Control off and back on under the person. The clock restarts when `waitingOn` turns null, as
  for an answered request.

A phase change starts a fresh stretch: a new reviewer is a new worker with its own clock and a zero
count, and a worker returning to work (below) restarts its clock at that pass. A worker is observed
from its spawn, so a just-spawned worker has a full quiet period before its first possible nudge.

**Returning from a question** (user decision 2026-09-24; mechanism re-decided at plan review
2026-09-26). Before 2026-09-26 a worker parked by its own question/decision/conflict report stayed
`awaiting-answer` until its next `implemented`/`done` report, so an answered-then-stuck worker was never
nudged. The un-park is not built by this plan: `resumeAnswered` in `loop.mjs`, committed beside Remote
Control outside any plan (bda34a5, 5b899df, 2026-09-26), returns a parked task to
`implementing`/`reviewing` by its role when its worker opens a turn after the one its ask ended with, or
when a request seen pending while parked is answered with the turn still open; it clears the
`decision` and records `resumed`. It leaves a conflict-sent park alone. Its rule sees an
answer typed on claude.ai, which never reaches pir's log as a message; a rule reading `from:"person"`
entries would miss it. This plan relies on it: the phase change it makes starts a fresh stretch (above).

Its one weak spot, a leftover background job's notification opening a turn unasked, is benign here: the
worker reads as working, and if it then sits idle the nudge tells it to drop its question report again,
which parks it.

### 2.5 The nudge message

Fixed text, built only by `nudgeMessage({ n, max, quietMs })` in `src/core/nudge.mjs`. The minutes
figure is derived from `quietMs` and `n`/`max` are the nudge number, so the text is deterministic
given the settings. The numbering also tells the worker which nudge this is.

```
[pir:nudge 1/2] Automatic check from the PIR coordinator, not from the person. Nobody is waiting on
a reply and nobody will answer one. You have shown no progress for about 15 minutes. If a background
command, monitor, watcher or wait-loop is holding you, decide whether you still need it; if not, stop
it. Then continue your task. If you have finished, drop your report as the pir-worker skill says. If
you are waiting on the person's answer to a question you already asked them, drop your question
report now as pir-worker says and keep waiting for them. Do not reply to this message and do not ask
the person about it.
```

It is written as one line (the real text has no line breaks; they are wrapped here for reading).

The waiting-on-the-person sentence covers a worker that asked the person in plain text, ended its turn
and forgot the question report: from outside it looks exactly like a stuck worker. Filing the report
parks it as `asking you` and makes it ineligible, without telling it to stop waiting (user decision
2026-09-24). A worker that asked through AskUserQuestion has a pending request and is never nudged
(§2.4).

The worker files no new report kind after acting on a nudge (user decision 2026-09-24). The
coordinator's log lines are the record, and the worker's conversation log holds the why.

`skills/pir-worker/SKILL.md` learns what a `[pir:nudge …]` message is: act on it, do not reply, do not
ask the person about it, and do not treat it as a new instruction or a change of task (T06).

### 2.6 What the person sees

- Dashboard row: while a stretch has nudges, the label gains a suffix, `building · nudged 1×`, then
  `building · stuck` after the second nudge goes unanswered (user decision 2026-09-24). The same suffix
  goes on `reviewing` and `fixing conflict`. It clears on real output. The row keeps its kind, so it
  still counts as running.
- The worker's conversation view: the nudge is a message from pir, drawn the way the conflict fix is.
  Nothing new is built for this.
- Flow log (`plans/{slug}/.parallel/control/log`): `nudge T05`, `nudge-failed T05`, `stuck T05`,
  `unstuck T05`, through the loop's existing `record()`.
- `run.log` / the live bin: one plain line per event through `renderer.line`, exactly these (user
  decision 2026-09-24, kept short; the task id prefixes each because the log interleaves tasks):

  ```
  T05 nudged (1/2)
  T05 nudged (1/2) error: worker has exited
  T05 stuck
  T05 building          (or `reviewing`, by role: on unstuck)
  ```

  `building`/`reviewing` are the existing display phase labels (`displayPhaseFor`, coordinate.mjs),
  not new words. An unstuck conflict-fixing worker prints `fixing conflict`.

Nothing is surfaced as a question and nothing asks the person to act. `stuck` is information; the
person may open the worker's conversation and talk to it as with any worker.

### 2.7 The unhappy paths

- **Send fails** (`{ ok:false }`: the process exited between the listing and the send): log
  `nudge-failed T05` and count it as a nudge. The next pass lists the worker dead and the loop's
  existing dead-worker path takes over.
- **Worker blocked inside one hung foreground call**: the nudge waits in the open turn until the call
  returns. The coordinator does nothing special.
- **A permission request arrives after a nudge**: the worker becomes ineligible until it is answered
  (§2.4); the count is kept, the clock restarts on the answer.
- **git fails on the worktree**: keep the previous fingerprint for that pass and do not crash the
  loop. A transient git error must not look like progress or reset anything.
- **A log line that failed to parse** (`raw` from `readEntry`): not an action. It neither counts as
  activity nor stops the reading.
- **Coordinator restart**: nudge state is in memory only and starts fresh. A restart reaps the old
  run's workers from `workers.json` and spawns fresh ones, so there is nothing to carry over.
- **A leftover process writing into the worktree**: a file it writes that git lists (not ignored) is
  real output, so that worker is never nudged. Accepted as a known limit (user decision 2026-09-24):
  most tools write to ignored paths or outside the worktree, and counting only tracked or committed
  changes would make a worker writing a new file look stuck. T07 documents it.
- **Clock**: `now` is injected into `runPass` (coordinate.mjs does not pass one today; T04 adds it);
  nothing in `src/core/` reads a clock.
- **Stall detection**: a nudge is not a productive action. It must not be added to the
  `['spawn','review','merge','close']` productive-pass lists (coordinate.mjs, loop.mjs `drain`), or a
  nudge would hide a real stall from the runaway breaker.

---

## 3. Architecture

### 3.1 The boundary

```
src/core/   — pure. Takes inputs as parameters, returns decisions. No clock, no fs, no net, no npm imports.
src/shell/  — reads git and the workers' in-memory log entries, sends over the existing line.
```

- `src/core/activity.mjs` (new, pure): worker events → own actions, action signatures, the "new signature in the window" test, and folding one observation into the tracked
  activity state. It reads entries through `readEntry` (`core/stream.mjs`), never its own parser.
- `src/core/nudge.mjs` (new, pure): `decideNudge` and `nudgeMessage`.
- `src/shell/platform.mjs` (extended): `observe(id, { worktreePath, cursor })` returns the worktree
  fingerprint and the worker's log entries since `cursor`. The entries are the ones `worker-proc`
  already holds in memory; nothing reads the ndjson file back.
- `src/shell/loop.mjs` (extended): per task with a live worker, observe, decide, send, record.

`src/core/boundary.test.mjs` already forbids `node:fs`, `node:child_process`, `node:net`, `fetch(`,
`Date.now`, argumentless `new Date()`, `Math.random` and npm imports in `src/core/`. If it fails, the
fix is to move the code, never to relax the test.

`src/shell/no-down-channel.test.mjs` gains one check: every `platform.send(` call in `loop.mjs` passes as
its text either the conflict prompt (`workerText`) or a `nudgeMessage(` call, so any other text sent to
a worker from the loop fails the scan. The relay-token checks stay as they are.

### 3.2 Modules

- `core/activity.mjs`: owns what counts as activity (§2.2). Depends on `core/stream.mjs`.
- `core/nudge.mjs`: owns when to nudge or mark stuck (§2.3) and the text (§2.5). Depends on nothing.
- `shell/platform.mjs`: owns reading the worktree and handing out log entries. The send already exists.
- `shell/fake/platform.mjs`: gains scriptable `observe()` results (fingerprints and entries per worker,
  per pass) and a scriptable `state` for `permission`; its `sent[]` already records sends.
- `shell/loop.mjs`: wires them per pass. `shell/coordinate.mjs`: reads `PARALLEL_NUDGE_MS`, passes
  `now` and `nudgeMs`, prints the run.log line, carries the fields into `buildRunState`.
- `core/display.mjs`: renders the label suffix.

### 3.3 The decision function

```
decideNudge({ now, eligible, lastActivityAt, lastNudgeAt, nudges, stuck, quietMs, maxNudges })
  → { action: 'none' | 'nudge' | 'stuck', n?: number }
```

A function of its arguments and nothing else. `activity.mjs` decides what moved `lastActivityAt` and
whether the count resets; `decideNudge` only decides what to do about the time that has passed.

### 3.4 Data flow, one pass

1. The loop reads the live list and the report inbox (existing), which updates phases, and
   `resumeAnswered` returns any answered parked task to work (§2.4).
2. For each task with a live worker, unless HALT: `platform.observe(workerId, { worktreePath, cursor })`
   returns `{ fingerprint, entries, cursor }` (T03).
3. A parked task (`awaiting-answer` without `decision.sent`): only its cursor advances, so entries
   logged while it waited never count as activity later. Nothing else happens for it this pass.
4. Otherwise `observeActivity(prev, { fingerprint, entries, reported }, { now, windowMs })` (core, T01)
   returns the new tracked state and whether this observation was real output, varied work, or neither.
5. `decideNudge(...)` (core) returns the action; `eligible` folds in the phase and the worker's
   `list()` state (§2.4).
6. On `nudge`: `platform.send(workerId, nudgeMessage(...), { from: 'pir' })`, then
   `record('nudge' | 'nudge-failed', …)`. On `stuck`: `record('stuck', …)`.

### 3.5 Storage

All nudge state lives in `state.tasks[num]` in memory: `activity` (fingerprint, lastActivityAt, log
cursor, recent signatures), `nudges`, `lastNudgeAt`, `stuck`. Nothing is written to disk
except the log lines and the conversation log entry `send` already writes, so there is nothing to
corrupt on a crash, and a restart starts clean (§2.7). The cursor is an index into the worker's
in-memory entries, which only grow, so no partial line is ever read.

---

## 4. Testing

- `core/activity.test.mjs`: on `core/fixtures/stream-sample.ndjson` (real SDK messages, 2.1.282) and
  hand-built log entries: signature normalisation, a tool-call poll loop counting as no activity,
  varied reads counting, results, system events, sent messages and assistant text not counting, a
  `raw` entry skipped.
- `core/nudge.test.mjs`: every threshold edge (just under, exactly at, over), eligibility, two nudges
  then stuck, the clock restart at each nudge, count reset only on real output, the exact message text.
- `shell/platform.test.mjs`: the fingerprint against a scratch git repo, `observe` returning only new
  entries, an unknown id.
- `shell/loop.test.mjs`: a whole stuck stretch against the fake platform with an injected clock:
  nudge, nudge, stuck, unstuck on output; no nudge while asking, while a request is pending, past a
  report, or under HALT; a conflict-fixing worker nudged; a task `resumeAnswered` returns to work
  starts a fresh stretch.
- `shell/no-down-channel.test.mjs`: the send-text guard (§3.1).
- The live drill (T09) is the only place a real worker is nudged.

---

## 5. Environment — read this before running anything

Measured on 2026-09-26.

| | |
|---|---|
| OS | macOS (Darwin 25.5.0), aarch64 |
| Language / runtime | Node v24.2.0 (built-in test runner), npm 11.4.2 |
| Toolchain | git 2.50.1, `claude` 2.1.283 |
| Dependencies | `@anthropic-ai/claude-agent-sdk` 0.3.282 and `@earendil-works/pi-tui` 0.87.1, both from `live-workers`, pinned and locked. This plan adds none. |

The installed `claude` (2.1.283) is one release ahead of the SDK's pair (2.1.282). `live-workers` §5
accepts that skew and says a protocol break surfaces as `sdk-error` at the first worker; upgrading the
SDK is not this plan's work.

**The test command.**

```
npm test
```

It runs `FORCE_COLOR=0 NO_COLOR=1 node --test --test-reporter=dot 'src/**/*.test.mjs'`: quiet on pass,
full failure output, exit code carries the result. Detail for debugging:
`node --test --test-reporter=spec 'src/**/*.test.mjs'`. It was green on 2026-09-26 with 1034 tests. A
fresh worktree needs the `setup` line (`npm ci`) first.

### 5.1 What the test command cannot reach

| Cannot be tested automatically | Why it needs a person or a live run |
|---|---|
| A real worker, nudged out of a needless wait-loop, frees itself sensibly without asking the person (T09) | The machine checks see the log lines and the report; whether the reaction was sensible is judged by T09's worker from the conversation (user, plan review 2026-09-26), recorded as worker-judged |
| The SDK's message shapes stay what `readEntry` reads across Claude Code updates | `live-workers` owns that risk (§5 there); a changed shape shows as `raw` entries, which count as no activity and can cause a harmless early nudge |

### 5.2 Seatbelts

| Flag / mechanism | Default | Effect |
|---|---|---|
| `PARALLEL_NUDGE_MS` | 900000 (15 min) | The drill sets 120000 so a stuck stretch takes minutes, not an hour |
| Scenario ceiling | per scenario | The `quiet-worker` scenario runs 1 worker |
| Harness scenario `timeoutMs` | 10 min default | The `quiet-worker` scenario sets 25 min; on expiry the runner touches HALT and tears workers down |
| Scratch repo | harness `--into` a trusted scratch path | The drill never touches this repo or `main` |
| `workers.json` reap | on stop, restart, teardown | No orphaned worker survives a killed coordinator |

Never run the drill against a real plan, and never with the 15-minute default to see what happens.

### 5.3 Outside the code — who acts

Everything here is local to this machine; nothing reaches another person. No credentials beyond the
existing `claude` login are involved.

| Action | Command (exact, wrapped) | Bin | Why this bin | Way back | Expected cost | Login check |
|---|---|---|---|---|---|---|
| live-nudge-drill | `node src/shell/harness/run.mjs quiet-worker --into /tmp/pir-quiet-worker` (the scenario sets `PARALLEL_NUDGE_MS=120000` itself, T08) | worker | Spawns a real coordinator and one paid worker; bounded by ceiling 1, the 25-min cap and a scratch repo. Moved down from `ask` by the user at plan review 2026-09-26, as live-workers bins its bounded harness runs | the harness tears workers down and HALTs on timeout; the scratch repo is disposable | one small task plus two nudges, under a dollar or two | `claude --version` exits 0 |
| refresh-install | `./install.sh` | worker | Local copy of this repo's engine and skills; the same step every engine task ends with. Never while any parallel run is live (live-workers §5) | re-run `./install.sh` from the previous commit | none | none |
| npm-ci | `npm ci` in a fresh task worktree (the `setup` line) | worker | Installs only the exact locked versions `live-workers` let in | delete `node_modules` | none | none |

The user approved the first version of this table at plan review on 2026-09-24. The re-plan removed the
`hook-probe` row, moved the drill's quiet-period setting into the scenario and added `npm-ci`. At the
re-review on 2026-09-26 the user moved the drill to `worker`. `.claude/settings.json` has all three
commands under `allow`.

---

## 6. Recovery

Nothing here can lock anyone out. If nudges misbehave on a real run: touch HALT
(`plans/{slug}/.parallel/control/HALT`), which stops all sends immediately, or set
`PARALLEL_NUDGE_MS` very high to disable nudging in effect. A nudge that reached a worker cannot be
recalled, but it asks for nothing irreversible and the worker's permission rules still apply to
anything it does next; the person can also open the worker in `pir` and tell it otherwise.

---

## 7. Decisions and rationale

- **Never nudge a worker `waitingOn` reads as waiting on the person** (user, 2026-09-27, planning
  `stopped-worker-asking`). Amended before any task was built; §2.4. The nudge now reaches only
  wait-loops and workers idle behind a background job; the nudge text's report sentence stays, harmless.
- **Deterministic nudge from the coordinator, no helper agent** (brief, PM, 2026-09-24). Cheapest thing
  that could work; a model-written nudge is a follow-up if the fixed one proves too blunt.
- **Activity = real output or varied own actions; a repeated action is not activity** (user,
  2026-09-24). Chosen over "the log grew", which misses a tool-call wait-loop, the case the person
  named as crucial, and over "folder changed only", which would nudge every worker that reads for 15
  minutes.
- **At most two nudges per stuck stretch, then `stuck`, never kill** (user, 2026-09-24).
- **The count resets only on real output; varied work only restarts the clock** (user, 2026-09-24).
  Otherwise the burst of work a nudge provokes would reset the count and a looping worker would never
  reach `stuck`.
- **Dashboard shows `nudged N×` and `stuck` as a label suffix** (user, 2026-09-24).
- **A worker waiting on the person but missing its report is told to file it and keep waiting** (user,
  2026-09-24). The alternative text could push it to guess.
- **An answered worker returns to work** (user, 2026-09-24). Chosen over leaving it parked, which left
  an answered-then-stuck worker unwatched.
- **The un-park is `resumeAnswered`, not this plan's own rule** (user, plan review 2026-09-26). It was
  being built beside Remote Control and sees answers typed on claude.ai, which a `from:"person"` rule
  cannot; two rules for one step would conflict in `runPass`. This drops the re-plan's `personReplies`
  and `unpark` (§2.4).
- **No new report kind after a nudge** (user, 2026-09-24). The log line is the record.
- **`PARALLEL_NUDGE_MS` env override, default 15 minutes** (planner). Follows `PARALLEL_POLL_MS`; the
  drill needs it.
- **A failed send counts as a nudge** (planner). An unreachable worker reaches `stuck` or is reaped as
  dead instead of being retried every pass.
- **The nudge number is in the text** (planner). Deterministic, and it tells the worker which nudge it is.
- **Channel: `platform.send` over the live-workers line** (re-plan, 2026-09-26, on the user's request to
  re-plan on `live-workers` and the Agent SDK). Replaces the 2026-09-24 hook-and-note channel and its
  stop-and-resume fallback, which existed only because a `--bg` worker had no line down. The probe task
  (old T00) and the note sender (old T04) are dropped: every fact they were to establish is either
  measured in live-workers FINDINGS or now pir's own log format.
- **Activity is read from pir's conversation log, not Claude's transcript** (re-plan, 2026-09-26). The
  log is pir's own, written by `worker-proc` and read by `readEntry`, so the transcript path helpers,
  `sessionId` lookups, byte offsets and the `activity-degraded` fallback all go.
- **A worker with a pending permission request or question set is not nudged** (re-plan, 2026-09-26).
  Same reason as the 2026-09-24 parked rule: it is waiting on the person. The first version listed a
  worker frozen on a permission prompt as unreachable and out of scope; `live-workers` routes that
  prompt to the person, so it is now simply ineligible.
- **A conflict-fixing worker is eligible** (re-plan, 2026-09-26). It is parked in the loop's phase
  model but works on pir's instruction, waiting on nobody; the 2026-09-24 exclusion was for workers
  waiting on the person. Confirmed by the user at plan review 2026-09-26.
- **Extend, do not rebuild** (survey). The per-task timers sit beside `busySince` in `runPass`; the
  label is a suffix in `display.mjs rowFor`; the log lines use `record()`; the env knob follows
  `PARALLEL_POLL_MS` in `coordinate.mjs`; the live check is a new harness fixture; the send is the
  conflict fix's `platform.send`; the event reading is `readEntry`.

---

## 8. Explicitly out of scope

- **A thinking helper agent that reads the worker's conversation and talks it through.** An explicit
  possible follow-up; it costs a model call per nudge and a new kind of session to supervise.
- **Killing, interrupting or restarting a stuck worker.** Kill loses work and does not stop a detached
  daemon; an interrupt ends the turn and cancels its requests; `resume-dead-worker` covers dead workers.
- **A shorter quiet period for a worker that is idle with nothing running.** The stream can tell that
  case apart now; whether to nudge it sooner is a behaviour change nobody has asked for.
- **Persisting nudge state across a coordinator restart.** Restart reaps the workers anyway.
- **Any reply from the worker to the coordinator about a nudge.** No new report kind (§2.5).
- **Changing `force-idle`.** It covers the post-report case and is left as it is.
