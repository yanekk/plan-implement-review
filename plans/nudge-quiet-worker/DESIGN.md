# Nudge a quiet worker — Design

How parallel mode behaves is canonical in `/docs`. This file is build-time rationale for this plan;
T08 carries the resulting behaviour into `docs/control-folder.md`, `docs/run-lifecycle.md` and
`docs/human-flow.md`. It never edits a finished plan's DESIGN.md.

## 1. Purpose

In a parallel run a worker can stop making progress without ever dropping a report: a background
command, a Monitor, a file-watcher or an `until … sleep` wait-loop holds it, or it simply forgot the
report. Today the coordinator never notices and the worker holds its slot for ever. The only related
guard, `AWAIT_IDLE_TIMEOUT_MS` / `force-idle` (`src/shell/loop.mjs`), fires only after a worker has
already dropped `implemented`/`done`. A real run held T05 about 1h on its implementer and 4h on its
reviewer on a leaked test-suite daemon (`docs/human-flow.md` "Known limitation").

This plan has the coordinator notice a worker that has made no progress for about 15 minutes and show
it one fixed, pre-written nudge through the worker's own hooks, so the worker can free itself. It is
for the person running a plan in parallel, who does not want to babysit workers and does not want to
be pulled in by this feature at all.

### Success criteria

- A worker stuck in a needless wait-loop, or idle behind a leftover background job, receives a nudge
  within about one quiet period plus one poll, and in the live drill frees itself and finishes.
- A worker that keeps not progressing is nudged at most twice per stuck stretch and then shown as
  `stuck` on the dashboard and in the log; nothing is ever killed by this feature.
- A worker parked on the person, a worker past its report, and every worker while HALT is present are
  never nudged.
- The nudge text is a constant from `src/core/`, identical every time for the same settings, and no
  test-visible path lets any other text reach a worker.

### Stance

- The nudge is deterministic machinery, not a conversation. No helper agent, no model-written text.
  A thinking helper that reads the worker's output and talks it through is a possible follow-up, not
  this plan (§8).
- The nudge never involves the person. It is not a question, it asks for no reply, and it tells the
  worker not to ask the person about it. The one case where the person is already involved (a worker
  waiting on an answer it forgot to report) is resolved by filing the missing report, not by a new
  escalation (§2.5).
- Report, never kill. After two nudges the coordinator labels the task `stuck` and keeps its slot; a
  kill would throw away work the person may still want and cannot undo a detached daemon anyway.

---

## 2. Behaviour specification

### 2.1 The channel: a note the worker's own hooks show it

The code and docs state there is no coordinator→worker channel: `docs/control-folder.md` says "There
is no coordinator → worker channel at all. A Node process cannot send a cross-session message", the
`src/shell/platform.mjs` header says "no `claude` subcommand can send a cross-session message", and
`plans/parallel-pir/DESIGN.md §2.2` decided it. The official docs (code.claude.com/docs, 2026-09-24)
agree that no supported way exists for an outside program to post into a running session.

This plan adds one, entirely inside what Claude Code supports (user decision 2026-09-24):

- **The coordinator writes a note file** for one worker, keyed by its `sessionId`, in a place every
  worktree of the repo can reach and `git status` never lists (T00 fixes the location).
- **Every worker is spawned with two hooks** passed by `claude --bg --settings <json>`, so they apply to
  workers only, never to the person's own sessions. A tool hook (PreToolUse/PostToolUse) shows a waiting
  note as `additionalContext` on the worker's next tool call, which covers a worker looping on tool calls.
  An async watcher hook (`asyncRewake`) waits for a note while the worker is idle and wakes it with the
  note, which covers a worker whose turn ended with a background job still running. Each hook deletes the
  note once shown, so a note still on disk means it has not been delivered yet.
- **Fallback for the idle case**: if T00 finds the wake does not work, a nudge to a worker whose note
  stays undelivered is stop-and-resume instead: `claude stop`, then `claude --bg --resume <sessionId>
  "<nudge>"`, the same conversation, name and folder (probed in `resume-dead-worker` FINDINGS 2026-09-24)
  and built on that plan's `platform.revive` (its T02), never a second copy of it.

Rejected: writing into the session's inbox socket (`/tmp/cc-socks/<pid>.sock`). It is an undocumented
internal, and this machine's auto-mode classifier blocked both attempts (as "Auto-Mode Bypass" and
"Credential Exploration"). Rejected as separate, larger work: workers the coordinator starts and holds on
a stream-json pipe (cezar's model), because the person could no longer answer a worker directly in its
own session; and moving workers to the pi agent, whose extensions offer this pattern natively.

What stays true is the reason the down-channel was removed: the coordinator routes nothing from the
person to a worker. The nudge is one fixed, one-way note; the person's answers still go to a worker only
by the person typing them in that worker's session. The `no-down-channel` guard test is narrowed to say
exactly that (§3.1), not deleted.

The hooks are unproven on a real worker; nothing below is designed as settled until T00 proves them
(§2.8).

### 2.2 What counts as progress

A worker is making progress while either of two signals moves. Both are read from outside the worker
by the coordinator each pass.

- **Real output**: its task worktree changed (HEAD moved, or a file was created, edited or deleted),
  or it dropped a report. The worktree is where every task's work lands, so no real progress happens
  without it changing eventually.
- **Varied work**: its session transcript shows a new action of its own, meaning an assistant
  `tool_use` whose signature it has not used in the preceding quiet window. This keeps a worker that
  is reading, thinking or running assorted commands from being nudged just because it has not saved
  a file yet.

A wait-loop is exactly the case the second signal must not count (user decision 2026-09-24): an
`until … sleep` poll made of repeated tool calls grows the transcript every round while achieving
nothing. So a repeated action, one whose signature already appeared in the window, is not activity.
Only the worker's own `tool_use` actions count: tool results, Monitor or background-task
notifications, attachments and incoming messages are things that happen to the worker, and assistant
text is excluded because a looping worker narrates ("still waiting") in varying words.

The signature of an action is its tool name plus its input with volatile parts normalised: digit runs
collapsed, whitespace collapsed, and the Bash `description` field dropped because the model rewrites it
freely. It is a pure function in `src/core/` with its own tests, so what counts as "the same action"
is one reviewable rule.

A single long-running tool call appends nothing to the transcript until it returns; that correctly
counts as no activity.

Why the transcript and not `claude agents --json` status: the planning probe (FINDINGS 2026-09-24)
showed a session whose turn had ended with a background `sleep` still running reported
`busy`/`working` indefinitely, so the status flag cannot tell working from stuck. The transcript's own
entries can.

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

Only a live worker (listed in `claude agents --json`, past its appear grace) whose task phase is
`implementing` or `reviewing`, meaning it has not dropped the report for its current phase.

- Never a worker parked on the person (`AWAITING`: `question`, `decision`, `conflict`). It is waiting
  on the person by design; a nudge would push it to guess.
- Never a worker past `implemented`/`done` (`review-ready`, `done`). That is `force-idle`'s case, and
  its work is already reported.
- Nothing is sent while HALT is present. HALT means stop acting on workers.
- A phase change starts a fresh stretch: a new reviewer is a new session with its own clock and a zero
  count, and a worker returning from `AWAITING` restarts its clock at the moment it returned.
- **Returning from `AWAITING`** (user decision 2026-09-24). Today a parked worker stays `AWAITING` until
  its next `implemented`/`done` report; nothing un-parks it when the person answers, so without this rule
  an answered worker that later got stuck would never be nudged and would read `asking you` for ever.
  The loop keeps reading an `AWAITING` worker's transcript (it never nudges it), and the first message
  typed by the person into that session after the park returns the task to `implementing`/`reviewing`
  by its role, clears its `decision`, and starts a fresh stretch. Only the person's reply counts, not the
  worker's own work: the worker skill tells a parked worker to keep doing independent work, so "worker
  did something" would un-park a worker still waiting. Applies to coordinator-parked conflicts too. If
  T00 finds a person's reply cannot be told apart from other incoming messages in the transcript, stop
  and return to the person; the fallback is to leave `AWAITING` as it is and document the gap.
- A worker is observed from its spawn time, so a just-spawned worker has a full quiet period before
  its first possible nudge.

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

The waiting-on-the-person sentence covers a worker that asked the person in its own session but
forgot the question report: from outside it looks exactly like a stuck worker. Filing the report parks
it as `asking` on the dashboard and makes it ineligible, without telling it to stop waiting (user
decision 2026-09-24).

The worker files no new report kind after acting on a nudge (user decision 2026-09-24). The
coordinator's log lines are the record, and the worker's own transcript holds the why.

`skills/pir-worker/SKILL.md` learns what a `[pir:nudge …]` message is: act on it, do not reply, do not
ask the person about it, and do not treat it as a new instruction or a change of task (T07).

### 2.6 What the person sees

- Dashboard row: while a stretch has nudges, the phase label gains a suffix, `building · nudged 1×`,
  then `building · stuck` after the second nudge goes unanswered (user decision 2026-09-24). It clears
  on real output. The row keeps its `building`/`reviewing` kind, so it still counts as running.
- Flow log (`plans/{slug}/.parallel/control/log`): `nudge T05`, `nudge-failed T05`, `stuck T05`,
  `unstuck T05`, `unpark T05`, `activity-degraded T05`, through the loop's existing `record()`.
- `run.log` / the live bin: one plain line per event through `renderer.line`, exactly these (user
  decision 2026-09-24, kept short; the task id prefixes each because the log interleaves tasks):

  ```
  T05 nudged (1/2)
  T05 nudged (1/2) error: <reason from platform.nudge>
  T05 stuck
  T05 building          (or `reviewing`, by role: on unstuck, and on unpark after the person's reply)
  ```

  `building`/`reviewing` are the existing display phase labels (`displayPhaseFor`), not new words.

Nothing is surfaced as a question and nothing asks the person to act. `stuck` is information.

### 2.7 The unhappy paths

- **Note write fails**: log `nudge-failed T05` (the flow log line is kind and task only, as `record()`
  writes it; the reason goes on the run.log line) and count it as a nudge, so a worker that cannot be
  reached still reaches `stuck` instead of being retried every pass.
- **Note not delivered**: a note still on disk when the next decision falls due means no hook showed
  it. It counts as a nudge; the next nudge replaces it, and the run.log line carries `error: not
  delivered`. Under the stop-and-resume fallback (§2.1) that next nudge is the resume.
- **Worker blocked inside one hung foreground command**: the tool hook shows the note when the command
  returns or hits the Bash 10-minute cap. The coordinator does nothing special.
- **Worker frozen on a permission prompt**: probably unreachable. It will reach `stuck`. Fixing that
  case is out of scope (§8).
- **Transcript not found or unparseable** (session id missing, Claude Code changed the format): fall
  back to real output only for that worker and log `activity-degraded T05` once. A reading worker may
  then get a harmless nudge; a nudge feature that silently stopped working would be worse.
- **git fails on the worktree**: keep the previous fingerprint for that pass and do not crash the
  loop. A transient git error must not look like progress or reset anything.
- **Coordinator restart**: nudge state is in memory only and starts fresh. A restart already reaps the
  old run's workers (reconcile), so there is nothing to carry over.
- **Session id**: the note is keyed by `sessionId` from `claude agents --json`, re-read every pass.
- **A leftover process writing into the worktree**: a file it writes that git lists (not ignored) is
  real output, so that worker is never nudged. Accepted as a known limit (user decision 2026-09-24): most
  tools write to ignored paths or outside the worktree, and counting only tracked or committed changes
  would make a worker writing a new file look stuck. T08 documents it.
- **Clock**: `now` is injected into `runPass`; nothing in `src/core/` reads a clock.
- **Stall detection**: a nudge is not a productive action. It must not be added to the
  `['spawn','review','merge','close']` productive-pass lists (coordinate.mjs, loop.mjs), or a nudge
  would hide a real stall from the runaway breaker.

### 2.8 What T00 must settle before anything is built on it

1. Hooks passed with `--settings` at `claude --bg` spawn load in the worker, with no permission-mode flag.
2. The tool hook shows a note to a worker cycling a tool-call wait-loop, on its next tool call.
3. How the shown note is labelled to the model, and what it appends to the transcript.
4. The async watcher wakes an idle worker whose turn ended with a background job still running, and
   shows it the note. If not, the idle case uses stop-and-resume (§2.1).
5. How a message the person types into a background session appears in its transcript, and whether it
   can be told apart from a hook-shown nudge, a background-task notification and a tool result (§2.4).
6. Where the note lives: reachable from every worktree of the repo and never listed by `git status`;
   the hook input field that carries the session id.
7. The transcript line shapes this design parses (`type:"assistant"` entries with `message.content[]`
   `tool_use` blocks and an ISO `timestamp`), and where it lives (`~/.claude/projects/*/<sessionId>.jsonl`).

If 1 or 2 fails, the plan stops and returns to the person: there is no supported channel for the
looping case. If 4 fails, the fallback applies without a new decision. Answer 6 feeds T04; 5 and 7 feed
T01.

---

## 3. Architecture

### 3.1 The boundary

```
src/core/   — pure. Takes inputs as parameters, returns decisions. No clock, no fs, no net.
src/shell/  — reads git, the transcript file and `claude agents`; writes the note file; spawns workers with hooks.
```

- `src/core/activity.mjs` (new, pure): transcript text → own actions and the person's replies, action signatures, the "new
  signature in the window" test, and folding one observation into the tracked activity state.
- `src/core/nudge.mjs` (new, pure): `decideNudge` and `nudgeMessage`.
- `src/shell/platform.mjs` (extended): `activity()` reads a worktree fingerprint and the new bytes of a
  transcript; `nudge()` writes a worker's note file; `spawn` passes the hook `--settings`. `parseAgents` now keeps `sessionId`. The transcript path helpers move here from `harness/capture.mjs`,
  which imports them back (user decision 2026-09-24: one lookup, not two).
- `src/shell/nudge-hook.mjs` (new): the worker-side hook script, tool and wake modes (§2.1).
- `src/shell/loop.mjs` (extended): per eligible task, observe, decide, send, record.

`src/core/boundary.test.mjs` already forbids `node:fs`, `node:child_process`, `node:net`, `fetch(`,
`Date.now`, argumentless `new Date()` and `Math.random` in `src/core/`. If it fails, the fix is to move
the code, never to relax the test. `Date.parse` on a transcript timestamp is allowed; it reads no clock.

`src/shell/no-down-channel.test.mjs` is narrowed, not removed. It keeps forbidding the relay machinery
and any `.send(` (the method is named `nudge`, not `send`), and forbids `node:net` and `cc-socks`. It gains a check that the only
`platform.nudge(` call in `loop.mjs` passes a `nudgeMessage(` result, so no other text can be routed to
a worker. The platform test `createMessaging exposes inbox and no send` stays true, because the nudge
lives on the platform object, not on the messaging surface; its comment is corrected.

### 3.2 Modules

- `core/activity.mjs`: owns what counts as activity (§2.2). Depends on nothing.
- `core/nudge.mjs`: owns when to nudge or mark stuck (§2.3) and the text (§2.5). Depends on nothing.
- `shell/platform.mjs`: owns reading the outside world and writing the note. Depends on git and the
  filesystem.
- `shell/nudge-hook.mjs`: runs inside the worker; owns showing and consuming its note.
- `shell/fake/platform.mjs`: gains scriptable `activity()` results and a recorded `nudge()`, so
  `loop.test.mjs` can drive a whole stuck stretch without a live agent.
- `shell/loop.mjs`: wires them per pass. `shell/coordinate.mjs`: reads `PARALLEL_NUDGE_MS`, passes
  `now`, prints the run.log line, carries the fields into `buildRunState`.
- `core/display.mjs`: renders the label suffix.

### 3.3 The decision function

```
decideNudge({ now, eligible, lastActivityAt, lastNudgeAt, nudges, stuck, quietMs, maxNudges })
  → { action: 'none' | 'nudge' | 'stuck', n?: number }
```

A function of its arguments and nothing else. `activity.mjs` decides what moved `lastActivityAt` and
whether the count resets; `decideNudge` only decides what to do about the time that has passed.

### 3.4 Data flow, one pass

1. The loop reads the live list (existing) and the inbox (existing), which updates phases.
2. For each eligible task: `platform.activity({ worktreePath, sessionId, transcriptPath, offset })`
   returns `{ fingerprint, transcriptPath, text, nextOffset, transcriptFound }` (T03).
3. `observeActivity(prev, obs, { now, windowMs })` (core, T01) returns the new tracked state and whether
   this observation was real output, varied work, or neither.
4. `decideNudge(...)` (core) returns the action.
5. On `nudge`: `platform.nudge({ sessionId }, nudgeMessage(...))` returns `{ ok, reason? }`, then
   `record('nudge' | 'nudge-failed', …)`; a previous note still pending (`platform.nudgePending`) is
   reported as not delivered (§2.7). On `stuck`: `record('stuck', …)`.

### 3.5 Storage

All nudge state lives in `state.tasks[num]` in memory: `activity` (fingerprint, lastActivityAt,
transcript path and byte offset, recent signatures), `nudges`, `lastNudgeAt`, `stuck`. Nothing is
written to disk except the log lines, so there is nothing to corrupt on a crash, and a restart starts
clean (§2.7). The transcript is read incrementally from a byte offset, cut at the last complete line
before decoding, so a half-written line is never parsed and the next pass reads it whole.

---

## 4. Testing

- `core/activity.test.mjs`: transcript parsing on real line shapes (captured in T00), signature
  normalisation, a tool-call poll loop counting as no activity, varied reads counting, notifications
  and text not counting, a partial trailing line.
- `core/nudge.test.mjs`: every threshold edge (just under, exactly at, over), eligibility, two nudges
  then stuck, the clock restart at each nudge, count reset only on real output, the exact message text.
- `shell/platform.test.mjs`: the note write and replace, write failure, the spawn `--settings` JSON, the
  fingerprint against a scratch git repo, the incremental transcript read.
- `shell/nudge-hook.test.mjs`: tool and wake modes against a temp notes dir, with no real waiting.
- `shell/loop.test.mjs`: a whole stuck stretch against the fake platform with an injected clock:
  nudge, nudge, stuck, unstuck on output; no nudge while AWAITING, past a report, or under HALT.
- `shell/no-down-channel.test.mjs`: the narrowed guard (§3.1).
- The live drill (T10) is the only place a real worker is nudged.

---

## 5. Environment — read this before running anything

Measured on 2026-09-24.

| | |
|---|---|
| OS | macOS (Darwin 25.5.0), aarch64 |
| Language / runtime | Node v24.2.0 (built-in test runner), npm 11.4.2 |
| Toolchain | git 2.50.1, `claude` 2.1.281 (`--settings` hooks, `claude agents --json` with `pid` and `sessionId`) |
| **Deliberately absent** | No runtime dependencies. No write to any session inbox socket (§2.1). |

**The test command.**

```
npm test
```

It runs `FORCE_COLOR=0 NO_COLOR=1 node --test --test-reporter=dot 'src/**/*.test.mjs'`: quiet on pass,
full failure output, exit code carries the result. `FORCE_COLOR=3` is set in this machine's environment
and the command overrides it. Detail for debugging: `node --test --test-reporter=spec 'src/**/*.test.mjs'`.
It was green on 2026-09-24 with 662 tests (re-measured at plan review).

**Dependencies.** None added. Node standard library, `git` and `claude` only.

### 5.1 What the test command cannot reach

| Cannot be tested automatically | Why it needs a person or a live run |
|---|---|
| A worker's hooks show it the note, looping and idle (T00) | Needs a live session |
| A real worker, nudged out of a needless wait-loop, frees itself sensibly without asking the person (T10) | The machine checks can see the log lines and the report; whether the worker's reaction was sensible is a judgement on its transcript |
| The transcript format stays parseable across Claude Code updates | Undocumented format; §2.7 degrades safely if it changes |

### 5.2 Seatbelts

| Flag / mechanism | Default | Effect |
|---|---|---|
| `PARALLEL_NUDGE_MS` | 900000 (15 min) | The drill sets 120000 so a stuck stretch takes minutes, not an hour |
| `PARALLEL_MAX_WORKERS` | per scenario | The drill runs 1 worker |
| Harness scenario `timeoutMs` | 10 min default | The `quiet-worker` scenario sets 25 min; on expiry the runner touches HALT and tears workers down |
| Scratch repo | harness creates one | The drill never touches this repo or `main` |
| `spike/nudge-probe.mjs teardown` | T00 | Stops and removes the probe session and its folder, and confirms none is left |

Never run the drill against a real plan, and never with the 15-minute default to see what happens.

### 5.3 Outside the code — who acts

Everything here is local to this machine; nothing reaches another person. No credentials beyond the
existing `claude` login are involved.

| Action | Command (exact, wrapped) | Bin | Why this bin | Way back | Expected cost | Login check |
|---|---|---|---|---|---|---|
| hook-probe | `node spike/nudge-probe.mjs <spawn\|nudge\|status\|teardown>` | ask | Spawns a paid scratch session with new hooks, which is new ground | `teardown` stops and removes the scratch session and its note; a shown note cannot be recalled but reaches only the scratch session | a few cents of tokens | `claude agents --json` exits 0 |
| live-nudge-drill | `PARALLEL_NUDGE_MS=120000 node src/shell/harness/run.mjs quiet-worker --into /tmp/pir-quiet-worker` | ask | Spawns a real coordinator and a paid worker | the harness tears workers down and HALTs on timeout; the scratch repo is disposable | one small task plus two nudges, under a dollar or two | `claude agents --json` exits 0 |
| refresh-install | `./install.sh` | worker | Local copy of this repo's engine and skills; the same step every engine task ends with | re-run `./install.sh` from the previous commit | none | none |

The user approved this table at plan review on 2026-09-24, keeping both `ask` rows as `ask` (the probe
row renamed from `inbox-probe` when the channel changed). The coordinator's own stop-and-resume of a
worker, under the fallback, is a run action like its existing `claude stop`, not a separate row. Its rules are
in `.claude/settings.json`: `./install.sh` and the login check under `allow`, each probe subcommand and
the exact drill command under `ask`.

---

## 6. Recovery

Nothing here can lock anyone out. If nudges misbehave on a real run: touch HALT
(`plans/{slug}/.parallel/control/HALT`), which stops all sends immediately, or set
`PARALLEL_NUDGE_MS` very high to disable nudging in effect. A nudge that reached a worker cannot be
recalled, but it asks for nothing irreversible and the worker's permission rules still apply to
anything it does next.

---

## 7. Decisions and rationale

- **Deterministic nudge from the coordinator, no helper agent** (brief, PM, 2026-09-24). Cheapest thing
  that could work; a model-written nudge is a follow-up if the fixed one proves too blunt.
- **Activity = real output or varied own actions; a repeated action is not activity** (user,
  2026-09-24). Chosen over "transcript grew", which misses a tool-call wait-loop, the case the person
  named as crucial, and over "folder changed only", which would nudge every worker that reads for 15
  minutes. The cost is a loop detector built on an undocumented transcript format; §2.7 degrades it
  safely.
- **At most two nudges per stuck stretch, then `stuck`, never kill** (user, 2026-09-24).
- **The count resets only on real output; varied work only restarts the clock** (user, 2026-09-24).
  Otherwise the burst of work a nudge provokes would reset the count and a looping worker would never
  reach `stuck`.
- **Dashboard shows `nudged N×` and `stuck` as a label suffix** (user, 2026-09-24). The person can tell
  a nudged worker from a healthy one at a glance without being pulled in.
- **A worker waiting on the person but missing its report is told to file it and keep waiting** (user,
  2026-09-24). The alternative text could push it to guess.
- **The person's reply un-parks an `AWAITING` worker** (user, 2026-09-24). Chosen over leaving it parked,
  which left an answered-then-stuck worker unwatched, and over un-parking on any worker activity, which
  would un-park a worker doing independent work while it still waits (§2.4).
- **No new report kind after a nudge** (user, 2026-09-24). The log line is the record.
- **`PARALLEL_NUDGE_MS` env override, default 15 minutes** (planner). Follows `PARALLEL_POLL_MS`; the
  drill needs it.
- **A failed send counts as a nudge** (planner). An unreachable worker reaches `stuck` instead of being
  retried every five seconds.
- **The nudge number is in the text** (planner). Deterministic, and it tells the worker which nudge it is.
- **Channel: a note file shown by the worker's own hooks, stop-and-resume as the idle fallback** (user,
  2026-09-24, after the socket post was blocked twice by the classifier and the user rejected it). Only
  supported mechanisms; the person still answers workers in their own sessions (§2.1).
- **Extend, do not rebuild** (survey). The per-task timers sit beside `busySince` in `runPass`; the
  label is a suffix in `display.mjs rowFor`; the log lines use `record()`; the env knob follows
  `PARALLEL_POLL_MS` in `coordinate.mjs`; the live check is a new harness fixture. `parseAgents`
  already drops `sessionId` deliberately (its comment says so); this plan reverses that because the
  transcript lookup needs it, and the comment is updated.
- **Planning probe** (2026-09-24): a background session that replied and ended its turn with a
  background `sleep` still running stayed `busy`/`working` in `claude agents --json`; its transcript
  stopped growing at the turn end. This rules out the status flag as the quiet signal.

---

## 8. Explicitly out of scope

- **A thinking helper agent that reads the worker's output and talks it through.** An explicit possible
  follow-up; it costs a model call per nudge and a new kind of session to supervise.
- **Killing or restarting a stuck worker.** Kill loses work and does not stop a detached daemon; a
  sibling brief ("resume a crashed worker") covers dead workers.
- **A stream-json worker model or a move to the pi agent.** Either gives a native message channel but is
  a rebuild of how workers run (§2.1).
- **Freeing a worker frozen on a permission prompt.** A note cannot answer a prompt, by design of
  Claude Code; that worker is shown `stuck`.
- **Persisting nudge state across a coordinator restart.** Restart reaps the workers anyway.
- **Any reply from the worker to the coordinator about a nudge.** No new report kind (§2.5).
- **Changing `force-idle`.** It covers the post-report case and is left as it is.
