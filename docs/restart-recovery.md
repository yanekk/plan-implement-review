# Restart and recovery

A parallel run can end abruptly: the kill switch fires, the coordinator crashes, the machine is
rebooted, or the person walks away. There is no separate resume command — recovery is to **restart
the coordinator on the same slug**. This page describes what that restart actually picks up today,
and, honestly, what it does not.

## What a restart reliably picks up

- **The feature branch and its worktree.** `pir/{plan}` and `.claude/worktrees/pir-{slug}` are
  deterministic and reused idempotently: `openFeature` checks whether the branch and worktree
  already exist and returns them rather than recreating. So a restart lands on the same feature
  worktree, not a duplicate.
- **Per-task branches and worktrees.** `pir/{plan}-T{nn}` and `.claude/worktrees/pir-{slug}-T{nn}`
  are deterministic and reused the same way (`createTask`). A task the coordinator re-dispatches
  after a restart is spawned into the existing task branch and worktree if one is present.
- **Completed work.** Any task already merged into the feature branch reads `✅` in the feature
  branch's `PROGRESS.md`, so a restart does not rebuild it — the feature branch is the durable
  record of what has actually landed. `main` is untouched until the single promotion, so an
  interrupted run leaves `main` exactly as it was.

The coordinator decides what is "still to do" from the feature-branch `PROGRESS.md` and re-dispatches
every ready `⬜` task, up to the ceiling, exactly as on a first start.

## Known limitations

These are current gaps, documented honestly. They are **not fixed here** — fixing is a separate
plan. Note that `plans/parallel-pir/DESIGN.md § 6 Recovery` describes restart as a clean resume
("re-opens the feature branch and continues from its `PROGRESS.md`"); that is the build-time
aspiration, and on the specifics below it is stale. The code is ground truth.

### In-flight task work is not adopted; it is re-dispatched from scratch

"Which tasks are still to do" is decided **only** from the feature-branch `PROGRESS.md`, and that
file advances a task past `⬜` only when the task is merged and reconciled into the feature branch. A
task that was built (`🔍`), or even built and reviewed (`✅`), **on its own task branch but not yet
merged** still reads `⬜` on the feature branch. On restart, the coordinator's in-memory run state
is empty, so it tracks no worker; it re-dispatches that task from `⬜`, spawning a fresh
`pir-implement` worker.

Because task branches and worktrees are reused (above), that fresh worker starts in the existing
worktree that already holds the finished-but-unmerged work — and re-implements the task from its
task doc. **Nothing scans existing task branches to adopt their in-flight state.** The finished work
on the branch is not lost from git, but it is not recognised as done, and the restarted run repeats
it. The cost of an interrupted run is therefore every task that had finished on its branch but not
yet merged.

### The control folder is reused, not cleared, so stale entries can contaminate a fresh run

`plans/{slug}/.parallel/control/` is created if missing but never cleared on restart. Entries left
over from the dead run are still there and can be read by the fresh run:

- **`HALT`** — if a run was stopped by the kill switch and the flag was not removed, a restart reads
  it as halted and immediately closes everything again. Removing the flag before restarting is the
  intended step (it is documented), but a forgotten flag silently prevents the run from proceeding.
- **`reports/`** — leftover report JSON files are drained on the fresh run's first pass, but the
  restarted coordinator is tracking no worker yet (its in-memory run state is empty, and the drain
  runs before the pass spawns anything), so a stale `implemented`/`done`/`question` matches no task and
  is dropped, not applied. `reports/` therefore self-clears on the first drain rather than contaminating
  the new run's state — the only cost is that a report the dead run still needed is gone.
- **`answers`, `outbox`, `surfaced`** — leftover lines from the dead run are drained/relayed on
  restart: a stale answer routed to a task, a stale down-message delivered, a stale surface relayed
  to the person.

None of these is cleared automatically today. A clean restart currently depends on the person (or a
future fix) removing `HALT` and clearing the drop-dir and bridge files first.

## Manual recovery

When a restart is not what is wanted, the pieces are all inspectable and removable by hand:

- **A leaked worker, worktree, or branch:** `claude agents --json` lists live sessions with their
  pid; `git worktree list` lists worktrees. End a session with `kill <pid>` (`claude stop` only
  interrupts), clear its record with `claude rm <id>`, and remove the worktree and branch with
  `git worktree remove --force` and `git branch -D`.
- **A confused or runaway coordinator:** create the `HALT` flag. All dispatch and delivery stop and
  every worker is ended; `main` is untouched. Remove the flag and restart to continue.
- **A bad merge on the feature branch:** it is a normal `git` recovery on `pir/{plan}`; `main` is not
  involved, since nothing merges to `main` until promotion.
- **Abandon the whole plan:** delete the feature branch `pir/{plan}` and its task branches. `main`
  never received anything, so there is nothing to revert.
