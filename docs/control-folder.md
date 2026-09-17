# The control folder

A run's per-run control state lives in `plans/{slug}/.parallel/control/`. It is **gitignored**
(`plans/*/.parallel/`), so it is never committed to a task branch and never rides the feature branch
to `main` at promotion — it is transient control state, not part of the plan. The coordinator
creates it (`fileControl` and `createAgentBridge` in `src/shell/coordinate.mjs`).

Workers reach this folder even though they live in separate worktrees, because every worktree
resolves the shared git dir to the one main checkout, so the control folder has a single location
all sessions can address.

## What is in it

| Entry | What it is |
|---|---|
| `HALT` | the kill-switch flag file. Its presence halts the run — see below. |
| `log` | the event log: one ISO-timestamped line per coordinator action. |
| `reports/` | the worker → coordinator up-channel: one JSON file per worker report. |
| `outbox` | the coordinator → worker down-channel: messages the coordinator agent delivers. |
| `answers` | the person's decisions, written by the coordinator skill for the loop to route. |
| `surfaced` | each parked worker's message, rendered in plain English for the skill to relay. |

## On restart, the transient feeds are cleared

The folder is reused across a restart, so before a fresh run writes anything the coordinator runs
`startupControlHygiene` (`coordinate.mjs`), which separates the transient feeds from the durable
records (DESIGN of the restart-resume plan, §2.7):

- **Cleared** — `reports/`, `answers`, `outbox` and `surfaced`. Each is a live-run conversation
  buffer, and a leftover entry from the dead run would route a stale answer to a fresh worker,
  replay a stale down-message, or re-relay a stale surface. The clear runs on every startup, not
  only a detected restart, because a genuine first start has them empty anyway.
- **Preserved — `log`** (the audit trail and the harness signal): never cleared; a `restart` marker
  line is appended to mark the boundary between runs.
- **Preserved — `HALT`** (a deliberate stop): never cleared. A `HALT` present at startup makes the
  coordinator refuse to start, naming the flag and the `rm` that clears it — see the kill switch
  below and [restart-recovery.md](restart-recovery.md).

## Why the two directions differ

Messaging is asymmetric (this was a deliberate change; DESIGN §2.2):

- **Worker → coordinator is a file drop** (`reports/`). The coordinator's decision loop is an
  ordinary Node process with no message inbox, so a worker does not message it — it writes its
  report as a file (`{from, text}` JSON), temp-then-rename so the loop never reads a half-written
  one. The loop drains that directory directly each pass, with no agent turn per report. A report
  that will not parse is dropped, never guessed into a message. This replaced an earlier design that
  parked the coordinator *agent* in the path of every routine report.
- **Coordinator → worker is cross-session messaging** (`SendMessage`), because the receiver is a
  live agent and only an agent can be messaged. A Node process cannot send one, so the loop writes
  the message to `outbox` and the coordinator *skill agent* performs the actual `SendMessage`. The
  only down-send that ever happens is the answer to a parked worker; there is no spawn-time hello. A
  down-send the coordinator cannot deliver (the worker is gone) is retried from the outbox and, if
  the worker is genuinely unreachable, surfaced to the person with a `send-failed` log line — the
  answer that carries a person's decision is never silently dropped.

`answers` and `surfaced` bridge the person's side of the conversation across the same
Node-process/agent boundary: the skill appends a decision to `answers` (to answer, or to defer) and
the loop routes it; the loop appends a parked worker's rendered message to `surfaced` and the skill
relays it in plain English. See [human-flow.md](human-flow.md).

## The log

Every coordinator action appends one line to `log`, tagged by kind: `open-feature`, `spawn`,
`hands-on`, `await-idle`, `force-idle`, `review`, `merge`, `answer`, `send-failed`, `close`,
`halt-close`, `surface`, `promote`, `teardown`, and `ceiling full`. This is the human-readable
record of what a run did, and the durable signal the test harness reads. A `hands-on {task}` line
marks a `you` task spawning a hands-on scribe (the `spawn` line drops the role). A restart adds two
more: a `restart` marker at startup (the boundary between runs) and a `restart-summary` line naming
what reconciliation adopted — see [restart-recovery.md](restart-recovery.md).

## The kill switch

`HALT` is a plain flag file. While it is present, the coordinator dispatches nothing, delivers
nothing, merges nothing, and promotes nothing, and it ends every live worker — SIGTERM to each
worker's pid, because `claude stop` only interrupts. It is hard-stop only; there is no pause or
resume. A HALT-killed worker's session record, worktree, and branch are deliberately **left** for
forensics — removal is reserved for workers that finished normally. `main` is untouched, because
the only merge to `main` is the promotion and a halt stops before it. To continue, the person
removes the flag and restarts the coordinator (see [restart-recovery.md](restart-recovery.md)).

The flag is never cleared automatically, and a restart with it still present does not start: at
startup the coordinator refuses the run, prints the flag path and the `rm` that clears it, and
exits. Auto-clearing would defeat the interlock — a run started past a live `HALT` would blow
straight through the stop.

The idle-gate mentioned in [run-lifecycle.md](run-lifecycle.md) is bounded by
`AWAIT_IDLE_TIMEOUT_MS` (5 minutes, in `loop.mjs`): a finished worker whose session stays `busy`
long past its `implemented`/`done` report is almost always a leftover background process, so past
the cap the loop stops trusting the busy flag, forces the hand-off or merge, and logs `force-idle`.
This only unblocks the coordinator; it does not reliably kill a detached background process the
worker left running — see the Known limitation in [human-flow.md](human-flow.md).
