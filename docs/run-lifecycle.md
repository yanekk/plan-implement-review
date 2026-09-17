# The lifecycle of a run

A run is driven by the coordinator (`skills/pir-coordinate`), which steps a loop. Each turn of
that loop is one **pass** (`runPass` in `src/shell/loop.mjs`): it gathers state, asks the pure
core what to do (`decideDispatch` in `src/core/dispatch.mjs`), and executes the result against the
real platform and git. The person's job is to answer the decisions the coordinator surfaces; the
mechanics below run without per-task typing.

## Start

1. The person starts a coordinator on a plan (`/pir-coordinate {slug}`). The coordinator **refuses
   a plan that is not reviewed** — it reads the `**Plan reviewed:**` line in `PROGRESS.md` and, on
   anything short of a positive verdict, stops and points the person at `/pir-review-plan`
   (`readReviewGate` in `coordinate.mjs`, `parsePlanReviewed` in `progress.mjs`). An unreviewed
   plan copies its defects into every task, and running many at once multiplies that.
2. On the first pass the coordinator opens the **feature branch** `pir/{plan}` off `main`, in its
   own worktree, and works there — the person's main checkout stays on `main` (`openFeature` in
   `worktree.mjs`). See [branch-model.md](branch-model.md).

## Each pass

A pass does, in order:

- **Read the kill switch.** If the `HALT` flag is present, close every worker of this run and do
  nothing else — no spawn, no merge, no promote. See [human-flow.md](human-flow.md).
- **List workers and fold in their reports.** The coordinator lists live sessions
  (`claude agents --json`), keeps only this run's own workers (matched by name), and reads any
  reports workers dropped since the last pass (a worker signalling `implemented`, `done`, a
  `question`, a `decision`, or a merge `conflict`). See [control-folder.md](control-folder.md).
- **Clean up dead workers.** A worker that has vanished from the list past a one-pass grace is
  dead; its session is closed and its worktree and branch removed, so a crashed worker never holds
  a slot forever.
- **Spawn ready tasks.** Every `⬜` task whose dependencies are all `✅` and which no live worker
  holds is a candidate, lowest number first, capped so live-plus-spawned never exceeds the ceiling.
  An `auto` task spawns an autonomous builder (`pir-implement Txx`); a `you` task spawns a hands-on
  worker (`pir-verify Txx`). See [task-state.md](task-state.md) and [human-flow.md](human-flow.md).
- **Hand off review.** When a worker reports `implemented` (its task is `🔍` on its branch), the
  coordinator spawns a **fresh** session on the same worktree to review it (`pir-review Txx`) and
  closes the implementer. A task in review holds one slot, not two, and the reviewer has no
  implementer context — that is where fresh-eyes review comes from.
- **Merge one done task.** When a worker reports `done`, the coordinator merges its task branch
  into the feature branch (**one per pass, serialized**), reconciles its row to `✅` on the feature
  branch, and closes the worker. A merge that conflicts instead parks the worker — see
  [human-flow.md](human-flow.md).
- **Promote.** When every task is `✅` and no worker is live, the coordinator runs the test command
  on the feature branch and, if it passes, merges the feature branch into `main` — the one and only
  merge to `main`. A red feature branch is surfaced to the person, not promoted.

The idle-gate: a close that follows a worker finishing (a review hand-off, or a merge-and-close)
waits for the agent list to show that worker `idle` before sending SIGTERM, so a final commit is
never cut off mid-turn. That wait is bounded — see [control-folder.md](control-folder.md) and the
known-limitation note in [human-flow.md](human-flow.md) about leaked background processes.

## End

A run ends in one of three ways:

- **Promoted** — the whole plan reached `main` in one merge. The run is complete.
- **Halted** — the kill switch closed every worker; nothing was promoted, `main` is untouched. To
  continue, the person removes `HALT` and restarts the coordinator (see
  [restart-recovery.md](restart-recovery.md)).
- **Quiet** — every remaining worker is parked on a person's decision, or there is nothing left to
  dispatch or promote. A parked run waits for the person; a genuinely finished-but-unpromotable run
  (for example everything deferred) is torn down so no paid worker is orphaned.

On any exit that is not a clean promotion or a halt, the coordinator tears down every live worker
of the run, so no session is left running (`teardownRun` in `coordinate.mjs`).
