# Restart and recovery

A parallel run can end abruptly: the kill switch fires, the command crashes or is killed, the
machine is rebooted, or the person walks away. There is no separate resume command — recovery is to
**re-run the command on the same slug**. A re-run reconciles every task from git and resumes it at
the stage it had actually reached, rather than rebuilding from the start. No exit path deletes a task
branch, so there is always something to reconcile. This page describes what
that re-run picks up and how it decides.

A re-run is checked like a first start: a plan without a valid setup/test block in its `DESIGN.md`
is refused before anything is reconciled (see [run-lifecycle.md](run-lifecycle.md)).

## What a re-run reliably picks up

- **The feature branch and its worktree.** `pir/{plan}` and `.claude/worktrees/pir-{slug}` are
  deterministic and reused idempotently: `openFeature` checks whether the branch and worktree
  already exist and returns them rather than recreating. So a re-run lands on the same feature
  worktree, not a duplicate.
- **Per-task branches and worktrees.** `pir/{plan}-T{nn}` and `.claude/worktrees/pir-{slug}-T{nn}`
  are deterministic and reused the same way (`createTask`). Reconciliation adopts the work already
  on each task branch (below); a task it resumes is spawned into the existing branch and worktree,
  and a branch whose worktree folder is gone gets the folder re-attached rather than being skipped.
- **Completed work.** Any task already merged into the feature branch reads `✅` in the feature
  branch's `PROGRESS.md`, so a re-run does not rebuild it — the feature branch is the durable record
  of what has actually landed. `main` is untouched (nothing ever merges to `main`), so an
  interrupted run leaves `main` exactly as it was.
- **In-flight task work, adopted from each task branch.** A task built (`🔍`) or built and reviewed
  (`✅`) on its own task branch but not yet merged is picked up at that stage, not re-dispatched from
  scratch. A task only partly built is resumed on its branch, commits and uncommitted edits intact.
  This is the reconciliation pass below.

## Reconciliation — git is the ground truth

On a re-run the command's in-memory run state is empty: it tracks no worker and remembers no phase.
Rather than trust the feature-branch `PROGRESS.md` — which advances a task past `⬜` only at merge,
and so still reads `⬜` for a task finished on its own branch but not yet merged — the command
reconstructs each task's state from git, the one place a crash cannot lie about what landed. It does
this **once, at startup, before the first dispatch**, inside the first pass (`reconcile`, pass 0
folded into `runPass` in `src/shell/loop.mjs`).

There is no "am I restarting?" flag. Reconciliation runs at every startup and is a no-op on a
genuine first start, because a first start has no task branches to adopt. The presence of task
branches is the only signal that matters, and a flag would be a second source of truth that could
disagree with git.

### The signal is the committed task-branch glyph

The stage a task reached lives in its own task branch's `plans/{slug}/PROGRESS.md` row, read with
`git show pir/{slug}-T{nn}:plans/{slug}/PROGRESS.md`. The glyph in that row is trustworthy because
it is committed **atomically with the work it describes**: the implementer marks `🔍` in the same
commit as the code, and the reviewer marks `✅` in its own commit. So committed code never carries a
stale `⬜`/`🟡` — either the build commit landed with its `🔍`, or it did not land at all. Uncommitted
working-tree state never promotes a task: a crash cannot be trusted to have finished what it left
uncommitted. It is kept, though, for the resumed implementer to inspect (below).

### Every exit keeps the task branches

`teardownRun` (`coordinate.mjs`) runs on every exit that is not a clean hand-off or a halt — a `pir`
stop, Ctrl-C, an uncaught error, the runaway breaker, a stall. It closes this run's
worker sessions and **never removes a task worktree or branch**. It used to remove them on every exit
but the detached stop; on 2026-09-22 a full disk (`ENOSPC`) crashed a real run, that `error` teardown
deleted two built tasks and one half-built one, and the restart implemented all three again.

### Reap the dead run's workers first

A crash that skips the command's own shutdown — a `SIGKILL`, a power loss, a stop that outlasts its
grace and is force-killed — leaves the dead run's worker sessions still running. Each orphaned session both inflates
the live-worker count (tripping the runaway breaker) and stays invisible to the slot maths (so the
run would over-spawn). So the first thing reconciliation does, before adopting anything, is stop
every worker session of this slug the platform still lists — **session-only** (close the session and
remove its record, never `worktree.remove`), because the task branches and worktrees are exactly
what the adoption needs. This makes the ceiling genuinely free before any reviewer spawns.

### One action per task

For each task on the feature branch, the pure classifier `decideResume` (`src/core/resume.mjs`)
decides one action from the feature-row state and the committed task-branch glyph:

| Feature row | Task branch | Action | What happens |
|---|---|---|---|
| `✅` | (any / absent) | **skip** | already merged; a leftover branch is cleaned up |
| `⛔` | (any / absent) | **skip** | a person deferred it; its dependents wait |
| `⬜` | `✅` | **merge** | built and reviewed — folded into the feature branch directly, no worker |
| `⬜` | `🔍` | **review** | built, not reviewed — a fresh reviewer session is spawned on its worktree |
| `⬜` | present, neither `✅` nor `🔍` | **resume** | half-built — a fresh implementer continues on the existing branch |
| `⬜` | absent | **implement** | never started — the pass's normal dispatch handles it |

- **merge** reuses the loop's own merge-and-reconcile: `worktree.mergeTask` folds the branch in,
  the feature row is reconciled to `✅`, and the task worktree and branch are removed. No worker
  session is involved, because the branch is already reviewed, so a merge does not consume the
  ceiling. Merges are applied in task order.
- **review** spawns a **fresh** reviewer on the existing task worktree and seeds it into run state as
  a normal reviewing task, so from the next pass the live loop reviews and merges it like any other.
  It runs no setup: the worktree is the one its implementer already ran in. There is no implementer to
  close — it died in the crash. Merges and reviews are done this way (a review always with a live
  session, a merge with none) because the loop's assignment machinery treats a tracked task with no
  live session as dead and would remove its branch, discarding the adopted work.
- **resume** leaves the branch and worktree alone; the feature row stays `⬜`, so the same pass's
  normal spawn step dispatches a fresh implementer, and `createTask` hands it the existing branch and
  worktree. That spawn step runs the plan's `setup` lines in the worktree first, as for any new
  implementer (see [run-lifecycle.md](run-lifecycle.md)), so a task whose coordinator died mid-setup —
  a worktree with no worker — gets its setup run again rather than a worker in a half-installed
  worktree. A setup child the dead coordinator left running may still be at work in the same worktree;
  that is rare, accepted, and fails loudly into the new worker's setup note. The worker contract
  (`skills/pir-worker` § Before you start) has every worker check `git log pir/{plan}..HEAD` and
  `git status` first and continue what an earlier session left. This replaced discard-and-rebuild on
  2026-09-23 by the user's decision: a rebuild threw away hours of work on every restart. Anything
  short of `🔍`/`✅` still counts as not built, so nothing half-done reaches review until an implementer
  marks it `🔍`.
- **merge** and **review** re-attach a worktree when the branch exists but its folder does not
  (`createTask` reuses the branch), so a lost folder never demotes a built task to a re-implement.

### When a `✅` branch will not merge

A reviewed branch can fail to merge cleanly if a sibling changed a shared file after it was built.
Reconciliation cannot auto-resolve and has no worker on that branch to resolve it. It marks the
task `⛔` on the feature branch (so the block survives the next re-run and the task's dependents keep
waiting), leaves the reviewed branch in place for a person to land by hand, and surfaces the
conflict in plain English. It does not rebuild — the work is reviewed and good, it only needs a hand
to land. A `🔍` branch that re-hits a conflict on review resurfaces through the normal review path
once its fresh reviewer runs; nothing special is needed.

A leftover branch for a task already `✅` on the feature branch (the merge landed but close did not
run before the crash) is removed as cleanup, so re-runs do not accumulate orphaned branches.

### The restart is narrated in one line

A re-run that silently merges, reviews and resumes looks, in ordinary progress output, almost
exactly like a fresh run. So reconciliation composes one plain-English line naming what it adopted —
what it merged because it was already finished, what it sent to review because it was already built,
what it is resuming because it was only half-done, what needs a hand to land, and what it is
starting fresh — logged as `restart-summary` and printed as the run resumes. A genuine first start
adopts nothing, so it emits no summary, and a first run's output is unchanged.

## Control-folder hygiene on restart

The control folder (`plans/{slug}/.parallel/control/`) is reused across a re-run. Before the run
writes anything, `startupControlHygiene` separates the transient feed from the durable records:

- **Cleared — `reports/`.** The worker up-channel is a live-run buffer; a leftover report from the
  dead run would be read as a fresh worker's signal, so it is emptied at startup. Clearing runs on
  every startup, not only a detected restart, because a genuine first start has it empty anyway.
  `reports/` is now the only feed there is to clear — the down-channel feeds (`outbox`, `answers`,
  `surfaced`) it used to clear alongside are gone (see [control-folder.md](control-folder.md)).
- **Preserved — `log`.** The append-only event log is the audit trail and the durable signal the
  test harness reads. It is never cleared; a restart appends a `restart` marker line so the log
  shows the boundary between runs.
- **Preserved — `HALT`.** The kill switch is a deliberate stop, and the documented way to continue is
  for the person to remove it. Auto-clearing it would defeat the interlock — a HALTed run that is
  re-run would blow straight past the stop. So a `HALT` present at startup makes the command **refuse
  to start**, naming the flag and the `rm` command that clears it.

(This hygiene and the reconciliation pass run when the command actually drives workers. A dry
preview — the run without `PARALLEL_LIVE=1` — spawns nothing, builds no control folder, and exits
before either step, which is harmless because it changes no state.)

## When the docs disagree with the sealed plan

`plans/parallel-pir/DESIGN.md § 6 Recovery` describes restart as a clean resume that "re-opens the
feature branch and continues from its `PROGRESS.md`". That was the build-time aspiration; the
reconciliation above is what makes it true. `plans/coordinator-restart-resume/DESIGN.md` records
rebuild-clean for a half-built branch and a teardown that removes worktrees; both were reversed on
2026-09-23 as described above. The sealed plan is history — this page and the code are
the ground truth.

## Manual recovery

When a re-run is not what is wanted, the pieces are all inspectable and removable by hand:

- **Leftover task branches from a run nobody will restart:** since no exit removes them, delete them
  with `git worktree remove --force` and `git branch -D` (below), or re-run the command, which merges,
  reviews or resumes each one.
- **A leaked worker, worktree, or branch:** `claude agents --json` lists live sessions with their
  pid; `git worktree list` lists worktrees. End a session with `kill <pid>` (`claude stop` only
  interrupts), clear its record with `claude rm <id>`, and remove the worktree and branch with
  `git worktree remove --force` and `git branch -D`.
- **A confused or runaway run:** create the `HALT` flag (`touch
  plans/{slug}/.parallel/control/HALT`). All dispatch and delivery stop and every worker is ended;
  `main` is untouched. Remove the flag and re-run to continue.
- **Inspecting what reconciliation will see:** `git show pir/{slug}-T{nn}:plans/{slug}/PROGRESS.md`
  is the exact read it makes — the committed glyph in that row is the action it will pick.
- **A bad merge on the feature branch:** it is a normal `git` recovery on `pir/{plan}`; `main` is not
  involved, since nothing merges to `main`.
- **Abandon the whole plan:** delete the feature branch `pir/{plan}` and its task branches. `main`
  never received anything, so there is nothing to revert.
