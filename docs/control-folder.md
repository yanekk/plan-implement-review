# The control folder

A run's per-run control state lives in `plans/{slug}/.parallel/control/`. It is **gitignored**
(`plans/*/.parallel/`), so it is never committed to a task branch and never rides the feature
branch — it is transient control state, not part of the plan. The command creates it (`fileControl`,
`createReportInbox` and `startPersonInbox` in `src/shell/coordinate.mjs` and `person-inbox.mjs`).

Workers reach this folder even though they live in separate worktrees, because every worktree
resolves the shared git dir to the one main checkout, so the control folder has a single location
all sessions can address.

## What is in it

| Entry | What it is |
|---|---|
| `HALT` | the kill-switch flag file. Its presence halts the run — see below. |
| `log` | the event log: one ISO-timestamped line per coordinator action. |
| `reports/` | the worker → coordinator report channel: one JSON file per worker report. |
| `conversations/` | one append-only log per worker, `{Txx}-{role}-{n}.ndjson`: everything the worker said and everything sent to it. The coordinator writes it, the `pir` screen reads it (`worker-proc.mjs`). |
| `inbox/` | the person's input on its way to a worker: one JSON file per message, interrupt or answer, dropped by the `pir` screen and forwarded by the coordinator (`person-inbox.mjs`). |
| `workers.json` | this coordinator's live workers, `[{ id, task, role, pid, startTime }]`, rewritten temp-then-rename on every spawn and exit (`writeWorkersFile` in `worker-proc.mjs`), so a stop or the next start can reap a worker the coordinator left behind (`reap.mjs`). |
| `status.json`, `run.log` | the snapshot and output of a run started by `pir` (see [detached-runs.md](detached-runs.md)). |
| `tests.log` | the output of the end-of-run gate on the feature branch: the plan's `setup` lines, then its `test` lines, each under a `$ <line>` header. Setup rewrites it and the tests append, so it is rewritten each time the gate runs (see [run-lifecycle.md](run-lifecycle.md)). A red end names this path. |
| `setup/T{nn}.log` | the output of the plan's `setup` lines in task T{nn}'s fresh worktree, run before its implementer is spawned; rewritten per attempt. A failed setup's last 20 lines and this path go into the worker's opening instruction (see [run-lifecycle.md](run-lifecycle.md)). |

There is no `outbox`, `answers`, or `surfaced`: those were the coordinator↔person↔worker relay of
the old agentic coordinator, removed with it (DESIGN of `non-agentic-coordinator`, §2.2). The line
down that replaced them is direct and passes through no model (below).

## Reports go up as files

The command's decision loop is an ordinary Node process with no message inbox, so a worker does not
message it — it writes its report as a file into `reports/` (`{from, text}` JSON, one file per
report, temp-then-rename so the loop never reads a half-written one). The loop drains that directory
directly each pass (`platform.inbox`), with no agent turn per report. A report that will not parse
is dropped, never guessed into a message. The reports it understands are `question`, `decision`,
`implemented`, `done`, and `conflict`. The report is what moves a task between phases and keeps a
parked worker's slot; it stays even though the command can now read the worker's conversation.

A worker proposing a new task adds **no** new report kind: it reuses the existing `decision` report
and is approved by the person in its own conversation (see [task-state.md](task-state.md)). The
command never acts on the proposal report — a new task lands only when its branch merges and the row
is adopted, so the report is just the worker's park signal, exactly as for any other decision.

## The line down

Every worker is a child process the command holds a live line to (`platform.mjs`,
`worker-proc.mjs`), so the command **does** send to workers. The old rule that "the coordinator routes
nothing to a worker" (`non-agentic-coordinator` §2.2) is withdrawn on purpose (`live-workers` §1,
user 2026-09-24): it existed because the old relay went through an agentic coordinator and lost
messages, and this line goes through no model and records everything it carries.

What travels down, all of it appended to the worker's conversation log with who sent it:

- **From the command itself, two things only:** the opening instruction (`pir-implement Txx`,
  `pir-review Txx`), sent as the worker's first message, and the merge-conflict fix (see
  [human-flow.md](human-flow.md)).
- **From the person, through `inbox/`:** a typed message, an interrupt, an answer to a permission
  request, and the answers to a question set. The `pir` screen writes one file per input into
  `inbox/`, temp-then-rename (`dropPersonInput`), and only while the run is `running` as the
  dashboard's `classifyRun` decides it; otherwise nothing is written and the view says the run is not
  running. The command watches the folder and forwards each drop the moment it lands, outside the
  5 s pass, with a drain at each pass as a backstop (`startPersonInbox`). A drop for a worker that is
  gone, or answering a request that is no longer pending, is logged as an `undelivered` note in that
  worker's conversation, so a lost answer is never silent. Every drop also gets a line in `log`.

## The conversation log

`conversations/{Txx}-{role}-{n}.ndjson`, `role` `implement` or `review`, `n` counting that task and
role's workers from 1. One JSON object per line, written by the coordinator alone, one `write` per
line (`worker-proc.mjs`):

- `dir: "in"` — an SDK message exactly as the worker's stream yielded it.
- `dir: "request"` — a permission request or question set the worker is waiting on (one `canUseTool`
  call): its `requestId`, tool, input, Claude's suggested rule and flags.
- `dir: "out"` — something sent to the worker, `from` `pir` or `person`: a message, an interrupt,
  or a reply to a request.
- `dir: "note"` — what pir observed: `delivered-by-grant`, `undelivered`, `exited` (with exit code and
  signal), `sdk-error`.

The `pir` screen reads the last 256 KB and follows appends (`log-follow.mjs`); a line that does not
parse (a crash mid-append) is shown raw and never stops the reader. A worker's state — busy, idle,
waiting on a permission, waiting on a question set — is derived from this log (`workerActivity` in
`src/core/stream.mjs`). The logs are kept across a restart, and a new worker for the same task gets
the next `n`; removing the run from the dashboard deletes the folder (`removeRun`).

## On restart, the up-channel is cleared

The folder is reused across a restart, so before a fresh run writes anything the command runs
`startupControlHygiene` (`coordinate.mjs`), which separates the transient feed from the durable
records:

- **Reaped first — `workers.json`.** Any worker a previous coordinator recorded that is still alive
  with its recorded start time is ended (SIGTERM, then SIGKILL after 3 s) before anything else runs
  (`reapRecorded` in `reap.mjs`). A different start time is a reused pid and is left alone.
- **Cleared — `reports/` and `inbox/`.** Both are live-run buffers: a leftover report from the dead
  run would be read as a fresh worker's signal, and a leftover input addressed to a previous run's
  worker must never reach a new one. The clear runs on every startup, not only a detected restart,
  because a genuine first start has them empty anyway.
- **Preserved — `conversations/`**: the previous workers' conversations stay readable.
- **Preserved — `log`** (the audit trail and the harness signal): never cleared; a `restart` marker
  line is appended to mark the boundary between runs.
- **Preserved — `HALT`** (a deliberate stop): never cleared. A `HALT` present at startup makes the
  command refuse to start, naming the flag and the `rm` that clears it — see the kill switch below
  and [restart-recovery.md](restart-recovery.md).

## The log

Every coordinator action appends one line to `log`, tagged by kind: `open-feature`, `prepare`,
`spawn`, `await-idle`, `force-idle`, `review`, `resume`, `cleanup`, `merge`, `adopt`, `surface`,
`close`, `setup-kill`, `halt-close`, `teardown`, `ceiling full`, and, on a restart, a `restart` marker and a
`restart-summary` line naming what reconciliation adopted (see [restart-recovery.md](restart-recovery.md)).
An `adopt` line marks the command taking a worker-introduced task's new row onto the feature branch
at merge — one line per adopted task, naming the task (see [task-state.md](task-state.md)).
A `prepare` line marks a task's setup starting in its fresh worktree; `spawn` follows once it has
exited. A `setup-kill` line marks the kill switch ending a running setup, and a `teardown: killed
setup for T{nn}` line the same on any other exit (see [run-lifecycle.md](run-lifecycle.md)).
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
and merges nothing, and it closes every live worker — ends its input queue, then SIGTERM after 5 s and
SIGKILL after 10 s if it has not exited (`platform.close`, `worker-proc.mjs`) — and kills every worker
setup still running. It is hard-stop only; there is no pause or resume. A HALT-closed worker's
conversation log, worktree, and branch are deliberately **left** for forensics — removal is reserved for workers that finished normally. `main` is untouched, because nothing in this system ever merges
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
`AWAIT_IDLE_TIMEOUT_MS` (5 minutes, in `loop.mjs`): a finished worker whose conversation still reads
`busy` (a turn open with no `result`; `workerActivity` in `stream.mjs`)
long past its `implemented`/`done` report is almost always a leftover background process, so past
the cap the loop stops trusting the busy flag, forces the hand-off or merge, and logs `force-idle`.
This only unblocks the command; it does not reliably kill a detached background process the worker
left running — see the Known limitation in [human-flow.md](human-flow.md).
