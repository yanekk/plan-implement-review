# The API service — `pir service`

pir keeps one small program running on the machine that answers a read-only REST API over HTTP on
`127.0.0.1`. Its first data endpoint says how much of the 5-hour and weekly Claude subscription limit
is used. The numbers come from pir's own sessions: every session a run holds receives them from
Claude as it works, the run saves each one to a file, and the service answers from that file. Any
local program can read them; nothing on pir's side reads them back.

The run and the service never talk to each other. A run writes a file and knows nothing of the
service; the service reads a file and knows nothing of runs. A run is therefore never slowed or failed
by the service, and the service never fails on what a run wrote.

The pure rules are in `src/core/api.mjs` (the router, the health body, the discovery record, which
home is real), `src/core/usage.mjs` (event to reading, the file, the response body) and
`src/core/service.mjs` (the plist, the step plans, the printed texts). The programs are
`src/shell/api-service.mjs` (the server launchd runs), `src/shell/usage-report.mjs` (the run-side
writer) and `src/shell/service-ctl.mjs` (`launchctl`, the plist, the marker, the status check).
`plans/api-service/DESIGN.md` holds the rationale.

```
claude (session) ──rate_limit_event──▶ worker-proc ──▶ usage-report ──▶ ~/.pir/usage.json
                                                                             │ stat + read
reader ──reads──▶ ~/.pir/api.json ──GET /v1/usage──▶ api-service ◀───────────┘
launchd ──runs, restarts──▶ api-service          install.sh / pir service ──▶ service-ctl ──▶ launchctl
```

## The contract (version 1)

All three files named on this page sit in `${PIR_HOME ?? HOME}/.pir/`, beside the run index.

### Discovery — `api.json`

While the service is up it keeps `~/.pir/api.json` current:

```json
{ "version": 1, "url": "http://127.0.0.1:47717", "pid": 4711 }
```

- A reader reads this file before each poll and takes the address from `url`. It does not assume the
  port.
- `pid` is the service process. A reader that finds no file, or a file whose `pid` is dead, treats the
  service as absent: a crash leaves the file behind.
- The file is written only after the port is bound, whole and by rename, as one line. Every 30 seconds
  the service rewrites it if it is missing or its content is not the service's own, so it survives
  somebody deleting `~/.pir`.
- On `SIGTERM` or `SIGINT` the service removes the file if its `pid` is its own, closes every
  connection and exits 0.

### `GET {url}/v1/usage`

Answers 200:

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

- `observed_at` is milliseconds since the epoch at which a pir session received the numbers, not when
  the request was answered. A reader that also has readings of its own can keep the newer one.
- `rate_limits` has the shape of Claude Code's statusline `rate_limits`. `used_percentage` is 0 to
  100 with at most two decimals; `resets_at` is epoch seconds.
- Either window may be `null`.
- A reading is served as it was heard however old it is, also when a `resets_at` has passed. The
  reader decides what a stale reading means.

When nothing is known the answer is still 200:

```json
{ "version": 1, "observed_at": null, "rate_limits": null }
```

That is the answer when no run has reported yet, and when `usage.json` is missing, unreadable, not
valid, or stamped more than 60 seconds ahead of the service's clock. It is never a 404 or a 500, so a
reader can tell a service that is up with nothing to report from no service.

### `GET {url}/health`

Answers 200, `pid` being the answering process:

```json
{ "version": 1, "status": "ok", "pid": 4711 }
```

It reads no file, so it answers whatever state `usage.json` is in. This is the endpoint that says
whether the service is up; `pir service` decides `running` from it alone.

### Every other request

Checked in this order:

| Case | Status | Body |
|---|---|---|
| A path other than `/v1/usage` and `/health`, any method | 404 | `{"version":1,"error":"not_found"}` |
| One of the two paths, any method but `GET` | 405, with `Allow: GET` | `{"version":1,"error":"method_not_allowed"}` |
| The endpoint failed | 500 | `{"version":1,"error":"internal"}` |

- The path is matched exactly. A query string is ignored; `/v1/usage/` and `/health/` are unknown
  paths.
- The path is checked before the method, so `POST /nope` is a 404 with no `Allow`.
- `HEAD` and `OPTIONS` are a 405 like any other method. No preflight is answered. (A `HEAD` answer
  carries the 405 and its headers and, as HTTP requires, no body.)
- A request body is never read.

### Headers, and who may read

Every response, the errors included, carries `Content-Type: application/json`, `Cache-Control:
no-store`, `X-Content-Type-Options: nosniff` and a `Content-Length`. No response carries an
`Access-Control-*` header.

The service binds `127.0.0.1` only, never a routable address, and has no authentication: any program
running on the machine can read it. The `Host` header is not checked. There is no rule for or against
browsers: with no CORS grant, a browser's own default keeps an ordinary web page from reading the
answer, and that is the whole of the protection (see Known limitations).

## The port

The port is fixed: **47717**. It is below macOS's range for outgoing connections (49152 and up), so
the system never hands it to another program by chance. The fixed port is also what keeps a second
copy of the service from running: it cannot bind.

When another program holds the port, the service exits with code 47, prints nothing and writes no
`api.json`. launchd starts it again every 10 seconds (its default, left alone), so the service comes up
once the port is free. `pir service` names the cause (below). The code is 47 and not the conventional
78 because launchd itself reports 78 when it cannot start a program at all, and the two must be told
apart.

On a scratch home (below) the port is chosen by the system and is found only through that home's
`api.json`.

## Where a reading comes from

Claude sends every session on a claude.ai subscription a `rate_limit_event` message from time to time.
pir reads one field of it, `rate_limit_info.unifiedWindows` (other fields left out here):

```json
{
  "type": "rate_limit_event",
  "rate_limit_info": {
    "unifiedWindows": {
      "five_hour": { "utilization": 0.97, "resetsAt": 1790673000 },
      "seven_day": { "utilization": 0.77, "resetsAt": 1790830800 }
    }
  }
}
```

- A window counts when `utilization` is a finite number of 0 or more and `resetsAt` a finite number
  above 0. A window that does not count, or is absent, is `null`. Other keys are ignored.
- An event with no `unifiedWindows`, or with no window that counts, yields no reading and the previous
  one stands. The event's older single-window fields are not used as a fallback: a one-window reading
  would replace a two-window one and blank the other window for the reader.
- `used_percentage` is `utilization` capped at 1, times 100, rounded to two decimals. Being over the
  limit reads as 100.

### The hand-off — `usage.json`

The run saves each reading to `~/.pir/usage.json`, whole and by rename, as one line:

```json
{
  "version": 1,
  "observed_at": 1790669288699,
  "five_hour": { "utilization": 0.97, "resets_at": 1790673000 },
  "seven_day": { "utilization": 0.77, "resets_at": 1790830800 }
}
```

- `observed_at` is the `t` of the conversation-log entry that carried the event, so the API's value
  can be matched against the run's conversation log exactly.
- Every event with a reading is written, also when the numbers did not change, so `observed_at` moves
  as a run works.
- Several run processes write the same file. Each write is whole, so the last writer wins, and the
  last writer is the newest reading.
- The write never fails the run: a missing `~/.pir` is created, and any other failure is swallowed and
  the previous file stands.
- The reading is a file, so it survives a restart of the service and a reboot.

On each request the service stats the file and re-reads it only when its size, modification time or
inode changed. It accepts version 1, an `observed_at` that is a finite number above 0 and at most 60
seconds ahead of its own clock, both windows present and each `null` or valid, and at least one window
valid. Anything else reads as no reading.

## Who reports, and who does not

Every session pir holds is started through one function (`startWorker` in
`src/shell/worker-proc.mjs`), and the writer is wired in there. So these report, with nothing else
knowing about it:

- a build's workers, implementers and reviewers alike, and the worker sent in at the end of a run;
- the coordinator agent;
- the planner and the plan reviewer of `pir plan`.

The writer is on only in a process started by `pir` (`pir start`, `pir plan`, a resume from the
dashboard), which sets `PIR_RUN=1` on it. These do not report:

- an ordinary Claude Code session, `/pir-work` included: pir does not hold it;
- a coordinator started by hand with `node src/shell/coordinate.mjs`;
- a run started before the engine with this feature was installed, until it is stopped and started
  again;
- any process whose home is the real one while it runs under `node --test` (below).

## The login item

The service is a launchd agent of the logged-in user, label `com.pir.api-service`, described by
`~/Library/LaunchAgents/com.pir.api-service.plist`. The plist holds:

| Key | Value |
|---|---|
| `ProgramArguments` | the absolute path of `node`, then `~/.claude/pir-engine/src/shell/api-service.mjs` |
| `RunAtLoad` | true: started when registered and at every login |
| `KeepAlive` | true: started again whenever it exits |
| `ProcessType` | `Background` |

- The `node` path is what `command -v node` resolves when the plist is written, not the file behind a
  symlink: launchd's own `PATH` has no Homebrew folder, and Homebrew's real path changes with every
  upgrade. With no `node` on the `PATH`, the `node` running the command is used.
- The script is always the installed engine's. Registering from a checkout or a worktree is refused,
  because that path would later be deleted.
- There is no log file. The service prints nothing when healthy, and a failure is read from launchd's
  last exit code.
- The service program and everything it imports use Node's built-ins and pir's own files only, no npm
  package, so it starts even when an install's `npm ci` failed.

### What `./install.sh` does

After the engine and the `pir` command are in place, every form of the installer runs the installed
engine's `service-ctl.mjs refresh` and prints what it answers:

- It writes the plist afresh, stops the service if it is registered, registers and starts it, waits up
  to 5 seconds for it to answer, and prints the `pir service` text. So every install restarts the
  service onto the code just installed, and picks up a `node` that moved.
- If the service was turned off with `pir service off`, it changes nothing and prints:

```text
the API service is off (pir service on turns it on)
```

- On a home that is not the account's real one (a drill's `HOME=/tmp/… ./install.sh`), it changes
  nothing and prints:

```text
skipped the API service (not the real home)
```

- On a system other than macOS it changes nothing and prints the `needs macOS` line below.
- When the step ends without the service answering, the installer adds `could not start the API
  service (see: pir service)` and carries on. The install never fails because of the service.

## `pir service`, `on`, `off`

### `pir service`

Prints the state and exits 0 only when the service answers `GET /health` with a version-1 body; every
other state exits 1. It checks in this order: the system, the off marker, whether launchd has the
label registered, then the service's own answer (each request bounded at 2 seconds).

Running, with a reading:

```text
pir service: running at http://127.0.0.1:47717 (pid 4711)
last usage reading 2 min ago: 5-hour 97%, weekly 77%
```

The second line comes from `GET /v1/usage`. The age reads `just now` under a minute, then `12 min
ago`, `3 h ago`, `1 day ago`, `4 days ago`. A percentage is rounded to a whole number. A window that
is `null` reads `5-hour unknown` or `weekly unknown`.

Running, with nothing to report, or when the usage request failed:

```text
pir service: running at http://127.0.0.1:47717 (pid 4711)
no usage reading yet: it arrives with the first pir run on a Claude subscription
```

Turned off (the marker exists):

```text
pir service: off
turn it on with: pir service on
```

launchd has no such label registered:

```text
pir service: not installed
run ./install.sh, or: pir service on
```

Something that is not the service answered on the port, or nothing answered and launchd's last exit
code for the service is 47:

```text
pir service: not answering: port 47717 is held by another program
it retries every 10 seconds and comes up once the port is free
```

Registered, nothing answered, and launchd has a last exit code. 78 is launchd's own code for a program
it could not start, which is what a moved or removed `node` looks like:

```text
pir service: registered but not answering (last exit code 78)
try: pir service off, then pir service on
```

Registered, nothing answered, and launchd has no exit code (the service never exited):

```text
pir service: registered but not answering
try: pir service off, then pir service on
```

On a system other than macOS, from every form of the command:

```text
pir service needs macOS (launchd)
```

### `pir service on`

Removes the off marker, writes the plist, stops the service if it is registered, registers and starts
it, waits up to 5 seconds for an answer, and prints the `pir service` text with its exit code.

Registering right after stopping can be refused while launchd is still tearing the old instance down,
so it is tried up to 10 times, 300 ms apart. If every try fails it prints the first line of what
`launchctl` said and exits 1:

```text
pir service: macOS would not register it: Bootstrap failed: 5: Input/output error
try: pir service off, then pir service on
```

Run from a copy of the engine that is not the installed one, `on` (and the installer's step) changes
nothing, exits 1 and prints:

```text
pir service: run the installed pir (./install.sh first)
```

### `pir service off`

Stops and unregisters the service, removes the plist, removes an `api.json` left by a dead process,
and leaves the empty marker `~/.pir/api-service.off`. It exits 0 and prints:

```text
pir service: off
```

While the marker exists, `./install.sh` leaves the service off, and `pir service` reads `off`. Only
`pir service on` removes it. `off` works from any copy of the engine.

### Other outcomes

- `pir service` with any other word, or more than one, prints the usage and exits 2.
- When `on` or `off` cannot write a file (an unwritable `~/Library/LaunchAgents`, say), it prints `pir
  service:` and the system's message on the error stream and exits 1.
- To remove the feature from a machine: `pir service off`. `usage.json` and `api.json` may be deleted
  at any time; the next reading and the next start of the service write them again.

## Scratch homes and tests

Three things could touch the real machine: the usage file, the port and the login item. One rule
(`homeKind` in `src/core/api.mjs`) decides all three from the environment. The home is `PIR_HOME` if
set, else `HOME`; the account's real home comes from the system's user database, not from `HOME`.

| Kind | When | Usage file | Port | Login item |
|---|---|---|---|---|
| `real` | the home is the account's home, and `NODE_TEST_CONTEXT` is unset | written | 47717 | allowed |
| `scratch` | the home is any other folder | written, in that folder | chosen by the system | refused |
| `test-real` | the home is the account's home and `NODE_TEST_CONTEXT` is set, or no home is set at all | not written | the service refuses to start | refused |

`node --test` sets `NODE_TEST_CONTEXT` in each test process and child processes inherit it, so a test
that forgot to set a scratch home writes nothing and binds nothing.

On a scratch home `on`, `off` and the installer's step print the `skipped` line above, exit 0 and
never call `launchctl`. The bare `pir service` asks the service named in that home's `api.json`, if
there is one.

No test in the suite writes the real `~/.pir/usage.json`, binds port 47717, runs the real `launchctl`
or registers a login item: tests use a temp folder as the home, a port chosen by the system and an
injected `launchctl`.

## What has been checked on a real machine

Both checks below were run by a build worker on 2026-09-30 (macOS 26.5.1, Node v24.2.0, Claude Code
2.1.285, SDK 0.3.282, a claude.ai `max` subscription), not by a person, and both on a scratch home.

- **launchd runs and restarts the service** (`node src/shell/harness/service-live-check.mjs`, exit 0).
  Under a temporary label, `com.pir.api-service.check`, with its plist in a temp folder: registered
  and answering in 0.2 s; killed with `kill -9` after 11 s up, back in 0.1 s; killed again at once,
  back in 10.1 s; a refresh restarted it in 0.2 s; `off` stopped it in 0.1 s, and launchd no longer
  knew the label afterwards.
- **Real sessions feed the API** (`node src/shell/harness/usage-live-check.mjs --into
  /tmp/usage-live`, exit 0 in 90 s). Four real sessions logged 8 `rate_limit_event`s, all with
  `unifiedWindows`; `observed_at` took 6 distinct values over 18 polls; the last answer of `GET
  /v1/usage` equalled the newest event in the run's conversation logs.

Not yet seen, and waiting for the first install of this feature:

- `./install.sh` registering the real label `com.pir.api-service`, and `pir service` reading `running
  at http://127.0.0.1:47717`.
- The real service on port 47717 serving a real run's numbers.
- The real service coming back after being killed.
- The service being up after logging out and in, with nobody starting it.
- What macOS shows for the login item: whether it puts up a background-item notice, and how it is
  listed under Login Items. The temporary item produced no such entry in the system log, but its plist
  sat outside `~/Library/LaunchAgents`, so that says nothing about the real one.
- A real clash on port 47717, and whether `pir service` names it.

## Known limitations

- **A run on the old engine does not report.** A run started before this was installed keeps the code
  it loaded. It reports once it is stopped and started again.
- **A run not started by `pir` does not report.** Ordinary Claude Code sessions and a coordinator run
  by hand write nothing. With no pir run, the service keeps serving the last reading, however old.
- **No numbers off a claude.ai subscription.** The events were measured on a subscription login only.
  On an API key, Bedrock or Vertex none is expected, and the service then answers nulls for ever.
- **`unifiedWindows` is not in the SDK's documented types.** It was on 389 of 389 events in this
  repo's conversation logs (SDK 0.3.282, Claude Code 2.1.285). If a later Claude drops or renames it,
  readings stop, the last one stands, and nothing says so.
- **macOS only.** There is no Linux or Windows service manager. The run still writes `usage.json`
  there; nothing serves it.
- **A moved `node`.** The plist names the `node` path found when it was written. If that path goes
  away the service cannot start, and `pir service` reads `registered but not answering (last exit code
  78)` until `./install.sh` or `pir service on` rewrites the plist.
- **Any local program can read it, and a DNS-rebinding page is not guarded against.** No
  authentication and no `Host` check. Letting web pages in (a CORS grant) is not done either.
- **The port is not configurable.**
- **Homes are compared as text.** The real home spelled another way (different letter case, a
  trailing `/.`, through a symlink) reads as a scratch home. With `~/.claude` a symlink, `pir service
  on` and the installer's step refuse with `run the installed pir`.
- **"Not installed" means not registered.** A plist that exists while launchd does not have the label
  loaded reads `not installed`; `pir service on` registers it.
- **The service keeps its loaded code.** Replacing the engine does not restart it; the installer's
  last step does. If that step fails, the old code keeps answering until the next `on` or install.
- **A folder named `usage.json`.** Each reading then leaves one `.tmp` file in `~/.pir` and nothing
  removes them.
- **Two events within the same few milliseconds** from different run processes may land in either
  order.
