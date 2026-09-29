---
setup:
  - test ! -f package-lock.json || npm ci
test:
  - npm test
---

# Reliable notifications — Design

How parallel mode behaves is canonical in `/docs`. This file is build-time rationale for this plan;
T09 carries the resulting behaviour into `/docs` and `README.md`.

Redesigned 2026-09-28 after the coordinator agent landed (`docs/coordinator-agent.md`). The first
version alerted on every waiting build worker; with the agent answering most questions itself, that
would buzz the phone for questions that never reach the person. This version alerts when a question
becomes the person's, and when the run waits on the person's merge.

## 1. Purpose

When a build run needs the person, the person must learn it on their phone, every time. Today the only
alert is a side effect of Remote Control: pir switches Remote Control on for a worker whose question is
the person's (`remoteWanted`, `coordinate.mjs`) and the Claude app decides whether to push. It pushes
late or not at all (real-asking-state FINDINGS 2026-09-27; live-workers memory: permission and
plain-question pushes lag), and pir has no API to trigger or repeat that push.

This plan makes pir send the alert itself, through ntfy (a free publish/subscribe push service with an
iPhone and Android app, no account; the topic name is the only secret). Remote Control is unchanged: it
still switches on for a question that is the person's, and it stays the way the person replies away from
the terminal. Only the alert moves.

### Success criteria

- A question that becomes the person's (any reason in §2.1) produces one ntfy alert within one
  coordinator pass, carrying the plan, the task, why it is the person's, an excerpt of the question, and
  the worker's Remote Control link when Remote Control is on.
- A question the coordinator agent answers itself produces no alert.
- Still the person's 15 minutes after that alert: exactly one reminder. Answered: a clear is sent.
- The run waiting on the person's merge (ready, or red) produces one alert.
- Alerts carry pir's icon.
- `pir notify` sets a user up in one command: random topic saved, QR code printed, test alert sent.
- With ntfy configured, the Claude app does not also push for pir's build workers or the agent.
- Seen on the user's iPhone in a real run with the agent on (T08).

## 2. Behaviour specification

### 2.1 What triggers a question alert

An **episode** is one continuous stretch in which a live build worker waits on the person, as decided by
`waitingFor(...).holder === 'person'` (`src/core/asking.mjs`), the predicate `remoteWanted` and the row's
`asking you` already use. The alert takes its input from exactly that predicate, never from a second one.
Why: the run list's `asking you`, Remote Control and the alert then always agree (user 2026-09-28:
"anything that's yours").

A worker becomes the person's for one of these reasons, which the alert names (§2.3):

| Reason | When | Source in `startCoordinator` |
|---|---|---|
| `passed` | the agent wrote a `pass` for an item that is not reserved | a new `passed` map, released like `held` |
| `timeout` | the agent held the item past the hold limit (5 min) | `timedOut` (a late pass keeps `timeout`) |
| `reserved` | an `ask`-bin or destructive request, the person's from the first pass, including one the agent tried to decide and the command turned into a pass (user 2026-09-28, plan re-review: it was always the person's) | `reserved`, or `item.reserved` |
| `unavailable` | the run has an agent but it is down, restarting, given up or failed to start, or the brief failed | agent null or not alive, or an item never briefed |
| `off` | the run has no agent (`--no-coordinator`, `PARALLEL_COORDINATOR=0`) | `startAgent === null` |
| `null` | a worker waiting with no item (an implementer that stopped with no report; `itemsOf` yields nothing) | none |

- An episode starts on the first pass the worker is the person's, and ends on the first pass it is not
  (answered by the person, answered late by the agent, back to work, exited, or its task left the waiting
  phase). The reason is read once, at episode start, from the worker's oldest person-held item.
- A question the agent holds and then answers is never the person's, so it never alerts. A held item
  that times out alerts at the timeout; the person's wait therefore starts up to 5 minutes after the
  worker asked. Accepted: the hold limit is the agent's time to answer.
- The same worker waiting again later is a new episode and a new alert. Why: it is a new question
  (user 2026-09-27).
- Each waiting worker has its own episode; two workers waiting at once give two alerts.
- End-of-run helper workers (main-sync, tests-fix) are workers like any other here.
- Planning sessions (`pir plan`: planner and plan reviewer) never alert. Why: the person plans at the
  computer (user 2026-09-27). `plan-run.mjs` is not touched.
- Build runs only: the alert is driven from `coordinate.mjs`, every pass, whether or not
  `PARALLEL_REMOTE` is on.

### 2.2 When a question alert is sent

- **First alert**: as soon as the episode's Remote Control link is known, so the tap opens the worker's
  chat. It is sent without a link when Remote Control will not come (`PARALLEL_REMOTE=0`, or the worker's
  Remote Control was refused) or when 20 s have passed since the episode started without a link. Why
  20 s: `enableRemoteControl` normally answers in about a second; a stuck bridge must not hold the alert
  back. Why the worker's chat and not the agent's: the question is answered at the worker; the agent
  never relays an answer (`docs/coordinator-agent.md`, Passing on).
- **Reminder**: one, 15 minutes after the first alert, if the same episode is still open. Never more.
  Why: a missed first buzz is the common failure, but a worker parked overnight must not buzz all night
  (user 2026-09-27). `PIR_NOTIFY_REMIND_MS` overrides the 15 minutes; it exists for the live check (T08)
  and is not documented to users.
- **Clear**: when an episode for which an alert was sent ends, and for every open episode when the
  coordinator exits. ntfy documents clearing for Android and the web app only, so on the user's iPhone
  the alert probably stays; pir sends the clear anyway because it costs one request and does no harm.
- The first alert and the reminder share a sequence id (`pir-{workerId}-{episodeN}`), so on a client
  that supports updates the reminder replaces the first alert rather than stacking under it.
- A coordinator restart loses the in-memory episodes; a worker already the person's gets a fresh alert.
  Accepted (user 2026-09-27).

### 2.3 What a question alert says

- **Title**: `{plan slug} · {task} {role}`, e.g. `screen-time · T04 implement`. A helper worker uses
  its label and slug: `screen-time · main-sync resolve-main-merge`.
- **Message**: the reason prefix, then the excerpt by kind.
  - Prefix by reason (user 2026-09-28, question + why yours, without the agent's suggestion):
    `passed` → `Agent passed it on: `; `timeout` → `Agent didn't answer in time: `; `reserved` →
    `Needs your yes: `; `unavailable` → `Agent unavailable: `; `off` and `null` → no prefix.
  - `question` from a report park: `asks: ` + the report text (`task.decision.text`) from its start.
  - `question` without a report: `asks: ` + the worker's last assistant text; `is waiting for you` if
    there is none.
  - `questions` (AskUserQuestion pending): `asks: ` + the first question's `question`, plus ` (+N more)`
    when there are more.
  - `permission`: `wants to run ` + the tool name and its one-line summary (`mainArg` in
    `src/core/conversation.mjs`, the same the gate shows).
  - The excerpt part is cut to 150 code points with `…` when cut, newlines folded to spaces. The prefix
    is outside the 150, so the whole message stays under 190.
- **Reminder**: the same message prefixed `Still waiting: `.
- **Click**: the worker's Remote Control `session_url` (`https://claude.ai/code/session_…`) when known.
- Priority 4 (high), tag `bell`, the icon (§2.5). No action buttons: replying stays with Remote Control
  and `pir`.

Why the reason and not the agent's suggestion (user 2026-09-28): the person learns from the lock screen
why it came to them; what the agent would pick is in its chat. Why a plain cut rather than a model
summary (user 2026-09-27): no model call, no delay. Why an excerpt at all on a public server (user
2026-09-27): the person decides from the lock screen whether it is urgent; about 190 characters of a
question pass through ntfy.sh and nothing else does.

### 2.4 The end-of-run alert

One alert when the run starts waiting on the person's merge (user 2026-09-28):

- **With the agent**: on the pass `settle()` first sets `handoff.step = 'waiting'` in this coordinator
  process, read in the shell as the pass's `handoff.state` turning `ready` or `red` (§3.3); not on a pass
  that also finishes the run. Ready: title `{slug} · ready to merge`, message `All {n} tasks merged. git merge pir/{slug}`.
  Red: title `{slug} · not ready`, message by cause (user 2026-09-28, plan re-review: the alert names what
  failed). Main-sync left unresolved: `Merge with main unresolved on pir/{slug}`. Otherwise: `Tests red on
  pir/{slug}: ` + the reason, cut to 150 code points, or `Tests red on pir/{slug}` when there is none. The
  shell learns the cause from `handoffView()`, which gains `unresolved` (`handoff.sync?.state ===
  'unresolved'`). Click: the agent's Remote Control `session_url` when known, since the agent presents the report
  and the merge there.
- **Without the agent**: on the pass `r.complete` ends the run, same titles and messages (red reason from
  the `red-feature` surface), no click. The send is awaited, bounded at 2 s, before the process returns,
  because the run ends on that pass.
- No reminder and no clear. Not sent again when `main` moves and the branch is re-synced, since that is
  still the same wait. A pir restart into `ready to merge` sends it again (in-memory, as §2.2).
- Priority 4, tag `tada` when ready and `warning` when red, the icon.

### 2.5 The icon

- Every alert, test alerts included, carries `icon` (ntfy's JSON field): a PNG pir serves from GitHub,
  default `https://raw.githubusercontent.com/yanekk/plan-implement-review/pir/reliable-notifications/assets/pir-notify-icon.png`, the pushed feature branch's copy.
  Temporary (user 2026-09-28, plan re-review): local `main` is far ahead of GitHub's, so a URL on `main`
  would serve nothing until the user pushes it; the feature branch is pushed in T08 anyway. The branch
  must therefore stay on GitHub after the merge, and where the icon lives for good is an open decision
  (PLAN). `PIR_NOTIFY_ICON` overrides the URL, for the live check and for that later move; it is not
  documented to users.
- The PNG is drawn by a worker (user 2026-09-28): a plain square, the letters `pir` on a solid colour,
  256×256, under 20 KB, produced by a committed script with no new dependency (`node:zlib` deflate and a
  hand-written PNG encoder), so a redo is a code change reviewed like any other. The person judges it on
  the phone in T08.
- ntfy downloads the icon on the phone and caches it for 24 h (ntfy publish docs). An unreachable URL
  shows ntfy's default icon; the alert still arrives. Why a public URL: ntfy takes an icon only by URL.

### 2.6 `pir notify`

- `pir notify`: if no config, generate a topic (`pir-` + 24 random lowercase base32 characters from
  `crypto.randomBytes`), save it, print the topic, a QR code and the subscribe instructions, and send
  a test alert. If the first test alert fails, the topic stays saved and printed, the error is shown with
  `pir notify test` to retry once online, and the exit is non-zero. Why (user 2026-09-27, plan review):
  the phone may already have subscribed from the QR, and a new topic would strand it. If a config exists,
  print the same for the existing topic and send nothing. Why not regenerate: re-running to see the QR
  again must not unsubscribe the phone.
- `pir notify test`: send a test alert to the configured topic; report the HTTP result. Non-zero exit
  if not configured or the send failed.
- `pir notify off`: delete the config and the presence marker (§2.7). A later `pir notify` makes a new
  topic.
- The QR encodes `https://ntfy.sh/{topic}`. The printed instructions name the topic for typing into the
  ntfy app's "Subscribe to topic", because whether the iOS app subscribes from a scanned link is not
  documented (§8). T08 records what scanning actually does.
- Config: `{PIR_HOME ?? HOME}/.pir/notify.json`, `{ "server": "https://ntfy.sh", "topic": "…" }`, mode
  0600. Why there: beside the run index `~/.pir/runs/`; `~/.claude/pir-engine` is deleted by every
  `install.sh`. Why per account, not per project: the phone is the person's, not the repo's.
  `PIR_NOTIFY_CONFIG` overrides the config path; it exists so the live harness run can read the user's
  real config while `PIR_HOME` points at a scratch folder, and is not documented to users.
- The coordinator reads the config when it needs to send, not once at start, so `pir notify off` stops
  alerts in a run already going.

### 2.7 Silencing the Claude app's own push

When ntfy is configured at the moment a build worker or the coordinator agent is spawned, pir sets
`CLAUDE_CLIENT_PRESENCE_FILE` in that session's environment to `{PIR_HOME ?? HOME}/.pir/presence`, and
makes sure that file exists. Claude Code skips mobile push while the file exists (documented on
code.claude.com's remote-control page; the variable is in the 2.1.283 binary). Remote Control itself is
untouched. `pir notify off` deletes the marker, so already-running sessions push through the Claude app
again.

Why (user 2026-09-27): one reliable channel, no double alerts. Why the agent too: its Remote Control is
on for the whole run, so its pointer replies could otherwise push a second time. Why build runs only:
planning sessions do not alert through ntfy, so their Claude app push is left as it is. Whether the
variable silences a headless SDK session's push is unmeasured; T08 checks it on the phone, and if it
does not, that goes back to the user (PLAN, open decisions).

### 2.8 Unhappy paths

- **ntfy unreachable, 5xx or 429**: retry after 5 s and 30 s; any other 4xx fails at once (a malformed
  request will not improve). On the last failure note `notify-failed` once for that episode in the
  worker's conversation, with the status or error; an end-of-run failure is noted in the agent's
  conversation, or only in `control.log` without an agent. The run never waits on or stops for a send,
  except the bounded exit sends. A failed clear is not retried and not noted. Why: the alert is a
  convenience on top of `pir`, which still shows `asking you`.
- **No config**: nothing is sent, no note, no presence variable. Behaviour is exactly today's.
- **Corrupt config** (unparseable, no topic): treated as no config for sending; `pir notify` reports it
  and offers `pir notify off` to reset.
- **Sent**: note `notified` in the worker's conversation (`{ reminder: bool }`), drawn as
  `alert sent to your phone` / `reminder sent to your phone`; the end-of-run alert notes `notified` in
  the agent's conversation. Why: the person can see in `pir` what the phone was told.
- **A send in flight when the episode ends**: the clear is sent after it settles.

## 3. Architecture

### 3.1 The boundary

Unchanged: `src/core` is pure and `src/core/boundary.test.mjs` forbids `node:fs`, `fetch(`, `Date.now`,
`Math.random` and bare package imports there. If that test fails, move the code; never relax the test.

- `src/core/notify.mjs` (pure): the alert texts and the episode machine. Takes `now` as an argument.
- `src/shell/ntfy.mjs`: the HTTP publish and clear, with `fetch` injected.
- `src/shell/notify-config.mjs`: read, write, delete the config and the presence marker; the icon URL.
- `src/shell/notify-icon.mjs` and `assets/pir-notify-icon.png`: the script that draws the icon, and the icon.
- `src/shell/pir.mjs`: the `notify` verb.
- `src/shell/worker-proc.mjs`, `platform.mjs`, `coordinator-agent.mjs`: the session link and the
  environment variable.
- `src/shell/coordinate.mjs`: `startCoordinator` records why each worker is the person's; `main` calls
  the machine each pass and performs its actions, and sends the end-of-run alert.

### 3.2 The episode machine

```
// view per live build worker, built each pass by the shell:
//   { id, waiting: kind|null, title, message, remote: 'wanted'|'off'|'refused', url }
//   (title and message come from alertText, which applies the §2.1 reason and the §2.3 excerpt)
notifyStep(state, views, now, { remindMs = 900_000, linkWaitMs = 20_000 }) → { state, actions }
// actions: { type: 'send', id, seq, title, message, click|null, reminder: bool }
//          { type: 'clear', id, seq }
```

`state` is `{ episodes: { [workerId]: { n, startedAt, sentAt|null, reminded: bool, seq, message } },
counts }`. A worker absent from `views` ends its episode. `notifyExit(state)` returns the clears for every
episode with `sentAt`. The message (prefix and excerpt) is fixed when the episode starts; the reminder
reuses it. The end-of-run alert is not an episode: `endAlert({ slug, ready, taskCount, reason, unresolved })` returns
its title, message and tags, and the shell sends it once.

### 3.3 Data flow

Each coordinator pass, after the (REMOTE-gated) `syncRemote`: build views from `platform.workers()`,
`coordinator.state.tasks`, `coordinator.heldByAgent()` and `coordinator.whyPerson()`; run `notifyStep`;
for each action, read the config (none: drop the action), then fire the publish or clear without
awaiting it, logging notes through `platform.note`. This runs whether or not `PARALLEL_REMOTE` is on.
When the pass result's `handoff.state` first reads `ready` or `red` (`settle()` sets it together with
`step: 'waiting'`; `coordinator.handoff` is `handoffView()`, which carries `state` but not `step`), fire the
end-of-run alert, unless the same pass finished the run (`r.finished`: a restart that found `main` already
holding the tip must not announce a merge that is done). The red reason is `r.testsReason?.reason`. On every exit path
the `notifyExit` clears (and the no-agent end alert) are awaited, bounded at 2 s, before the process ends:
the signal handlers call `process.exit` at once, and an unawaited request dies with it. The loop polls
every `PARALLEL_POLL_MS` (5 s), so a hand-off is seen within about 5 s; that is the alert's latency floor
and is accepted.

### 3.4 Storage

Config and marker only (§2.6, §2.7). Episode state and the end-alert flag live in memory for the
coordinator's life; so does the new `passed` map in `startCoordinator`, released with the other maps.
Config is written through `writeFileAtomic` (`src/shell/atomic-write.mjs`, temp file and rename), so a
crash mid-write leaves the old file or none.

## 4. Testing

Unit tests beside the source. The episode machine and every text are tested exhaustively in core with
explicit `now`. `whyPerson` is tested through `startCoordinator` with the fake platform and a fake agent,
one case per reason in §2.1. `ntfy.mjs` is tested with an injected fake `fetch` recording requests; no test
reaches the network. `pir notify` is tested through `run(argv, injected)` in `pir.test.mjs` with
`PIR_HOME` on a temp dir. The icon is tested by decoding its PNG header. The coordinator wiring is tested
with the fake platform and a fake publisher. The real service, the icon on the phone and the phone itself
are T08.

## 5. Environment — read this before running anything

| | |
|---|---|
| OS | macOS 26.5.1 |
| Language / runtime | Node 24.2.0 (engines `>=22.19`; global `fetch`, `node:zlib`) |
| Claude Code / SDK | 2.1.283 / `@anthropic-ai/claude-agent-sdk` 0.3.282 |
| Network | `https://ntfy.sh/v1/health` 200 from this machine, 2026-09-28 |
| Repo | `github.com/yanekk/plan-implement-review`, public; the icon URL depends on it |
| **Deliberately absent** | The `ntfy` CLI, `terminal-notifier`, any image library. Not needed: one HTTPS request, and a PNG encoder is 50 lines over `node:zlib`. |

**The test command.** `npm test` (the block above): `FORCE_COLOR=0 NO_COLOR=1 node --test
--test-reporter=dot`. Quiet on pass (93 lines of dots, 2026-09-28), full failures, colour forced off in
the command because the shell sets `COLORTERM=truecolor`. For detail, run one file with
`node --test src/core/notify.test.mjs`. **Setup** is `npm ci` when a lockfile exists; it leaves
`git status` clean.

**Dependencies.** One addition, approved by the user 2026-09-27: `uqr` 0.1.3 (MIT, 79 KB unpacked, no
dependencies) for the terminal QR code, as a regular dependency because `install.sh` omits dev ones.
Nothing else. HTTP uses the global `fetch`; the icon uses `node:zlib`.

### 5.1 What the test command cannot reach

| Cannot be tested automatically | Why it needs a person |
|---|---|
| The alert arrives on the iPhone, and when | The phone is the person's |
| The icon shows on the iPhone, and looks right | Only the phone shows it |
| Tapping it opens the Claude app on the worker's chat, or the browser | iOS decides how a claude.ai link opens |
| The Claude app stays silent with `CLAUDE_CLIENT_PRESENCE_FILE` set | Only the phone shows it |
| What scanning the QR code does in the iOS ntfy app | The phone's camera and app |

### 5.2 Seatbelts

| Flag / mechanism | Default | Effect |
|---|---|---|
| No config file | no alerts | Nothing is sent until `pir notify` runs |
| Injected `fetch` in tests | fake | No test reaches ntfy.sh |
| `PIR_HOME` | `HOME` | Tests keep config and marker in a temp dir |
| `PIR_NOTIFY_CONFIG` | unset | Only the live harness run points at the user's real config |
| One reminder per episode | on | A parked worker cannot buzz the phone more than twice |
| One end-of-run alert per process | on | A run waiting overnight for its merge buzzes once |
| `PARALLEL_REMOTE=0` | on | Still opts out of Remote Control; alerts then go without a link |

### 5.3 Outside the code — who acts

| Action | Command (exact, wrapped) | Bin | Why this bin | Way back | Expected cost | Login check |
|---|---|---|---|---|---|---|
| Add the QR library (T06) | `npm i uqr@0.1.3` | `worker` | Free, local, the dependency the user approved; user 2026-09-27 at plan review | Remove it from `package.json` and the lockfile, `npm ci` | none | none |
| Publish an alert to a pir-generated topic (a throwaway one in T06, the user's in T08) | `PIR_HOME=/tmp/pir-notify-t06 node src/shell/pir.mjs notify` (T06); the T08 harness run | `worker` | Free, received only by whoever subscribed: nobody, or the user's own phone | Nothing to undo; the alert can be swiped away | none | none (anonymous ntfy.sh) |
| Push the feature branch so the icon is online (T08) | `git push origin pir/reliable-notifications` | `ask` | Public repo: other people can see the branch (user 2026-09-28) | `git push origin --delete pir/reliable-notifications`, which also takes the default icon offline (§2.5) | none | `gh auth status` |
| Live harness run with real workers and the agent | `PIR_NOTIFY_REMIND_MS=120000 PIR_NOTIFY_ICON=https://raw.githubusercontent.com/yanekk/plan-implement-review/pir/reliable-notifications/assets/pir-notify-icon.png node src/shell/harness/run.mjs notify-live --into /tmp/notify-live` | `worker` | Same as prior live checks (pir-coordinator T09); draws plan usage | Harness tears down; HALT file | plan usage, minutes | `claude auth status` reads `loggedIn: true` |
| Remove the live run's scratch folder | `rm -rf /tmp/notify-live` | `worker` | A scratch folder the harness made | none needed | none | none |
| Remove T06's scratch folder | `rm -rf /tmp/pir-notify-t06` | `worker` | A scratch folder T06's own check made | none needed | none | none |
| Check whether the icon is online (T08) | `curl -sI https://raw.githubusercontent.com/yanekk/plan-implement-review/pir/reliable-notifications/assets/pir-notify-icon.png` | `worker` | Read-only request to a public URL | nothing changed | none | none |
| Install ntfy, subscribe, look at the phone, tap the alert, answer | on the iPhone | `person` | A device only the user holds | n/a | none | n/a |

Bins approved by the user as listed, 2026-09-28 at plan re-review; the rules are in `.claude/settings.json`.

Credentials: none for ntfy.sh, which is anonymous; the topic name is the secret and never goes in a
commit, a log line, or a FINDINGS row. The push uses the user's existing GitHub login.

## 6. Recovery

`pir notify off` stops all alerts at once, in running runs too, and removes the marker so the Claude app
pushes again. Deleting `~/.pir/notify.json` by hand does the same except the marker.

## 7. Decisions and rationale

- **Alert when a question is the person's, not when a worker waits** (user 2026-09-28): the agent answers
  most questions; alerting on those would buzz for nothing. All reasons count, the agent's absence
  included, so a crashed agent never means a silent question.
- **The reason in the message, not the agent's suggestion** (user 2026-09-28).
- **An end-of-run alert, once** (user 2026-09-28): the run now waits on the person's merge, often hours
  later. This reverses the first version's out-of-scope line for that one event.
- **A custom icon, drawn by a worker and served from GitHub** (user 2026-09-28): ntfy lists `icon` for
  Android, iOS and web; it needs a public URL. The live check pushes the feature branch once (`ask`) so
  the icon is online before the merge. For now the default URL is that branch's copy, not `main`'s,
  because GitHub's `main` lags the local one (user 2026-09-28, plan re-review; §2.5).
- **The reason is recorded in `startCoordinator`, not derived in core**: the maps that know it (`held`,
  `timedOut`, `reserved`) live there; a pass leaves every map today, so a `passed` map is added.
- **Tap opens the worker's chat for questions, the agent's for the end**: where each is acted on.
- **Silence the agent's Claude app push too**: follows the one-channel decision (user 2026-09-27).
- **ntfy over Pushover, Telegram, Pushary, Mac-only banners** (user 2026-09-27, after a web survey):
  free, no account, both phone platforms, one HTTPS request, click-to-URL, maintained (v2.28.0,
  2026-09). Claude Code's own push (the `PushNotification` tool, the app's action-required push) cannot
  be triggered by pir and is the channel that proved unreliable.
- **Extend, not rebuild**: the trigger is `waitingFor`/`remoteWanted`, the link is the `session_url`
  `enableRemoteControl` already returns (logged `remote-control` with `url`), the excerpt comes from
  `task.decision.text`, the pending request and `mainArg`, the end hook is `settle()`. New code is the
  reason record, the machine, the sender, the config, the icon and the verb.
- **Build runs only, never planning sessions** (user 2026-09-27).
- **Excerpt, 150 characters, plain cut** (user 2026-09-27).
- **Immediately, one reminder at 15 minutes** (user 2026-09-27).
- **`pir notify` command with a random topic and QR** (user 2026-09-27).
- **Alert state in memory, not in the control folder**: a restart re-alerting is accepted.
- **iOS clear and QR subscribe are undocumented**: ntfy's docs name Android and web for clearing and
  Android for `ntfy://` links. Neither changes the design; T08 records what the iPhone does.

## 8. Explicitly out of scope

- Alerts for other events (a task merged, halted, crashed, the agent given up). Why: the person acts on a
  question or a merge; the rest shows in `pir`.
- Replying or acting from the alert (ntfy action buttons). Why: Remote Control is the reply path.
- The agent's suggestion in the alert (§2.3).
- Other services, self-hosted ntfy, ntfy access tokens, a user-set icon. Why: one reliable channel first.
- Planning-session alerts (§2.1).
- Persisting episodes across a coordinator restart (§7).
