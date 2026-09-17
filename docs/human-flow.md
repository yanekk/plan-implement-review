# The human decision and hands-on flow

Parallel mode keeps the classic rule that a person owns every genuine decision. A worker never
guesses an underspecified requirement or a real choice — it escalates. The difference from classic
mode is only the routing: a worker escalates to the coordinator, which surfaces it to the person and
routes the answer back down.

## Questions, decisions, and how they route

When a worker cannot continue on its own, it pauses its task and reports the coordinator a
`question` (something unspecified) or a `decision` (a genuine choice, either answer defensible), and
waits, doing nothing further. On its next pass the coordinator:

1. Parks that task (phase `awaiting-answer`) and writes the message to the `surfaced` feed.
2. The coordinator skill relays it to the person **in plain English**, one decision at a time.
3. The person's answer is written to `answers` and the loop routes it straight down to the parked
   worker (addressed by name), which un-parks and resumes.

One parked worker does not stall the others: the coordinator keeps every other independent task
moving while it waits, so the person is the bottleneck for that one decision only. A parked worker
still holds a slot under the ceiling, so if several stack up the run correctly throttles down to
human speed. If the person **defers** instead of answering, the task is marked `⛔` on the feature
branch and its worker closed to free the slot; its dependents wait. Nothing is guessed or lost.

The procedure for surfacing and relaying is in `skills/pir-coordinate`; the worker's side of
escalating is in `skills/pir-worker`, `pir-implement`, and `pir-review`.

## Merge conflicts

There are two places a conflict can arise:

- **At a worker's own integrate.** Before signalling done, a worker merges the current feature
  branch into its task branch. If that conflicts in code, the worker attempts the resolution — it
  holds the task's context. If it cannot resolve cleanly, it escalates a `decision` and waits, as
  above.
- **At the coordinator's own merge.** A worker's integrate was clean when it signalled done, but
  another task changed the same lines before the coordinator merged this one, so `mergeTask`
  conflicts. The coordinator **keeps that worker alive and parked** — it does not close it, remove
  its worktree, delete its task, or respawn it. It surfaces the conflict, routes the person's
  decision down to that same worker, and the worker resolves on its own branch and re-signals done;
  only then does the coordinator merge the now-clean branch. The merge and the worker's close are
  paired — a worker is closed only after its branch has actually merged — so a conflict can never
  destroy the worker that must resolve it.

The coordinator never merges a dirty branch into the feature branch, and never promotes a red
feature branch: at promotion it runs the tests on the feature branch first and, if they fail,
surfaces that to the person rather than merging to `main`.

## The hands-on (`you`) flow

A `you` task's completion is a person's observation, not code. The coordinator still spawns a
worker for it — a **hands-on** one (`pir-verify Txx`) — and points the person at it by name. The
division of labour:

- **The worker owns everything mechanical:** it brings the execution environment up and seeds it,
  runs whatever automated checks a machine can decide, hands the person a running thing to look at,
  and — after the person has judged — tears the environment down and confirms it is down. Guaranteed
  teardown is the seatbelt that makes it safe for a worker to stand a live environment up at all.
- **The person judges only what a person can:** looking at the running thing and saying whether it
  is right. The person does not stand the environment up or down and does not run a check a machine
  could run.
- **The worker is the scribe:** it records the machine result it observed and the person's judgement
  as **two separate confirmations** in `FINDINGS.md` on its task branch, and it never rounds an
  ambiguous reply up — a terse answer to a two-part question is re-asked, not resolved toward the
  bigger claim.

A `you` worker has no fresh-review phase: there is no code for a second session to review. It goes
straight from hands-on to done; the coordinator merges its branch, reconciles the row to `✅` from
the file diff (never the conversation), and the task folds back like any other. A `you` worker
counts against the ceiling and holds its slot while the person works, which throttles the run to
human speed — correct, because a `you` task can sit on the critical path.

**Fold vs split.** When an `auto` task builds something whose real proof needs a person, there are
two planned ways to check it, and both are first-class: **fold** the check into the builder (it
builds, then escalates the exact seatbelted command through the question path and records the
answer — one `auto` row); or **split** it into a separate `you` verify task that depends on the
builder (its own planned unit, folded back without review). Fold keeps a light check inside the
builder; split lifts a heavy or first-class check into its own row. This is a planning choice, made
by `/pir-plan` and `pir-parallelize-plan`.

## The worker ceiling

At most **4 workers run at once** (configurable via `PARALLEL_MAX_WORKERS`; default 4). This is the
one hard cap kept, because the coordinator spawning its own workers is the real runaway vector, and
it also bounds paid agents and merge complexity. `decideDispatch` never spawns past it. Hitting the
ceiling is logged (`ceiling full`) and reported as "throttled, work waiting" — a task simply waits
for a slot; nothing is dropped. The live bin also carries a runaway breaker that aborts and tears
the run down if this run's live-worker count stays over the ceiling.

## Known limitation: a leaked background process outlives its worker

The idle-gate and its `force-idle` timeout (see [control-folder.md](control-folder.md)) only unblock
the coordinator when a finished worker's session stays `busy`. They do **not** clean up a background
process the worker left running. A daemon that double-forks detaches from the session's process
group and reparents to init, so it survives the worker session's SIGTERM entirely (a real run left
`cockpitd` daemons running 8+ hours later as pid-1 orphans). The reliable cleanup is the worker's own
discipline — run test suites in the foreground so their `trap … EXIT` fires, and leave nothing
running before going idle (`pir-worker`). Killing the session cannot undo a leak the worker left
behind. This is worker-side hygiene the code cannot enforce, not a coordinator bug to fix here.
