# Parallel PIR — Design

## 1. Purpose

The framework today runs one session at a time: the user types `/pir-work {slug}`, one task
is built or reviewed, the session stops, and the user types it again. This is deliberate and
it stays. Parallel PIR adds a second way to run the same plan: a **coordinator** session that
the user talks to, which spawns many **worker** sessions at once — each in its own isolated
workspace — so independent tasks are built and reviewed concurrently instead of one after
another. The classic flow is untouched; this is an added mode a project opts into per run.

It leans on Claude Code's own primitives — background sessions, per-session git worktrees,
cross-session messaging, and stop/remove — rather than rebuilding them. Those primitives work
headless (`claude -p`) in any project with no cockpit and no experimental flags, which is what
makes this portable: the mode builds only the PIR-specific glue on top of an engine that is
already there.

### Success criteria

- A user starts a coordinator on a reviewed plan, and independent tasks are implemented and
  reviewed concurrently, each in its own worktree and branch, with no manual per-task typing.
- Every task still gets the fresh-eyes review the base method guarantees: the session that
  reviews a task never carries the implementation in context.
- The user sees every worker message, every decision routes through the user, and one kill
  switch halts everything.
- The PIR-specific decision logic (which task is ready, how a finished task folds back into the
  shared file) runs and is proven with no live agents, in the ordinary test command.
- Nothing dangerous — a real agent spawn, a real merge to `main` — runs before its logic has
  been rehearsed against fakes and then hand-verified with the user, small first.

### Stance

- **Parallel mode is additive, never a replacement.** The single-stream flow keeps its exact
  contract. A session that finds the two modes inconsistent fixes the parallel mode.
- **Lean on the platform; build only the PIR glue.** Claude Code already spawns isolated
  background workers, lets sessions message each other, and stops them. Rebuilding any of that
  in our own code would be a worse copy of a stable primitive, and the only thing that would
  justify it — portability — is already satisfied because those primitives run headless in any
  project. What is ours is the PIR state protocol and the coordinator's decision loop.
- **The existing skills are reused unchanged.** Workers run the stock `pir-work` /
  `pir-implement` / `pir-review`. Parallelism is wrapped around them via a worker contract, not
  sewn into them, because forking those skills would split the method and double every fix.
- **Fresh eyes come from a separate session, not a memory wipe.** A worker implements its task
  on its worktree; a fresh session is then pointed at the same worktree to review it. A new
  session has no implementer context by construction, which is cleaner than driving a `/clear`.
- **The user supervises by observing, not by approving each send.** Messages deliver
  immediately; the user watches and can intervene, rather than gating every message.

---

## 2. Behaviour specification

### 2.1 The run

1. The user starts a coordinator (`/pir-coordinate {slug}`) and points it at a plan whose
   `PROGRESS.md` says it has been reviewed. If the plan is not reviewed, the coordinator
   refuses, exactly as `pir-work` does — an unreviewed plan copies its defects into every task,
   and running many at once multiplies that.
2. The coordinator reads the task table, finds every task whose dependencies are `✅` and which
   is not already assigned, and — up to the worker ceiling — spawns a worker for each: a
   background `claude` session whose working directory is a fresh worktree and branch, handed
   the one task. `coordinator → worker` is direct and immediate.
3. The worker runs the stock `pir-work`, which implements the task and marks it `🔍` on its
   branch. When it reports implemented, the coordinator spawns a **fresh** session pointed at
   the same worktree, which runs `pir-work` again and reviews the work, marking it `✅`. Fresh
   eyes come from that being a different session with no implementer context.
4. If a worker hits a question or decision at any phase, it sends the coordinator a message and
   waits. The coordinator surfaces it to the user; the user's answer is sent straight back down
   to that worker.
5. When the task is reviewed and clean, the worker brings its branch up to date with `main` and
   sends the coordinator a "done" message. `worker → coordinator` is indirect and async: the
   coordinator reads its inbox when it reaches a natural break in its own loop, never by
   interrupt, because an interrupt mid-merge is worse than a message read a few seconds late.
6. The coordinator merges that branch into `main`, **closes the worker** (stops its session and
   removes its worktree and branch), and dispatches the next ready task.

### 2.2 The two directions are asymmetric, and both use cross-session messaging

- **coordinator → worker: direct, immediate.** The coordinator sends the worker a message and
  the worker acts on it. The transport is Claude Code's cross-session messaging (`SendMessage`),
  which is bidirectional and works headless on this machine. Not `claude --resume -p`: that
  resumes a stopped session in a new terminal and does not inject a turn into a running one
  (FINDINGS.md, 2026-09-07).
- **worker → coordinator: indirect, async.** The worker sends a message to the coordinator's
  inbox; the coordinator reads it at a natural break in its loop. Same transport, opposite
  discipline: the coordinator never lets an inbound message interrupt an action in flight.

### 2.3 The worker lifecycle: create, drive, close

The coordinator owns a worker's whole life, and it must be able to end it, not only start it.

- **create** — spawn a background `claude` session whose cwd is a fresh worktree and branch off
  current `main`, handed the one task and a short contract (§2.1, and the worker contract skill).
- **drive** — send the worker a message (an answer to its question, the instruction to hand off
  to review). The review session is a *separate* fresh spawn on the same worktree.
- **close** — stop the worker's session and remove its worktree and branch.

**Close exists for three reasons, and all three are why it is first-class rather than an
afterthought.** Normal end-of-task teardown after a merge; the hard-stop kill switch, which
tears every worker down at once; and cleaning up a worker that crashed or was abandoned so its
worktree does not leak. A design that can spawn but not reliably close leaks worktrees and
cannot honour its own kill switch. Note that `claude rm` removes a worktree only when it is
clean, so close after a clean merge or remove the worktree explicitly (FINDINGS.md).

### 2.4 The rails

- **Same repo only.** A worker communicates only with teammates on the same project, for a
  tight blast radius. Because workers live in worktrees, "same repo" is resolved from each
  agent's live `cwd` (from `claude agents --json`) and its shared git dir
  (`git rev-parse --git-common-dir`), not a naive path match, and not `--cwd`, which matches the
  repo root and returns nothing for a worktree (FINDINGS.md).
- **The user supervises.** Every worker message is surfaced, every decision routes through the
  user, and supervision is observe-and-intervene, not approve-each-send.
- **Worker ceiling: at most 4 workers at once.** This is the one hard cap kept, because the
  coordinator spawns its own workers and that is the real runaway vector; it also bounds paid
  agents and merge complexity. Hitting the ceiling is logged, and a task simply waits for a slot.
- **Kill switch: hard stop only.** A control flag file. While it is present the coordinator
  dispatches nothing and delivers nothing, and it closes every live worker with `claude stop`.
  There is no pause or resume: to continue, the user removes the flag and restarts the
  coordinator, which reads `PROGRESS.md` and picks up from the recorded task states.
  Hard-stop-only was chosen because restart-from-`PROGRESS.md` already gives a clean resume.

The earlier plan also carried a message-rate cap and a hop-depth cap. Both are dropped, because
the re-scoped design removes what they guarded: workers never spawn workers, so there is no
handoff chain to bound, and the coordinator is the only downward sender while the platform
already throttles message bursts to a session. Keeping them would be guarding a runaway vector
that no longer exists. If load ever shows they are needed they can be added to the coordinator
loop cheaply.

### 2.5 The unhappy paths

- **A worker cannot continue on its own — a question or a decision for the user.** The worker
  never guesses; an underspecified requirement or a genuine choice is exactly what goes to the
  user, as in the classic flow. The worker pauses its task, messages the coordinator (kind
  question or decision) and waits, doing nothing further. The coordinator surfaces it to the user
  in plain English at its next natural break, and routes the user's answer straight back down to
  that worker, which resumes. Crucially, one parked worker does not stall the others: the
  coordinator keeps every other independent task moving while it waits, so the user is the
  bottleneck only for that one decision. A parked worker still holds a slot under the ceiling, so
  if several stack up waiting the run throttles itself down to human speed, which is correct. If
  the user never answers, the task stays parked; on a restart the coordinator sees it unfinished
  and can re-raise it, and a task deliberately left for a human is marked ⛔ in `PROGRESS.md` so
  the state survives the restart. Nothing is guessed or lost.
- **Two workers finish at once.** Merges to `main` are serialized: the coordinator merges one
  branch at a time. A worker brings its branch up to date with `main` before it signals done,
  so at merge time its only change to shared files is its own task's work.
- **A real merge conflict.** When a worker integrates `main` and hits a conflict in code, the
  worker attempts the resolution, because it holds its task's context. If it cannot resolve
  cleanly it sends the coordinator a decision message and waits for the user. The coordinator
  never merges a dirty branch.
- **`PROGRESS.md` contention.** `PROGRESS.md` is the one file every session writes, so parallel
  workers would collide on it. The coordinator owns `PROGRESS.md` on `main`. A worker edits only
  its own task's row on its own branch (the stock skills do this). At merge time the coordinator
  does not rely on git's line merge for `PROGRESS.md`: it reads the worker's task row from the
  branch and folds just that row into `main`'s `PROGRESS.md` with a pure function (§3.3), leaving
  the coordinator-managed lines — Status, `Next pir-work will:`, Review queue — alone. That
  sidesteps the guaranteed conflict on those single-line fields, which several branches all edit.
- **A worker crashes or is abandoned.** Its worktree and branch are left behind. The
  coordinator's close removes them; cleanup runs on the next loop pass that notices the worker
  is gone (its `state` in `claude agents --json`), so a dead worker does not hold a slot forever.
- **The kill switch fires mid-task.** In-flight workers are stopped. Their branches are left on
  disk unmerged for inspection; nothing half-done reaches `main`, because only the coordinator
  merges and it stops first. Restart re-dispatches whatever `PROGRESS.md` still shows unbuilt.

---

## 3. Architecture

### 3.1 The boundary

```
src/core/    — pure. Takes inputs as parameters, returns decisions. No clock, no I/O,
               no process spawn, no network. The current time and the presence of control
               flags arrive as arguments.
src/shell/   — everything platform-shaped: the claude CLI (spawn / message / list / stop),
               git worktrees and merges, the filesystem, the loop. As thin as it can be; it
               executes what core decides.
```

The reason is testability. Everything in `core/` is proven exhaustively in milliseconds in the
ordinary test run. Everything in `shell/` can only be established by a person watching real
agents and real merges, which is slow and sometimes unavailable. **Every rule that leaks across
the boundary becomes a rule only a person can check.**

**What enforces it:** `src/core/boundary.test.mjs` scans every file in `src/core/` for
forbidden references — `node:fs`, `node:child_process`, `node:net`, `fetch(`, `Date.now`,
`new Date(` with no argument, `Math.random` — and fails if it finds one. **If that test fails
the fix is to move the code into `shell/` and pass the result in as a parameter, never to relax
the test.** The test is the rule; the code is what bends.

### 3.2 Modules

Pure (`src/core/`):

- `progress.mjs` — parse `PROGRESS.md` into a structured task table and the plan-reviewed gate,
  and fold one finished task's row back into a `PROGRESS.md` text. Depends on nothing.
- `dispatch.mjs` — decide what to do this pass: which tasks to spawn a worker for, which worker
  to move into review, which branch to merge, which workers to close. A function of the task
  table, the current worker assignments, the worker ceiling and the halted flag. Depends on the
  `progress.mjs` shapes.

Shell (`src/shell/`):

- `platform.mjs` — the thin wrapper over Claude Code: spawn a background worker in a worktree
  cwd, send a worker a message and read the coordinator's inbox (cross-session messaging), list
  live workers with their state (`claude agents --json`, same-repo resolution), and close a
  worker (`claude stop` then remove its worktree). This is where the T00 spike's confirmed
  mechanisms live.
- `worktree.mjs` — create a worktree and branch, integrate `main`, merge a branch to `main`
  serialized, and remove a worktree and branch.
- `control.mjs` — read the kill-switch flag file and append to the log.
- `loop.mjs` — the coordinator's outer cycle: gather state, call `dispatch.mjs`, execute its
  actions, honour the ceiling and the kill switch, fold merged results back, log every event.
  The thin driver behind the `pir-coordinate` skill.

### 3.3 The decision function

`decideDispatch({ tasks, assignments, maxWorkers, halted })` is where the behaviour comes
together, and it is a function of its arguments and nothing else.

- `tasks` — the parsed `PROGRESS.md` table: each `{ num, name, deps, state }`.
- `assignments` — which task each live worker holds, and its phase (implementing, review-ready,
  reviewing, awaiting-answer, done, dead).
- `maxWorkers` — the ceiling (4).
- `halted` — whether the kill-switch flag is present.

It returns `{ spawn, review, merge, close }`:

- If `halted`, `spawn`, `review` and `merge` are empty and `close` is every live worker.
- `spawn` is the ready `⬜` tasks (all deps `✅`, not already assigned), capped so
  live-plus-spawned never exceeds `maxWorkers`, lowest task number first.
- `review` is the workers that reported implemented (`🔍`) and need a fresh review session.
- `merge` is the branches of workers reporting done, at most one per pass (serialized).
- `close` is the workers whose task merged, plus any assignment the agent list shows is dead.

Reconciling a finished task into shared progress is the other pure function:
`reconcileTaskRow(mainProgressText, { num, state, notes })` returns a new `PROGRESS.md` text with
only that task's row changed and the coordinator-managed lines left alone.

### 3.4 Data flow

```
PROGRESS.md ────────parse──▶ tasks ─┐
claude agents --json ──────▶ live  ─┼─▶ decideDispatch ─▶ { spawn, review, merge, close }
coordinator inbox (messages) ─────  ┤                         │
control flag ──────────────▶ halt ──┘                         ▼  shell executes via platform.mjs
                                                     spawn / send / spawn-review / merge / close
                            reconcileTaskRow ◀── worker's task row ◀── (on merge)
                                    │
                                    ▼
                                PROGRESS.md (on main, coordinator-owned)
```

### 3.5 Storage

State lives on disk, plain text so a person can read it under pressure:

- `PROGRESS.md` on `main` — the task states, owned by the coordinator.
- `plans/{slug}/.parallel/control/` — the kill-switch flag file (`HALT`) and `log` for the
  ceiling-hit and lifecycle record.
- Worker branches and worktrees — git's, under `.git/worktrees/`; `git worktree remove` is the
  recovery for a leaked one.

Cross-agent messages are carried by the platform's messaging, not a file store this project
owns, so there is no custom mailbox format or locking to get wrong. The one place a torn file
would matter is `PROGRESS.md`, and the coordinator is its single writer.

---

## 4. Testing

Three layers, and what each can and cannot prove:

- **Unit tests over `src/core/`** prove the decisions: dispatch picks the right ready tasks,
  respects the ceiling, moves implemented tasks to review, serializes merges, and halts
  correctly; `reconcileTaskRow` touches one row and no other line; the parser reads the table
  and the gate. This is the bulk of the evidence and it runs in milliseconds.
- **The dry-run harness (Phase 2)** runs the whole loop against a fake platform (fake spawn /
  message / list / close and a scratch git repo), proving the loop drains a plan to all-`✅` with
  no live agent. It proves the wiring; it cannot prove the real CLI behaves as the fakes do.
- **Hand verification with the user (Phase 3)** is the only thing that proves a real background
  worker spawns, receives a message and acts on it, a fresh session reviews, a worker is closed
  cleanly, and a real branch merges to `main`. None of the automated layers can reach this, so
  it is in the table at §5.1 and verified by hand, small first.

---

## 5. Environment — read this before running anything

| | |
|---|---|
| OS | macOS (Darwin 25.5.0), aarch64 |
| Language / runtime | Node v24.2.0 (built-in test runner), npm 11.4.2 |
| Toolchain | git 2.50.1 (worktree), `claude` 2.1.263 (cross-session messaging ≥ 2.1.248, present) |
| **Deliberately absent** | No `bats` (bash tests considered and rejected — §7). No product code or test setup existed before this plan; both are introduced by T01. |

**The test command.**

```
npm test
```

which runs `NO_COLOR=1 node --test --test-reporter=dot` over `src/**/*.test.mjs` (exact
invocation settled by T01 on the machine). **It is the only evidence a session may produce on
its own.**

**It is cheap to read when it passes.** The dot reporter prints one character per test and a
short summary, not a line per assertion, so a green run is a few lines, and the exit code
carries the result. To see full detail while debugging, a person runs
`node --test --test-reporter=spec src/**/*.test.mjs`.

**No colour.** `NO_COLOR=1` is set inside the command rather than trusted from the environment,
because `FORCE_COLOR` / `CI` / `CLICOLOR_FORCE` force colour even down a pipe and override
`NO_COLOR`. T01 checks `env | grep -i color` on this machine and records anything forcing it.

**Loud on failure.** A failing test prints its name, file, line and the assertion diff in full,
and the exit code is non-zero. T01 must not suppress it.

**Dependencies.** The pure core and the shell use only the Node standard library and the
`claude` and `git` commands already on the machine — no runtime dependencies — because the
whole point is portability into any project. A dev-only dependency may be added by a decision of
the user, one at a time, never mid-task.

### 5.1 What the test command cannot reach

| Cannot be tested automatically | Why it needs a person |
|---|---|
| A real `claude --bg` worker spawns in a worktree and returns a usable id | Spawns a live, paid agent process |
| A message from coordinator to a running worker is received and acted on | Live cross-session messaging; T00 |
| A fresh session reviewing a worker's `🔍` task on the same worktree | Live session behaviour; T00 |
| Closing a worker: `claude stop` then worktree removed | Acts on a live session and real worktrees |
| A real branch merging to `main`, serialized, worktree removed | Mutates real git history |
| The kill switch stopping every live worker | Requires live workers to stop |

### 5.2 Seatbelts

| Flag / mechanism | Default | Effect |
|---|---|---|
| `PARALLEL_DRY_RUN=1` | on in all tests | Spawn / message / list / close / merge hit the fakes and a scratch repo, never a real agent or `main` |
| Scratch plan + scratch repo | used for T00, T07, T09 | The dangerous operations run against a throwaway plan and repo, never the real project |
| Worker ceiling = 4 | always on | Bounds how many real agents can exist at once |
| Kill-switch flag | always available | One file halts all dispatch and delivery and stops every worker |

**Never ask the user to run the unbounded version to find something out, and never run it
yourself.** No spike or task spawns real long-running paid agents against real branches. The
first real spawn (T07) is one worker, one trivial task, on a scratch plan, ceiling at its
minimum, kill switch wired.

---

## 6. Recovery

- **A leaked worktree or branch** (worker crashed, coordinator killed mid-loop):
  `claude agents --json` lists live sessions with their state; `git worktree list` lists
  worktrees. `claude stop <id>` stops a session and `claude rm <id>` removes it and its worktree
  when clean; `git worktree remove` and `git branch -D` clean the rest. The coordinator does
  this on its next pass, but a person can do it by hand from those commands.
- **The coordinator is confused or runaway:** create the `HALT` control flag file. All dispatch
  and delivery stop and every worker is stopped. Remove the flag and restart the coordinator to
  continue from `PROGRESS.md`.
- **`main` is dirty or a merge went wrong:** only the coordinator merges, one branch at a time,
  and only a branch a worker reported clean after integrating `main`. A bad merge is a normal
  `git` recovery on `main`; the worker branches are still on disk until close removes them.

---

## 7. Decisions and rationale

- **Lean on Claude Code's own primitives; build only the PIR glue.** A platform survey
  (2026-09-07) established that background sessions, per-session worktrees, cross-session
  messaging and stop/remove are all built in and all work headless in any project. The earlier
  plan rebuilt these in custom code; the re-scope replaces the custom spawn/transport/mailbox/
  kill machinery with the platform and keeps only the state protocol and the decision loop.
  Chosen with the user 2026-09-07 after they asked whether we were reinventing the wheel.
- **Down-channel is `SendMessage`, not `claude --resume -p`.** The brief assumed `--resume -p`
  would inject a turn into a running worker; the docs say it resumes a stopped session in a new
  terminal instead. Cross-session messaging is the correct, already-built primitive. This
  correction removed a spike and a chunk of custom transport.
- **Fresh-eyes review is a separate session, not a `/clear`.** Pointing a new session at the
  worker's worktree gives a reviewer with no implementer context by construction, which is
  cleaner and removed the "can `/clear` be driven" spike.
- **Coordinator shape: a conversational skill, not a batch workflow.** Claude Code's dynamic
  workflows could express implement-then-review fan-out, but they are more fire-and-forget and
  surface human input as approval prompts. The user chose a coordinator they talk to (2026-09-07)
  because decisions routing through the user in conversation is the supervision model they want.
- **Test stack: Node built-in `node --test`.** Chosen over `bats` and Python for zero
  dependencies, quiet-on-pass, natural boundary enforcement, and matching the sibling project.
  Chosen with the user 2026-09-07.
- **Worker ceiling 4 kept; message-rate and hop-depth caps dropped.** The ceiling still bounds
  the real runaway vector (the coordinator spawning workers). Rate and hop caps guarded a model
  where workers spawn and free-message workers, which the re-scoped design does not have, and
  the platform throttles bursts. Revisited with the user 2026-09-07.
- **Kill switch is hard-stop only.** Pause/resume was offered and declined; restart from
  `PROGRESS.md` already gives a clean resume. Chosen with the user 2026-09-07.
- **Merge conflicts: worker resolves, escalates if stuck.** The worker holds the task context.
  Chosen with the user 2026-09-07.
- **Close is a first-class worker operation.** The user required that the coordinator be able to
  close a worker, not only create and drive it (2026-09-07). Close is what the kill switch and
  crash-cleanup depend on, so it is designed in.
- **`PROGRESS.md` is coordinator-owned on `main`, folded row by row.** A shared file every
  branch edits would conflict on its single-line fields; folding one task row with a pure
  function avoids that and keeps the coordinator the single writer of the cross-cutting lines.

---

## 8. Explicitly out of scope

- **A cockpit or visual supervision layer.** The mode is CLI-and-platform only, so it is
  portable; a cockpit could later add an optional visual layer as a separate concern.
- **A batch-workflow shape for the coordinator.** Considered and set aside in favour of the
  conversational coordinator; the workflow feature stays available to a user who wants it, but
  this mode does not build on it.
- **Agent teams.** Claude Code's agent-teams feature is experimental, opt-in and interactive
  only, so it is not a foundation this portable mode can rest on.
- **Cross-project or cross-machine coordination.** Same-repo, same-machine only, for a tight
  blast radius; cross-machine messaging needs Remote Control and is not built.
- **A custom file mailbox and its locking.** Cross-session messaging replaces it; building a
  second transport would be the exact wheel-reinvention this re-scope removed.
- **Message-rate and hop-depth caps, budget-metering, cooldown/backoff, and pause/resume of the
  kill switch.** Each guards a failure mode the re-scoped design does not have, or duplicates a
  platform behaviour; all deliberately not built.
- **Changing the classic single-stream flow in any way.** It keeps its exact contract.
