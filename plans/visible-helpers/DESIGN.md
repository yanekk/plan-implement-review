---
setup:
  - test ! -f package-lock.json || npm ci
test:
  - npm test
---

# Visible helpers — Design

How parallel mode behaves is canonical in `/docs`. This file is build-time rationale for this plan; T07
carries the resulting behaviour into `docs/human-flow.md` and `README.md`. It never edits a finished
plan's DESIGN.md.

## 1. Purpose

A session pir holds (a planner, a plan reviewer, a build worker, the coordinator agent) can start
helpers of its own with Claude's Agent tool (older name `Task`). Today pir shows a helper as one
`↳ running in the background: …` line and then mixes the helper's own steps and words into the
parent's conversation as if the parent had produced them, labelled `worker ▸`. The person cannot tell
what the helper is doing, whether it is still alive, or which of the lines are the parent's.

The brief came from `pir/plan-0339` (now `finisher`). The planner spawned a background Explore helper
at 08:24:07, asked the person a question while it ran, and the person pressed Esc at 08:25:10. That
interrupt cancelled the question and Claude killed the helper with it (`task_updated` `killed`,
`task_notification` `stopped`). The model was told only `[Request interrupted by user for tool use]`,
never that its helper had died, so eight minutes later it ended a turn with "I'm waiting for a survey"
while nothing was running, and pir read that stop as `asking you`. The reading was correct: while the
helper had been alive, `background` (stopped-worker-asking §2.2) had kept the session out of
`asking`. The defect was that nobody could see the helper's life, and nobody told the model it had
ended. The trimmed log is `evidence/plan-0339-helper.ndjson`.

### Success criteria

- Every helper a session starts is one line in its conversation, naming it, its current step, its step
  count and how long it has run, and ending as finished, stopped or failed.
- None of a helper's own steps or words appear in the default conversation; in the Tab detail view they
  appear labelled as the helper's.
- A permission request a helper makes names the helper.
- Esc (or Ctrl+C on an empty box) while helpers run warns first and lists them; a second Esc interrupts.
- The person's next message after such an interrupt carries a note from pir naming the helpers the
  interrupt stopped, and the conversation shows that note.
- A session whose helper is running is never `asking you`, on the list row, the clock or Remote Control,
  and a helper's output never opens a turn of its parent (proven on the plan-0339 log).

## 2. Behaviour specification

### 2.1 What a helper is, in the log

Measured on the plan-0339 log (Claude Code 2.1.28x, SDK 0.3.282) and by a probe run in this planning
session (Claude Code 2.1.284, 2026-09-29):

- The parent's `Agent` (or `Task`) tool_use starts it. A `system:task_started` follows with
  `task_type: 'local_agent'`, the `task_id` (the helper's id), `tool_use_id` (the parent's Agent call),
  `description`, `subagent_type`, and `is_backgrounded` (`true` for a background helper, `false` for a
  foreground one). A background helper is also listed in `background_tasks_changed`.
- While it works, `system:task_progress` events carry the same `task_id` and `tool_use_id`, a
  `description` of the current step ("Reading src/shell/worker-proc.mjs", "Running git log…"),
  `last_tool_name`, and `usage.tool_uses` and `usage.duration_ms`.
- Every assistant or user frame the helper produces carries `parent_tool_use_id` set to the parent's
  Agent call id. The parent's own frames carry `parent_tool_use_id: null`.
- When a helper asks permission, the SDK's `canUseTool` options carry `agentID` equal to the helper's
  `task_id`, and `toolUseID`. The wire field is `request.agent_id`. The request reaches `canUseTool`
  before the helper's tool_use frame is yielded, so attribution goes by `agentID`, not by frame order.
- It ends with `task_updated` `patch.status` in `completed | failed | killed | stopped` and then
  `task_notification` with `status`. An interrupt of the parent kills every running helper: plan-0339
  shows `task_updated killed` and `task_notification stopped` two milliseconds after the `out
  interrupt`.

A helper spawned by a helper (nested) has frames whose `parent_tool_use_id` is the inner Agent call.
They roll up into the outermost helper, whose line and label they share, because the person asked to
see the agent's helpers, not a tree.

### 2.2 The helper line (default view)

Each helper is exactly one line, placed where it started (directly under the parent's `⎿ Agent …` step
line), replacing today's `↳ running in the background: …` and `↳ … in the background: …` lines for
`local_agent` tasks. Background Bash commands and monitors keep today's two lines.

```
  ↳ helper · Survey end-of-run machinery · Reading src/shell/worker-proc.mjs · 9 steps · 21s
  ↳ helper finished · Survey end-of-run machinery · 20 steps · 1m 12s
  ↳ helper stopped · Survey end-of-run machinery · 20 steps · 1m 2s
  ↳ helper failed · Survey end-of-run machinery · 4 steps · 8s
```

- Running reads `dim`; finished reads `dim`; stopped and failed read `bad`. `killed` and `stopped`
  both read `stopped`.
- The step text is the latest `task_progress.description`; before the first progress event it is
  `starting`. Steps and time come from the latest progress `usage` (`tool_uses`, `duration_ms`), so the
  core reads no clock; the time is therefore as of the last progress event, which arrives every few
  seconds while the helper works. An ended helper drops the step text.
- The line is clipped to the width like every step line, never wrapped: it is a status, not prose.
- A helper whose `task_started` was never seen (a log that begins mid-run) gets no line; its frames are
  still kept out of the default view by `parent_tool_use_id`.

Why one line at its start and not a line at its end too: the person chose "one line that updates as it
works". The end is still visible where it matters, through the Esc warning (§2.5) and the note under
the person's next message (§2.6).

### 2.3 The helper's steps and words (Tab detail view)

In the default view every frame with a non-null `parent_tool_use_id` is left out: its text, its tool
steps, its tool results. In the Tab detail view (`full`) they are drawn in log order where they
occurred, each prefixed so it cannot be read as the parent's:

- the helper's text: `helper ▸ ` prefix, style `dim`;
- the helper's tool steps: the ordinary step line with `helper ` before the `⎿`, e.g.
  `  helper ⎿ Read src/core/notify.mjs  159`.

Why hide them by default: in plan-0339 a busy helper produced 20 step lines in a minute between the
parent's own lines, and one of its sentences read as `worker ▸`. The person chose the one-line view.

### 2.4 A helper's permission request

A request entry with an `agentId` is the helper's. Its head names the helper instead of the parent:
`? helper "Survey end-of-run machinery" asks …` in place of `? {taskId} asks …`, both in the pinned
gate and in the answered request drawn in the scrollback. An `agentId` that matches no helper seen in
the log reads `? a helper asks …`. Everything else about the gate (keys, grants, arming) is unchanged,
and the row still reads `asking you · allow a command?`, because the person must still answer it.

`worker-proc.mjs` logs `agentId: opts.agentID` on the request entry when present. Nothing else in the
request flow changes.

### 2.5 The Esc warning

In the conversation view, when the parent has running helpers (§2.1: started, not ended) and the person
presses Esc, or Ctrl+C on an empty box (the two keys that interrupt today):

- the first press sends nothing and arms a warning, drawn where the status line is:
  `esc again to interrupt · this also stops 2 helpers: Survey end-of-run machinery; Check the tests`;
- a second Esc (or Ctrl+C) while armed sends the interrupt, as today;
- any other key disarms the warning and then does what it would have done, the same convention the
  risky-permission gate uses (`gateReducer`: "any other key disarms");
- with no helper running, Esc interrupts at once, as today.

The warning is armed state in the view, not a timer: the core never reads a clock, and an armed
warning left alone does nothing. The helper list is computed when the key is pressed, so a helper that
ended since is not listed; if none is still running by the second press, the interrupt is sent anyway,
because the person has confirmed it.

Why a warning and not a block: the person decides whether stopping the helper is worth it; pir only
makes sure they know it will happen.

### 2.6 The note on the next message

A helper counts as stopped by an interrupt when its end (`killed` or `stopped`) arrives after an `out
interrupt` and before the `result` that closes that turn. When the person next sends a message from the
conversation view, pir attaches a note naming every helper stopped by an interrupt that no earlier
message has already reported:

```
[pir] Before this message, the person's interrupt stopped your helpers: "Survey end-of-run machinery".
They will not report back. Start them again or do the work yourself if it is still needed.
```

- The note goes to the model first, then a blank line, then the person's text, in one user message.
- The logged `out message` entry keeps the person's `text` unchanged and adds `helpersStopped: [ids]`
  and `preface: <the note>`, so the conversation draws `you ▸ {text}` and then the note as a `pir ▸`
  line under it, and a later note never repeats a helper already reported.
- Only a typed message carries it. A permission reply, a refusal with text, or question answers do
  not, because they answer a request rather than start a turn; the interrupt has cancelled every pending
  request anyway (stream.mjs).
- Input typed over Remote Control does not pass through pir's view and carries no note (§8).

Why attach it to the person's message rather than send it on its own at once: a message on its own
opens a turn, and the model would carry on with work the person had just interrupted. Attached, it
arrives exactly when the person speaks.

### 2.7 Asking, and the parent's turns

`background` already holds a running background helper's id, so `stoppedOnPerson` is false and neither
a build task nor a planning step reads `asking` while it runs. A foreground helper keeps the parent's
turn open. Neither rule changes. T01 fixes one defect under them: the helper's frames are
`TURN_OPENERS` today (`text`, `tool-use`), so a helper's output after the parent's `result` re-opens a
parent turn and adds a `turnCauses` entry and a later `result`-less open. Frames with a non-null
`parent_tool_use_id` never open or count a parent turn. A pending request from a helper still makes the
state `permission` or `questions`, as it must.

### 2.8 The unhappy paths

| Case | Behaviour |
|---|---|
| A log starting mid-helper (resumed view, truncated log) | No line for a helper without `task_started`; its frames still hidden by default |
| A `resumed` note (pir-plan-command §2.14) | Every helper not ended before it counts as stopped with the old process; not listed as running, not reported by a note |
| A helper with no progress event yet | `starting`, `0 steps`, no time |
| A `task_notification` with no `task_updated` before it, or the reverse | Either end event ends the helper; the first status seen wins |
| Two helpers | Two lines; the warning and the note list both, in start order |
| Esc pressed while a question is pinned and a helper runs | Warning first; the second Esc interrupts and cancels the question, as today |
| Read-only view (the worker has exited) | Lines as recorded; no warning (Esc sends nothing today); no note |
| A helper's own permission request after the parent's `result` | Pinned and labelled as the helper's; the row reads `asking you · allow a command?` |

## 3. Architecture

### 3.1 The boundary

The rules live in `src/core` and take log entries in and return data; no clock, no filesystem, no
package import (`boundary.test.mjs` enforces it; if it fails, move the code, never relax the test). The
shell only carries the note through the drop, the inbox and the worker's queue, logs `agentId`, and
paints the warning.

### 3.2 Modules

| Module | Side | Change |
|---|---|---|
| `src/core/stream.mjs` | pure | events carry `helper` (the `parent_tool_use_id`) when set; requests carry `agentId`; helper frames never open a turn (T01) |
| `src/core/helpers.mjs` | pure, new | `helpersOf(entries)`, `runningHelpers(entries)` (T01); `stoppedByInterrupt(entries)`, `helpersNote(helpers)`, `interruptGate(gate, key, running)` (T04) |
| `src/core/fixtures/helper-sample.ndjson` | fixture, new | trimmed from `evidence/plan-0339-helper.ndjson` (T01) |
| `src/shell/fake/claude-stream.mjs` | test fake | a permission step may carry `agentId` (T02) |
| `src/shell/conversation-rig.mjs` | rig | scenario `helpers` (T02) |
| `src/core/conversation.mjs` | pure | helper line, detail labels, request head, note line (T03, T05) |
| `src/shell/worker-proc.mjs` | shell | logs `agentId` on requests (T03); `send(text, { from, preface, helpersStopped })` (T05) |
| `src/shell/conversation-view.mjs` | shell | the Esc/Ctrl+C gate and the note on submit (T05) |
| `src/shell/person-inbox.mjs`, `src/shell/platform.mjs` (`send`), `src/shell/coordinator-agent.mjs` (its `send` wrapper), `src/shell/plan-run.mjs` (its platform `send`) | shell | pass `preface` and `helpersStopped` through (T05) |

### 3.3 Data flow

The view already folds the worker's conversation log on every paint (`buildConversation`,
`workerActivity`). It adds `runningHelpers(entries)` for the gate and `stoppedByInterrupt(entries)` for
the note. On submit, the drop becomes `{ to, kind: 'message', text, preface?, helpersStopped? }`; the
inbox calls `platform.send(to, text, { from: 'person', preface, helpersStopped })`; the worker logs the
entry with both fields and queues `preface + '\n\n' + text` to the model. Nothing new is stored: the
log is the record, and a note already sent is known from the `helpersStopped` of earlier `out message`
entries.

## 4. Testing

`npm test` runs every `src/**/*.test.mjs` with the dot reporter and colour off (`FORCE_COLOR=0
NO_COLOR=1`, set in `package.json`); a pass prints a few lines of dots and exits 0, a failure prints its
assertion and stack. Run one file with `node --test src/core/helpers.test.mjs` for detail. A full run
takes about five minutes on this machine.

The fold and the rules are tested on `helper-sample.ndjson` and hand-built entries. The screen is
driven end to end through the existing conversation rig (`src/shell/conversation-rig.mjs`, its pty
driver in `conversation-rig.test.mjs`) and the fake `claude` (`src/shell/fake/claude-stream.mjs`): no
real Claude, no cost. T06 is the drill. No live paid run is planned: every wire shape the code reads is
in the plan-0339 log or the §2.1 probe.

## 5. Environment — read this before running anything

Measured 2026-09-29: Node 24.2.0, Claude Code 2.1.284, `@anthropic-ai/claude-agent-sdk` 0.3.282.
`npm test` passes on a fresh detached worktree after `npm ci` (setup line) and leaves it clean. Without
`npm ci` a fresh worktree has no `node_modules`. `COLORTERM=truecolor` is set in this shell; nothing
forces colour, and the test script sets `FORCE_COLOR=0 NO_COLOR=1` itself.

### 5.1 What the test command cannot reach

| Cannot be tested automatically | Why |
|---|---|
| A real model acting on the note (restarting or absorbing the stopped helper's work) | Model behaviour; the note's text and delivery are tested, what a model does with it is not |

### 5.2 Seatbelts

| Mechanism | Effect |
|---|---|
| The rig runs the fake `claude` in a scratch folder (`--into`, else a temp folder) | Nothing paid, never the canonical checkout |

### 5.3 Outside the code — who acts

| Action | Command | Bin | Why this bin | Way back | Cost |
|---|---|---|---|---|---|
| `./install.sh` | refresh the installed engine and skills after the plan merges | `worker` | Local, idempotent; never while a run is live | Re-run from the previous commit | none |

Nothing in this plan needs the person's hands.

## 6. Recovery

Display and message text only; nothing persists beyond the fields added to log entries, which older
code ignores. To back the change out, revert the task commits and run `./install.sh`.

## 7. Decisions and rationale

- Conversation only; no helper row in the run's list (person, 2026-09-29). The list row keeps reading
  the parent's state.
- One updating line per helper, steps on Tab (person, 2026-09-29), §2.2–§2.3.
- Warn before Esc, listing the helpers, second Esc confirms; the next prompt carries a note naming the
  helpers stopped before it (person, 2026-09-29), §2.5–§2.6.
- Prototype skipped: the surface is a handful of text lines in an existing screen whose wording the
  person chose from written examples.
- Extend, not rebuild: the helper line replaces the `local_agent` branch of `backgroundEvent` in
  `conversation.mjs`; `background` in `workerActivity` already carries a background helper, so the
  asking rule needs no change, only a regression test (§2.7). The Esc gate follows `gateReducer`'s
  "any other key disarms" convention. The note rides the existing drop → inbox → `send` path.
- Attribution by `agentID`, not by frame order, because the probe showed the request arriving before
  the helper's tool_use frame (§2.1).
- Nested helpers roll up into the outermost one (§2.1).

## 8. Explicitly out of scope

- A helper line or count on the run's list row, the dashboard or Remote Control (person's choice).
- A warning for an interrupt sent from Remote Control or the phone: it never passes through pir's view.
- A note for input typed over Remote Control, for the same reason.
- Background Bash commands and monitors: unchanged, even though an interrupt may stop them too.
- Stopping a single helper from pir (the SDK's `stopTask`): not asked for.
