# Parallel PIR — Design

## 1. Purpose

The framework today runs one session at a time: the user types `/pir-work {slug}`, one task
is built or reviewed, the session stops, and the user types it again. This is deliberate and
it stays. Parallel PIR adds a second way to run the same plan: a **coordinator** session that
the user talks to, which spawns many **worker** sessions at once — each in its own isolated
workspace — so independent tasks are built and reviewed concurrently instead of one after
another. The classic flow is untouched; this is an added mode a project opts into per run.

It must work in any project that installs the framework, using only the plain `claude`
command, `git`, and shared files on disk. It depends on no cockpit or IDE, because the whole
value is that a project gets parallelism without adopting anything else.

### Success criteria

- A user starts a coordinator on a reviewed plan, and independent tasks are implemented and
  reviewed concurrently, each in its own worktree and branch, with no manual per-task typing.
- Every task still gets the fresh-eyes review the base method guarantees: the session that
  reviews a task never carries the implementation in context.
- The user sees every cross-agent message, every decision routes through the user, and one
  kill switch halts everything.
- The decision logic (which task is ready, is a cap breached, is it halted, how a finished
  task folds back) runs and is proven with no live agents, in the ordinary test command.
- Nothing dangerous — a real agent spawn, a real merge to `main` — runs before its logic has
  been rehearsed in a fake world and then hand-verified with the user, small first.

### Stance

- **Parallel mode is additive, never a replacement.** The single-stream flow keeps its exact
  contract. A session that finds the two modes inconsistent fixes the parallel mode, not the
  classic one.
- **The existing skills are reused unchanged.** Workers run the stock `pir-work` /
  `pir-implement` / `pir-review`. Parallelism is wrapped around them, not sewn into them,
  because forking those skills would split the method in two and double every future fix.
- **Fresh eyes come from a context reset, not a second machine.** A worker implements its
  task, wipes its own memory, and reviews its own work on the same worktree. The user
  confirmed a context-reset same worker is a legitimate reviewer in their practice.
- **The user supervises by observing, not by approving each send.** Messages deliver
  immediately; the user watches and can intervene, rather than gating every message.

---

## 2. Behaviour specification

### 2.1 The run

1. The user starts a coordinator (`/pir-coordinate {slug}`) and points it at a plan whose
   `PROGRESS.md` says it has been reviewed. If the plan is not reviewed, the coordinator
   refuses, exactly as `pir-work` does — an unreviewed plan copies its defects into every
   task, and running many tasks at once multiplies that.
2. The coordinator reads the task table, finds every task whose dependencies are `✅` and
   which is not already assigned, and — up to the worker ceiling — spawns a worker for each in
   its own worktree and branch. `coordinator → worker` is direct and immediate.
3. A worker owns its task end to end: it runs `pir-work` (which implements the task and marks
   it `🔍`), then resets to fresh context and runs `pir-work` again on the same worktree
   (which reviews its own work and marks it `✅`). Fresh eyes come from the reset between the
   two runs, not from a different agent.
4. If a worker hits a question or decision at any phase, it writes a message to the shared
   mailbox and waits. The coordinator surfaces it to the user; the user's answer is sent back
   down to that worker immediately.
5. When a worker's task is reviewed and clean, it brings its branch up to date with `main`
   and writes a "done" message to the mailbox. `worker → coordinator` is indirect and async:
   the coordinator reads it when it reaches a natural break in its own loop, never by
   interrupt.
6. The coordinator merges that branch into `main`, **closes the worker** (stops its session
   and removes its worktree and branch), and dispatches the next ready task.

### 2.2 The two directions are deliberately asymmetric

- **coordinator → worker: direct, immediate.** The coordinator directs and a worker acts on
  the instruction at once. Mechanism is settled by the T00 spike (§5.1 / T00).
- **worker → coordinator: indirect, async mailbox.** A worker writes a file; the coordinator
  reads it at a natural break. The reason is that the coordinator is running its own loop, and
  an interrupt-driven inbox would corrupt what it is mid-way through — a half-applied merge is
  worse than a message read a few seconds late.

### 2.3 The worker lifecycle: create, drive, close

The coordinator owns a worker's whole life, and it must be able to end it, not only start it.
Three operations:

- **create** — `git worktree add` a fresh worktree and branch off current `main`, then spawn a
  background `claude` session with its cwd in that worktree, handed the one task.
- **drive** — send a turn to the worker (the task, an answer to its question, the instruction
  to reset context and review). The exact mechanism is the T00 spike's output.
- **close** — stop the worker's session and remove its worktree and branch.

**Close exists for three reasons, and all three are why it is a first-class operation rather
than an afterthought.** Normal end-of-task teardown after a merge; the hard-stop kill switch,
which must tear every worker down at once; and cleaning up a worker that crashed or was
abandoned so its worktree does not leak. A design that can spawn but not reliably close leaks
worktrees and cannot honour its own kill switch.

### 2.4 The rails

- **Same repo only.** A worker communicates only with teammates on the same project, for a
  tight blast radius. Because workers live in worktrees, "same repo" is resolved from each
  agent's live cwd and its shared git dir (`git rev-parse --git-common-dir`), not a naive path
  match — see the measured gotcha in §5.1.
- **The user supervises.** Every message is visible, every decision routes through the user,
  and supervision is observe-and-intervene, not approve-each-send.
- **Hard caps, logged never silent.** Chosen over budget-metering and cooldown/backoff for
  predictability and because a hard cap is the easiest thing to seatbelt.
  - **Message rate:** 5 messages per agent per minute.
  - **Hop depth:** a chain of handoffs started by one message dies after 6 hops.
  - **Worker ceiling:** at most 4 workers exist at once. This is the strongest runaway vector,
    because the coordinator spawns its own workers and spawn-plus-message compounds.
  - Hitting any cap is written to the log with which cap and which agent. A silent cap is a
    runaway nobody can see.
- **Kill switch: hard stop only.** A control flag file. While it is present the coordinator
  dispatches nothing and delivers nothing, and it closes every live worker. There is no pause
  or resume: to continue, the user removes the flag and restarts the coordinator, which reads
  `PROGRESS.md` and picks up from the recorded task states. Hard-stop-only was chosen over a
  pause/resume pair because restart-from-`PROGRESS.md` already gives a clean resume and a
  second mode is more machinery to build and to reason about under pressure.

### 2.5 The unhappy paths

- **Two workers finish at once.** Merges to `main` are serialized: the coordinator merges one
  branch at a time. A worker brings its branch up to date with `main` before it signals done,
  so at merge time its only change to shared files is its own task's work.
- **A real merge conflict.** When a worker integrates `main` and hits a conflict in code, the
  worker attempts the resolution, because it holds its task's context. If it cannot resolve
  cleanly it writes a decision message to the mailbox and waits for the user. The coordinator
  never merges a dirty branch.
- **`PROGRESS.md` contention.** `PROGRESS.md` is the one file every session writes, so
  parallel workers would collide on it. The coordinator owns `PROGRESS.md` on `main`. A worker
  edits only its own task's row on its own branch (the stock skills do this). At merge time the
  coordinator does not rely on git's line merge for `PROGRESS.md`: it reads the worker's task
  row from the branch and folds just that row into `main`'s `PROGRESS.md` with a pure function
  (§3.3), leaving the coordinator-managed lines — Status, `Next pir-work will:`, Review queue —
  alone. This sidesteps the guaranteed conflict on those single-line fields, which several
  branches all edit.
- **A worker crashes or is abandoned.** Its worktree and branch are left behind. The
  coordinator's close operation removes them; cleanup runs on the next loop pass that notices
  the worker is gone, so a dead worker does not hold a slot under the ceiling forever.
- **The kill switch fires mid-task.** In-flight workers are closed. Their branches are left on
  disk unmerged for inspection; nothing half-done reaches `main`, because only the coordinator
  merges and it stops first. Restart re-dispatches whatever `PROGRESS.md` still shows unbuilt.

---

## 3. Architecture

### 3.1 The boundary

```
src/core/    — pure. Takes inputs as parameters, returns decisions. No clock, no I/O,
               no process spawn, no network. The current time and the presence of control
               flags arrive as arguments.
src/shell/   — everything platform-shaped: git, the claude CLI, the filesystem, the loop.
               As thin as it can be; it executes what core decides.
```

The reason is testability. Everything in `core/` is proven exhaustively in milliseconds in
the ordinary test run. Everything in `shell/` can only be established by a person watching
real agents and real merges, which is slow and sometimes unavailable. **Every rule that leaks
across the boundary becomes a rule only a person can check.**

**What enforces it:** `src/core/boundary.test.mjs` scans every file in `src/core/` for
forbidden references — `node:fs`, `node:child_process`, `node:net`, `fetch(`, `Date.now`,
`new Date(` with no argument, `Math.random` — and fails if it finds one. **If that test fails
the fix is to move the code into `shell/` and pass the result in as a parameter, never to
relax the test.** The test is the rule; the code is what bends.

### 3.2 Modules

Pure (`src/core/`):

- `progress.mjs` — parse `PROGRESS.md` into a structured task table and the plan-reviewed
  gate; fold one finished task's row back into a `PROGRESS.md` text. Depends on nothing.
- `dispatch.mjs` — decide what to do this pass: which tasks are ready to spawn, which workers
  to close, which branches are ready to merge. A function of the task table, the current
  assignments, the worker ceiling, and the halted flag. Depends on `progress.mjs` shapes.
- `caps.mjs` — the message-rate window, the hop-depth check, and the halted check. Each
  returns allow/deny and a reason string for the log. Time and flag presence arrive as
  arguments. Depends on `mailbox.mjs` message shape for hop depth.
- `mailbox.mjs` — format and parse a mailbox message, and read its provenance (from, to, task,
  hop count). Pure text in, struct out. The filesystem read and write live in `shell/`.

Shell (`src/shell/`):

- `agents.mjs` — spawn a background worker (`claude --bg` in a worktree cwd), drive it, list
  live agents (`claude agents --json`), and close it (`claude stop` then `rm`). Owns the T00
  spike's chosen mechanisms.
- `worktree.mjs` — create a worktree and branch, integrate `main`, merge a branch to `main`
  serialized, and remove a worktree and branch.
- `mailboxfs.mjs` — the mailbox directory: write a message atomically (write to a temp name,
  rename into place), list messages, mark one consumed. Calls `mailbox.mjs` to format/parse.
- `control.mjs` — read the control flag file and the log; the halted check reads the flag,
  `caps.mjs` decides on it.
- `loop.mjs` — the coordinator's outer cycle: gather state, call `dispatch.mjs`, execute its
  actions, honour caps and the kill switch, repeat. The thin driver behind the
  `pir-coordinate` skill.

### 3.3 The decision function

`decideDispatch({ tasks, assignments, maxWorkers, halted })` is where the behaviour comes
together, and it is a function of its arguments and nothing else.

- `tasks` — the parsed `PROGRESS.md` table: each `{ num, name, deps, state }`.
- `assignments` — which task each live worker holds, and that worker's phase (implementing,
  reviewing, awaiting-answer, done).
- `maxWorkers` — the ceiling (4).
- `halted` — whether the kill-switch flag is present.

It returns `{ spawn: [taskNum…], merge: [branch…], close: [workerId…] }`:

- If `halted`, `spawn` and `merge` are empty and `close` is every live worker.
- Otherwise `spawn` is the ready `⬜` tasks (all deps `✅`, not already assigned), capped so
  live-plus-spawned never exceeds `maxWorkers`, lowest task number first.
- `merge` is the branches of workers reporting done, at most one per pass (serialized).
- `close` is the workers whose task has merged, plus any worker the agent list shows is gone.

Reconciling a finished task into shared progress is the other pure function:
`reconcileTaskRow(mainProgressText, { num, state, notes })` returns a new `PROGRESS.md` text
with only that task's row changed and the coordinator-managed lines left alone.

### 3.4 Data flow

```
PROGRESS.md ──parse──▶ tasks ─┐
mailbox/    ──parse──▶ msgs  ─┤
claude agents --json ─▶ live ─┼─▶ decideDispatch ─▶ actions ─▶ shell executes:
control flag ─────────▶ halt ─┘                                spawn / drive / merge / close
                                                                       │
                            reconcileTaskRow ◀── worker's task row ◀────┘ (on merge)
                                    │
                                    ▼
                                PROGRESS.md (on main, coordinator-owned)
```

### 3.5 Storage

State lives in three places, all on disk and all plain text so a person can read them under
pressure:

- `PROGRESS.md` on `main` — the task states, owned by the coordinator.
- `plans/{slug}/.parallel/mailbox/` — one file per message. Messages are written to a temp
  name and renamed into place so a half-written file is never read. A consumed message is
  moved to a `consumed/` subdirectory, not deleted, so the user can see the history.
- `plans/{slug}/.parallel/control/` — the kill-switch flag file (`HALT`), and `log` for the
  cap-hit and lifecycle record.

On a crash mid-write, the rename discipline means a reader sees either the old state or the
new one, never a torn file. The worktrees themselves are git's, under `.git/worktrees/`, and
`git worktree remove` is the recovery for a leaked one.

---

## 4. Testing

Three layers, and what each can and cannot prove:

- **Unit tests over `src/core/`** prove the decisions: dispatch picks the right ready tasks
  and respects the ceiling; caps allow and deny at the right boundaries; hop depth counts
  correctly; the mailbox round-trips; `reconcileTaskRow` touches one row and no other line.
  This is the bulk of the evidence and it runs in milliseconds.
- **The dry-run harness (Phase 2)** runs the whole loop against a fake agent registry and a
  scratch git repo, proving the loop drains a plan to all-`✅` with no live agent. It proves
  the wiring; it cannot prove the real CLI behaves as the fakes do.
- **Hand verification with the user (Phase 3)** is the only thing that proves a real
  `claude --bg` worker spawns, acts on a driven turn, resets context, reviews, and is closed
  cleanly, and that a real branch merges to `main`. None of the automated layers can reach
  this — it is agents, worktrees and merges — so it is in the table at §5.1 and verified by
  hand, small first.

---

## 5. Environment — read this before running anything

| | |
|---|---|
| OS | macOS (Darwin 25.5.0), aarch64 |
| Language / runtime | Node v24.2.0 (built-in test runner), npm 11.4.2 |
| Toolchain | git 2.50.1 (worktree), `claude` 2.1.263 |
| **Deliberately absent** | No `bats` (bash tests were considered and rejected — see §7). No product code or test setup existed before this plan; both are introduced by T01. |

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

**No colour.** `NO_COLOR=1` is set inside the command rather than trusted from the
environment, because `FORCE_COLOR` / `CI` / `CLICOLOR_FORCE` force colour even down a pipe and
override `NO_COLOR`. T01 checks `env | grep -i color` on this machine and records anything
that was forcing it.

**Loud on failure.** A failing test prints its name, file, line, and the assertion diff in
full, and the exit code is non-zero. This is the dot reporter's default and T01 must not
suppress it.

**Dependencies.** The pure core and the shell use only the Node standard library — no runtime
dependencies — because the whole point is portability into any project. A dev-only dependency
may be added by a decision of the user, one at a time, never mid-task.

### 5.1 What the test command cannot reach

| Cannot be tested automatically | Why it needs a person |
|---|---|
| A real `claude --bg` worker spawns in a worktree and returns a usable id | Spawns a live, paid agent process |
| Driving a turn into a running worker (immediate down-channel) | Depends on live CLI behaviour; T00 |
| A worker resetting to fresh context and reviewing its own work | Live session behaviour; T00 |
| Closing a worker: `claude stop` then `rm`, worktree gone | Acts on a live session and real worktrees |
| A real branch merging to `main`, serialized, and its worktree removed | Mutates real git history |
| The kill switch tearing every live worker down | Requires live workers to tear down |

### 5.2 Seatbelts

| Flag / mechanism | Default | Effect |
|---|---|---|
| `PARALLEL_DRY_RUN=1` | on in all tests | Spawn / drive / merge / close hit the fake registry and a scratch repo, never a real agent or `main` |
| Scratch plan + scratch repo | used for T00, T11, T13 | The dangerous operations run against a throwaway plan and a throwaway git repo, never the real project |
| Worker ceiling = 4, rate = 5/min | always on | Bounds how many real agents can exist and how fast messages flow |
| Kill-switch flag | always available | One file halts all dispatch and delivery and closes every worker |

**Never ask the user to run the unbounded version to find something out, and never run it
yourself.** No spike or task spawns real long-running paid agents against real branches. The
first real spawn (T11) is one worker, one trivial task, on a scratch plan, with the ceiling at
its minimum and the kill switch wired.

---

## 6. Recovery

- **A leaked worktree or branch** (worker crashed, coordinator killed mid-loop):
  `claude agents --json` lists live sessions; `git worktree list` lists worktrees.
  `claude rm <id>` closes a session and removes its worktree when safe; `git worktree remove`
  and `git branch -D` clean the rest. The coordinator does this automatically on its next
  pass, but a person can do it by hand from these two commands.
- **The coordinator is confused or runaway:** create the `HALT` control flag file. All
  dispatch and delivery stop and every worker is closed. Remove the flag and restart the
  coordinator to continue from `PROGRESS.md`.
- **`main` is dirty or a merge went wrong:** only the coordinator merges, one branch at a
  time, and only a branch a worker reported clean after integrating `main`. A bad merge is a
  normal `git` recovery on `main`; the worker branches are still on disk until close removes
  them.

---

## 7. Decisions and rationale

- **Test stack: Node built-in `node --test`.** Alternatives were `bats` (bash, closest to
  `install.sh`) and Python `unittest`. Node won because it is already installed, needs no
  dependency, is quiet on pass, enforces the pure boundary more naturally than shell, and
  matches the sibling `agentic-ide` project's `.mjs` style. Chosen with the user 2026-09-07.
- **Coordinator is a new skill, not an extension of `pir-work`.** `pir-work`'s contract is one
  unit of work then stop; the coordinator loops. Overloading it would break the contract every
  other skill relies on. Decided from the Stage 4 survey.
- **Workers run the stock skills unchanged.** Forking `pir-implement` / `pir-review` for
  parallel mode would split the method and double every future fix. Parallelism is wrapped
  around them via the worker contract (T10) and the spawn instruction.
- **Caps: 5/min, 6 hops, 4 workers.** Starting points chosen with the user 2026-09-07 for
  enough parallelism to matter while staying watchable; all three are tunable constants.
- **Kill switch is hard-stop only.** Pause/resume was offered and declined; restart from
  `PROGRESS.md` already gives a clean resume, and a second mode is more to build and reason
  about. Chosen with the user 2026-09-07.
- **Merge conflicts: worker resolves, escalates if stuck.** The worker holds the task context,
  so it attempts the resolution and only pulls in the user when a human judgement is needed.
  Chosen with the user 2026-09-07.
- **Close is a first-class worker operation.** The user required that the coordinator be able
  to close a worker, not only create and drive it (2026-09-07). Close is what the kill switch
  and crash-cleanup depend on, so it is designed in, not bolted on.
- **`PROGRESS.md` is coordinator-owned on `main`, folded row by row.** A shared file every
  branch edits would conflict on its single-line fields. Folding one task row with a pure
  function avoids that and keeps the coordinator the single writer of the cross-cutting lines.

---

## 8. Explicitly out of scope

- **A cockpit or visual supervision layer.** The feature is deliberately CLI-and-files only so
  it is portable into any project; a cockpit could later add an optional visual layer as a
  separate concern.
- **Cross-project coordination.** Same-repo only, for a tight blast radius. Workers on
  different projects never see each other.
- **Budget-metering or cooldown/backoff rails.** Hard caps were chosen instead for
  predictability and easier seatbelting; a metered budget is not built.
- **Pause/resume of the kill switch.** Hard-stop plus restart-from-`PROGRESS.md` is the whole
  mechanism; a resumable pause is deliberately not built.
- **Changing the classic single-stream flow in any way.** It keeps its exact contract; this
  mode is additive.
