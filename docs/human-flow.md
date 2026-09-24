# The human decision flow

Parallel mode keeps the classic rule that a person owns every genuine decision. A worker never
guesses an underspecified requirement or a real choice — it escalates. The difference from classic
mode is only where the person answers: not at a `/pir-work` prompt, but directly in the blocked
worker's own session.

## Questions and decisions — the person answers the worker directly

When a worker cannot continue on its own, it pauses its task and does two things, then waits, doing
nothing further:

1. It **drops a one-line report** into the control folder's `reports/` up-channel — a `question`
   (something unspecified) or a `decision` (a genuine choice, either answer defensible). This is a
   plain file drop the command's loop reads directly; no agent is in the path. See
   [control-folder.md](control-folder.md).
2. It **stays parked in its own `claude agents` session**, holding its worktree, waiting for a reply
   in that session.

On its next pass the command uses that report for two things only: it keeps the parked worker's
slot counted under the ceiling (a parked worker is alive, not dead), and it **prints the question in
the live display** so the person can see who is asking and correlate several at once. The command
**routes nothing** — there is no down-channel, no relay, no answer feed. It never sees the answer.

The person **finds the asking worker in their own `claude agents` view, attaches to its session,
and answers there, in plain English**. The worker un-parks itself and continues. Because the person
reads the workers directly, there is no separate human-facing "asks" file: the report signal exists
for the command's slot-keeping and the display, not to relay a question to a person.

One parked worker does not stall the others: every other independent task keeps moving while it
waits, so the person is the bottleneck for that one decision only. A parked worker still holds a
slot under the ceiling, so if several stack up the run correctly throttles down to human speed. The
worker's side of escalating is in `skills/pir-worker`, `pir-implement`, and `pir-review`.

## A task that needs the person's eyes is an ordinary worker that asks

There is no separate hands-on task type and no `pir-verify` path. When a task's real proof is a
person's judgement — a spike, a look at a running thing — the worker handles it the way the classic
flow always did: it builds and prepares up to the point where the only missing thing is the person's
eyes, then asks a specific question through the same escalation path as any other worker (above) — a
running thing and a list of what to look at, with the exact seatbelted command, not "can you check
this." The worker records the answer in `FINDINGS.md` on its task branch under its normal contract.
The bar for "genuinely cannot verify this itself" is written into the `pir-worker` contract, not
carried as a per-task marker.

## Live actions: the bins the plan review granted

A worker that deploys, calls a paid service or changes anything outside the repo follows the bin its
plan's `DESIGN.md §5.3` gives that action. `/pir-review-plan` turned the bins the person approved into
project permission rules in `.claude/settings.json`, which every worktree inherits because the file is
committed. A `worker` action is `allow`ed and runs without stopping. An `ask` action is under an `ask`
rule: the worker drops a `question` report, explains the action in its session and runs the command,
and the platform parks the session on its permission prompt. It shows as needing input in
`claude agents`, and the person attaches and approves or refuses there, so one approval is the whole
exchange. A `person` action is only a login, a device or a judgement, raised like any other question.
An action with no row is treated as `ask`.

## Merge conflicts

There are two places a conflict can arise:

- **At a worker's own integrate.** Before signalling done, a worker merges the current feature
  branch into its task branch. If that conflicts in code, the worker attempts the resolution — it
  holds the task's context. If it cannot resolve cleanly, it escalates a `decision` and waits, as
  above, for the person to attach and decide.
- **At the coordinator's own merge.** A worker's integrate was clean when it signalled done, but
  another task changed the same lines before the command merged this one, so `mergeTask` conflicts.
  The command **keeps that worker alive and parked** — it does not close it, remove its worktree,
  delete its task, or respawn it. Because that worker finished clean and has no idea a clash happened,
  the command **composes a ready-to-paste resolution prompt** and prints it: which worker to attach
  to, the `git merge` that folds the feature branch into the task branch, the conflicting files, and
  the finish steps (commit, the test command — the `test` lines of the plan's `DESIGN.md` setup/test
  block — re-signal done). It leaves the keep-which-side choice a marked
  blank, because that judgement is the person's — it is exactly what made the conflict stop for a
  person. The command **sends nothing**: the person copies the prompt, attaches to that same worker,
  fills in which side to keep, and pastes it. The worker resolves on its branch and re-signals done,
  and only then does the command merge the now-clean branch. The merge and the worker's close are
  paired — a worker is closed only after its branch has actually merged — so a conflict can never
  destroy the worker that must resolve it. The prompt is bulky and must be selectable to copy, so it
  prints on the normal screen above the live display; the in-place frame itself stays a compact line
  naming the parked worker. (On a restart, a finished branch can clash with no live worker to attach
  to; the prompt then names the task branch to check out and land by hand.)

The command never merges a dirty branch into the feature branch. At the end it runs the plan's
declared `setup` then `test` lines on the feature branch first and, if they fail, prints the failure
and does not offer the `git merge` hand-off — it never tells the person a red branch is ready. The
red hand-off says which half failed and how (``test `make test` exited 2``), and names `tests.log`;
the same reason and path show in the live display's footer and in the `pir` viewer's frame of the
finished run, which says the branch is not ready to merge instead of offering `git merge` (see
[run-lifecycle.md](run-lifecycle.md), [detached-runs.md](detached-runs.md)). The person fixes the
feature branch and merges it themselves.

## The test command is the block

In both flows a plan's test command is the `test` lines of the setup/test block its `DESIGN.md` opens
with — not a command named in prose. A worker runs them as its test command, and runs the `setup`
lines first when its tests cannot start because something is not installed. When the plan's setup
failed in a worker's fresh worktree, the worker's opening instruction says which line failed, shows
the last lines of its output and the log path, and the worker gets the worktree ready itself; the
person is not asked about it. See [run-lifecycle.md](run-lifecycle.md).

## The worker ceiling

At most **4 workers run at once** (configurable via `PARALLEL_MAX_WORKERS`; default 4). This is the
one hard cap kept, because the command spawning its own workers is the real runaway vector, and it
also bounds paid agents and merge complexity. `decideDispatch` never spawns past it. Hitting the
ceiling is logged (`ceiling full`) and shown as a queued task waiting for a slot; nothing is dropped.
The command also carries a runaway breaker that aborts and tears the run down if this run's
live-worker count stays over the ceiling.

## Known limitation: a leaked background process outlives its worker

The idle-gate and its `force-idle` timeout (see [control-folder.md](control-folder.md)) only unblock
the command when a finished worker's session stays `busy`. They do **not** clean up a background
process the worker left running. A daemon that double-forks detaches from the session's process
group and reparents to init, so it survives the worker session's SIGTERM entirely (a real run left
`cockpitd` daemons running 8+ hours later as pid-1 orphans). The reliable cleanup is the worker's own
discipline — run test suites in the foreground so their `trap … EXIT` fires, and leave nothing
running before going idle (`pir-worker`). Killing the session cannot undo a leak the worker left
behind. This is worker-side hygiene the code cannot enforce, not a coordinator bug to fix here.
