# Parallel PIR — how it behaves

This folder is the single source of truth for how the **parallel** plan-implement-review
workflow behaves: its components, the lifecycle of a run, where task state lives, the branch
and worktree model, the control folder, the human decision and hands-on flow, the kill switch,
the worker ceiling, and restart and recovery. It is the behavioural spec — nouns, states, data
flows, and guarantees.

It is not the step-by-step. The procedure a coordinator or worker session follows lives in the
skills (`skills/pir-coordinate`, `pir-worker`, `pir-implement`, `pir-review`, `pir-verify`), and
that is where it stays. Where a behaviour here corresponds to a procedure, this spec states the
behaviour and names the skill for the "how you do it."

These docs describe the **actual current behaviour**, verified against the code in
`src/core/` and `src/shell/`. Where current behaviour has a known gap, it is called out under a
**Known limitations** heading rather than papered over. `plans/parallel-pir/DESIGN.md` is the
build-time rationale that produced this system and is retained as history; where DESIGN and these
docs disagree on what the code does today, these docs win.

## How parallel mode relates to classic PIR

Classic PIR runs one session at a time: a person types `/pir-work {slug}`, one task is built or
reviewed, the session stops, and the person types it again. That flow is documented in `CLAUDE.md`
and the skills, and it is unchanged. Parallel mode is an added way to run the **same reviewed
plan**: a single **coordinator** session that the person talks to spawns many **worker** sessions
at once, each in its own worktree, so independent tasks build and review concurrently. The plan
runs on one **feature branch** with a **task branch** per task, and lands on `main` in a single
promotion at the end. A project opts into parallel mode per run; nothing about the classic flow
changes.

## The components

- **Coordinator** — the session the person talks to (`skills/pir-coordinate`). It opens the
  feature branch, decides which task each worker builds, spawns and closes workers, surfaces every
  worker question to the person and routes answers back down, and performs the one promotion to
  `main`. It never writes product code.
- **Workers** — background `claude` sessions the coordinator spawns, one per task, each in its own
  task-branch worktree (`skills/pir-worker`). A worker runs exactly what the coordinator sends it —
  `pir-implement Txx`, `pir-review Txx`, or `pir-verify Txx` — and never self-selects a task.
- **The pure decision core** (`src/core/`) — decides what to do without touching the clock,
  filesystem, or any process: `dispatch.mjs` (what to spawn/review/merge/close/promote this pass),
  `progress.mjs` (parse and reconcile `PROGRESS.md`), `naming.mjs` (agent names), `parallelism.mjs`
  (a plan's parallel width). Proven in the ordinary test run.
- **The shell** (`src/shell/`) — everything platform-shaped: `loop.mjs` (one pass of the
  coordinator cycle), `coordinate.mjs` (the conversational wrapper and the live bin),
  `worktree.mjs` (feature/task branches and merges), `platform.mjs` (spawn/message/list/close over
  the `claude` CLI). It executes what the core decides.

## The documents

- [run-lifecycle.md](run-lifecycle.md) — a run start to finish, and the coordinator pass.
- [task-state.md](task-state.md) — `PROGRESS.md` as the state, the glyphs, the `Runs` marker.
- [branch-model.md](branch-model.md) — feature branch, task branches, worktrees, one promotion,
  agent names.
- [control-folder.md](control-folder.md) — the per-run `.parallel/control/` folder.
- [human-flow.md](human-flow.md) — decisions and questions, the hands-on (`you`) flow, merge
  conflicts, the kill switch, the worker ceiling.
- [restart-recovery.md](restart-recovery.md) — what a restart picks up, and the known limitations.
