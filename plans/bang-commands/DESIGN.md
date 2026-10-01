---
setup:
  - test ! -f package-lock.json || npm ci
test:
  - npm test
---

# Bang commands — Design

How parallel mode behaves is canonical in `/docs`. This file is build-time rationale for this plan;
T10 carries the resulting behaviour into `/docs` and `README.md`. It never edits a finished plan's
DESIGN.md.

## 1. Purpose

Today an agent in a `pir` run that needs the person to run something (a login, a command only their
account can run) can only ask in words, and the person must leave `pir`, run it in another terminal and
paste the output back. Claude Code solves the same problem with `!`: a line starting with `!` runs as a
shell command and its output joins the conversation. This plan brings that to `pir`'s conversation view
and lets an agent start the exchange by handing the person a ready command.

Success is checkable: in any held session's conversation in `pir`, `! printf hi` shows `hi` streaming
in, the agent receives one message with the command, its exit and its output and replies to it; and an
agent that calls the hand tool gets its row read `asking you · run a command`, the person presses Enter
on the pinned command, and the agent receives the output as the tool's result.

## 2. Behaviour

Requirements confirmed by the person on 2026-10-01 (points 1–14 of the planning conversation); each rule
below names its reason.

### 2.1 Command mode in the box

- The box is in command mode whenever its text starts with `!`. The `!` stays visible as the first
  character, the box border and the `!` take the `shell` style (pink), and the hint line reads
  `! command · ↵ run in this session's folder · ⌫ the ! to leave`. Deriving the mode from the text,
  rather than a hidden flag, means backspace over the `!` leaves the mode with no extra state, a pasted
  `!ls` is a command, and two screens cannot disagree about a mode they never share.
- Slash autocomplete is off in command mode (it only fires on a leading `/` already).
- Enter sends the text after the `!`, trimmed, as the command. An empty command sends nothing and the box
  keeps its `!`. A multi-line command is passed to the shell whole.
- Command mode exists only where the box exists: a live session, in a running run. In a read-only view
  there is no box. In a run that is not `running`, the drop is refused like a typed message (`not
  running`), the view says so, and the text stays in the box.
- While a question set is pinned, typing goes to its Other line as today, so `!` is not available until
  the question set is answered. The picker's text field already owns every printable key, and stealing
  `!` from it would make a question answer impossible to start with `!`.
- While a permission request is pinned, a `!` line runs the command and leaves the request pinned. A
  typed reply refuses a permission (existing rule), but a command the person runs is not a reply to it,
  and refusing a request as a side effect of running `ls` would surprise.

### 2.2 Running

- The command runs in the session's own working directory (the worker's task worktree, the planning
  worktree, the single run's worktree, the coordinator agent's or finisher's feature worktree), because
  that is the folder the agent is looking at and the one its output describes.
- The shell is the person's: `$SHELL -i -c <command>` when `$SHELL`'s basename is `zsh` or `bash`, else
  `/bin/sh -c <command>`. The interactive flag loads the person's rc file so their aliases and functions
  work as in their terminal (measured 2026-10-01: `zsh -ic` with stdin from `/dev/null` loads 237
  aliases in 1.2 s; `zsh -lc` loads 2). The environment is the host's, through `scrubEnv`
  (`commands.mjs`), so pir's own `PARALLEL_*` and `PIR_RUN` do not leak into the person's command.
- Stdin is `/dev/null`. Plain only, as the person chose: a command that waits for input sits until the
  person stops it. Handing over the terminal for interactive commands is out of scope (§8).
- stdout and stderr are merged in arrival order, reduced to plain text by `plainText` (`core/text.mjs`:
  escapes stripped, `\r` overwrites kept to their last segment, tabs expanded), and logged into the
  session's conversation log in coalesced chunks (at most every 250 ms or 8 KB), so the view streams
  them and two open screens show the same thing. The log keeps at most 1 MB of a command's output, then
  one `clipped` marker; the agent's message is capped separately (§2.3).
- The command runs in the **host** process (the coordinator for a build, `plan-run.mjs` for a planning
  run, `single-run.mjs` for a single run), started by the person-inbox forwarder, never in the `pir`
  screen. The screen is a reader that can be closed at any time; the person chose that a command keeps
  running and its result still reaches the agent when the screen is closed.
- One command at a time per session. A second `!` while one runs is refused in the view (`a command is
  already running · esc stops it`) and again by the forwarder (a `shell-refused` note), so a stale
  screen cannot start two. Typed messages to the agent still send while a command runs.
- There is no timeout: the person is at the keyboard by construction, and Esc stops it.

### 2.3 What the agent gets

- When the command ends, the agent receives one message at once, `from: 'person'`, which starts its
  turn (the person chose straight away over Claude Code's quiet mode). Text, built by `bangMessage`:

  ```
  [pir] The person ran a command in your working folder:
  $ gsutil ls gs://acme-staging/ledger
  exit 0 · 6s
  <output, or "(no output)">
  ```

  The status line is `exit {n}`, `killed by {signal}`, or `stopped by the person` with the elapsed
  time, written by `helperTime` (`conversation.mjs`). Output over 30 000 characters keeps its last 30 000, preceded by `(output cut: the first {n}
  characters are not shown)`. The cap matches Claude Code's own Bash output cap, and the tail is kept
  because errors and summaries come last.
- Being `from: 'person'`, the message counts as an answer: a parked or stopped worker un-parks
  (`resumeAnswered`'s `ANSWER_CAUSES`) with no new rule. That is what the person asked for in point 5.
- If the session has ended by then, the send is logged `undelivered` as for any message and the end
  entry says so.

### 2.4 Stopping

- Esc in the conversation view while this session's command runs stops the command, not the agent;
  Ctrl+C on an empty box does the same. Both drop `shell-stop`. The helper warning of
  `visible-helpers` does not apply: no interrupt is sent, so no helper is stopped.
- Stop is SIGTERM to the command's process group, then SIGKILL after 3 s. The agent's message says
  `stopped by the person` with whatever output there was.
- When the session closes while its command runs (task finished, run stopped), the command is killed,
  its end entry reads `stopped: 'session-closed'`, and nothing is sent.
- A host that dies with a command running (crash, `kill -9`) leaves its record in
  `{controlDir}/shells/{sessionId}.json`. The next host start in that control folder kills a still-live
  group whose pid and start time match (the `reapCommand` rule of single runs), appends that command's
  `end` entry (`stopped: 'pir-restart'`, `sent: 'none'`) to its session's conversation log so its block
  closes whether or not the session comes back, and deletes the record; if that session is live again in the new host, it is sent `[pir] A command the person ran was cut off
  when pir restarted: $ {command}`. Without the record, a restarted coordinator would leave an orphan
  `tail -f` running for ever.

### 2.5 Which sessions

- `!` works in every conversation with a box: build workers (implement and review), end-of-run
  helpers, the coordinator agent, the finisher, the planner, the plan reviewer, a single run's builder
  and reviewer. All of them already use `createConversationView` and the same `dropPersonInput` →
  `startPersonInbox` path (§3), so one change covers all.
- The person's command is not checked against the plan's §5.3 bins or any permission rule: it is the
  person's own hands, as in Claude Code (point 14). The finisher's fence judges the finisher's tool
  calls, and a person's `!` is not one.

### 2.6 A command the agent hands to the person

- Build workers, end-of-run helpers, the planner and plan reviewer, and a single run's builder and
  reviewer get one extra tool, `hand_command`, from an in-process MCP server `pir` (full name
  `mcp__pir__hand_command`), input `{ command: string, reason: string }`. The coordinator agent and the
  finisher do not: neither runs commands, and the finisher already has its go (point 8).
- Calling it raises an ordinary permission request through `canUseTool`, logged as a `request` entry
  like any other, so every piece of pending-request machinery (row, clock, Remote Control, alert,
  conversation pin, restart) applies unchanged. T00 proves on this machine that the request does reach
  `canUseTool` in the workers' `auto` mode; if it does not, a `PreToolUse` hook returning `ask` for the
  tool forces it, as the finisher's `ASK_EVERY_CALL` does.
- The request is pinned above the box (the mock, `prototype/index.html`, tab 4):

  ```
  ! T05 asks you to run a command
    gcloud auth login --no-launch-browser
    why: the deploy check needs your Google login
    ↵ run · e edit first · n decline · or type a reply to decline with it
  ```

  - `↵` on an empty box runs the command exactly as handed: a `shell` drop carrying the `requestId`.
  - `e` puts `! {command}` in the box; the request stays pinned; Enter then runs the edited command as
    the answer (a `!` line sent while a hand request is pinned carries its `requestId`).
  - `n` declines: the request is denied with `The person declined to run it.`
  - A typed reply (not starting with `!`) declines with the text, as a typed reply refuses a permission.
  - No `a` (allow-always) and no double press: a grant would let the agent run commands as the person
    without the person, which is the one thing this tool must not do.
- When the person's run of it ends, the forwarder answers the request instead of sending a message:
  `allow` with `updatedInput = { command, reason, pirResult }`, where `pirResult` is the `bangMessage`
  text (with `The person ran your command` or `The person edited your command and ran it` in its first
  line). The tool's handler returns `pirResult` as its result. The SDK strips any argument the tool's zod
  shape does not declare, so T00 settles how `pirResult` reaches the handler; whichever way, the handler
  never returns a `pirResult` the model supplied itself. The agent therefore reacts at once, inside
  its open turn, which is the "straight away" the person chose; and the request leaves `pending` on the
  logged reply, so the row stops asking.
- The handler, run with no `pirResult` (the person allowed it on claude.ai or the phone, where pir runs
  nothing), returns `The person allowed this from outside pir, so pir did not run it. Ask them in words
  whether they ran it and what it printed.`
- Only the person runs a handed command. The coordinator agent never answers one: `reservedFor`
  (`coordinator-policy.mjs`) reserves every `mcp__pir__hand_command` request for the person as it does
  an `ask`-bin action, so the row goes straight to `asking you` and the agent may only add a note
  (point 10). Grants never cover it (`grantFrom` returns null for it). This holds pir's rule that the
  agent never runs a command and never answers an `ask` action.

### 2.7 How it reads elsewhere

- Row: `waitingOn` returns `'command'` for a pending hand request; the build row reads `asking you · run
  a command` (`ASKING_LABEL`), and a planning or single row the same (`ASKING_TEXT`). Clock and Remote
  Control follow `waitingOn` as for every other kind.
- Phone alert (`kindPart`): `asks you to run: {command} (open pir to run it)`, cut to 150 characters as
  every alert is, with the `Needs your yes: ` prefix a reserved item already gets. The person cannot run
  it from the phone, and the wording says where to go.
- Over Remote Control the request shows as Claude's own permission prompt. Allowing it there runs the
  handler with no output (above); refusing it declines. A reply in words un-parks the worker as any
  answer does (point 11).

### 2.8 How it is drawn

The mock (`prototype/index.html`, approved 2026-10-01) is the vibe, not the spec; the drill (T08) judges
the real screen against this section.

- A command block in the history: `you ! {command}` (person style, `!` in the shell style), then its
  output lines indented two columns, then one end line: `✓ exit 0 · 6s · sent to T05`, `✗ exit 1 · 2s ·
  sent to T05`, `✗ stopped by you · 1m 12s · sent to T05`, `✗ cut off by a pir restart`, `✗ not sent:
  the session has ended`. The `sent to` name is the session's label as the header names it (`T05`,
  `agent`, `planner`, …).
- In the grouped view a block shows its last 12 output lines under a dim `… {n} earlier lines · Tab
  shows all`; Tab's full detail shows every line. A long log would otherwise bury the agent's reply.
- The message the agent was sent is not drawn a second time as a `you ▸` line: the block is its
  representation (the out entry carries `shell: {id}` to tie them).
- While it runs, the status line reads `● running your command · {elapsed} · esc stops it`.
- A handed command answered or declined stays in the scrollback as `! T05 asked you to run: {command}`
  followed by its block, or `· declined` / `· declined: {text}`.

## 3. Architecture and the boundary

The pure core (`src/core/`) decides; the shell (`src/shell/`) touches the world. `boundary.test.mjs`
already fails on `node:child_process`, `node:fs` and the clock in `src/core/`; if it fails on this plan's
code, the fix is to move the code, never to relax the test.

| Module | Side | What it holds |
|---|---|---|
| `src/core/bang.mjs` (new) | pure | `parseBang(text)`, `capForAgent`, `bangMessage`, `shellStatusLine` (over `plainText` and `helperTime`, reused), `HAND_TOOL` name and the handler's fallback text |
| `src/core/person-input.mjs` | pure | drop kinds `shell`, `shell-stop` |
| `src/core/stream.mjs` | pure | reading `dir:'shell'` entries; `workerActivity` gains `shell: {id, command, t} \| null`; `readRequest` reads a hand request as `kind:'command'` |
| `src/core/conversation.mjs` | pure | the command block, the status part, the hand gate and its reducer |
| `src/core/asking.mjs`, `display.mjs`, `plandisplay.mjs`, `notify.mjs`, `coordinator-policy.mjs`, `coordinator-brief.mjs` | pure | the `command` asking kind, its labels, alert text and reservation |
| `src/shell/person-shell.mjs` (new) | shell | spawn, stream, stop, record, reap |
| `src/shell/person-inbox.mjs` | shell | forwarding `shell` and `shell-stop`; answering a hand request on end |
| `src/shell/worker-proc.mjs` | shell | `logEntry`; the in-process MCP server and its handler |
| `src/shell/platform.mjs`, `held-session.mjs`, `coordinator-agent.mjs` (`withAgent`) | shell | `cwdOf(to)`, `log(to, entry)`; passing `handTool` |
| `coordinate.mjs`, `plan-run.mjs`, `single-run.mjs` | shell | the shells dir, reap at start, kill on close and exit |
| `conversation-view.mjs` | shell | the mode, Esc/Ctrl+C routing, the pinned hand prompt |

### 3.1 Data flow

```
box "! cmd" ─drop {kind:'shell', command, requestId?}─▶ inbox/ ─▶ startPersonInbox.forward (host)
   ─▶ person-shell.start(cwdOf(to)) ─chunks─▶ platform.log(to, {dir:'shell', kind:'output'…}) ─▶ conversation ndjson ─▶ view
   ─end─▶ requestId pending ? platform.answer(to, requestId, allow{updatedInput.pirResult}) : platform.send(to, bangMessage, {from:'person', shell:id})
Esc ─drop {kind:'shell-stop'}─▶ forward ─▶ person-shell.stop(to)
agent hand_command ─▶ canUseTool ─▶ {dir:'request', toolName:'mcp__pir__hand_command'} ─▶ pending ─▶ row, alert, pin
```

### 3.2 Wire shapes

Inbox drops, validated by `validateDrop` on both sides:

```
{ to, kind: 'shell', command: string /* non-empty after trim */, requestId?: string }
{ to, kind: 'shell-stop' }
```

Decline reuses `{ to, kind: 'permission', requestId, decision: 'deny', text? }`; the forwarder words the
deny message for a hand request (`The person declined to run it.` plus `They said: {text}`).

Conversation log entries, written by the host through `platform.log(to, entry)` → the worker's
`logEntry`, so they share the session's file, its `t` stamp and its listeners:

```
{ dir: 'shell', kind: 'start',  id, command, cwd, requestId?, edited?: true }
{ dir: 'shell', kind: 'output', id, text }                 // plainText, coalesced
{ dir: 'shell', kind: 'output', id, text: '', clipped: true }  // once, past 1 MB
{ dir: 'shell', kind: 'end', id, code: number|null, signal: string|null,
  stopped: null|'person'|'session-closed'|'pir-restart', ms, sent: 'message'|'answer'|'undelivered'|'none' }
{ dir: 'note', kind: 'shell-refused', command, reason: 'busy'|'no-session' }
{ dir: 'out', from: 'person', kind: 'message', text, shell: id }   // the existing send, one field added
```

`id` is `sh-{t}-{rand4}`. An older reader shows an unknown `dir` as one raw line; nothing older reads
these logs while this plan's own code is installed, since the screen and the host ship together.

The shells record, `{controlDir}/shells/{sessionId}.json`, written temp-then-rename on start and deleted
on end: `{ id, to, pid, startTime, command, requestId? }`. It is keyed by session id, not worker id,
because a resumed session keeps its session id and gets a new worker.

### 3.3 Concurrency

The forwarder runs in one host process per run, so "one command per session" is a map in that process.
Two `pir` screens may both drop `shell`; the second is refused `busy`. Output chunks and the agent's own
events append to the same ndjson file through the one `log()` in `worker-proc.mjs`, which already
serialises them in that process.

`plan-run.mjs` and `single-run.mjs` stop and restart the forwarder when the rename moves the control
folder. The running-command map and its shells records therefore live outside one forwarder instance and
follow the move, so a command started before the rename keeps its `busy` check, its stop and its record.

## 4. Environment

- Node v22.17.1 on the PATH (nvm; below `engines: >=22.19`, and the suite runs on it), `@anthropic-ai/claude-agent-sdk`
  0.3.282, `@earendil-works/pi-tui` 0.87.1, Claude Code 2.1.286 logged in through Bedrock (`apiKeyHelper`),
  macOS (Darwin 25.6), `$SHELL=/bin/zsh`. Measured 2026-10-01.
- The SDK exports `createSdkMcpServer` and `tool` (`sdk.d.ts`); whether an in-process tool reaches
  `canUseTool` under `permissionMode: 'auto'` is T00's question. `tool()`'s input schema must be a zod raw
  shape (a JSON-schema object throws `inputSchema must be a Zod schema or raw shape`), and zod is a peer
  the `.npmrc` `omit[]=peer` never installs, so `zod` 4.6.5 becomes a direct dependency (T05). Measured at
  plan review 2026-10-01: an external zod 4.6.5 shape works with the SDK's bundled MCP server, and an
  argument the shape does not declare is stripped before the handler sees it.
- Test command: `npm test`, which is `FORCE_COLOR=0 NO_COLOR=1 node --test --test-reporter=dot
  'src/**/*.test.mjs'` and prints `TESTS PASSED` or `TESTS FAILED`. Quiet on green (dot reporter),
  colour forced off inside the command because `COLORTERM=truecolor` is set here, full failures on red.
  For detail run one file with `node --test {file}`. A full run takes about 3 minutes.
- Setup: `test ! -f package-lock.json || npm ci`, measured in a fresh worktree 2026-10-01: exit 0,
  `git status --porcelain` empty afterwards.
- **Known red on the base when this plan was written:** `src/shell/notify-wiring.test.mjs` fails in a
  fresh worktree at `3a607f6`: 10 of its cases, every one `Promise resolution is still pending`, on Node
  22.17.1 and 22.22.3 alike (re-measured at plan review; the plan first named only "main: the end alert
  knows the finisher takes over, and the done alert is sent with the exit"). The person decided (2026-10-01)
  it is fixed on `main` separately, before this build starts; it is not this plan's task.
- End-to-end tooling, reused: `src/shell/conversation-rig.mjs` (`startRig` scenarios, `openScreen` over a
  python3 pty relay, real SDK against `fake/claude-stream.mjs`, real `startPersonInbox`) with tests in
  `conversation-rig-{80x24,120x40,60x20}.test.mjs` and helpers in `conversation-rig-helpers.mjs`; and
  `src/shell/plan-rig.mjs` (`startPlanRig`, `startSingle`, the `claude` shim) for planning and single
  runs. No new rig is planned. A `!` in the rig runs a real shell command (`printf`, `sleep`) in the
  scratch folder, which is free and harmless.
- One new dependency, `zod` 4.6.5 (no dependencies of its own), because the SDK's `tool()` takes nothing
  else (above; the person, 2026-10-01). The peer policy stays: the MCP SDK and the rest of the ~95 peer
  packages are still never installed. No pty library: it would only serve the interactive mode the person
  declined.

## 5. Verification

### 5.1 What the test command proves

Everything in §2 except the rows below: the pure rules in unit tests, the runner against real `sh`
processes in a temp folder, the forwarding and the hand-request answer through the real SDK against the
fake `claude`, and every screen through the conversation and plan rigs at 60×20, 80×24 and 120×40.

### 5.2 What it cannot reach

| Claim | Why the tests cannot | How it is established |
|---|---|---|
| A real model calls `hand_command` and `canUseTool` sees it in `auto` mode | the fake `claude` emits whatever it is scripted to | T00, one short real session, recorded in FINDINGS |
| The hand request on claude.ai/the phone looks like a permission and allowing it there returns the fallback text | needs the person's phone | recorded as a limit in T10's docs; not planned as a check, since the behaviour there is Claude's own prompt |

Seatbelts: the rig runs in a scratch folder with the fake `claude`; T00's real session runs in a scratch
repo under `/tmp` with `perl -e 'alarm 300; exec @ARGV'` around it and the tool's command never actually
executed by the spike (it answers the request itself).

### 5.3 Outside the code — who acts

| Action | Command | Bin | Why this bin | Way back | Cost |
|---|---|---|---|---|---|
| One real Claude session for the spike (T00) | `perl -e 'alarm 300; exec @ARGV' node /tmp/pir-hand-spike/spike.mjs`, after `npm i zod@4.6.5` in that folder | worker | one short session billed through Bedrock like any worker's, scratch repo, nothing others see; approved by the person at plan review 2026-10-01 | delete `/tmp/pir-hand-spike` | one short Bedrock session |
| Delete the spike folder (T00) | `rm -rf /tmp/pir-hand-spike` | worker | a scratch folder this plan made | none needed | none |
| Add zod (T05) | `npm i zod@4.6.5` | worker | local; package.json and the lock only; approved 2026-10-01 | revert the commit | none |

`./install.sh` is no task's: the repo's finishing rules (`.pir/rules/on-finish.md`) run it after the merge
and check the installed copy, and it must never run while this build's own run is live.

## 6. Recovery

Nothing persists beyond the log entries and the shells record. To back the change out, revert the task
commits and run `./install.sh`. A shells record left by a reverted build is ignored by older code.

## 7. Decisions and rationale

- **Both directions, plain only, straight away, pinned like a permission** — the person, 2026-10-01, in
  that order of questions. Interactive handover was offered and declined; quiet mode was offered and
  declined.
- **Prototype approved** — `prototype/index.html`, five states, approved by the person 2026-10-01 as the
  right direction, with wording and colours left open to the build.
- **The host runs the command, not the screen** — follows from point 6 (keeps running with the screen
  closed) and from the screen being a reader everywhere else in pir.
- **Extend the person-inbox path, do not build a second channel** — `dropPersonInput` and
  `startPersonInbox` already carry every input from every screen to every kind of session in all three
  hosts; a `shell` kind on it reaches all of §2.5 at once.
- **New spawner, not `startLines`** — `commands.mjs` `startLines` writes output straight into a file
  descriptor and never back to Node, so it cannot stream into a conversation; its process-group kill,
  `scrubEnv` and single-run's pid+start-time reap are reused as rules, and `scrubEnv` as code.
- **The hand request is a permission request, not a report file** — every host already turns a pending
  `canUseTool` request into the row, clock, alert, Remote Control and pin; a report kind would need a
  new park in builds and does not exist at all in planning and single runs (their questions are never
  filed). The answer arrives as the tool's result, which reaches the agent at once as the person asked.
- **The pinned decline wording and `e`** — the person chose a pinned prompt with run, edit and decline;
  typed-reply-declines mirrors the permission prompt so one rule covers both.
- **The failing finisher test is fixed on `main` separately** — the person, 2026-10-01.
- **zod as a direct dependency** — the person, plan review 2026-10-01: the SDK's `tool()` needs it, and one
  package with no dependencies costs less than a hand-written stdio MCP server.
- **Reuse `plainText` and `helperTime`** — the person, plan review 2026-10-01: `core/text.mjs` `plainText`
  already strips CSI/OSC/two-byte escapes and keeps the last `\r` segment, and `conversation.mjs`
  `helperTime` already writes `6s`/`1m 12s`; a second copy of either would need every fix made twice.
- **No install inside the build** — the person, plan review 2026-10-01: the finishing rules install after
  the merge; installing from T10 would replace the engine and skills under the live run.

## 8. Out of scope, and limits

- Interactive commands (a terminal handed over, a pty, typing into a running command). Declined by the
  person; a command that prompts sits until Esc.
- `!` from claude.ai or the phone. Their input never passes through pir's view or forwarder.
- Checking the person's commands against §5.3 or permission rules. They are the person's own hands.
- A queue of commands, history search, or tab completion of shell words. One at a time; the box's own
  history recalls earlier lines.
- The coordinator agent and the finisher handing commands.
