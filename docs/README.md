# Parallel PIR — how it behaves

This folder is the single source of truth for how the **parallel** plan-implement-review
workflow behaves: its components, the lifecycle of a run, where task state lives, the branch
and worktree model, the control folder, the human decision flow, the kill switch, the worker
ceiling, and restart and recovery. It is the behavioural spec — nouns, states, data flows, and
guarantees.

It is not the step-by-step. The procedure a worker session follows lives in the skills
(`skills/pir-worker`, `pir-implement`, `pir-review`), and that is where it stays. There is no
coordinator skill: the coordinator is a plain command, not a session. Where a behaviour here
corresponds to a worker procedure, this spec states the behaviour and names the skill for the
"how you do it."

These docs describe the **actual current behaviour**, verified against the code in
`src/core/` and `src/shell/`. Where current behaviour has a known gap, it is called out under a
**Known limitations** heading rather than papered over. `plans/parallel-pir/DESIGN.md` and
`plans/non-agentic-coordinator/DESIGN.md` are the build-time rationale that produced this system
and are retained as history; where a DESIGN and these docs disagree on what the code does today,
these docs win.

## How parallel mode relates to classic PIR

Classic PIR runs one session at a time: a person types `/pir-work {slug}`, one task is built or
reviewed, the session stops, and the person types it again. That flow is documented in `CLAUDE.md`
and the skills, and it is unchanged. Parallel mode is an added way to run the **same reviewed
plan**: a single **coordinator command** — a plain foreground program, not a session the person
talks to — spawns many **worker** sessions at once, each in its own worktree, so independent tasks
build and review concurrently. The plan runs on one **feature branch** with a **task branch** per
task. It never merges to `main`: the command stops at a green feature branch and hands the person a
`git merge` to run by hand. A project opts into parallel mode per run; nothing about the classic
flow changes.

A person launches parallel mode with `pir-coordinate {slug}`, run from inside the target repo (dry
by default — real, paid workers spawn only under `PARALLEL_LIVE=1`; see
[run-lifecycle.md](run-lifecycle.md)). The one-time setup is `./install.sh`, which puts the
`pir-coordinate` command on the PATH and installs the coordinator engine where it can run against
any set-up repo — so `pir-coordinate {slug}` is the way to launch, not a bare
`node …/coordinate.mjs`.

## The components

- **The coordinator command** — launched with `pir-coordinate {slug}` (the installed shortcut;
  underneath it runs `node src/shell/coordinate.mjs {slug}`), a plain foreground program, not a
  session and not an agent. It opens the feature branch in its own worktree, decides
  which task each worker builds, spawns and closes workers, prints a live status display, and hands
  the person the finished feature branch to merge. It has no agent name and never appears in
  `claude agents`. It never merges to `main` and never writes product code. Dry by default; it only
  spawns real workers under `PARALLEL_LIVE=1` (see [run-lifecycle.md](run-lifecycle.md)).
- **Workers** — background `claude` sessions the command spawns, one per task, each in its own
  task-branch worktree (`skills/pir-worker`). A worker runs exactly what the command sends it —
  `pir-implement Txx` or `pir-review Txx` — and never self-selects a task. There is one kind of
  worker; the old hands-on (`pir-verify`) worker is gone.
- **The pure decision core** (`src/core/`) — decides what to do without touching the clock,
  filesystem, or any process: `dispatch.mjs` (what to spawn/review/merge/close this pass, and a
  `complete` flag), `progress.mjs` (parse and reconcile `PROGRESS.md`), `naming.mjs` (agent names),
  `parallelism.mjs` (a plan's parallel width), `resume.mjs` (what a restart adopts), and
  `display.mjs` (the pure live-display model). Proven in the ordinary test run.
- **The shell** (`src/shell/`) — everything platform-shaped: `loop.mjs` (one pass of the
  coordinator cycle), `coordinate.mjs` (the foreground command and live bin), `worktree.mjs`
  (feature/task branches and merges), `platform.mjs` (spawn/list/close/inbox over the `claude`
  CLI), `render.mjs` (the terminal renderer for the display model). It executes what the core
  decides.

## The documents

- [run-lifecycle.md](run-lifecycle.md) — a run start to finish, the pass, and the live display.
- [task-state.md](task-state.md) — `PROGRESS.md` as the state, the glyphs, the task slug.
- [branch-model.md](branch-model.md) — feature branch, task branches, worktrees, the hand-off (no
  promotion), agent names.
- [control-folder.md](control-folder.md) — the per-run `.parallel/control/` folder.
- [human-flow.md](human-flow.md) — decisions and questions answered directly in `claude agents`,
  merge conflicts, the kill switch, the worker ceiling.
- [restart-recovery.md](restart-recovery.md) — what a restart picks up, and the known limitations.
