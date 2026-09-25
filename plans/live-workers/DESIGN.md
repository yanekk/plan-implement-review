---
setup:
  - test ! -f package-lock.json || npm ci
test:
  - npm test
---

# Live workers — Design

How parallel mode behaves is canonical in `/docs`. This file is build-time rationale for this plan;
T17 carries the resulting behaviour into `/docs`. It never edits a finished plan's DESIGN.md.

## 1. Purpose

A parallel run's workers are `claude --bg` background sessions today. The coordinator cannot say
anything to them: it starts them with one instruction and afterwards only reads the report files they
drop. The person reaches a worker by leaving `pir`, finding it in `claude agents` and attaching. A merge
conflict is resolved by the person copying a prompt out of pir and pasting it into the worker.

This plan makes every worker a child process of the coordinator, driven through the Claude Agent SDK,
which speaks Claude Code's stream-json protocol to the installed `claude`, so the coordinator holds a
live two-way line to each one. Through that line pir can message a
worker at any moment, a worker's permission requests and question sets come to pir, and everything the
worker does is saved as it happens. The `pir` screen gains a third view, a worker's conversation, where
the person reads the worker and answers, approves, interrupts or types to it without leaving pir. It is
for the person running a plan in parallel, and it is the channel later plans (nudging a quiet worker,
reviving a dead one) build on.

### Success criteria

- `pir {slug}` runs a plan to a green feature branch with every worker a stream-json child; none is a
  `claude --bg` session.
- The person answers a worker's plain question, question set and permission request inside `pir`, and
  the worker carries on; an Esc interrupts a busy worker within about a second.
- A merge conflict reaches the worker as a message from pir with no copy and paste.
- The runs list and the run live view look and behave as before the move to pi-tui.
- `npm test` stays green, quiet and free of paid calls: every protocol path is exercised by the real SDK
  against a fake `claude` that speaks stream-json.

### Stance

- pir talks to workers. The rule "the coordinator routes nothing to a worker" (non-agentic-coordinator
  §2.2) is withdrawn on purpose, user 2026-09-24. That rule existed because the old relay went through
  an agentic coordinator and dropped messages; this line is direct, recorded, and passes through no
  model.
- pir shows the part of Claude's screen a person needs to steer a worker, and nothing more (§2.11,
  §8). The rest of Claude Code's screen is not rebuilt.
- The conversation log on disk is the single source for the conversation view. The coordinator writes
  it, the `pir` screen only reads it, so a closed screen loses nothing and two screens agree.

---

## 2. Behaviour specification

### 2.1 A worker is a stream-json child of the coordinator

The coordinator starts each worker with the Agent SDK's `query()` (`@anthropic-ai/claude-agent-sdk`,
§5), user 2026-09-25. pir does not build protocol lines itself; the SDK owns the wire format and is
released in step with Claude Code (SDK 0.3.N pairs with CLI 2.1.N).

```js
query({ prompt: <pir's input queue, an AsyncIterable of SDK user messages>, options: {
  cwd: <task worktree>, sessionId: <uuid chosen by pir>, permissionMode: 'auto',
  pathToClaudeCodeExecutable: <the installed `claude`, resolved once at coordinator start>,
  extraArgs: { name: <agent name from naming.mjs> },
  canUseTool: <pir's handler, §2.6, §2.7>,
  spawnClaudeCodeProcess: <pir's adapter over node:child_process.spawn, so pir holds the pid (§2.12) and tests swap the binary>,
}})
```

`spawnClaudeCodeProcess` is `(SpawnOptions { command, args, cwd, env, signal }) → SpawnedProcess` (sdk.d.ts
0.3.282), not `spawn`'s own signature, so pir passes a small adapter: `spawn(command, args, { cwd, env, stdio })`,
returning the ChildProcess (which satisfies SpawnedProcess). The SDK's forwarded `signal` fires only after its
own stdin-EOF grace, so the adapter may hang a kill on it without racing the worker's clean exit.

- The SDK launches exactly the line the plan-time probes measured by hand (seen 2026-09-25 on 2.1.282):
  `claude --output-format stream-json --verbose --input-format stream-json --permission-prompt-tool stdio
  --permission-mode auto --session-id=<uuid> --name <name>`. It runs on the person's Claude login; no API
  key is read (`apiKeySource: none`, measured).
- The installed `claude` is used, not the SDK's bundled binary: workers run the same Claude the person
  runs, and the 222 MB binary is not installed (`--omit=optional`, §5).
- `settingSources` is left at its default (user, project, local, as the CLI), so CLAUDE.md, skills and
  the auto-mode exception load as they do for a `--bg` worker.
- The opening instruction (`openingInstruction`, platform.mjs) is pushed as the first user message, not as
  an argument. One path for every message keeps the log uniform.
- pir chooses the session id, and that uuid is the worker's `id` everywhere. This removes today's
  mismatch between the id `claude --bg` prints and the id `claude agents` lists (loop.mjs matches by
  name to work around it).
- `permissionMode: 'auto'` keeps today's behaviour: workers ran in auto mode, which is why this project
  ships an auto-mode exception (`src/core/settings.mjs`). A `-p` worker defaults to `default` mode if
  the mode is left off (measured 2026-09-24).
- Passing `canUseTool` is what makes the SDK add `--permission-prompt-tool stdio`, which routes permission
  requests and AskUserQuestion to pir. Without it AskUserQuestion is absent from the worker's tools
  (measured on the raw line 2026-09-24).
- The worker's skills load as before: `user-invocable: false` skills are missing from `init.slash_commands`
  but still load through the Skill tool (measured).

Liveness is the child process: a worker is live while its process has not exited. `claude agents` is
no longer consulted by the coordinator for its own workers. A `-p` worker still shows in
`claude agents --json`, as `kind:"interactive"` with its `-n` name, a status, and `id: null` (measured
2026-09-24 on 2.1.282), so the person can see it there but cannot attach to it; nothing in pir may treat
that listing as a handle on a live worker.

### 2.2 The line down

pir pushes each message into the worker's input queue, which the SDK writes to the worker. Every
message pir sends is also appended to the conversation log (§2.3) with its sender, `pir` or `person`, so the view shows who said what. In this
plan pir itself sends exactly two things: the opening instruction, and the merge-conflict fix (§2.10).
Anything else pir might say later (nudges) belongs to the plan that needs it.

A message sent while the worker is mid-turn is taken into that turn (measured), so pir never queues
messages waiting for idle.

### 2.3 The conversation log

`plans/{slug}/.parallel/control/conversations/{Txx}-{role}-{n}.ndjson`, `role` implement or review,
`n` counting that task and role's workers from 1 in this run. One JSON object per line:

```
{ "t": <ms>, "dir": "in", "event": <an SDK message, exactly as query() yielded it> }
{ "t": <ms>, "dir": "request", "requestId": "…", "toolName": "…", "input": {…}, "suggestions": […],
  "reason": "…", "description": "…", "defaultToNo": bool, "suppressAlwaysAllowRule": bool }
{ "t": <ms>, "dir": "out", "from": "pir" | "person", "kind": "message", "text": "…" }
{ "t": <ms>, "dir": "out", "from": "person", "kind": "interrupt" }
{ "t": <ms>, "dir": "out", "from": "pir" | "person", "kind": "reply", "requestId": "…", "result": <PermissionResult> }
{ "t": <ms>, "dir": "note", "kind": "delivered-by-grant" | "undelivered" | "exited" | "sdk-error" | …, … }
```

- A `request` entry is one `canUseTool` call: `requestId`, `decisionReason` (as `reason`) and
  `description` come from the SDK's call options, `suggestions` from its `suggestions`. The SDK does
  not yield control requests as messages, so pir records them itself.
- Written by the coordinator only, appended one `write` per line, so a reader never sees a torn line
  from a single writer and the view needs no lock.
- A log line that fails to parse on read (a crash mid-append) is kept by the reader as `raw` and never
  stops it. An error thrown by the SDK's message stream is logged as a `sdk-error` note with its message,
  and the worker is then handled as exited (§2.14).
- Kept until the person removes the run from the dashboard (Ctrl+X), which deletes the folder with the
  run's index record. A restart keeps it; a new worker for the same task gets the next `n`.

### 2.4 Worker state from the stream

The pure core derives each worker's activity from its events: `busy` (a turn is open: a message went
in and no `result` has come back), `idle` (last turn ended, nothing pending), `permission` (a
`request` entry for any tool but AskUserQuestion has no reply), `questions` (an AskUserQuestion
request has no reply). The loop's existing `isBusy` and force-idle logic read this instead of
`claude agents` status.

T00, 2026-09-25: stands. A `result` with nothing pending was never followed by another message in 20 s, over five results.

A task row shows "asking you" when the worker has a report of kind question/decision/conflict (as
today) or a pending permission or question set. The row says which: `asking you · allow a command?`,
`asking you · a question`. The asking footer reads `● Txx slug — asking you; open it (→) to answer`, and the
coordinator's start banner in `run.log` says to answer in `pir` the same way; neither mentions
`claude agents` or attaching any more. The report file stays part of the worker contract because it is what keeps
a parked worker's slot and task phase in the loop; the pending request is what tells the person what
kind of answer is wanted.

### 2.5 The person's input reaches the coordinator through a drop folder

The `pir` screen and the coordinator are separate processes. The screen writes one file per input into
`plans/{slug}/.parallel/control/inbox/`, temp-then-rename like the workers' reports:

```
{ "to": "<worker id>", "kind": "message", "text": "…" }
{ "to": "<worker id>", "kind": "interrupt" }
{ "to": "<worker id>", "kind": "permission", "requestId": "…", "decision": "allow" | "deny" | "allow-always" }
{ "to": "<worker id>", "kind": "answers", "requestId": "…", "answers": { "<question>": "<label, …>" } }
{ "to": "<worker id>", "kind": "decline-questions", "requestId": "…", "text": "…" }
```

- The coordinator watches the folder with `fs.watch` and forwards each drop as it lands, independent of
  the 5 s pass, so a message or an interrupt is not held up by the dispatch cycle. A poll at the pass
  catches anything the watcher missed.
- A forwarded input is logged as `dir:"out", from:"person"`; one addressed to a worker that is gone, or
  answering a request that is no longer pending, is logged as a `note` `undelivered` and deleted. The
  view shows it, so a lost answer is never silent.
- Before writing, the screen checks the coordinator is alive: the open run's state is `running`, as the
  dashboard's `classifyRun` decides it (pid and start time; `resolveLiveness` alone reads the pid only, so a
  reused pid would pass). If it is not, nothing is written, the view says the run is not running, and the typed text stays in the box.
- Startup hygiene clears `inbox/` like `reports/`: an input addressed to a previous run's worker must
  never reach a new one.

### 2.6 Permission requests

A permission request (a `canUseTool` call, logged as a `request` entry) shows in the conversation with the tool, the command or input, and the
worker's description. Keys: `y` allow once, `n` refuse, `a` allow and do not ask this worker again for
this. Typing a reply instead refuses and sends the text as the refusal message, so the worker sees why.

"Do not ask again" is remembered by pir, per worker, in memory for the worker's life, never written to
any settings file (user 2026-09-24). pir keeps it because Claude does not: returning
`updatedPermissions` with `destination:"session"` did not stop the next identical request (measured
on the raw line 2026-09-24; T00 rechecks it through the SDK). The grant is the `addRules` rule Claude
itself suggested for that request, which the SDK passes to `canUseTool` as `suggestions`; a later request from the same worker that the rule matches is allowed by pir at once and
logged as `delivered-by-grant`. Matching follows Claude's rule form: an exact `ruleContent` matches the
identical input; a `prefix:*` form matches any command starting with the prefix. When a request carries
no `addRules` suggestion, `a` is not offered.

Claude flags some requests itself (`canUseTool` options, sdk.d.ts 0.3.282), and pir honours both flags (user
2026-09-25, re-review): `suppressAlwaysAllowRule` means the rule would grant more than this request, so `a`
is not offered; `defaultToNo` means one stray key must not approve it, so the first `y` only arms the gate
("press y again to allow") and a second `y` allows, the press-twice pattern pir uses for stop and remove.
Any other key disarms. `n` refuses in one press as usual.

pir answers by resolving the pending `canUseTool` promise with a `PermissionResult`. A refusal is
`behavior:"deny"` with the message `The person refused.` or the typed text. A request left unanswered
keeps its promise open. The SDK itself sets no deadline ("permission prompts have no park deadline",
sdk.d.ts 0.3.282); whether Claude gives up on a long-unanswered request is not yet measured; T00 checks it.

T00, 2026-09-25: a request left 300 s unanswered was not timed out. Through the SDK, Claude did honour a
session `addRules` grant (contrary to the raw-line row), so pir's own grant list may be redundant: a decision
for the user, unchanged here. The grant returned must be the `addRules` suggestion only: returning every
suggestion also applied `setMode acceptEdits` to the worker.

### 2.7 Question sets

An AskUserQuestion request (`input.questions[]`: `question`, `header`, `options[{label,description}]`,
`multiSelect`) shows as a picker, one question at a time, like Claude's own: ↑↓ move, space picks or
ticks, Enter goes to the next question and on the last sends. Every question gets a final "Other" line
that takes the typed text as the answer. The `canUseTool` result is `behavior:"allow"`, `updatedInput` = the request's
input plus `answers: { "<question text>": "<label>" }`, several labels joined with `", "` (the round trip
was measured). Typing a reply instead of using the picker sends `decline-questions`: pir refuses the
tool with the typed text as the message, which is what Claude's own "chat about this" amounts to.

### 2.8 Interrupt

Esc in a worker's conversation calls the SDK's `interrupt()`, which sends the interrupt control request.
The open turn ends at once with a `result` of subtype `error_during_execution` (measured on the raw line
2026-09-24, about 1 s; through the SDK 2026-09-25, acknowledged at once); the person then types a new instruction. A command
the worker had already moved to the background keeps running and reports later, as with Esc in Claude.

### 2.9 Slash commands

A slash command is sent as an ordinary user message; its reply comes back as worker text (measured:
`/context`, `/model`). The typing box autocompletes from the worker's `init.slash_commands` minus
`init.terminal_slash_commands` (`/doctor`, `/color`, `/focus`, `/reload-plugins`), which do not work
over the line.

### 2.10 The merge-conflict fix goes to the worker

When the coordinator's merge of a task branch conflicts and the worker that built it is live, pir sends
it the resolution prompt directly (§2.2) instead of printing it for the person. `buildConflictPrompt`
(core/conflict.mjs) drops the copy markers for this path (the `KEEP:` blank is already gone, f3d4b8f) and tells the worker to
merge the feature branch in, resolve, run the test command, commit, re-signal done, and ask the person
when choosing a side needs a judgement. The restart path with no live worker keeps today's printed
prompt, because there is nobody to send it to.

Once the fix is sent, the task row reads `fixing conflict` in the working (cyan) style, with no paste block
and no conflict footer: nothing is asked of the person, and if the worker needs a judgement it asks and the
row turns `asking you` like any question (user 2026-09-24, plan review). The orange `merge conflict` row and
its paste-in prompt in the watch view (f3d4b8f) stay only for a conflict no live worker received.

### 2.11 The `pir` screen

The whole `pir` screen moves onto `@earendil-works/pi-tui` (user 2026-09-24): the runs list, the run
live view and the new conversation view. One library draws the terminal; two painters on one alt screen
fight over the cursor.

- The runs list and the run live view look and behave exactly as before. Any visible difference is a
  bug. The pure frame builders (`buildListFrame`, `buildWatchFrame`, `dashboardReducer`) and their tests
  stay; only the painting changes.
- The run live view gains a selectable task row. ↑↓ move it, → or Enter opens that task's worker. A task
  with no worker yet says so in the footer. ← still steps back to the list and Esc still quits `pir`,
  as today (`decodeKey`: lone Esc is `quit`, ← is `back`).
- The conversation view (prototype approved 2026-09-24, `prototype/`):

| Key | Does |
|---|---|
| typing, Enter | send a message to the worker |
| Esc | interrupt the worker (§2.8) |
| Ctrl+C | clear the box if it holds text, else interrupt the worker, as in Claude's own screen (user 2026-09-25, re-review; it quits `pir` in the other views) |
| ← with an empty box | back to the run live view |
| Tab | one line per step (default) ⇄ full detail |
| y / n / a | answer a pending permission request, only while the box is empty (§2.6) |
| ↑↓ space Enter | drive a pending question set, only while the box is empty (§2.7) |
| PgUp / PgDn | scroll |

  One line per step is the default (user 2026-09-24). A step line is the tool name, its main argument,
  and the last line of its result. Messages from pir, the person and the worker are marked and coloured
  differently. A pending permission request or question set is highlighted and pinned above the box.
- The view opens the task's live worker; with none live, the task's latest worker, read-only (no box).

### 2.12 Stop, remove, restart, and orphaned workers

A worker does not reliably die with a coordinator killed by SIGKILL: a child mid-command was still alive
22 s after its parent was killed (measured 2026-09-24). An idle SDK-driven worker whose parent exited
hard was gone within about a second (measured 2026-09-25), which does not cover the mid-command case.
T00, 2026-09-25: stands. Re-measured through the SDK: alive 10 s after the parent's SIGKILL, mid-command.
pir spawns the process itself through `spawnClaudeCodeProcess` (§2.1), so it has the pid. So:

- The coordinator writes `control/workers.json`, `[{ id, task, role, pid, startTime }]`, temp-then-rename,
  on every spawn and exit. `startTime` is `startTimeOf(pid)` (identity.mjs), so a reused pid is never
  mistaken for a worker.
- Closing a worker: end its input queue (the SDK then closes the worker's stdin), SIGTERM after 5 s if it
  has not exited, SIGKILL after 10 s. pir's escalation runs on the pid; it does not depend on the SDK's
  own grace window (about 2 s after stdin EOF).
- `teardownRun` closes every live child. It stays synchronous because it runs from signal handlers and the
  loop's pass is synchronous: it ends every input queue and SIGTERMs every pid without waiting, and
  `close(id)` called from the pass is fire-and-forget. A child that outlives this is reaped from
  `workers.json` by `stopRun` or the next startup. Startup hygiene and the dashboard's `stopRun` reap any pid in
  `workers.json` whose start time still matches, instead of listing `claude agents`.
- `removeRun` also deletes the run's `conversations/` folder (§2.3).

A restart otherwise behaves as today: branches are reconciled and each unfinished task gets a fresh
worker. Reviving the previous conversation is `resume-dead-worker`'s, not this plan's.

### 2.13 `pir-coordinate` is sunset

The deprecated foreground launcher is removed (user 2026-09-24): `bin/pir-coordinate`, its install
lines, its tests and its docs. Its live mode would strand a worker's question, since workers leave
`claude agents` and that command has no conversation view. Its dry rehearsal goes with it; the
coordinator's dry path stays only where the test suite uses it. `install.sh` removes an installed
`pir-coordinate` launcher it finds.

### 2.14 The unhappy paths

- **A worker exits unexpectedly:** the loop sees the child gone and treats the worker as dead, exactly
  as it treats a vanished session today; the log gets an `exited` note with the exit code and signal.
- **A worker never answers a line** (hung): unchanged from today; nothing here times a worker out.
- **A message for a worker whose process has exited** (or whose input queue is closed): the input is
  logged `undelivered`; the exit path handles the rest.
- **The SDK's message stream throws** (the process died, a protocol error): logged as a `sdk-error` note;
  the worker is treated as exited.
- **The person answers the same request twice or from two screens:** the first answer is forwarded, the
  second finds nothing pending and is logged `undelivered`.
- **The coordinator restarts with a request pending:** the old worker is reaped, its request dies with
  it, and the new worker starts clean; the old conversation stays readable.
- **A huge conversation:** the view reads the last 256 KB of the file, then follows appends; a step line
  never renders more than one line in the default mode.
- **pi-tui throws while painting:** the terminal is restored (raw mode off, alt screen left) before the
  error is printed, as `runTui` does today.

---

## 3. Architecture

### 3.1 The boundary

```
src/core/   — pure. Takes inputs as parameters, returns decisions. No clock, no fs, no child_process,
              no net, and (new) no npm package imports.
src/shell/  — spawns workers, writes logs and drop files, watches folders, draws the terminal.
```

`src/core/boundary.test.mjs` enforces it. This plan extends it to forbid any bare-specifier import
(an npm package) in `src/core/`, since pi-tui and the Agent SDK are the first packages in the repo. If that test fails the
fix is to move the code, never to relax the test. Everything on the pure side is tested exhaustively in
milliseconds; every rule that leaks across becomes a rule only a person can check.

### 3.2 Modules

New, pure:
- `core/stream.mjs` — read conversation-log entries (SDK messages, requests, replies) into worker
  events; build the SDK user message and the `PermissionResult`s pir returns; derive worker activity
  (§2.4); list pending requests. It never builds a protocol line: the SDK does.
- `core/conversation.mjs` — log entries → styled lines (one line per step or full); the permission gate
  and question-set picker models and their reducers.
- `core/person-input.mjs` — validate inbox drops (§2.5); the per-worker grant list and rule matcher (§2.6).

New, shell:
- `shell/worker-proc.mjs` — start and hold one worker through the SDK's `query()`: its input queue, its
  `canUseTool` handler, its log, its pid, its exit. The only module that imports the SDK.
- `shell/person-inbox.mjs` — the screen's `dropPersonInput` and the coordinator's watcher/forwarder.
- `shell/fake/claude-stream.mjs` — a scripted fake `claude` executable speaking stream-json, including the
  control handshake the SDK opens with (`initialize`), so the real SDK drives it in tests.
- `shell/conversation-view.mjs` — the conversation view on pi-tui; `shell/log-follow.mjs` — tail and follow a
  conversation log (T13).
- `shell/reap.mjs` — read `workers.json` and reap recorded pids (T06).
- `shell/terminate.mjs` — the one SIGTERM-wait-SIGKILL helper, extracted from `stopRun`'s inline escalation (T04); the person inbox
  reuses `coordinate.mjs`'s report-folder reader and watcher, generalised (T07). Extending, not copying:
  user 2026-09-25, plan review. Likewise at the re-review: `wrapLine` moves from pir-tui.mjs to core for T02,
  `readLogTail` (commands.mjs) grows into the log tail T13 follows, and one shared temp-then-rename JSON writer
  serves `writeRecord`, `writeSnapshot` and `workers.json` (T04).
- `shell/pir-view.mjs` — the pi-tui component painting styled-span frames (T11, if split out).

Changed: `shell/platform.mjs` (live children instead of `--bg`), `shell/loop.mjs` (isBusy, conflict
send), `shell/coordinate.mjs` (inbox watcher, workers.json, hygiene, teardown), `shell/control-run.mjs`
(reap by workers.json, remove conversations), `shell/pir-tui.mjs` (pi-tui painting, task selection),
`core/dashboard.mjs` (task selection, conversation view state), `core/conflict.mjs` (worker-addressed
prompt), `core/display.mjs` and `coordinate.mjs buildRunState` (asking kinds, worker ids, log paths),
`shell/fake/platform.mjs`, `shell/harness/*`, `skills/pir-worker|pir-implement|pir-review`, `install.sh`,
`package.json`, `.npmrc`.

### 3.3 Data flow

```
worker ◀─stdio─▶ SDK query() ──messages, canUseTool──▶ worker-proc ──append──▶ conversations/*.ndjson ──read/follow──▶ pir screen
                     ▲                                     │
                     └── input queue, interrupt(), results ┤◀── platform.send/interrupt/answer ◀── loop (opening, conflict fix)
                       │◀── person-inbox forwarder ◀── inbox/*.json ◀── pir screen (person)
worker-proc ──activity──▶ platform.list ──▶ loop ──▶ status.json snapshot ──▶ pir screen rows
```

### 3.4 Storage

All under `plans/{slug}/.parallel/control/`: `conversations/` (append-only NDJSON, §2.3), `inbox/`
(transient drops, cleared at startup), `workers.json` (temp-then-rename, §2.12), plus the existing
`reports/`, `log`, `status.json`, `HALT`. A crash mid-append leaves at most one partial last line, which
the reader keeps as `raw`.

---

## 4. Testing

- Pure core: exhaustive unit tests. Fixtures are real SDK messages and `canUseTool` calls recorded by
  T01's probe (paths scrubbed), so the reader is tested against what Claude actually emits, not what its
  docs say.
- Shell: `worker-proc`, platform and the inbox forwarder run the real SDK against `fake/claude-stream.mjs`,
  a node script launched in place of `claude` (through `spawnClaudeCodeProcess`) that answers the SDK's
  `initialize`, replays a scripted conversation, emits `control_request`s, honours interrupts and exits
  on stdin EOF. The fake's wire lines are copied from T01's committed recording of the SDK talking to
  the real `claude`. No test spawns the real `claude`.
- The fake platform (`fake/platform.mjs`) gains `send`, `interrupt`, `answer` and activity so loop and
  coordinator tests cover the conflict send and the asking kinds.
- None of it can prove a real worker behaves over the line for a whole task, or that the screen feels
  right: T00, T11, T13 and T18 carry those to a person or a paid run (§5.1).

---

## 5. Environment

| | |
|---|---|
| OS | macOS 26.5.1 (Darwin 25.5.0) |
| Runtime | Node 24.2.0, ES modules, `node:test`; npm 11.4.2 |
| Toolchain | git 2.50.1; Claude Code 2.1.282 (every stream-json fact in §2 was measured on 2.1.281) |
| New dependency | `@earendil-works/pi-tui` 0.87.1, MIT, needs Node ≥ 22.19; deps `marked`, `get-east-asian-width`; ships prebuilt `.node` binaries (`native/darwin/prebuilds/darwin-arm64/darwin-platform.node`), loaded by its terminal module for modifier keys and clipboard |
| New dependency | `@anthropic-ai/claude-agent-sdk` 0.3.282 (pairs with Claude Code 2.1.282), Anthropic Commercial Terms, Node ≥ 18. Installed with peers and optionals omitted: 4.9 MB, one package, `sdk.mjs` imports only Node built-ins (measured 2026-09-25). Its peers (`zod`, `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`, some 95 packages with an HTTP server) serve only in-process MCP tools pir does not use; its optionals are the 222 MB bundled `claude` |
| Deliberately absent | no Ink/React; no third npm package; no SDK peers or bundled binary |

**The test command.**

```
npm test
```

Which is `FORCE_COLOR=0 NO_COLOR=1 node --test --test-reporter=dot 'src/**/*.test.mjs'`: quiet on
green, colour off inside the command, loud on failure. To debug one file, run it with
`--test-reporter=spec`. It is the only evidence a session may produce on its own. After T10 a fresh
checkout needs `npm ci` before it: the setup line at the top of this file runs it once `package-lock.json`
exists and is a no-op before, because the engine reads the block once at run start from the main checkout,
so one line must serve worktrees made before and after T10 lands. The engine install runs its own (§5.3).

**Dependencies.** Exactly two runtime packages, `@earendil-works/pi-tui` (the screen, user 2026-09-24)
and `@anthropic-ai/claude-agent-sdk` (the line, user 2026-09-25), each pinned to an exact version with a
committed `package-lock.json`, imported only from `src/shell/`. Both are 0.x and publish often, so they
are upgraded deliberately, never by range. A committed `.npmrc` sets `omit=peer` and `omit=optional`, so
`npm ci` anywhere installs neither the SDK's peers nor its bundled binary (T10 confirms pi-tui needs
neither). Any other package is a decision for the user. This replaces the "no runtime dependencies"
rule of `parallel-pir` DESIGN §5.

**SDK and Claude versions.** Workers run the installed `claude`, which updates itself, while the SDK is
pinned. A skew that breaks the protocol is expected to surface as an `sdk-error` at the first
worker; nothing here detects a subtler one. Upgrading the SDK to the installed Claude's paired version is a
deliberate change with its own `npm test` run.

**After changing engine code or a skill, run `./install.sh`** and grep the change in
`~/.claude/pir-engine/`. Never while any parallel run is live, of this plan or another: a live run's workers
use the installed engine and skills, and from T06 on the installed `pir` stops a run by `workers.json`, which
an older run's `--bg` workers are not in, so they would be orphaned (§5.3; user 2026-09-24). This plan is
built in parallel, so until `pir/live-workers` is merged its tasks install only into a scratch `HOME`
(`HOME=/tmp/pir-live-workers-home ./install.sh`) and run the new engine from their worktree (PLAN.md build route).

### 5.1 What the test command cannot reach

| Cannot be tested automatically | Why it needs a person or a paid run |
|---|---|
| A real worker carrying a real task over the line, skills and reports included | Only a real `claude` does it (T00, T18) |
| pi-tui drawing in the person's terminal, keys arriving as expected | Only a real TTY (T00, T11) |
| The runs list and live view looking the same as before | A person compares by eye (T11) |
| The conversation view's feel: reading, typing, picker, interrupt | A person judges (T13) |
| A whole plan built by live workers with a question and a permission answered in pir | Paid workers and a person (T18) |

### 5.2 Seatbelts

| Mechanism | Default | Effect |
|---|---|---|
| `PARALLEL_MAX_WORKERS=1` | harness and T00 ceiling 1 | One paid worker at a time |
| Scratch repo | harness `--into` a scratch path | Never the canonical checkout (`PARALLEL_ALLOW_HERE` unset) |
| Harness `timeoutMs` | 10 min | A stuck live run is torn down |
| `perl -e 'alarm N; exec @ARGV'` | every direct `claude` probe | macOS has no `timeout`; the probe dies at N s |
| `workers.json` reap | on stop, restart, teardown | No orphaned worker survives a killed coordinator |
| `HALT` | available | Stops every worker of the run |

Scratch paths must already be trusted by Claude Code (`hasTrustDialogAccepted` in `~/.claude.json`).

### 5.3 Outside the code — who acts

Approved by the user at plan review, 2026-09-25, as listed. At the re-review the same day the user moved
`npm ci` of the committed lockfile down to `worker`; nothing else moved.

| Action | Command | Bin | Why this bin | Way back | Cost |
|---|---|---|---|---|---|
| Probe worker (T00, T01) | `perl -e 'alarm 900; exec @ARGV' node <spike script>` (T00) or `perl -e 'alarm 120; exec @ARGV' node <probe script>` (T01) on a scratch repo, one SDK-driven worker. The script stops after a fixed number of turns and never sends its own stop marker as a message | `worker` | Minutes of model time, one worker, scratch only | Kill the pid; delete scratch | under a dollar |
| Install packages from npm | `npm i @earendil-works/pi-tui@0.87.1` and `npm i --omit=peer --omit=optional @anthropic-ai/claude-agent-sdk@0.3.282` in a scratch folder (T00, T01) or the repo (T10) | `ask` | First third-party code this project runs, native `.node` binary included (§5) | Revert the commit; delete `node_modules` | none |
| Install the locked packages | `npm ci` in the repo or a task worktree: the setup line above, run by the engine in every fresh worktree, and T10/T13/T18 bring-up | `worker` | User 2026-09-25, re-review: the engine runs setup unattended, and `npm ci` installs only the exact versions the `ask` row above let in at T10 | Delete `node_modules` | none |
| Live harness run | `node src/shell/harness/run.mjs <fixture> --into <scratch>` | `worker` | Bounded by ceiling 1, 10-min timeout, scratch only | HALT; scratch deleted | a few dollars |
| Person-check scratch run (T13) | `PARALLEL_MAX_WORKERS=1 node <worktree>/src/shell/pir.mjs <fixture>` in a scratch repo | `ask` | Paid, and no automatic time limit: it runs until Ctrl+S twice or HALT | HALT or Ctrl+S twice; scratch deleted | a few dollars |
| T18 end-to-end run | `PARALLEL_MAX_WORKERS=2 node <worktree>/src/shell/pir.mjs live-workers-demo` in a scratch repo | `ask` | A whole small plan of paid workers | HALT or Ctrl+S twice; scratch deleted | a few dollars |
| Scratch install (T10, T15) | `HOME=/tmp/pir-live-workers-home ./install.sh` | `worker` | Writes only under that HOME; re-fetches the lockfile's exact packages | `rm -rf /tmp/pir-live-workers-home` | none |
| `./install.sh` | refresh the installed engine and skills, once, after `pir/live-workers` is merged to main | `worker` | Local, idempotent; never while any parallel run is live (§5) | Re-run from the previous commit | none |

---

## 6. Recovery

If the new engine misbehaves after install: `git checkout <commit before T05> -- src skills install.sh`
in a scratch clone and run its `./install.sh`, which puts the `--bg` engine back. An orphaned worker
from a killed coordinator: `cat plans/{slug}/.parallel/control/workers.json`, then `kill <pid>` for each
entry still running (`ps -p <pid>`).

---

## 7. Decisions and rationale

All user decisions are 2026-09-24 unless dated otherwise.

- **The Agent SDK for the line, not a hand-built protocol** (user 2026-09-25, after plan review). The
  plan first wrote its own stream-json reader, line builders and control-request handling (old T01, T04).
  The SDK already wraps that exact protocol (`canUseTool`, `interrupt()`, streaming input, chosen session
  id), ships in step with Claude Code, and so moves the least-documented part of the plan onto Anthropic.
  A survey found no terminal tool doing this whole job (claude-squad and ccmanager drive PTYs; Toad over
  ACP has no question sets; Vibe Kanban and Nimbalyst speak the protocol but are web or desktop apps), so
  only the line is taken off the shelf. Checked before deciding: it runs on the person's subscription
  login with no API key, and personal use is permitted. Costs accepted: a proprietary licence (Anthropic
  Commercial Terms) and a pinned SDK against a self-updating `claude` (§5). Billing is unchanged: `-p` and
  SDK use draw the subscription's limits, since Anthropic paused its 2026-06-15 plan to move them to a
  separate credit (support.claude.com article 15036540, read 2026-09-25); a revival would hit `-p` equally.
- **Stream-json children over `claude attach`.** `claude attach <id>` would have shown the real Claude
  screen for a `--bg` worker at almost no cost, but gives pir no line to the worker; the user wants pir
  to talk to workers, so the cezar-style design won.
- **The terminal, not a web page.** cezar shows its agents in a browser; the user asked for → inside
  pir.
- **pi-tui for the whole `pir` screen**, not for the conversation view only and not no library. The
  existing Claude-transcript viewers (ccview, claude-clean, claude-md-stream) only display; Ink needs
  React and some 25 packages; pi-tui has the editor with autocomplete, markdown, select list and
  differential rendering pir needs.
- **One line per step by default**, Tab for detail; approved against the prototype.
- **No take-over key.** Handing a worker to Claude's own screen interrupts it, and slash commands
  already work over the line; revisit as its own plan if missed.
- **"Do not ask this worker again", kept by pir, never saved.** Offering "never ask again" would write a
  lasting settings file on one key press.
- **Existing plans untouched.** `nudge-quiet-worker` and `resume-dead-worker` stay as they are and are
  revisited after this plan; restart behaviour is today's.
- **Build order** (plan review): T00 starts only after `declared-test-command` is merged to main, since it
  rewrites some 40 of the files this plan changes; `nudge-quiet-worker` and `resume-dead-worker` are built
  after this plan and re-planned first, since both are designed on `claude --bg` workers.
- **`pir-coordinate` sunset**, rehearsal included.
- **The conflict fix goes straight to the worker**; a judgement it needs comes back as its question.
- **Report files stay.** They already drive the loop's phases; replacing them with stream inference is
  a larger change nobody asked for, and the pending request supplies what the person needs.

---

## 8. Explicitly out of scope

- **Reviving a dead worker's conversation**: `resume-dead-worker`.
- **Nudging a quiet worker**: `nudge-quiet-worker`; it will send its nudge over this line.
- **A take-over key into Claude's own screen**: interrupts the worker; slash commands cover most needs.
- **Pasting images, rewinding a conversation, Claude's diff viewer, `/doctor` `/color` `/focus`
  `/reload-plugins`**: the rest of Claude's screen is not rebuilt (§1 Stance).
- **Opening a task's earlier workers from the view**: their logs stay on disk; the view shows the live
  or latest one.
- **Cost per worker on screen**: not asked for; the `result` events carry it if wanted later.
- **A conversation view for foreground runs**: the foreground launcher is gone (§2.13).
