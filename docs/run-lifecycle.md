# The lifecycle of a run

A run is driven by the coordinator command, `node src/shell/coordinate.mjs {slug}`, foreground,
printing as it goes until the plan is done or the person stops it. Each turn of its loop is one
**pass** (`runPass` in `src/shell/loop.mjs`): it gathers state, asks the pure core what to do
(`decideDispatch` in `src/core/dispatch.mjs`), and executes the result against the real platform
and git. The pass is the internal unit the tests and harness drive; it is not a verb the person
types. The person's job is to answer the workers that ask for a decision; the mechanics below run
without per-task typing.

## Start

1. The person runs the command on a plan (`node src/shell/coordinate.mjs {slug}`). It **refuses a
   plan that is not reviewed** — it reads the `**Plan reviewed:**` line in `PROGRESS.md` and, on
   anything short of a positive verdict, stops and points the person at `/pir-review-plan`
   (`readReviewGate` in `coordinate.mjs`, `parsePlanReviewed` in `progress.mjs`). An unreviewed
   plan copies its defects into every task, and running many at once multiplies that.
2. **The dry-run seatbelt.** Without `PARALLEL_LIVE=1` the command does the safe half only — it
   confirms the gate and prints what it *would* dispatch — then returns, spawning no worker and
   touching no branch. Only with `PARALLEL_LIVE=1` does it open branches and spawn real workers.
   See [restart-recovery.md](restart-recovery.md) and the seatbelts in
   `plans/non-agentic-coordinator/DESIGN.md § 5.2`.
3. **The branch-safety guard.** Before a live run the command refuses to run inside the canonical
   `plan-implement-review` checkout unless `PARALLEL_ALLOW_HERE=1` is set (`canPromoteHere` in
   `coordinate.mjs` — the name is historical; it now guards the feature branch, not a promotion), so
   a live run cannot open and mangle the real repo's branches by accident.
4. On the first pass the command opens the **feature branch** `pir/{plan}` off `main`, in its own
   worktree, and works there — the person's main checkout stays on `main` (`openFeature` in
   `worktree.mjs`). See [branch-model.md](branch-model.md).
5. Still on the first pass, before dispatching, the command **reconciles each task from its own
   task branch** — a restart adopts in-flight work (merges a finished task, reviews a built one,
   rebuilds a half-built one) rather than starting over; a genuine first start finds no task
   branches and reconciles nothing. See [restart-recovery.md](restart-recovery.md).

## Each pass

A pass does, in order:

- **Read the kill switch.** If the `HALT` flag file is present, close every worker of this run and
  do nothing else — no spawn, no merge. See [human-flow.md](human-flow.md).
- **List workers and fold in their reports.** The command lists live sessions
  (`claude agents --json`), keeps only this run's own workers (matched by name), and reads any
  reports workers dropped since the last pass (a worker signalling `implemented`, `done`, a
  `question`, a `decision`, or a merge `conflict`). See [control-folder.md](control-folder.md).
- **Clean up dead workers.** A worker that has vanished from the list past a one-pass grace is
  dead; its session is closed and its worktree and branch removed, so a crashed worker never holds
  a slot forever.
- **Spawn ready tasks.** Every `⬜` task whose dependencies are all `✅` and which no live worker
  holds is a candidate, lowest number first, capped so live-plus-spawned never exceeds the ceiling.
  Every task spawns an autonomous builder (`pir-implement Txx`); there is one kind of worker. See
  [task-state.md](task-state.md).
- **Hand off review.** When a worker reports `implemented` (its task is `🔍` on its branch), the
  command spawns a **fresh** session on the same worktree to review it (`pir-review Txx`) and
  closes the implementer. A task in review holds one slot, not two, and the reviewer has no
  implementer context — that is where fresh-eyes review comes from.
- **Merge one done task.** When a worker reports `done`, the command merges its task branch into the
  feature branch (**one per pass, serialized**), reconciles its row to `✅` on the feature branch,
  and closes the worker. A merge that conflicts instead parks the worker — see
  [human-flow.md](human-flow.md).
- **Complete.** When every task is `✅` and no worker is live, the pass reports a `complete` flag;
  the command runs the test command on the feature branch and reports the result. It never merges
  to `main` — see **End** below.

The idle-gate: a close that follows a worker finishing (a review hand-off, or a merge-and-close)
waits for the agent list to show that worker `idle` before sending SIGTERM, so a final commit is
never cut off mid-turn. That wait is bounded — see [control-folder.md](control-folder.md) and the
known-limitation note in [human-flow.md](human-flow.md) about leaked background processes.

## The live status display

While it runs, the command prints a `docker compose up`-style display that updates in place: one
line per task, a summary line, and a footer. This is the command's status — there is no separate
`status` command. It splits across the pure/shell boundary:

- **The model is pure** (`buildDisplay` in `src/core/display.mjs`): a function of the run state a
  pass produces plus the current time and spinner frame, returning `{branch, summary, rows, footer}`
  as data, with no I/O and no clock. Each row carries a `kind` — `building`, `reviewing`, `merging`,
  `asking` (shown "asking you"), `waiting` (`needs T..`), `queued` (marked when the ceiling is full),
  or `done` (shown "merged"). The summary carries done/total, how many are running, asking, and
  waiting, and the ceiling. This is tested exhaustively.
- **The renderer is shell** (`createRenderer` in `src/shell/render.mjs`): on a TTY it paints the
  model in place with cursor control and ticks a spinner; when stdout is not a TTY — piped,
  redirected, or captured by the test harness — it **degrades to plain append-only lines**, because
  cursor-control escapes garble a non-terminal. The in-place painting is what only a person can
  judge (hand-verified, T09).

The footer names the current asking worker and how to reach it (find it in `claude agents`, attach,
answer there), or, at the end, the green feature branch and the `git merge` hand-off.

## End

A run ends in one of three ways:

- **Handed off** — every task reached `✅`, the feature branch is green, and the command prints the
  branch and the one line `git merge pir/{slug}` for the person to run by hand (`renderHandoff` in
  `coordinate.mjs`). `main` is untouched; merging it is the person's step, not the command's (see
  [branch-model.md](branch-model.md)). A **red** feature branch prints the failure and the branch
  and offers no `git merge` line — the command never tells the person a red branch is ready.
- **Halted** — the `HALT` flag closed every worker; nothing merged, `main` is untouched. To
  continue, the person removes `HALT` and re-runs the command (see
  [restart-recovery.md](restart-recovery.md)).
- **Quiet** — every remaining worker is parked on a person's decision, or there is nothing left to
  dispatch. A parked run waits for the person.

On any exit that is not a clean hand-off or a halt, the command tears down every live worker of the
run, so no session is left running (`teardownRun` in `coordinate.mjs`). Ctrl-C (SIGINT/SIGTERM) runs
the same teardown as an orphan-guard before it exits.
