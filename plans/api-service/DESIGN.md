---
setup:
  - test ! -f package-lock.json || npm ci
test:
  - npm test
---

# API service — Design

How parallel mode behaves is canonical in `/docs`. This file is build-time rationale for this plan;
T11 carries the resulting behaviour into `/docs/api-service.md` and the README. It never edits a
finished plan's DESIGN.md.

## 1. Purpose

The agentic-ide cockpit (`~/src/agentic-ide`) shows in its footer how much of the 5-hour and weekly
Claude subscription limit is used. It gets the numbers from a statusline hook that only ordinary
Claude Code sessions run. pir's workers are SDK sessions with no statusline, so during a pir run the
footer goes stale, although every pir worker receives the same numbers as `rate_limit_event`
messages.

This plan gives pir a permanent local service that answers a REST API over HTTP, started at login and
kept alive by launchd, with subscription usage as its first data endpoint and a health check beside
it. Run processes save
each reading they hear to one file; the service answers from that file. The cockpit polls it.

### Success criteria

- With the service up and a run alive, `curl -s "$(jq -r .url ~/.pir/api.json)/v1/usage"` answers
  with numbers equal to the newest `rate_limit_event` in that run's conversation log, and
  `observed_at` moves as the run works.
- With no run alive it still answers, with the last reading or nulls.
- Kill the service process and it comes back.
- After logging out and in it is up without anyone starting it (person, §5.1).
- A run is never slowed or failed by the service, and the service never fails on a bad reading.
- No test writes the real `~/.pir/usage.json`, binds port 47717 or registers a login item.

### Stance

The run and the service never talk to each other. A run writes a file and knows nothing of the
service; the service reads a file and knows nothing of runs. That is what makes "a run never suffers
for the service" true by construction rather than by error handling.

---

## 2. Behaviour specification

### 2.1 The contract (version 1)

The contract is the one the cockpit's plan was written against (`~/src/agentic-ide`,
`plans/pir-usage-api/PIR-PROMPT.md`). This plan settles the points that brief left open and changes
nothing else. A change to this section must be carried to that file.

**Discovery.** While the service is up it keeps `${PIR_HOME ?? HOME}/.pir/api.json` current:

```json
{ "version": 1, "url": "http://127.0.0.1:47717", "pid": 4711 }
```

Written temp-then-rename, removed on a clean exit. `pid` lets a reader tell a file left by a crash
from a live service. The reader reads the file before each poll and never assumes the port.

**`GET {url}/v1/usage`** answers 200, `Content-Type: application/json`:

```json
{
  "version": 1,
  "observed_at": 1790669288699,
  "rate_limits": {
    "five_hour": { "used_percentage": 97, "resets_at": 1790673000 },
    "seven_day": { "used_percentage": 77, "resets_at": 1790830800 }
  }
}
```

- `observed_at` is ms since epoch when a worker received the event, not when the request was
  answered. Reason: the cockpit takes the newer of this and its own statusline reading, so only an
  honest time keeps an old pir reading from overwriting a fresh one.
- `rate_limits` has the shape of Claude Code's statusline `rate_limits`: `used_percentage` is
  utilization × 100, `resets_at` is epoch seconds. Reason: the cockpit feeds it to code it already has.
- Either window may be `null`. Nothing known: 200 with `observed_at: null` and `rate_limits: null`,
  never a 404 or an error. Reason: the cockpit must tell "service up, nothing to report" from "no
  service".
- A reading is returned as it was heard even if a `resets_at` has since passed; the reader handles it.
- A query string is ignored. `/v1/usage/` is an unknown path.

**`GET {url}/health`** answers 200 with `{ "version": 1, "status": "ok", "pid": 4711 }`, `pid` being the
answering process (user 2026-09-30, at plan review). It reads no file, so it answers whatever state
`usage.json` is in. Reason: `pir service`, and any reader, asks "is the service up" here rather than
through the usage endpoint. A query string is ignored; `/health/` is an unknown path.

**Everything else.** Checked in this order, each with a small JSON body and the same headers:

| Case | Status | Body |
|---|---|---|
| Unknown path, any method | 404 | `{"version":1,"error":"not_found"}` |
| Known path, method not `GET` (`HEAD` and `OPTIONS` included) | 405, `Allow: GET` | `{"version":1,"error":"method_not_allowed"}` |
| The handler threw | 500 | `{"version":1,"error":"internal"}` |

Every response carries `Content-Type: application/json`, `Cache-Control: no-store` and
`X-Content-Type-Options: nosniff`, and no `Access-Control-*` header. The `Host` header is not checked.
Reason (user 2026-09-30, at plan review): no special rule for or against browsers. A browser's default
already keeps an ordinary page from reading the answer, since no CORS grant is sent; the person dropped
the planned `Host` check knowingly, so a DNS-rebinding page is not guarded against. Letting pages in
(a CORS grant) would be a separate decision.

The service binds `127.0.0.1` only, never a routable address. No authentication.

### 2.2 The port

Fixed: **47717**, fail if taken (user 2026-09-30). The number is below macOS's ephemeral range
(49152 and up, measured), so no outgoing connection is ever handed it, and it was free on this machine.
If another program holds it, the service exits with code 47 and writes no `api.json`; launchd starts
it again every 10 seconds (its default throttle, measured), so it comes up once the port is free.
Reason the throttle is left at its default: a port clash is then a slow retry, not a busy loop.
Reason for 47: launchd itself reports `last exit code = 78: EX_CONFIG` when it cannot start the
program (measured at plan review), so 78 could not tell a held port from a moved `node`; 47 is outside
the sysexits range, Node's own codes and the signal codes.

The fixed port is also the single-instance lock on the real machine: a second real service cannot bind.

On a scratch home (§2.8) the port is chosen by the OS and found only through that home's `api.json`.
Reason: tests and checks must never bind the real port, and several may run at once.

### 2.3 Where a reading comes from

The SDK yields `{ type: "rate_limit_event", rate_limit_info: {...} }` to every worker on a claude.ai
subscription. The source is `rate_limit_info.unifiedWindows`:

```json
{ "five_hour": { "utilization": 0.97, "resetsAt": 1790673000 },
  "seven_day": { "utilization": 0.77, "resetsAt": 1790830800 } }
```

`utilization` is a fraction, `resetsAt` epoch seconds. `unifiedWindows` is not in `sdk.d.ts`; it was
on 389 of 389 events in this repo's conversation logs (SDK 0.3.282, Claude Code 2.1.285).

- A window is valid when `utilization` is a finite number ≥ 0 and `resetsAt` a finite number > 0.
  An invalid or absent window is `null`. Other keys in `unifiedWindows` are ignored.
- An event with no `unifiedWindows`, or with no valid window, yields no reading and the previous one
  stands (user 2026-09-30). Reason: falling back to the documented single-window fields would replace
  a two-window reading with a one-window one and blank the other window in the footer.
- `used_percentage` is `min(utilization, 1) × 100`, rounded to two decimals. Reason: the contract
  says 0–100, and `0.11 × 100` is `11.000000000000002` in floating point.
- On Bedrock, Vertex or an API key no such event arrives, and the service never hears anything.

### 2.4 The hand-off: one file

A run process saves each reading to `${PIR_HOME ?? HOME}/.pir/usage.json`, temp-then-rename (user
2026-09-30, chosen over the run calling the service and over the service tailing conversation logs):

```json
{ "version": 1, "observed_at": 1790669288699,
  "five_hour": { "utilization": 0.97, "resets_at": 1790673000 },
  "seven_day": { "utilization": 0.77, "resets_at": 1790830800 } }
```

- `observed_at` is the `t` of the conversation-log entry that carried the event, so the API's value
  can be matched against the log exactly.
- Every event with a reading is written, even when the numbers did not change. Reason: `observed_at`
  must move as the run works.
- Newest wins by write order: several run processes write the same file, each whole and atomic, and
  each stamps the moment it heard the event, so the last writer is the newest reading. Two events
  within the same few milliseconds may land in either order; the difference is not observable.
- The write is synchronous, wrapped so that no failure escapes: a missing folder is created, any
  other error is swallowed. Reason: a run never suffers for the service. About 3 % of a worker's
  messages are usage events (389 of 12 425 log lines), so the cost is one small write now and then.
- The reading survives a service restart and a reboot, because it is a file (user 2026-09-30).

**Who writes.** Every session pir holds goes through `startWorker` (`src/shell/worker-proc.mjs`), so
the reporter is wired there, once, as a default parameter. Build workers, planning sessions, the
coordinator agent, and the sessions of the in-flight `finisher` and `single-runs` plans are covered
without any caller knowing. The reporter is on only when `PIR_RUN=1`, which `pir` sets on every run
process it launches (`launch.mjs`). Reason: that is the existing switch for "a run started by `pir`",
and it keeps a unit test that calls `startWorker` directly from writing anything.

A run started before this is installed runs the old code and reports nothing until it is stopped and
started again (user 2026-09-30). A run not started through `pir` does not report.

### 2.5 What the service does with the file

On each request the service stats `usage.json`, re-reads it only when size or mtime changed, and
validates the text: version 1, `observed_at` a finite number > 0 and at most 60 s ahead of the
service's clock, each window null or valid, at least one window valid. Anything else, a missing file
included, reads as no reading. Reason: the service never suffers for a run, and a time stamp from the
future would otherwise beat every real reading in the cockpit for ever.

### 2.6 Start at login, kept alive

A launchd agent, label `com.pir.api-service`, plist at `~/Library/LaunchAgents/com.pir.api-service.plist`:
`ProgramArguments` = the absolute `node` path and `~/.claude/pir-engine/src/shell/api-service.mjs`,
`RunAtLoad` true, `KeepAlive` true, `ProcessType` `Background`. No log file: the service prints
nothing in normal operation, and a failure is read from launchd's last exit code (§2.7).

- The `node` path is what `command -v node` resolves at registration (`/opt/homebrew/bin/node` here),
  not the real path behind the symlink. Reason: launchd's PATH is `/usr/bin:/bin:/usr/sbin:/sbin`
  (measured), and the Cellar path changes with every `brew upgrade`.
- The script path must be the installed engine's. `on` and `refresh` refuse when run from any other
  copy of the engine. Reason: a checkout or a task worktree would register a path that is later
  deleted.
- The service imports only Node built-ins and `src/core/`. Reason: it must start even when an
  install's `npm ci` failed.
- On SIGTERM or SIGINT it removes `api.json` if the file's `pid` is its own, closes and exits 0.
- Every 30 s it rewrites `api.json` if the file is missing or not its own. Reason: "keeps it current"
  must survive somebody deleting `~/.pir`.

### 2.7 What the person sees and does

`./install.sh` registers and starts the service, and restarts it on every later install so it runs the
code just installed (user 2026-09-30). It does this after the engine and its packages are in place,
and a failure here prints one line and does not fail the install. On a scratch `HOME` it prints
`skipped the API service (not the real home)`.

`pir service` prints the state and exits 0 only when the service answers `GET /health` with a
version-1 body (user 2026-09-30, at plan review: health, not usage, is what it checks). The reading
line then comes from `GET /v1/usage`; if that fails it prints the `no usage reading yet` line.

```
pir service: running at http://127.0.0.1:47717 (pid 4711)
last usage reading 2 min ago: 5-hour 97%, weekly 77%
```
```
pir service: running at http://127.0.0.1:47717 (pid 4711)
no usage reading yet: it arrives with the first pir run on a Claude subscription
```
```
pir service: off
turn it on with: pir service on
```
```
pir service: not installed
run ./install.sh, or: pir service on
```
```
pir service: not answering: port 47717 is held by another program
it retries every 10 seconds and comes up once the port is free
```
```
pir service: registered but not answering (last exit code 1)
try: pir service off, then pir service on
```

```
pir service: registered but not answering
try: pir service off, then pir service on
```
```
pir service: macOS would not register it: {launchctl's message}
try: pir service off, then pir service on
```

The seventh is the sixth when launchd has no exit code for the service (it never exited, or the line
is absent). The eighth is printed by `on` when `bootstrap` still fails after its retries (§2.9). Both
wordings: user 2026-09-30, at plan review. `{launchctl's message}` is the first line of its stderr only
(user 2026-09-30, at T03 review). Reason: the second line is `Try re-running the command as root for
richer errors.`, which is wrong for a per-user agent and would sit above pir's own hint.

The age reads `just now` under a minute, then `N min ago`, `N h ago`, `N days ago`. A percentage is
the API's `used_percentage` rounded to a whole number (user 2026-09-30, at plan review). A null window
reads `5-hour unknown` or `weekly unknown`.

`pir service off` stops and unregisters the service, removes the plist and a stale `api.json`, and
leaves a marker `~/.pir/api-service.off`. It prints `pir service: off`. While the marker exists,
`./install.sh` leaves the service off and prints `the API service is off (pir service on turns it on)`. `pir service on` removes the marker, registers and
starts it, waits up to 5 s for it to answer and prints the `pir service` text. Reason for the marker:
off must stay off across installs (user 2026-09-30), and the absence of a plist alone cannot tell
"turned off" from "never installed".

`on`, or the install step, run from a copy of the engine that is not the installed one (§2.6) prints
`pir service: run the installed pir (./install.sh first)` and changes nothing.

On a platform other than macOS every form of `pir service`, the bare one included (user 2026-09-30,
at plan review), and the install step print `pir service needs macOS (launchd)` and change nothing.

### 2.8 Scratch homes and tests

Three things could touch the real machine: the usage file, the port, the login item. One rule, one
function (`homeKind`), decides all three from the environment:

| Kind | When | Usage file | Port | Login item |
|---|---|---|---|---|
| `real` | `PIR_HOME ?? HOME` is the OS account's home, and `NODE_TEST_CONTEXT` is unset | written | 47717 | allowed |
| `scratch` | `PIR_HOME ?? HOME` is any other folder | written, in that folder | OS-chosen | refused |
| `test-real` | the home is the real one and `NODE_TEST_CONTEXT` is set, or neither `PIR_HOME` nor `HOME` is set | not written | service refuses to start | refused |

`node --test` sets `NODE_TEST_CONTEXT=child-v8` in each test process and children inherit it
(measured). Reason for the third row: a test that forgot to set a scratch home must fail closed
rather than feed fake numbers to the person's cockpit. An environment with no home at all is in the
same row because `indexDir` falls back to the real home there. The OS account's home comes from the user
database (`os.userInfo().homedir`), not from `HOME`. Reason: drills run `HOME=/tmp/... ./install.sh`,
and launchd's domain is per user whatever `HOME` says.

### 2.9 Unhappy paths

| Case | What happens |
|---|---|
| Service down, slow or absent | The run writes its file regardless; nothing waits on the service |
| `~/.pir` missing or not writable | The run's write fails silently; the service reports nulls |
| `usage.json` corrupt, half a version, or future-dated | Reads as no reading: 200 with nulls |
| Port 47717 held | Exit 47, no `api.json`, launchd retries every 10 s; `pir service` names the cause, from a foreign answer on the port or from launchd's last exit code 47 |
| Service killed | launchd restarts it (0.2 s after ≥ 10 s up, 10 s otherwise, measured); `api.json` is rewritten with the new pid |
| Crash leaves a stale `api.json` | Overwritten at the next start; `pir service off` removes one whose pid is dead |
| `node` moved or removed after registration | The service cannot start; `pir service` says registered but not answering (last exit code 78, launchd's own); `./install.sh` or `pir service on` rewrites the plist |
| Engine replaced mid-run of the service | The running process keeps its loaded code until `install.sh` restarts it at the end |
| `bootstrap` right after `bootout` | May fail with code 5 while the old instance is torn down (a second `bootstrap` of a loaded label measured code 5); retried up to 10 times, 300 ms apart |
| launchd refuses the registration (every retry failed) | `pir service on` prints the `macOS would not register it` text of §2.7 and exits 1; the install step prints it and carries on |

---

## 3. Architecture

### 3.1 The boundary

`src/core/` decides; `src/shell/` touches the world. The three new core modules take the clock, the
environment and the file text as arguments. `src/core/boundary.test.mjs` already scans every core
file for `node:fs`, `node:net`, `Date.now` and the rest; the new files fall under it with no change.
If it fails, move the code to `shell/`; never relax the test.

### 3.2 Modules

| Module | Side | Holds |
|---|---|---|
| `src/core/usage.mjs` | core | event → reading, the file format, the response body (§2.3–§2.5) |
| `src/core/api.mjs` | core | the router, the health body, the discovery record, `homeKind`, the port, the file names (§2.1, §2.2, §2.8) |
| `src/core/service.mjs` | core | the plist text, the on/off/refresh step plans, the status wording (§2.6, §2.7) |
| `src/shell/usage-report.mjs` | shell | the run-side writer; wired into `worker-proc.mjs` |
| `src/shell/api-service.mjs` | shell | the HTTP server, `api.json`, the file cache; the program launchd runs |
| `src/shell/service-ctl.mjs` | shell | `launchctl`, the plist and the marker; the CLI `install.sh` calls |
| `src/shell/pir.mjs` | shell | the `service` verb |

The router takes its endpoints as a table (`{ '/v1/usage': () => body }`) and knows nothing about
usage. Reason: the API is meant to grow, and a second endpoint should be one more table row.

### 3.3 Data flow

```
claude (worker) ──rate_limit_event──▶ worker-proc ──▶ usage-report ──▶ ~/.pir/usage.json
                                                                            │ stat + read
cockpit ──reads──▶ ~/.pir/api.json ──GET /v1/usage──▶ api-service ◀─────────┘
launchd ──runs, restarts──▶ api-service          install.sh / pir service ──▶ service-ctl ──▶ launchctl
```

### 3.4 Storage

All under `${PIR_HOME ?? HOME}/.pir/`, beside the run index, resolved as `dirname(indexDir({ env }))`
the way `notify-config.mjs` does. Reason: `~/.claude/pir-engine` is deleted by every install.

| File | Writer | Format |
|---|---|---|
| `usage.json` | run processes | §2.4; whole file, temp-then-rename (`atomic-write.mjs`) |
| `api.json` | the service | §2.1; temp-then-rename; removed on a clean exit |
| `api-service.off` | `pir service off` | empty marker |

A crash mid-write leaves a `.tmp` file no reader opens; the previous whole file stays.

---

## 4. Testing

Core modules are tested exhaustively with plain values. Shell modules are tested with the real
filesystem in a temp folder, a real HTTP server on an OS-chosen port, the real SDK against the fake
`claude` (`src/shell/fake/claude-stream.mjs`, whose `emit` step already sends any message, so a
script can send a `rate_limit_event`), and an injected `launchctl`. No test runs the real
`launchctl`. T08 proves the chain through the real launch path with fake sessions. T09 and T10 are
the two checks the suite cannot hold: real launchd, and real sessions.

No surface: `pir service` prints lines and exits. Its text is specified in §2.7 and asserted
verbatim in T03, so there is no rig and no drill.

---

## 5. Environment — read this before running anything

| | |
|---|---|
| OS | macOS 26.5.1 (Darwin 25.5.0) |
| Runtime | Node v24.2.0, `/opt/homebrew/bin/node` (symlink into the Cellar); npm 11.4.2 |
| Git | 2.50.1 (Apple Git-155) |
| Claude | Claude Code 2.1.285, login `claude.ai`, subscription `max`; SDK `@anthropic-ai/claude-agent-sdk` 0.3.282 |
| Tools | `/usr/bin/curl`, `/usr/bin/jq`, `/bin/launchctl` |
| **Deliberately absent** | GNU `timeout` (bound a process with Node's own timers or `spawnSync` `timeout`) |

**The test command** is `npm test`: `FORCE_COLOR=0 NO_COLOR=1 node --test --test-reporter=dot
'src/**/*.test.mjs'`, ending in `TESTS PASSED` or `TESTS FAILED`. Quiet dot reporter; colour is
forced off in the command itself (nothing in this shell forces it on); failures print in full. For
detail run one file: `node --test --test-reporter=spec path/to/file.test.mjs`. Measured in a fresh
worktree on 2026-09-30: green in 112 s, `git status --porcelain` empty after setup and after the run.

**Setup** is `test ! -f package-lock.json || npm ci`, as in every recent plan here.

**Dependencies.** None added. Node built-ins only: `node:http` for the server and for the status
check's request.

### 5.1 What the test command cannot reach

| Cannot be tested automatically | Why | Who |
|---|---|---|
| launchd starts the real code, restarts it when killed, stops it on bootout | Only the real launchd shows it | worker, T09, under a scratch label |
| Real sessions yield readings and the API serves them | Needs real Claude sessions on a subscription | worker, T10, on a scratch home |
| The real install: `./install.sh` registers the service and `pir service` says running | The installed engine may not be replaced while a run is live, so it cannot happen inside the build | after the merge (PLAN § After the merge) |
| Up after logging out and in | Only the person can log out | person, after the merge |

### 5.2 Seatbelts

| Mechanism | Default | Effect |
|---|---|---|
| `homeKind` (§2.8) | on | Under the test runner, or on a scratch home, nothing reaches the real file, port or login item |
| Injected `launchctl` | fake in tests | No test runs the real one |
| Installed-engine rule (§2.6) | on | A checkout or worktree cannot register the real label |
| Scratch label and plist outside `~/Library/LaunchAgents` (T09) | the check's only mode | The temporary item cannot survive a logout and never collides with the real one |
| Guaranteed teardown (T09, T10) | `finally` | The check boots its item out and deletes its folder whatever happened |
| launchd's 10 s throttle | default, left alone | A service that cannot start retries slowly |

### 5.3 Outside the code — who acts

| Action | Command | Bin | Why this bin | Way back | Expected cost | Login check |
|---|---|---|---|---|---|---|
| Install the locked packages | `test ! -f package-lock.json \|\| npm ci` | `worker` | Exact locked versions only | Delete `node_modules` | none | none |
| Temporary login item (T09) | `node src/shell/harness/service-live-check.mjs` | `worker` | Scratch label, plist in a temp folder, removes itself; moved down from `ask` by the user 2026-09-30 | `launchctl bootout gui/$(id -u)/com.pir.api-service.check` | none | none |
| Live harness run with real workers (T10) | `node src/shell/harness/usage-live-check.mjs --into /tmp/usage-live` | `worker` | Same as prior live checks; scratch repo and scratch home | The harness tears down; `HALT` file | plan usage, minutes | `claude auth status` reads `loggedIn: true`, `authMethod: claude.ai` |
| Remove T10's scratch folder | `rm -rf /tmp/usage-live` | `worker` | A folder the check made | none needed | none | none |
| Read the local API | `curl -s http://127.0.0.1:{port}/health`, `curl -s http://127.0.0.1:{port}/v1/usage` | `worker` | Read-only, this machine | nothing changed | none | none |
| Kill the real service once, after the merge | `kill -9 "$(jq -r .pid ~/.pir/api.json)"` | `worker` | Only after the approved install; placed here by the user 2026-09-30: it undoes itself and the reading is a file | launchd restarts it (0.2 s, or 10 s) | none | none |
| `./install.sh`, after `pir/api-service` is merged | registers the login item and restarts the service | `ask` | Changes what starts at login on the person's Mac; macOS shows a background-item notice the first time | `pir service off` | none | none |

`Bash(./install.sh)` was under `permissions.allow` in `.claude/settings.json`, from before it
registered anything. The plan review moved it to `permissions.ask` (user 2026-09-30): every session in
this repo now stops for the person before the real installer runs, a build worker included. Installs
into a scratch `HOME` keep their own `allow` rules and skip the service (§2.7).

Credentials: none. The service has no login; T10 uses the person's existing Claude login.

---

## 6. Recovery

`pir service off` removes the login item and the plist; nothing else on the machine was changed.
`usage.json` and `api.json` may be deleted at any time: the next reading and the next service start
rewrite them. To back the plan out, revert the task commits and run `./install.sh` after `pir service
off`. A reader that finds no `api.json`, or one whose `pid` is dead, treats the service as absent.

---

## 7. Decisions and rationale

| Decision | Reason | When |
|---|---|---|
| REST over HTTP, polled; a permanent service started at login; usage the only data endpoint; read-only | The API is meant to grow; decided before this plan | user 2026-09-30, in the brief |
| Hand-off by one shared file | The run never talks to the service; the reading survives restarts; no write endpoint on a read-only API | user 2026-09-30 |
| Fixed port 47717, fail if taken | The person wants one number; launchd's retry makes the failure self-healing | user 2026-09-30 |
| `install.sh` registers; `pir service`, `on`, `off`; off stays off across installs | The service arrives with pir; one plain way to see and stop it | user 2026-09-30 |
| `install.sh` restarts the service after every install | The service always runs the code just installed; a self-watching service could restart onto a half-copied engine | user 2026-09-30 |
| No fallback when `unifiedWindows` is absent | A one-window reading would blank the other window | user 2026-09-30 |
| The real install and the login check are a checklist after the merge, not a task | `./install.sh` may not run while a run is live | user 2026-09-30 |
| T09's temporary login item runs without a prompt | Scratch label, self-removing | user 2026-09-30 |
| No prototype | No screen; `pir service` prints lines | 2026-09-30 |
| No `Host` check, no CORS headers | No special rule for or against browsers; the planned refusal of a foreign `Host` was dropped | user 2026-09-30, plan review |
| `GET /health`, and `pir service` checks it instead of usage | "Is it up" should not depend on the usage endpoint | user 2026-09-30, plan review |
| `./install.sh` is `ask` in the settings; the after-merge kill is `worker` | The installer now changes what starts at login; the kill undoes itself | user 2026-09-30, plan review |
| Port-taken exit code is 47, not 78 | launchd reports 78 itself for a program it cannot start | measured 2026-09-30, plan review |
| The reporter is a default of `startWorker`, gated on `PIR_RUN=1` | One choke point covers every session kind, including those of in-flight plans | 2026-09-30 |
| Extend `atomic-write.mjs`, `indexDir`, the fake `claude`, the harness and the `pir notify` verb pattern; build the server, the launchd handling and the event reading new | The first five exist and fit; nothing in the repo serves HTTP, drives launchd or reads `rate_limit_event` | 2026-09-30 |
| Utilization above 1 reads as 100 % | The contract says 0–100; dropping the reading would hide being over the limit | 2026-09-30 |
| No log file for the service | It prints nothing when healthy, and a 10 s restart loop would grow a log without bound | 2026-09-30 |

---

## 8. Explicitly out of scope

- Any endpoint beyond `/v1/usage` and `/health`, and any endpoint that changes something. Reason:
  decided in the brief; `/health` was added by the user at plan review.
- Authentication, and access from another machine.
- Any change to the dashboard's screen.
- agentic-ide's side; its reader is planned in `~/src/agentic-ide`, `plans/pir-usage-api/`.
- A configurable port. Reason: the person chose one fixed number; a setting can be added when needed.
- A fallback to the documented single-window fields (§2.3).
- Reporting from a run not started through `pir`, or from a run on the old engine (§2.4).
- Linux and Windows service managers.
