# The lifecycle of a run

A run is driven by the coordinator command — a person launches it with `pir start {slug}` (detached; see
[detached-runs.md](detached-runs.md)), which runs `node src/shell/coordinate.mjs {slug}` until the
plan is done or the person stops it. (The foreground launcher `pir-coordinate` was removed in
`plans/live-workers` §2.13; the tests and the harness still run `coordinate.mjs` directly.) Each turn of its loop is one
**pass** (`runPass` in `src/shell/loop.mjs`): it gathers state, asks the pure core what to do
(`decideDispatch` in `src/core/dispatch.mjs`), and executes the result against the real platform
and git. The pass is the internal unit the tests and harness drive; it is not a verb the person
types. The person's job is to answer the workers that ask for a decision; the mechanics below run
without per-task typing.

## Start

1. The person runs the command on a plan (`pir start {slug}`, or the go at the end of a `pir plan`
   run — [planning-runs.md](planning-runs.md)). It **refuses a
   plan that is not reviewed** — it reads the `**Plan reviewed:**` line in `PROGRESS.md` and, on
   anything short of a positive verdict, stops and points the person at `/pir-review-plan`
   (`readReviewGate` in `coordinate.mjs`, `parsePlanReviewed` in `progress.mjs`). An unreviewed
   plan copies its defects into every task, and running many at once multiplies that.

   **Where the plan is read from.** Every read of the plan's `PROGRESS.md` and `DESIGN.md` in the
   pre-flight, the worker setup and the end gate goes through `planHome(slug)`
   (`src/shell/plan-home.mjs`): the main checkout's working tree if `plans/{slug}/PROGRESS.md` exists
   there — the hand-made plan, read exactly as before — else the **committed** tree of branch
   `pir/{slug}`, read with `git show`, which is where `pir plan` leaves a reviewed plan until the person
   merges it. The branch is read committed, not from its worktree, because a worktree may hold
   uncommitted edits no build would see. The main checkout comes first so a narrow re-review committed
   there while its build runs is still what the build reads. Dispatch reads `PROGRESS.md` from the feature
   worktree, as always.
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

   `readTestBlockGate` in `coordinate.mjs` reads `plans/{slug}/DESIGN.md` from the plan's home and
   parses it with `parseTestBlock` (`src/core/testblock.mjs`); both keys are required, `setup: none`
   is the explicit empty setup, and `test` needs at least one line. A missing or malformed block
   counts as not reviewed: the command prints the parser's reason (`no front-matter block`, `no test
   key`, …) and points at `/pir-review-plan {slug}`, which writes and verifies the block
   (`testBlockRefusal`). The check runs before anything is spawned or any worktree created, dry run
   included, so a restart — a re-run of the same command — is checked the same way. `pir start {slug}`
   refuses the same plan in its pre-flight (see [detached-runs.md](detached-runs.md)), and `pir-work`
   in the classic flow. A plan whose tests the engine cannot run is not ready to be built by it.
3. **The dry-run seatbelt.** Without `PARALLEL_LIVE=1` the command does the safe half only — it
   confirms the gate and prints what it *would* dispatch — then returns, spawning no worker and
   touching no branch. Only with `PARALLEL_LIVE=1` does it open branches and spawn real workers.
   `pir` always sets it, so a dry run is only reachable by running `coordinate.mjs` by hand.
   See [restart-recovery.md](restart-recovery.md) and the seatbelts in
   `plans/non-agentic-coordinator/DESIGN.md § 5.2`.
4. On the first pass the command opens the **feature branch** `pir/{plan}` off the run's **base
   branch**, in its own worktree, and works there (a plan made by `pir plan` already has that branch and
   worktree, and the command reuses them) — the person's main checkout stays on whatever branch they
   left it (`openFeature` in `worktree.mjs`). The base is settled before the command starts: `pir start`
   reads it from the branch's recorded `pirBase` when `pir/{slug}` exists, and otherwise resolves the
   repo's settings, fetches and prepares the base, cuts `pir/{slug}` from it and records `pirBase`, then
   passes `--base <name> --base-sha <sha>` to the command. A command started by hand without them
   resolves them the same way itself (`resolveRunBase` in `base-branch.mjs`). A missing local base is
   created from the remote's copy, never at HEAD. See [branch-model.md](branch-model.md). On the same pass, unless the run was
   started with `--no-coordinator`, it starts the run's **coordinator agent** in the feature worktree
   (see [coordinator-agent.md](coordinator-agent.md)).
5. Still on the first pass, before dispatching, the command **reconciles each task from its own
   task branch** — a restart adopts in-flight work (merges a finished task, reviews a built one,
   resumes a half-built one on its branch) rather than starting over; a genuine first start finds no task
   branches and reconciles nothing. See [restart-recovery.md](restart-recovery.md).

There is no repo-name check: a live build runs in any checkout, the `plan-implement-review` one
included, with no environment flag. The old canonical-repo guard (`canPromoteHere`,
`PARALLEL_ALLOW_HERE`) is gone. Only the harness's live scenario launcher
(`src/shell/harness/run.mjs`) still refuses to run a paid scenario from a checkout named
`plan-implement-review`, and `--into <dir>` is its only override.

## Between passes

The loop runs a pass as soon as something happens that the pass would act on or show, and otherwise
sleeps on a 5 s backstop timer (`PARALLEL_POLL_MS`). What wakes it (one waker, `createWaker` in
`src/shell/drop-folder.mjs`): a file in `reports/` or `inbox/`; any entry in a worker's conversation log
except a `note` (a permission request or question set, output, a turn ending; `wakesLoop` in
`src/core/stream.mjs`); a worker exiting; the coordinator agent's own log entries, its exit and a decision
file landing in `coordinator/decisions/`; the person's input being forwarded; and a worker setup
finishing. The loop also wakes itself after a pass that made progress (it spawned, handed to review,
merged or closed a worker, or moved the end of the run a step; `passProgressed` in `coordinate.mjs`), since
the pass after it often has work that nothing else would wake it for. A quiet pass does not, so an idle run
still sleeps on the backstop. A wake that arrives while a pass is running makes the next wait return at once, so none is
lost. Passes start at least 250 ms apart (`PASS_MIN_GAP_MS`); wakes inside that gap are served by the one
pass at its end. The timer is only a backstop for a missed filesystem event: correctness never depends
on a wake. The two pass-counted graces keep their wall-clock meaning: the run ends as stalled only after
three quiet passes spanning 3 × `PARALLEL_POLL_MS`, and the runaway breaker tolerates one worker over the
ceiling for three passes and 3 × `PARALLEL_POLL_MS` (`stallVerdict`, `runawayVerdict` in `coordinate.mjs`).

## Each pass

A pass does, in order:

- **Read the kill switch.** If the `HALT` flag file is present, kill every running worker setup
  (below; logged `setup-kill`), close every worker of this run and do nothing else — no spawn, no
  merge. See [human-flow.md](human-flow.md).
- **List workers and fold in their reports.** The command lists its live workers — its own child
  processes, held by `platform.mjs`; `claude agents` is not consulted — and reads any reports workers
  dropped since the last pass (a worker signalling `implemented`, `done`, a `question`, a `decision`,
  or a merge `conflict`). See [control-folder.md](control-folder.md). Each listed worker carries its
  activity, derived from its conversation log (`workerActivity` in `src/core/stream.mjs`): `busy` (a
  turn is open), `idle` (the last turn ended and nothing is pending), `permission` or `questions` (a
  permission request or a question set waits on the person). Only `busy` holds up a close. A task
  parked on a question or decision report returns to its role's phase once the person answers: a turn
  opened by a message from the person (typed in `pir` or over Remote Control), person input landing
  in an open turn, or a request answered with the turn still open. A background job's wake-up or a
  message pir sent is not an answer and leaves the task parked (`resumeAnswered`, see
  [human-flow.md](human-flow.md#what-un-parks-a-report-park)).
- **Clean up dead workers.** A worker is live while its process has not exited. One whose process
  has exited is dead at once — there is no grace pass, since a child is listed the moment it is
  spawned — and its worktree and branch are removed, so a crashed worker never holds a slot forever.
  Its conversation log gets an `exited` note with the exit code and signal (`worker-proc.mjs`).
- **Route waiting items through the coordinator agent.** With the agent on, the command lists every
  waiting item (a report park, a permission request, a question set), drains the agent's decision
  files and applies the ones that pass its checks, briefs the agent on items waiting for the first
  time, and marks which items the agent holds and which are the person's (see
  [coordinator-agent.md](coordinator-agent.md#answer-first)).
- **Forward the person's input.** Separately from the pass, the command watches the control folder's
  `inbox/` and forwards each message, interrupt or answer to its worker the moment it lands (see
  [control-folder.md](control-folder.md)), so a dispatch cycle never holds it up.
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
    worker, so it is exempt from the liveness and death checks, and it counts as live work, so the
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
  command spawns a **fresh** worker on the same worktree to review it (`pir-review Txx`) and
  closes the implementer. A task in review holds one slot, not two, and the reviewer has no
  implementer context — that is where fresh-eyes review comes from.
- **Merge one done task.** When a worker reports `done`, the command merges its task branch into the
  feature branch (**one per pass, serialized**), reconciles its row to `✅` on the feature branch,
  and closes the worker. A merge that conflicts instead keeps the worker and sends it the fix over its
  line — see [human-flow.md](human-flow.md). `PARALLEL_HOLD_MERGES=1` is a test lever, not a setting:
  it merges nothing while any worker is still building (a parked one does not count), so two
  same-line tasks both finish before either lands and the second conflicts at this step rather than
  at the worker's own integrate. The `merge-conflict` harness fixture sets it. The merge may also **adopt new task rows** the branch carried — a
  worker-introduced task: each adopted row is appended to the feature `PROGRESS.md` as `⬜` and logged
  with an `adopt` line, and a later pass's spawn step dispatches it (above). A row that cannot be
  adopted — an edit of an existing task, or a dependency on a task that does not exist — is left
  unapplied and recorded as a `bad-plan-change` surface; unlike a `question` or a merge conflict this
  surface parks no one, because the introducing task's own reviewed code merged cleanly and the run
  continues (see [control-folder.md](control-folder.md) for the `adopt` log kind versus the
  `bad-plan-change` surface, and [task-state.md](task-state.md) for the adoption rule).
- **Complete.** When every task is `✅` and no worker is live, the pass reports a `complete` flag;
  the command runs the plan's declared lines on the feature branch and reports the result. It never
  merges into the base — see **End** below. `runFeatureTests` (`coordinate.mjs`) reads the setup/test
  block from the plan's home (`planHome`, above: the main checkout's `plans/{slug}/DESIGN.md`, else the
  committed `pir/{slug}`) — not the feature worktree's copy, which may predate a review pass that added
  the block — and runs the `setup` lines, then the `test` lines, in
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
waits until the worker's activity is no longer `busy`, so a final commit is never cut off mid-turn.
Closing a worker ends its input queue, which lets it exit cleanly, then sends SIGTERM after 5 s and
SIGKILL after 10 s if it is still running (`close` in `worker-proc.mjs`); the command records every
live worker's pid and start time in the control folder's `workers.json` so one that outlives it can be
reaped. That wait is bounded — see [control-folder.md](control-folder.md) and the
known-limitation note in [human-flow.md](human-flow.md) about leaked background processes.

After each pass the command switches Remote Control on for every live worker waiting on the person
(`remoteWanted`, reading the same `waitingOn` predicate as the row and the clock, so it stays off
while a parked worker's asking turn is still open, and while the coordinator agent holds the item) and off for every other, unless the run was started with `PARALLEL_REMOTE=0` (see
[human-flow.md](human-flow.md)); a closing worker switches it off before its input queue ends.

Then, whatever `PARALLEL_REMOTE` says, the command runs the phone alerts: it builds a view of every live
worker that is the person's by the same predicate, runs the pure episode machine (`notifyStep` in
`src/core/notify.mjs`), and fires the sends, reminders and clears it returns without awaiting them
(`notifyPass` and `runNotifyActions` in `coordinate.mjs`). With no `~/.pir/notify.json` nothing is sent.
On every exit path the clears for open alerts are awaited, bounded at 2 s. See
[human-flow.md](human-flow.md#phone-alerts--pir-notify).

## The live status display

While it runs, the command prints a `docker compose up`-style display that updates in place: one
line per task, a summary line, and a footer. This is the command's status — there is no separate
`status` command. It splits across the pure/shell boundary:

- **The model is pure** (`buildDisplay` in `src/core/display.mjs`): a function of the run state a
  pass produces plus the current time and spinner frame, returning `{branch, summary, rows, footer}`
  as data, with no I/O and no clock. Each row carries a `kind` — `preparing` (the plan's setup is
  running in the task's fresh worktree; no worker yet), `building`, `reviewing`, `merging` (the
  reviewer has reported done; the merge waits for it to go idle), `asking` (shown `asking you` for a
  question or decision report once the worker has ended the turn it asked in, `asking you · allow a
  command?` for a pending permission request, `asking you · a question` for a pending question set;
  a task parked on a report whose asking turn is still open reads `building` or `reviewing`, see
  [human-flow.md](human-flow.md#when-a-row-reads-asking-you)), `fixing-conflict` (shown `fixing conflict`:
  the worker was sent a merge-conflict fix and is working on it, nothing asked of the person),
  `asking-coordinator` (shown `asking coordinator · …` in the working style: the coordinator agent holds
  the item, nothing is asked of the person, and it is not counted as asking),
  `waiting` (`needs T..`), `queued` (marked when the ceiling is full), or `done` (shown "merged"). The summary carries done/total, how many are running, asking, and
  waiting, and the ceiling. This is tested exhaustively.
- **An asking row's clock is stopped.** A row's elapsed clock counts from when its phase began,
  except while the worker waits on the person — the same `waitingOn` predicate as the row, so a
  parked task's clock keeps running until its asking turn ends: `advanceTiming` in `coordinate.mjs` records the stop
  time as the task's `stoppedAt` in the run state, and the model reads `stoppedAt − since` instead of
  `now − since`, so the coordinator and a detached `pir` viewer freeze at the same value. When the
  answer returns the task to the phase it left, the clock resumes where it stopped; the merged
  duration leaves the wait out.
- **The renderer is shell** (`createRenderer` in `src/shell/render.mjs`): on a TTY it paints the
  model in place with cursor control and ticks a spinner; when stdout is not a TTY — piped,
  redirected, or captured by the test harness — it **degrades to plain append-only lines**, because
  cursor-control escapes garble a non-terminal. The in-place painting is what only a person can
  judge (hand-verified, T09).
- **Colour is a paint-time layer** (T16): on a colour TTY the renderer tints each line by the
  model's `kind` — active work (preparing, building, reviewing, merging, fixing conflict) cyan, a merged task green,
  a **parked `asking` worker amber and bold** so the one thing needing the person stands out, idle tasks
  (`waiting`, `queued`) dim, and a failed or interrupted run red. The summary header stays neutral
  while the run is going and takes a colour only at the end — green when finished, red when Ctrl-C
  interrupts it — so the live status colour otherwise lives on the rows and on the amber-bold
  "asking you" footer pointer. Colour is layered on top of the glyphs, never instead of them, so a
  colour-blind reader loses no information. It is applied after each line is clipped, so it changes
  no widths, and the plain content (`formatLines`) carries no escapes. It is off unless stdout is a
  colour TTY and `NO_COLOR` is unset (any value of `NO_COLOR` disables it); a non-TTY — a pipe or
  the test harness — is never coloured, so that output stays plain, escape-free text.
- **The palette is Catppuccin Mocha** (`src/shell/palette.mjs`, shared by this renderer and the `pir`
  screen). A terminal that says it shows 24-bit colour (`COLORTERM=truecolor` or `24bit`, or
  `FORCE_COLOR=3`) gets Mocha's foreground colours with no background of its own, so the terminal's
  background shows through; the selected row's band is Mocha's selection grey. Any other terminal
  keeps the basic 16-colour codes. Each colour keeps its meaning in both — amber for asking, green,
  red, cyan, dim — so the colour names in these docs hold either way.

The footer names the current asking worker and how to reach it — `● Txx slug — asking you; open it (→)
to answer` (`render.mjs`): the person opens the task's row in `pir` and answers in the worker's
conversation (see [human-flow.md](human-flow.md)) — or, at the end, the green feature branch and the `git merge` hand-off. A red end's
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

With the coordinator agent on (the default), reaching the end gate does not end the run. The command
gives red tests one attempt by a test-fix worker in the feature worktree, prepares the run's base
(fetching it from the remote) and merges it into the feature branch (a conflict is finished by a main-sync worker), reruns the tests if anything
merged (red there, and no fix attempt yet, gets the one attempt then), has the agent write the delivery report's sections, commits
`plans/{slug}/REPORT.md` on the feature branch, and waits in **ready to merge**: the footer reads
`✔ ready to merge · git switch {base} && git merge pir/{slug}` and names the report, or `✗ not ready · tests red …` on red.
The run stays open until the person merges `pir/{slug}` into the base (the command sees the local base,
or the remote's copy it fetches every 5 minutes, contains its tip) or tells the agent to close it; either
ends it as `finished`. If the base moves meanwhile, the branch is re-synced and the report's footer
rewritten. A base that cannot be fetched or has split from the remote's holds the run in `preparing`
and retries every minute. The command still never merges into the base. The
steps, the report and the failure paths are in [coordinator-agent.md](coordinator-agent.md#the-end-of-the-run).

With phone alerts set up, reaching ready to merge (or red) sends one end-of-run alert, on the first pass
that reads it and never on a pass that also finishes the run (`endAlertPass`). Without the agent the
end alert goes on the pass that ends the run, awaited at most 2 s before the process returns (see
[human-flow.md](human-flow.md#phone-alerts--pir-notify)).

A run ends in one of three ways. With the agent on, the first is the ready-to-merge end above;
without it (`pir start {slug} --no-coordinator`), it is:

- **Handed off** — every task reached `✅`, the feature branch is green, and the command prints the
  branch and the one line `git switch {base} && git merge pir/{slug}` for the person to run by hand (`renderHandoff` in
  `coordinate.mjs`). The base is untouched; merging into it is the person's step, not the command's (see
  [branch-model.md](branch-model.md)). A **red** feature branch prints the failure and the branch
  and offers no `git merge` line — the command never tells the person a red branch is ready. The red
  line names which half failed, the failing line and its exit code (or the parser's reason when the
  block is invalid) and the path to `tests.log`.
- **Halted** — the `HALT` flag closed every worker (and the coordinator agent); nothing merged, the base is untouched. To
  continue, the person removes `HALT` and re-runs the command (see
  [restart-recovery.md](restart-recovery.md)).
- **Quiet** — every remaining worker is parked on a person's decision, or there is nothing left to
  dispatch. A parked run waits for the person indefinitely: there is no pass cap or time limit
  (one used to tear a run down after ~7 hours), and waiting makes no model calls.

On any exit that is not a clean hand-off or a halt, the command tears down every live worker of the
run (`teardownRun` in `coordinate.mjs`). Teardown runs from signal handlers, so it is synchronous: it
ends every worker's input queue and sends every worker SIGTERM at once, without waiting. A worker that
survives it is reaped from `workers.json` by a stop from the dashboard or the next start (see
[restart-recovery.md](restart-recovery.md)). It also kills any worker
setup still running, because setup lines run detached in their own process group and would otherwise
outlive the command. Ctrl-C (SIGINT/SIGTERM) runs the same teardown as an orphan-guard before it
exits. The teardown closes workers and setups only: task branches and worktrees are always left for
the next start to reconcile, and a task left with a worktree and no worker gets its setup run again
there (see [restart-recovery.md](restart-recovery.md)). A coordinator killed outright (SIGKILL, a
crash) skips the teardown, so a setup it was running can outlive it, and so can a worker in the middle
of a command; the worker is reaped from `workers.json`, the setup is not. Teardown also closes the
coordinator agent; the agent is not in `workers.json`, so one left by a SIGKILLed coordinator is not
reaped (see [coordinator-agent.md](coordinator-agent.md#known-limitations)).
