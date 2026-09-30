# Parallel PIR — how it behaves

This folder is the single source of truth for how the **parallel** plan-implement-review
workflow behaves: its components, the lifecycle of a run, where task state lives, the branch
and worktree model, the control folder, the human decision flow, the kill switch, the worker
ceiling, restart and recovery, the detached `pir` front-end that starts a run outliving its
terminal and watches every run on the machine, and `pir plan`, which runs the planning and the plan
review inside that front-end, and the coordinator agent that stands in for the person during a build,
and the local API service that tells other programs how much of the Claude subscription limit is used.
It is the behavioural spec — nouns, states, data
flows, and guarantees.

It is not the step-by-step. The procedure a worker session follows lives in the skills
(`skills/pir-worker`, `pir-implement`, `pir-review`), and that is where it stays. The coordinator
command has no skill: it is a plain program, not a session. The coordinator agent's base definition is
the `pir-coordinator` skill. Where a behaviour here
corresponds to a worker procedure, this spec states the behaviour and names the skill for the
"how you do it."

These docs describe the **actual current behaviour**, verified against the code in
`src/core/` and `src/shell/`. Where current behaviour has a known gap, it is called out under a
**Known limitations** heading rather than papered over. `plans/parallel-pir/DESIGN.md`,
`plans/non-agentic-coordinator/DESIGN.md`, `plans/live-workers/DESIGN.md` and
`plans/pir-coordinator/DESIGN.md` are the build-time
rationale that produced this system and are retained as history; where a DESIGN and these docs
disagree on what the code does today, these docs win.

## How parallel mode relates to classic PIR

Classic PIR runs one session at a time: a person types `/pir-work {slug}`, one task is built or
reviewed, the session stops, and the person types it again. That flow is documented in `CLAUDE.md`
and the skills, and it is unchanged. Parallel mode is an added way to run the **same reviewed
plan**: a single **coordinator command** — a plain program, not a session the person
talks to — spawns many **worker** sessions at once, each in its own worktree, so independent tasks
build and review concurrently. The plan runs on one **feature branch** with a **task branch** per
task. The feature branch is cut from the repo's **base branch** (`dev`, `main`, …), which the repo
names in `.pir/settings.json` or the person in `~/.pir/{repo}/settings.json`; with neither, `pir`
refuses to plan or build. `pir` fetches the base from the remote before cutting from it and before the
end-of-run sync, and moves the person's local copy forward only when that is safe. It never merges into
the base and never pushes: the command stops at a green feature branch and hands the person `git switch
{base} && git merge pir/{slug}` to run by hand. With the coordinator agent on (the default), it first
merges the base into the feature branch, commits a delivery report, and waits in `ready to merge` until the person merges
or closes the run. A project opts into parallel mode per run; nothing about the classic
flow changes.

A person launches parallel mode with `pir start {slug}`, run from inside the target repo — it starts
the coordinator detached and drops into its live view; a bare `pir` opens the cross-repo dashboard (see
[detached-runs.md](detached-runs.md)). The front half can run in `pir` too: `pir plan` hosts the
planner and then a fresh plan reviewer as sessions answered in the same screen, on a side branch
`pir/{slug}` that the build later reuses as its feature branch, and asks for the go to start the build
when the plan is reviewed (see [planning-runs.md](planning-runs.md)). The person answers a worker inside that same screen, by
opening the worker's conversation (see [human-flow.md](human-flow.md)), unless the run's coordinator
agent answers it first (see [coordinator-agent.md](coordinator-agent.md)). The one-time setup is
`./install.sh`, which puts the `pir` command on the PATH and installs the coordinator engine, with its
two npm packages, where it can run against any set-up repo.

`pir-coordinate`, the old foreground launcher, is gone (`plans/live-workers` §2.13, user 2026-09-24):
its live mode would strand a worker's question, since workers are no longer `claude agents` sessions
and it had no conversation view. `install.sh` removes an installed copy it finds.

## The components

- **The coordinator command** — launched with `pir start {slug}`, which runs `node
  src/shell/coordinate.mjs {slug}` detached: a plain program, not a session and not an agent. It opens
  the feature branch in its own worktree, decides which task each worker builds, spawns and closes
  workers, holds a live line to each one, prints a live status display, and hands the person the
  finished feature branch to merge. It has no agent name and never appears in `claude agents`. It
  starts the run's coordinator agent, briefs it, and checks and applies its decisions. It never merges
  into the base branch and never writes product code. Run by hand, it is dry by default and only
  spawns real workers under `PARALLEL_LIVE=1`; `pir` always sets it (see
  [run-lifecycle.md](run-lifecycle.md)).
- **Workers** — `claude` processes the command starts as its own **child processes**, one per task
  phase, each in its own task-branch worktree (`skills/pir-worker`). Each is driven through the Claude
  Agent SDK (`@anthropic-ai/claude-agent-sdk`), which speaks Claude Code's stream-json protocol to the
  installed `claude` over the child's stdin and stdout (`src/shell/worker-proc.mjs`). A worker runs
  exactly what the command sends it — `pir-implement Txx` or `pir-review Txx` — and never
  self-selects a task. There is one kind of worker; the old hands-on (`pir-verify`) worker is gone.
  Workers are no longer `claude --bg` sessions: the person reaches one through `pir`, not by attaching
  in `claude agents` (see [human-flow.md](human-flow.md)).
- **The pure decision core** (`src/core/`) — decides what to do without touching the clock,
  filesystem, or any process: `dispatch.mjs` (what to spawn/review/merge/close this pass, and a
  `complete` flag), `progress.mjs` (parse and reconcile `PROGRESS.md`), `naming.mjs` (agent names),
  `parallelism.mjs` (a plan's parallel width), `resume.mjs` (what a restart adopts), and
  `display.mjs` (the pure live-display model). Proven in the ordinary test run.
- **The shell** (`src/shell/`) — everything platform-shaped: `loop.mjs` (one pass of the
  coordinator cycle), `coordinate.mjs` (the command's bin and live display), `worktree.mjs`
  (feature/task branches and merges), `platform.mjs` (spawn, list, close, send, interrupt and answer
  over the live workers, plus the report inbox), `worker-proc.mjs` (one worker held through the SDK:
  its input queue, its permission handler, its conversation log, its pid), `person-inbox.mjs` (the
  person's input from the `pir` screen to a worker), `reap.mjs` (kill the workers a dead coordinator
  left, from `workers.json`), `render.mjs` (the terminal renderer for the display model), and the `pir`
  screen (`pir-tui.mjs`, `conversation-view.mjs`, drawn with `@earendil-works/pi-tui`). It executes
  what the core decides. The pure core also gained `stream.mjs` (read conversation-log entries, derive
  a worker's activity), `conversation.mjs` (log entries to screen lines, the permission gate and
  question picker) and `person-input.mjs` (validate the person's input, the "do not ask again" grants).
- **The coordinator agent** — one Claude session per build run, held by the command beside the
  workers (`src/shell/coordinator-agent.mjs`), on unless `pir start {slug} --no-coordinator`. It is the
  person's stand-in: it sees every worker question and permission request first and answers it or
  passes it on, and at the end writes the delivery report's sections. It only decides, by writing
  decision files; the command checks and applies them, and keeps `ask`-bin actions and destructive
  commands for the person in code (`src/core/coordinator-policy.mjs`). Its base definition is the
  `pir-coordinator` skill; a project may add `.claude/pir-coordinator.md`. It never merges into
  the base branch and never pushes (see [coordinator-agent.md](coordinator-agent.md)).
- **The planning program** (`src/shell/plan-run.mjs`) — the detached program behind `pir plan`. It
  holds one planning session at a time through the same worker line, checks each report against git,
  renames the run's branch, worktree and control folder once the plan has a name, and records the
  outcome. The pure step machine is `src/core/planflow.mjs`; the steps view and the go question are
  `src/core/plandisplay.mjs`; the brief box is `src/shell/brief-box.mjs`. `src/shell/plan-home.mjs`
  tells a build where its plan lives: the main checkout, else the committed branch `pir/{slug}`.
- **The API service** (`src/shell/api-service.mjs`) — a small HTTP server on `127.0.0.1:47717` that
  launchd starts at login and keeps alive, outside any run. It answers `GET /v1/usage` (how much of the
  5-hour and weekly subscription limit is used) and `GET /health`. It never talks to a run: every
  session a run holds saves the usage numbers it hears to `~/.pir/usage.json`
  (`src/shell/usage-report.mjs`, wired into `worker-proc.mjs`), and the service answers from that file.
  `pir service`, `on` and `off` show, start and stop it (`src/shell/service-ctl.mjs`); the pure rules
  are `src/core/api.mjs`, `usage.mjs` and `service.mjs`. macOS only (see
  [api-service.md](api-service.md)).

## The documents

- [run-lifecycle.md](run-lifecycle.md) — a run start to finish, the pass, and the live display.
- [task-state.md](task-state.md) — `PROGRESS.md` as the state, the glyphs, the task slug.
- [branch-model.md](branch-model.md) — the base branch (settings, fetch, `pirBase`), feature branch,
  task branches, worktrees, the hand-off (no promotion), agent names.
- [control-folder.md](control-folder.md) — the per-run `.parallel/control/` folder.
- [human-flow.md](human-flow.md) — questions, question sets and permission requests answered in the
  `pir` screen, merge conflicts, the kill switch, the worker ceiling.
- [restart-recovery.md](restart-recovery.md) — what a restart picks up, and the known limitations.
- [detached-runs.md](detached-runs.md) — the `pir` front-end: start a run detached, the cross-repo
  dashboard to watch, stop, clear and resume runs, and a worker's conversation view.
- [coordinator-agent.md](coordinator-agent.md) — the coordinator agent: answer first, what is reserved
  for the person, passing on, its conversation, the ledger, the end-of-run base sync and its hold, `REPORT.md` and
  `ready to merge`, `--no-coordinator`.
- [planning-runs.md](planning-runs.md) — `pir plan`: the planner and the plan reviewer run inside `pir`,
  the rename, the go that starts the build, resume.
- [api-service.md](api-service.md) — the local API service: the contract (`api.json`, `GET /v1/usage`,
  `GET /health`), the port, where a reading comes from, the login item, `pir service`, scratch homes.
