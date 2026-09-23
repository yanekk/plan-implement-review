# The control folder

A run's per-run control state lives in `plans/{slug}/.parallel/control/`. It is **gitignored**
(`plans/*/.parallel/`), so it is never committed to a task branch and never rides the feature
branch — it is transient control state, not part of the plan. The command creates it (`fileControl`
and `createReportInbox` in `src/shell/coordinate.mjs`).

Workers reach this folder even though they live in separate worktrees, because every worktree
resolves the shared git dir to the one main checkout, so the control folder has a single location
all sessions can address.

## What is in it

| Entry | What it is |
|---|---|
| `HALT` | the kill-switch flag file. Its presence halts the run — see below. |
| `log` | the event log: one ISO-timestamped line per coordinator action. |
| `reports/` | the worker → coordinator up-channel: one JSON file per worker report. |
| `tests.log` | the output of the feature-branch test command at the end of the run, rewritten each time it runs (see [run-lifecycle.md](run-lifecycle.md)). |

There is no `outbox`, `answers`, or `surfaced`: those were the coordinator↔person↔worker relay of
the old agentic coordinator, and they were removed with the down-channel (DESIGN of
`non-agentic-coordinator`, §2.2). The person answers a blocked worker directly in its `claude
agents` session now — see [human-flow.md](human-flow.md).

## Messaging is one direction only — a file drop up

The command's decision loop is an ordinary Node process with no message inbox, so a worker does not
message it — it writes its report as a file into `reports/` (`{from, text}` JSON, one file per
report, temp-then-rename so the loop never reads a half-written one). The loop drains that directory
directly each pass (`platform.inbox`), with no agent turn per report. A report that will not parse
is dropped, never guessed into a message. The reports it understands are `question`, `decision`,
`implemented`, `done`, and `conflict`.

A worker proposing a new task adds **no** new report kind: it reuses the existing `decision` report
and is approved by the person in its own session (see [task-state.md](task-state.md)). The command
never acts on the proposal report — a new task lands only when its branch merges and the row is
adopted, so the report is just the worker's park signal, exactly as for any other decision.

There is **no coordinator → worker channel at all**. A Node process cannot send a cross-session
message, and nothing needs one: the only down-send the old design ever made was the answer to a
parked worker, and that answer now goes straight from the person to the worker inside the worker's
own session, never through the command. The command routes nothing.

## On restart, the up-channel is cleared

The folder is reused across a restart, so before a fresh run writes anything the command runs
`startupControlHygiene` (`coordinate.mjs`), which separates the transient feed from the durable
records:

- **Cleared — `reports/`.** It is a live-run buffer; a leftover report from the dead run would be
  read as a fresh worker's signal. The clear runs on every startup, not only a detected restart,
  because a genuine first start has it empty anyway. (`reports/` is now the only feed there is to
  clear; the down-channel feeds it used to clear alongside are gone.)
- **Preserved — `log`** (the audit trail and the harness signal): never cleared; a `restart` marker
  line is appended to mark the boundary between runs.
- **Preserved — `HALT`** (a deliberate stop): never cleared. A `HALT` present at startup makes the
  command refuse to start, naming the flag and the `rm` that clears it — see the kill switch below
  and [restart-recovery.md](restart-recovery.md).

## The log

Every coordinator action appends one line to `log`, tagged by kind: `open-feature`, `spawn`,
`await-idle`, `force-idle`, `review`, `rebuild`, `cleanup`, `merge`, `adopt`, `surface`, `close`,
`halt-close`, `teardown`, `ceiling full`, and, on a restart, a `restart` marker and a
`restart-summary` line naming what reconciliation adopted (see [restart-recovery.md](restart-recovery.md)).
An `adopt` line marks the command taking a worker-introduced task's new row onto the feature branch
at merge — one line per adopted task, naming the task (see [task-state.md](task-state.md)).
A `surface` line marks a worker parking on a `question`, a `decision`, or a merge `conflict`, or the
command flagging a red feature branch or a `bad-plan-change`; it records the task, not the kind, so
the harness keys on the task. A `bad-plan-change` surface is the one exception to "surface means a
worker is parked": it flags a new task row that could not be adopted — an edit of an existing task,
or a dependency on a task that does not exist — and it parks no one, because the introducing task's
reviewed code merged and the run continues (see [run-lifecycle.md](run-lifecycle.md)). A `late-block` surface is informational
the same way: an adopted task's `blocks` clause named a task that had already started, so the named
task was built without the new work and the person decides whether it needs redoing (see
[task-state.md](task-state.md)). This is the
human-readable record of what a run did, and the durable signal the test harness reads.

## The kill switch

`HALT` is a plain flag file. While it is present, the command dispatches nothing, delivers nothing,
and merges nothing, and it ends every live worker — SIGTERM to each worker's pid, because `claude
stop` only interrupts. It is hard-stop only; there is no pause or resume. A HALT-killed worker's
session record, worktree, and branch are deliberately **left** for forensics — removal is reserved
for workers that finished normally. `main` is untouched, because nothing in this system ever merges
to `main` (see [branch-model.md](branch-model.md)). To continue, the person removes the flag and
re-runs the command (see [restart-recovery.md](restart-recovery.md)).

The person raises it directly — `touch plans/{slug}/.parallel/control/HALT` — and the command prints
that exact path as the abort when it starts. No session relays it any more; the command's own loop
reads the flag each pass. Ctrl-C (SIGINT/SIGTERM) is a separate thing: it runs the same worker
teardown as an orphan-guard and exits, rather than leaving a run's workers running unattended — it
is not the deliberate stop the `HALT` flag is.

The flag is never cleared automatically, and a restart with it still present does not start: at
startup the command refuses the run, prints the flag path and the `rm` that clears it, and exits.
Auto-clearing would defeat the interlock — a run started past a live `HALT` would blow straight
through the stop.

The idle-gate mentioned in [run-lifecycle.md](run-lifecycle.md) is bounded by
`AWAIT_IDLE_TIMEOUT_MS` (5 minutes, in `loop.mjs`): a finished worker whose session stays `busy`
long past its `implemented`/`done` report is almost always a leftover background process, so past
the cap the loop stops trusting the busy flag, forces the hand-off or merge, and logs `force-idle`.
This only unblocks the command; it does not reliably kill a detached background process the worker
left running — see the Known limitation in [human-flow.md](human-flow.md).
