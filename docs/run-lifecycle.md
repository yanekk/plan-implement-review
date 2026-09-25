# The lifecycle of a run

A run is driven by the coordinator command — a person launches it with `pir {slug}` (detached; see
[detached-runs.md](detached-runs.md)) or the deprecated `pir-coordinate {slug}` (foreground, printing
as it goes); underneath either runs `node src/shell/coordinate.mjs {slug}`, until the plan is done or
the person stops it. Each turn of its loop is one
**pass** (`runPass` in `src/shell/loop.mjs`): it gathers state, asks the pure core what to do
(`decideDispatch` in `src/core/dispatch.mjs`), and executes the result against the real platform
and git. The pass is the internal unit the tests and harness drive; it is not a verb the person
types. The person's job is to answer the workers that ask for a decision; the mechanics below run
without per-task typing.

## Start

1. The person runs the command on a plan (`pir {slug}`, or the deprecated `pir-coordinate {slug}`). It **refuses a
   plan that is not reviewed** — it reads the `**Plan reviewed:**` line in `PROGRESS.md` and, on
   anything short of a positive verdict, stops and points the person at `/pir-review-plan`
   (`readReviewGate` in `coordinate.mjs`, `parsePlanReviewed` in `progress.mjs`). An unreviewed
   plan copies its defects into every task, and running many at once multiplies that.
2. It then **refuses a plan whose `DESIGN.md` has no valid setup/test block** — the front-matter
   block the file opens with, declaring the plan's `setup` lines and its `test` lines:

   ```
   ---
   setup:
     - cd server && npm ci
   test:
     - make test
   ---
   ```

   `readTestBlockGate` in `coordinate.mjs` reads `plans/{slug}/DESIGN.md` from the main checkout and
   parses it with `parseTestBlock` (`src/core/testblock.mjs`); both keys are required, `setup: none`
   is the explicit empty setup, and `test` needs at least one line. A missing or malformed block
   counts as not reviewed: the command prints the parser's reason (`no front-matter block`, `no test
   key`, …) and points at `/pir-review-plan {slug}`, which writes and verifies the block
   (`testBlockRefusal`). The check runs before anything is spawned or any worktree created, dry run
   included, so a restart — a re-run of the same command — is checked the same way. `pir {slug}`
   refuses the same plan in its pre-flight (see [detached-runs.md](detached-runs.md)), and `pir-work`
   in the classic flow. A plan whose tests the engine cannot run is not ready to be built by it.
3. **The dry-run seatbelt.** Without `PARALLEL_LIVE=1` the command does the safe half only — it
   confirms the gate and prints what it *would* dispatch — then returns, spawning no worker and
   touching no branch. Only with `PARALLEL_LIVE=1` does it open branches and spawn real workers.
   See [restart-recovery.md](restart-recovery.md) and the seatbelts in
   `plans/non-agentic-coordinator/DESIGN.md § 5.2`.
4. **The branch-safety guard.** Before a live run the command refuses to run inside the canonical
   `plan-implement-review` checkout unless `PARALLEL_ALLOW_HERE=1` is set (`canPromoteHere` in
   `coordinate.mjs` — the name is historical; it now guards the feature branch, not a promotion), so
   a live run cannot open and mangle the real repo's branches by accident.
5. On the first pass the command opens the **feature branch** `pir/{plan}` off `main`, in its own
   worktree, and works there — the person's main checkout stays on `main` (`openFeature` in
   `worktree.mjs`). See [branch-model.md](branch-model.md).
6. Still on the first pass, before dispatching, the command **reconciles each task from its own
   task branch** — a restart adopts in-flight work (merges a finished task, reviews a built one,
   resumes a half-built one on its branch) rather than starting over; a genuine first start finds no task
   branches and reconciles nothing. See [restart-recovery.md](restart-recovery.md).

## Each pass

A pass does, in order:

- **Read the kill switch.** If the `HALT` flag file is present, kill every running worker setup
  (below; logged `setup-kill`), close every worker of this run and do nothing else — no spawn, no
  merge. See [human-flow.md](human-flow.md).
- **List workers and fold in their reports.** The command lists live sessions
  (`claude agents --json`), keeps only this run's own workers (matched by name), and reads any
  reports workers dropped since the last pass (a worker signalling `implemented`, `done`, a
  `question`, a `decision`, or a merge `conflict`). See [control-folder.md](control-folder.md).
- **Clean up dead workers.** A worker that has vanished from the list past a one-pass grace is
  dead; its session is closed and its worktree and branch removed, so a crashed worker never holds
  a slot forever.
- **Spawn ready tasks.** Every `⬜` task whose dependencies are all `✅` and which no live worker
  holds is a candidate, lowest number first, capped so live-plus-spawned never exceeds the ceiling.
  Every task spawns an autonomous builder (`pir-implement Txx`); there is one kind of worker. The
  candidate set is whatever the current feature-branch `PROGRESS.md` holds, so a task a merge adopted
  on an earlier pass — a worker-introduced task (see [task-state.md](task-state.md)) — is a candidate
  here on equal footing with a task the plan started with; nothing in the dispatch brain changed to
  make that work. See [task-state.md](task-state.md).
- **Set up each new worktree before its worker starts.** A task worktree is fresh — nothing the main
  checkout has installed is in it — so before the implementer is spawned the command starts the
  block's `setup` lines in that worktree as a background process (`makePrepare` in `coordinate.mjs`,
  `startLines` in `src/shell/commands.mjs`), records the task in the loop phase `PREPARING`, and logs
  `prepare`. Each line runs in its own `/bin/sh -c` with the worktree root as its working directory,
  stopping at the first failure; output goes to `setup/T{nn}.log` in the control folder, rewritten per
  attempt. The lines run with the same scrubbed environment as the end gate. A later pass sees setup
  has exited and spawns the implementer. Setup runs in the background because a pass is synchronous:
  a blocking `npm ci` would freeze every other worker's merge and the display for its whole length.
  - A preparing task holds a slot under the ceiling (it is about to become a worker) but has no
    session, so it is exempt from the liveness and death checks, and it counts as live work, so the
    run's "nothing left to do" end never fires while setup runs.
  - **Setup failure still spawns the worker** (best effort): its opening instruction carries a note
    naming the failing line and its exit status, the last 20 lines of its output inline, and the log
    path (`formatSetupNote` in `src/core/setupnote.mjs`), and the worker gets its worktree ready
    itself. Nothing is shown on screen for it; the worker handles it and the log has it.
  - `setup: none` skips the phase and spawns in the same pass. The review hand-off reuses the
    implementer's prepared worktree and runs no setup, nor does a reviewer spawned on an adopted
    worktree at restart. A setup that hangs leaves the task `preparing` until HALT or stop; there is
    no time limit.
- **Hand off review.** When a worker reports `implemented` (its task is `🔍` on its branch), the
  command spawns a **fresh** session on the same worktree to review it (`pir-review Txx`) and
  closes the implementer. A task in review holds one slot, not two, and the reviewer has no
  implementer context — that is where fresh-eyes review comes from.
- **Merge one done task.** When a worker reports `done`, the command merges its task branch into the
  feature branch (**one per pass, serialized**), reconciles its row to `✅` on the feature branch,
  and closes the worker. A merge that conflicts instead parks the worker — see
  [human-flow.md](human-flow.md). The merge may also **adopt new task rows** the branch carried — a
  worker-introduced task: each adopted row is appended to the feature `PROGRESS.md` as `⬜` and logged
  with an `adopt` line, and a later pass's spawn step dispatches it (above). A row that cannot be
  adopted — an edit of an existing task, or a dependency on a task that does not exist — is left
  unapplied and recorded as a `bad-plan-change` surface; unlike a `question` or a merge conflict this
  surface parks no one, because the introducing task's own reviewed code merged cleanly and the run
  continues (see [control-folder.md](control-folder.md) for the `adopt` log kind versus the
  `bad-plan-change` surface, and [task-state.md](task-state.md) for the adoption rule).
- **Complete.** When every task is `✅` and no worker is live, the pass reports a `complete` flag;
  the command runs the plan's declared lines on the feature branch and reports the result. It never
  merges to `main` — see **End** below. `runFeatureTests` (`coordinate.mjs`) reads the setup/test
  block from the main checkout's `plans/{slug}/DESIGN.md` — not the feature branch's copy, which may
  predate a review pass that added the block — and runs the `setup` lines, then the `test` lines, in
  the feature worktree, each via `/bin/sh -c`, stopping at the first failure (`runLines` in
  `commands.mjs`). The run's own `PARALLEL_*` and `PIR_RUN` variables are removed from their
  environment. Setup runs first because the feature worktree is fresh too. All output goes to
  `tests.log` in the control folder, one `$ <line>` header per line: setup rewrites the file and the
  tests append, so it reads in run order. No prose is read and nothing is guessed. A red result names
  which half failed and how — ``setup `cd server && npm ci` exited 1`` or ``test `make test` exited
  2`` — and a block that no longer parses (edited mid-run) is red with the parser's reason,
  `plans/{slug}/DESIGN.md: <reason>`, running nothing. The reason and the log path travel with the
  pass result as `testsReason`, onto the display and the status snapshot (below, and
  [detached-runs.md](detached-runs.md)).

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
  as data, with no I/O and no clock. Each row carries a `kind` — `preparing` (the plan's setup is
  running in the task's fresh worktree; no worker yet), `building`, `reviewing`, `merging` (the
  reviewer has reported done; the merge waits for its session to go idle), `asking` (shown "asking
  you"), `waiting` (`needs T..`), `queued` (marked when the ceiling is full), or `done` (shown
  "merged"). The summary carries done/total, how many are running, asking, and
  waiting, and the ceiling. This is tested exhaustively.
- **The renderer is shell** (`createRenderer` in `src/shell/render.mjs`): on a TTY it paints the
  model in place with cursor control and ticks a spinner; when stdout is not a TTY — piped,
  redirected, or captured by the test harness — it **degrades to plain append-only lines**, because
  cursor-control escapes garble a non-terminal. The in-place painting is what only a person can
  judge (hand-verified, T09).
- **Colour is a paint-time layer** (T16): on a colour TTY the renderer tints each line by the
  model's `kind` — active work (preparing, building, reviewing, merging) cyan, a merged task green,
  a **parked `asking` worker amber and bold** so the one thing needing the person stands out, idle tasks
  (`waiting`, `queued`) dim, and a failed or interrupted run red. The summary header stays neutral
  while the run is going and takes a colour only at the end — green when finished, red when Ctrl-C
  interrupts it — so the live status colour otherwise lives on the rows and on the amber-bold
  "asking you" footer pointer. Colour is layered on top of the glyphs, never instead of them, so a
  colour-blind reader loses no information. It is applied after each line is clipped, so it changes
  no widths, and the plain content (`formatLines`) carries no escapes. It is off unless stdout is a
  colour TTY and `NO_COLOR` is unset (any value of `NO_COLOR` disables it); a non-TTY — a pipe or
  the test harness — is never coloured, so that output stays plain, escape-free text.

The footer names the current asking worker and how to reach it (find it in `claude agents`, attach,
answer there), or, at the end, the green feature branch and the `git merge` hand-off. A red end's
footer says the branch is not ready to merge and adds a second line with the gate's reason and the
`tests.log` path (`footerFor` in `display.mjs` carries `testsReason`; `render.mjs` prints it), so the
person watching sees why without opening a log. A `preparing` row is active, with the spinner, so the
screen does not look stalled during an `npm ci`. While the end gate runs, the header reads
`N/N done · running the tests` with the spinner, not the finished `✓`, and the footer reads `all N
task(s) merged · running the plan's setup and tests on pir/{slug} · m:ss`. The gate blocks the
completing pass, so before running it the command paints and snapshots a run state carrying
`testing: { since }` (`testingRunState` in `coordinate.mjs`); a detached `pir` viewer ticks the
spinner and clock from it.

## End

A run ends in one of three ways:

- **Handed off** — every task reached `✅`, the feature branch is green, and the command prints the
  branch and the one line `git merge pir/{slug}` for the person to run by hand (`renderHandoff` in
  `coordinate.mjs`). `main` is untouched; merging it is the person's step, not the command's (see
  [branch-model.md](branch-model.md)). A **red** feature branch prints the failure and the branch
  and offers no `git merge` line — the command never tells the person a red branch is ready. The red
  line names which half failed, the failing line and its exit code (or the parser's reason when the
  block is invalid) and the path to `tests.log`.
- **Halted** — the `HALT` flag closed every worker; nothing merged, `main` is untouched. To
  continue, the person removes `HALT` and re-runs the command (see
  [restart-recovery.md](restart-recovery.md)).
- **Quiet** — every remaining worker is parked on a person's decision, or there is nothing left to
  dispatch. A parked run waits for the person.

On any exit that is not a clean hand-off or a halt, the command tears down every live worker of the
run, so no session is left running (`teardownRun` in `coordinate.mjs`). It also kills any worker
setup still running, because setup lines run detached in their own process group and would otherwise
outlive the command. Ctrl-C (SIGINT/SIGTERM) runs the same teardown as an orphan-guard before it
exits. The teardown closes sessions and setups only: task branches and worktrees are always left for
the next start to reconcile, and a task left with a worktree and no worker gets its setup run again
there (see [restart-recovery.md](restart-recovery.md)). A coordinator killed outright (SIGKILL, a
crash) skips the teardown, so a setup it was running can outlive it.
