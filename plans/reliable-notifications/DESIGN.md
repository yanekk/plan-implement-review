---
setup:
  - test ! -f package-lock.json || npm ci
test:
  - npm test
---

# Reliable notifications — Design

How parallel mode behaves is canonical in `/docs`. This file is build-time rationale for this plan;
T07 carries the resulting behaviour into `/docs` and `README.md`.

## 1. Purpose

When a build worker waits on the person, the person must learn it on their phone, every time. Today the
only alert is a side effect of Remote Control: pir switches Remote Control on for a waiting worker
(`remoteWanted`, `coordinate.mjs`) and the Claude app decides whether to push. It pushes late or not at
all (real-asking-state FINDINGS 2026-09-27: no push for T01 although Remote Control came on after its
turn ended; live-workers memory: permission and plain-question pushes lag). pir cannot trigger or
repeat that push: it has no API, and the model or the app decides.

This plan makes pir send the alert itself, through ntfy (a free publish/subscribe push service with an
iPhone and Android app, no account; the topic name is the only secret). Remote Control is unchanged: it
still switches on while a worker waits, and it stays the way the person replies away from the terminal.
Only the alert moves.

### Success criteria

- A build worker that starts waiting on the person (any kind `waitingOn` returns) produces one ntfy
  alert within one coordinator pass of the waiting being seen, carrying the plan, the task, an excerpt
  of the ask, and the worker's Remote Control session link when Remote Control is on.
- Still waiting 15 minutes after that alert: exactly one reminder. Answered: a clear is sent.
- `pir notify` sets a user up in one command: random topic saved, QR code printed, test alert sent.
- With ntfy configured, the Claude app does not also push for pir's build workers.
- Seen on the user's iPhone in a real run (T06).

## 2. Behaviour specification

### 2.1 What triggers an alert

An **episode** is one continuous stretch in which a live build worker is waiting on the person, as
decided by `remoteWanted(workers, stateTasks)` and `waitingOn(task, activity)` (`src/core/asking.mjs`).
The alert logic takes its input from exactly that predicate, never from a second one. Why: the run list's
`asking you`, Remote Control and the alert then always agree, and any later widening of the predicate
(the planned `stopped-worker-asking` plan adds a third clause) feeds alerts with no change here.

- An episode starts on the first pass a worker is in the waiting set, and ends on the first pass it is
  not (answered, back to work, exited, or its task left the waiting phase).
- The same worker waiting again later is a new episode and a new alert. Why: it is a new question
  (user 2026-09-27).
- Each waiting worker has its own episode; two workers waiting at once give two alerts.
- Planning sessions (`pir plan`: planner and plan reviewer) never alert. Why: the person plans at the
  computer (user 2026-09-27). `plan-run.mjs` is not touched.
- Build runs only: the alert is driven from `coordinate.mjs`.

### 2.2 When it is sent

- **First alert**: as soon as the episode's Remote Control link is known, so the tap opens the chat.
  It is sent without a link when Remote Control will not come (`PARALLEL_REMOTE=0`, or the worker's
  Remote Control was refused) or when 20 s have passed since the episode started without a link. Why
  20 s: `enableRemoteControl` normally answers in about a second; a stuck bridge must not hold the
  alert back.
- **Reminder**: one, 15 minutes after the first alert, if the same episode is still open. Never more.
  Why: a missed first buzz is the common failure, but a worker parked overnight must not buzz all night
  (user 2026-09-27). `PIR_NOTIFY_REMIND_MS` overrides the 15 minutes; it exists for the live check
  (T06) and is not documented to users.
- **Clear**: when an episode for which an alert was sent ends, and for every open episode when the
  coordinator exits. ntfy documents clearing for Android and the web app only, so on the user's iPhone
  the alert probably stays; pir sends the clear anyway because it costs one request and does no harm.
- The first alert and the reminder share a sequence id (`pir-{workerId}-{episodeN}`), so on a client
  that supports updates the reminder replaces the first alert rather than stacking under it.
- A coordinator restart loses the in-memory episodes; a worker already waiting gets a fresh alert.
  Accepted (user 2026-09-27).

### 2.3 What it says

- **Title**: `{plan slug} · {task} {role}`, e.g. `screen-time · T04 implement`.
- **Message** by kind, the excerpt cut to 150 code points with `…` when cut, newlines folded to spaces:
  - `question` from a report park: `asks: ` + the report text (`task.decision.text`) from its start.
  - `question` without a report (a later `waitingOn` clause may yield this): `asks: ` + the worker's last
    assistant text; `is waiting for you` if there is none.
  - `questions` (AskUserQuestion pending): `asks: ` + the first question's `question`, plus ` (+N more)`
    when there are more.
  - `permission`: `wants to run ` + the tool name and its one-line summary (`mainArg` in
    `src/core/conversation.mjs`, the same the gate shows).
- **Reminder**: the same message prefixed `Still waiting: `.
- **Click**: the Remote Control `session_url` (`https://claude.ai/code/session_…`) when known.
- Priority 4 (high), tag `bell`. No action buttons: replying stays with Remote Control and `pir`.

Why a plain cut rather than a worker-written one-liner or a model summary (user 2026-09-27): no change
to workers, no model call, no delay. A report that opens with background shows background; accepted.
Why the excerpt at all on a public server (user 2026-09-27): the person decides from the lock screen
whether it is urgent. 150 characters of a question pass through ntfy.sh; nothing else does.

### 2.4 `pir notify`

- `pir notify`: if no config, generate a topic (`pir-` + 24 random lowercase base32 characters from
  `crypto.randomBytes`), save it, print the topic, a QR code and the subscribe instructions, and send
  a test alert. If the first test alert fails, the topic stays saved and printed, the
  error is shown with `pir notify test` to retry once online, and the exit is non-zero. Why (user
  2026-09-27, plan review): the phone may already have subscribed from the QR, and a new topic would strand
  it. If a config exists, print the same for the existing topic and send nothing. Why not
  regenerate: re-running to see the QR again must not unsubscribe the phone.
- `pir notify test`: send a test alert to the configured topic; report the HTTP result. Non-zero exit
  if not configured or the send failed.
- `pir notify off`: delete the config and the presence marker (§2.5). A later `pir notify` makes a new
  topic.
- The QR encodes `https://ntfy.sh/{topic}`. The printed instructions name the topic for typing into the
  ntfy app's "Subscribe to topic", because whether the iOS app subscribes from a scanned link is not
  documented (§7). T06 records what scanning actually does.
- Config: `{PIR_HOME ?? HOME}/.pir/notify.json`, `{ "server": "https://ntfy.sh", "topic": "…" }`, mode
  0600. Why there: beside the run index `~/.pir/runs/`; `~/.claude/pir-engine` is deleted by every
  `install.sh`. Why per account, not per project: the phone is the person's, not the repo's.
- The coordinator reads the config when it needs to send, not once at start, so `pir notify off` stops
  alerts in a run already going.

### 2.5 Silencing the Claude app's own push

When ntfy is configured at the moment a build worker is spawned, pir sets `CLAUDE_CLIENT_PRESENCE_FILE`
in that worker's environment to `{PIR_HOME ?? HOME}/.pir/presence`, and makes sure that file exists.
Claude Code skips mobile push while the file exists (documented on code.claude.com remote-control page;
the variable is present in the 2.1.283 binary). Remote Control itself is untouched. `pir notify off`
deletes the marker, so already-running workers push through the Claude app again.

Why (user 2026-09-27): one reliable channel, no double alerts. Why build workers only: planning sessions
do not alert through ntfy, so their Claude app push is left as it is. Whether the variable silences a
headless SDK worker's push is unmeasured; T06 checks it on the phone, and if it does not, that goes back
to the user (PLAN, open decisions).

### 2.6 Unhappy paths

- **ntfy unreachable, 5xx or 429**: retry after 5 s and 30 s; any other 4xx fails at once (a malformed
  request will not improve). On the last failure note `notify-failed`
  once for that episode in the worker's conversation, with the status or error. The run never waits on
  or stops for a send. A failed clear is not retried and not noted. Why: the alert is a convenience on
  top of `pir`, which still shows `asking you`.
- **No config**: nothing is sent, no note, no presence variable. Behaviour is exactly today's.
- **Corrupt config** (unparseable, no topic): treated as no config for sending; `pir notify` reports it
  and offers `pir notify off` to reset.
- **Sent**: note `notified` in the worker's conversation (`{ reminder: bool }`), drawn as
  `alert sent to your phone` / `reminder sent to your phone`. Why: the person can see in `pir` what the
  phone was told.
- **A send in flight when the episode ends**: the clear is sent after it settles.

## 3. Architecture

### 3.1 The boundary

Unchanged: `src/core` is pure and `src/core/boundary.test.mjs` forbids `node:fs`, `fetch(`, `Date.now`,
`Math.random` and bare package imports there. If that test fails, move the code; never relax the test.

- `src/core/notify.mjs` (pure): the alert text and the episode machine. Takes `now` as an argument.
- `src/shell/ntfy.mjs`: the HTTP publish and clear, with `fetch` injected.
- `src/shell/notify-config.mjs`: read, write, delete the config and the presence marker.
- `src/shell/pir.mjs`: the `notify` verb.
- `src/shell/worker-proc.mjs`, `platform.mjs`: the session link and the environment variable.
- `src/shell/coordinate.mjs`: calls the machine each pass and performs its actions.

### 3.2 The episode machine

```
// view per live build worker, built each pass by the shell:
//   { id, waiting: kind|null, title, message, remote: 'wanted'|'off'|'refused', url: string|null }
notifyStep(state, views, now, { remindMs = 900_000, linkWaitMs = 20_000 }) → { state, actions }
// actions: { type: 'send', id, seq, title, message, click|null, reminder: bool }
//          { type: 'clear', id, seq }
```

`state` is `{ episodes: { [workerId]: { n, startedAt, sentAt|null, reminded: bool, seq } }, counts }`.
A worker absent from `views` ends its episode. `notifyExit(state)` returns the clears for every episode
with `sentAt`. The message text is fixed when the episode starts (the excerpt of that ask); the
reminder reuses it.

### 3.3 Data flow

Each coordinator pass, after `syncRemote`: build views from `platform.workers()`, `coordinator.state.tasks`
and `remoteWanted`; run `notifyStep`; for each action, read the config (none: drop the action), then
fire the publish or clear without awaiting it, logging notes through `platform.note`. This runs whether or
not `PARALLEL_REMOTE` is on. On every exit path the `notifyExit` clears are awaited, bounded at 2 s, before
the process ends: the signal handlers call `process.exit` at once, and an unawaited request dies with it. The loop polls
every `PARALLEL_POLL_MS` (5 s), so a permission request is seen within about 5 s; that is the alert's
latency floor and is accepted.

### 3.4 Storage

Config and marker only (§2.4, §2.5). Episode state lives in memory for the coordinator's life. Config is
written through `writeFileAtomic` (`src/shell/atomic-write.mjs`, temp file and rename), so a crash
mid-write leaves the old file or none.

## 4. Testing

Unit tests beside the source. The episode machine is tested exhaustively in core with explicit `now`.
`ntfy.mjs` is tested with an injected fake `fetch` recording requests; no test reaches the network.
`pir notify` is tested through `run(argv, injected)` in `pir.test.mjs` with `PIR_HOME` on a temp dir.
The coordinator wiring is tested with the fake platform and a fake publisher. The real service and the
phone are T06.

## 5. Environment — read this before running anything

| | |
|---|---|
| OS | macOS 26.5.1 |
| Language / runtime | Node 24.2.0 (engines `>=22.19`; global `fetch`) |
| Claude Code / SDK | 2.1.283 / `@anthropic-ai/claude-agent-sdk` 0.3.282 |
| Network | `https://ntfy.sh/v1/health` 200 from this machine, 2026-09-27 |
| **Deliberately absent** | The `ntfy` CLI, `terminal-notifier`. Not needed: one HTTPS request. |

**The test command.** `npm test` (the block above): `FORCE_COLOR=0 NO_COLOR=1 node --test
--test-reporter=dot`. Quiet on pass (79 lines of dots, 2026-09-27), full failures, colour forced off in
the command because the shell sets `COLORTERM=truecolor`. For detail, run one file with
`node --test src/core/notify.test.mjs`. **Setup** is `npm ci` when a lockfile exists; this worktree had no
`node_modules` until it ran, and it left `git status` clean.

**Dependencies.** One addition, approved by the user 2026-09-27: `uqr` 0.1.3 (MIT, 79 KB unpacked, no
dependencies) for the terminal QR code, as a regular dependency because `install.sh` omits dev ones.
Nothing else. HTTP uses the global `fetch`.

### 5.1 What the test command cannot reach

| Cannot be tested automatically | Why it needs a person |
|---|---|
| The alert arrives on the iPhone, and when | The phone is the person's |
| Tapping it opens the Claude app on the worker's chat, or the browser | iOS decides how a claude.ai link opens |
| The Claude app stays silent with `CLAUDE_CLIENT_PRESENCE_FILE` set | Only the phone shows it |
| What scanning the QR code does in the iOS ntfy app | The phone's camera and app |

### 5.2 Seatbelts

| Flag / mechanism | Default | Effect |
|---|---|---|
| No config file | no alerts | Nothing is sent until `pir notify` runs |
| Injected `fetch` in tests | fake | No test reaches ntfy.sh |
| `PIR_HOME` | `HOME` | Tests keep config and marker in a temp dir |
| One reminder per episode | on | A parked worker cannot buzz the phone more than twice |
| `PARALLEL_REMOTE=0` | on | Still opts out of Remote Control; alerts then go without a link |

### 5.3 Outside the code — who acts

| Action | Command (exact, wrapped) | Bin | Why this bin | Way back | Expected cost | Login check |
|---|---|---|---|---|---|---|
| Add the QR library (T03) | `npm i uqr@0.1.3` | `worker` | Free, local, the dependency the user approved; user 2026-09-27 at plan review | Remove it from `package.json` and the lockfile, `npm ci` | none | none |
| Publish an alert to a pir-generated topic (a throwaway one in T03, the user's in T06) | `PIR_HOME=/tmp/pir-notify-t03 node src/shell/pir.mjs notify` (T03); the T06 harness run | `worker` | Free, received only by whoever subscribed: nobody, or the user's own phone | Nothing to undo; the alert can be swiped away | none | none (anonymous ntfy.sh) |
| Live harness run with real workers | `PIR_NOTIFY_REMIND_MS=120000 node src/shell/harness/run.mjs notify-live --into /tmp/notify-live` | `worker` | Same as prior live checks (real-asking-state T05); draws plan usage | Harness tears down; HALT file | plan usage, minutes | `claude auth status` reads `loggedIn: true` |
| Install ntfy, subscribe, look at the phone, tap the alert | on the iPhone | `person` | A device only the user holds | n/a | none | n/a |

Credentials: none needed. ntfy.sh is anonymous; the topic name is the secret and never goes in a commit,
a log line, or a FINDINGS row.

## 6. Recovery

`pir notify off` stops all alerts at once, in running runs too, and removes the marker so the Claude app
pushes again. Deleting `~/.pir/notify.json` by hand does the same except the marker.

## 7. Decisions and rationale

- **ntfy over Pushover, Telegram, Pushary, Mac-only banners** (user 2026-09-27, after a web survey of
  agent-oriented options): free, no account, both phone platforms, one HTTPS request, click-to-URL,
  actively maintained (v2.28.0, 2026-09). Pushary is agent-specific but paid, young, and built for
  replying from the notification, which stays with Remote Control. Claude Code's own push cannot be
  triggered by an outside program. HumanLayer's SDK is deprecated.
- **Extend, not rebuild**: the trigger is `remoteWanted`/`waitingOn`, the link is the `session_url`
  `enableRemoteControl` already returns (logged `remote-control` with `url`), the excerpt comes from
  `task.decision.text`, the pending request and `mainArg`, all existing. New code is the machine, the
  sender, the config and the verb.
- **Build runs only, never planning sessions** (user 2026-09-27).
- **Excerpt, 150 characters, plain cut** (user 2026-09-27).
- **Immediately, one reminder at 15 minutes** (user 2026-09-27), over a grace period, no reminder, or
  repeating.
- **`pir notify` command with a random topic and QR** (user 2026-09-27), over a hand-set env variable.
- **Silence the Claude app via `CLAUDE_CLIENT_PRESENCE_FILE`** (user 2026-09-27).
- **Tap opens the Remote Control chat** (user 2026-09-27): the alert waits up to 20 s for the link.
- **Alert state in memory, not in the control folder**: a restart re-alerting a waiting worker is
  accepted, and nothing new is persisted.
- **iOS clear and QR subscribe are undocumented**: ntfy's docs name Android and web for clearing and
  Android for `ntfy://` links. Neither changes the design; T06 records what the iPhone does.
- **Merge note**: `stopped-worker-asking` (planned, unbuilt) also edits `coordinate.mjs` near
  `syncRemote`. Whichever lands second resolves the conflict; this plan only adds a call after
  `syncRemote`.

## 8. Explicitly out of scope

- Alerts for other events (run finished, halted, crashed, merge ready). Why: the brief is the waiting
  alert; add later if wanted.
- Replying or acting from the alert (ntfy action buttons). Why: Remote Control is the reply path.
- Other services, self-hosted ntfy, ntfy access tokens. Why: one reliable channel first.
- Planning-session alerts (§2.1).
- Persisting episodes across a coordinator restart (§7).
