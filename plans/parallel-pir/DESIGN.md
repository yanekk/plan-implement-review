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
- **The coordinator dispatches; workers never self-select.** In classic mode `pir-work` reads
  `PROGRESS.md` and picks the next task itself. In parallel mode that cannot work — every worker
  would read the same file and grab the same lowest-ready task and collide. So the coordinator is
  the dispatcher: it decides task and phase and tells each worker exactly what to do, sending it
  `pir-implement Txx` to build or `pir-review Txx` to review. Workers run the stock implement and
  review procedures unchanged in their logic; the change is only that those skills gain an explicit
  task entry point so the coordinator can name the task, rather than being reached only through
  `pir-work`'s own selection. `pir-work` itself is not used inside a worker.
- **The base rule "only `pir-work` invokes implement/review, one task per invocation" is bent
  deliberately, and its guarantee relocated.** That rule exists to keep the reviewer from being the
  implementer. In parallel mode the coordinator keeps that guarantee a different way — it spawns a
  fresh session for the review — so it is allowed to invoke the phases directly. Written down here
  so a later session does not "fix" it back.
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
   and running many at once multiplies that. The coordinator opens one **feature branch** for the
   whole plan, `pir/{plan}`, off `main`, **in its own worktree**, and works there — so the user's
   main checkout is left on `main`, undisturbed. `main` is not touched again until the plan is
   done (§2.9).
2. The coordinator reads the task table, finds every `auto` task whose dependencies are `✅` and
   which is not already assigned, and — up to the worker ceiling — spawns a worker for each: a
   background `claude` session whose working directory is a fresh worktree on a **task branch**,
   `pir/{plan}/T{nn}`, cut from the **feature branch** (not from `main`), so the worker starts from
   whatever sibling tasks have already merged. It tells that worker `pir-implement Txx` for the
   specific task it chose. The coordinator, not the worker, decides which task the worker builds.
   A ready `you` task is spawned too, but as a **hands-on** worker (`pir-verify Txx`, §2.6): the
   coordinator points the user at it, the user runs the live commands and the worker records the
   findings, and it skips review — step 3 below is the `auto` path only.
3. The worker runs `pir-implement Txx`, which implements that task and marks it `🔍` on its task
   branch. When the worker reports implemented, the coordinator **closes the implement session**
   and spawns a **fresh** session pointed at the same worktree and tells it `pir-review Txx`,
   which reviews the work and marks it `✅`. Closing the implementer as the reviewer starts means
   a task in review holds one worker slot, not two, and no two live sessions ever share a name.
   Fresh eyes come from that being a different session with no implementer context, and the
   coordinator is what guarantees the reviewer is never the implementer.
4. If a worker hits a question or decision at any phase, it sends the coordinator a message and
   waits. The coordinator surfaces it to the user; the user's answer is sent straight back down
   to that worker.
5. When the task is reviewed and clean, the worker brings its task branch up to date with the
   **feature branch** and sends the coordinator a "done" message. `worker → coordinator` is
   indirect and async: the coordinator reads its inbox at a natural break in its loop, never by
   interrupt, because an interrupt mid-merge is worse than a message read a few seconds late.
6. The coordinator merges that task branch into the **feature branch** (serialized, one at a time),
   **closes the worker** (stops its session and removes its worktree and task branch), and
   dispatches the next ready task. Nothing has reached `main` yet.
7. When every task is `✅` and no worker is live, the coordinator promotes the plan: it runs the
   test command on the feature branch, and if green merges the **feature branch into `main`** — the
   one and only merge to `main` — then reports completion. This is the plan landing atomically
   (§2.9).

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

- **create** — spawn a background `claude` session whose cwd is a fresh worktree on a task branch
  `pir/{plan}/T{nn}` cut from the **feature branch** (§2.9), handed the one task and a short
  contract (§2.1, and the worker contract skill).
- **drive** — send the worker a message (an answer to its question, the instruction to hand off
  to review). The review session is a *separate* fresh spawn on the same worktree, and the
  implement session is closed as that reviewer starts (§2.1), so one task in review holds one slot.
- **close** — stop the worker's session and remove its worktree and task branch.

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
- **Two workers finish at once.** Merges into the feature branch are serialized: the coordinator
  merges one task branch at a time. A worker brings its task branch up to date with the feature
  branch before it signals done, so at merge time its only change to shared files is its own task's
  work.
- **A real merge conflict.** When a worker integrates the feature branch and hits a conflict in
  code, the worker attempts the resolution, because it holds its task's context. If it cannot
  resolve cleanly it sends the coordinator a decision message and waits for the user. The
  coordinator never merges a dirty branch into the feature branch.
- **`PROGRESS.md` contention.** `PROGRESS.md` is the one file every session writes, so parallel
  workers would collide on it. The coordinator owns `PROGRESS.md` on the **feature branch**. A
  worker edits only its own task's row on its own task branch (the stock skills do this). At merge
  time the coordinator does not rely on git's line merge for `PROGRESS.md`: it reads the worker's
  task row from the task branch and folds just that row into the feature branch's `PROGRESS.md`
  with a pure function (§3.3), leaving the coordinator-managed lines — Status, `Next pir-work
  will:`, Review queue — alone. That sidesteps the guaranteed conflict on those single-line fields.
  The finished `PROGRESS.md`, all `✅`, reaches `main` with the feature branch at promotion.
- **A worker crashes or is abandoned.** Its worktree and task branch are left behind. The
  coordinator's close removes them; cleanup runs on the next loop pass that notices the worker
  is gone (its `state` in `claude agents --json`), so a dead worker does not hold a slot forever.
- **The kill switch fires mid-task.** In-flight workers are stopped. Their task branches and the
  feature branch are left on disk for inspection; `main` is untouched, because the only merge to
  `main` is the final promotion and the coordinator stops before it. Restart re-opens the same
  feature branch and re-dispatches whatever `PROGRESS.md` on it still shows unbuilt.

### 2.6 Which tasks a worker builds, and which a person runs with a worker

Not every task is work an autonomous worker can finish. A spike is a person running seatbelted
commands and recording what they saw; a hand-verification drill is a person watching real agents.
A worker cannot safely stand in for the person here — it has no code to produce, and the design
forbids an agent spawning real paid agents against real branches on its own (§5.2). But the
coordinator should not carry that task's exploratory back-and-forth in its own context either — a
spike is noisy, and the coordinator stays a clean dispatcher.

So every task carries a marker, decided at plan time and recorded in `PROGRESS.md`:

- **`auto`** — an autonomous worker produces this task's deliverable (code and tests), even if it
  also has a hand-verified half it escalates to the user through the normal question path (§2.5).
  Most tasks are `auto`.
- **`you`** — the task's completion is a person's actions with no deliverable a worker could
  produce: a spike, or a hand-verification drill. The coordinator still spawns a worker for it,
  but a **hands-on** one: the person runs the live commands themselves and reports what they saw,
  and the worker is the scribe that records it into `FINDINGS.md` on its task branch. The user
  works with that worker directly, so the exploration lands in the worker's context, not the
  coordinator's.

The marker is a `Runs` column in the `PROGRESS.md` task table, `auto` or `you`, defaulting to
`auto` when a plan predates the column so classic plans still parse. The coordinator reads it and
spawns the matching kind of worker: an autonomous builder for `auto`, a hands-on scribe for `you`.
A hands-on worker gets the same task worktree and branch off the feature branch as any worker
(§2.9); its instruction is the worker contract's hands-on mode (`pir-verify Txx`, T07), not
`pir-implement`, and the coordinator tells the user which worker to go and drive.

**A `you` worker has no fresh-review phase and folds back like any task.** There is no code for a
second session to review; the person's recorded observation is the result, so a `you` worker goes
straight from hands-on to done, skipping review. When the user finishes and the worker reports
done, the coordinator merges its task branch into the feature branch and reconciles the row to
`✅` with `reconcileTaskRow` (§3.3) — reading the file diff, never the conversation, so it stays
the single writer of `PROGRESS.md` and its own context stays clean. A `you` worker counts against
the worker ceiling and holds its slot while the user works, which correctly throttles the run to
human speed. A `you` task the user defers is marked `⛔` and its dependents wait; nothing
downstream of an unrun spike is dispatched. This matters because a `you` task can sit on the
critical path — the T00 spike gates T07 and T08 — so the run genuinely pauses at human speed until
the user runs it, which is the correct behaviour, not a stall to design around.

### 2.7 Planning for parallelism

A parallel coordinator is only as valuable as the width of the plan it is given. A plan that is a
single long dependency chain drains no faster in parallel than one task at a time, because every
task waits on the one before it. So the planning method (`/pir-plan`) is taught to produce plans
that parallelise honestly, and to show the user how parallel a plan actually is.

Two rules, and one report:

- **Declare only real dependencies.** A dependency that is not genuinely required serializes work
  that could run at once, and it is invisible cost — nothing downstream flags it. The planner
  declares a dependency only when a task truly cannot start until another is done.
- **Never fake width.** The incentive is honest independence, not the appearance of it. Cutting a
  real dependency to make a plan look wide is worse than an honest chain: it produces workers that
  collide or build on work that is not there. Reviewability and correct task boundaries win over
  throughput every time; parallelism is a property to surface, never to force.
- **Report the shape.** At the plan checkpoint the planner shows the user the plan's parallel
  width — the longest dependency chain, the widest set of tasks that could run together, and how
  many tasks are `you` rather than `auto` — computed by `analyzeParallelism` (§3.2). This is what
  lets the user see, before a line is built, whether a plan will actually benefit from the
  coordinator or is serial by nature.

This is a change to the shared planning method and its templates, so it affects the classic flow
too. The classic flow simply ignores the width report and the `Runs` marker; nothing it does
changes, and a plan is now honest about its own shape whether or not it is ever run in parallel.

### 2.8 Naming and addressing

Every agent has a deterministic name, so agents address each other by a name anyone can predict
rather than an opaque session id handed around out of band:

- **Coordinator:** `@{repo} / {plan}` — e.g. `@plan-implement-review / parallel-pir`.
- **Worker:** `@{repo} / {plan} / T{nn}` — e.g. `@plan-implement-review / parallel-pir / T05`.

The name is set at spawn with `claude --bg -n "<name>"` (FINDINGS.md), and it is what
`claude agents --json` shows and what a worker uses to message the coordinator. Three things fall
out of it, which is why the convention is worth fixing rather than leaving names incidental:

- **A worker addresses the coordinator by name without being told an id.** It knows the repo and
  the plan, so it can construct `@{repo} / {plan}` itself. The coordinator still passes the worker
  its own name at spawn for clarity, but the scheme means no id has to be discovered.
- **The coordinator finds and identifies its workers from the name alone.** Its workers are the
  agents whose name starts with `@{repo} / {plan} / T`, and the task each holds is the `T{nn}` at
  the end. So the coordinator can rebuild "which worker is on which task" purely from
  `claude agents --json`, without separate bookkeeping that could drift from reality.
- **The user reads `claude agents` and sees exactly who is doing what**, across every repo and
  plan on the machine, because the name carries the repo, the plan and the task.

The name identifies the repo, plan and task, not the phase: the implement session and the fresh
review session for one task carry the same `@{repo} / {plan} / T{nn}` name, but they do not run at
once — the implement session is closed as the review session spawns (§2.1), so at most one live
session ever holds a given task name. The coordinator tracks the phase from the worker's own
messages (implemented, done) and the task state in `PROGRESS.md`, so the name never has to carry
the phase. The name gives identity and task; the lifecycle gives phase.

The name format is pure string work (`naming.mjs`, §3.2) so it is tested directly; T00 confirms
that `--name` sets the `agents --json` name and that messaging addresses by it on this version.

### 2.9 The branch model: a feature branch, task branches, one merge to main

The whole plan runs on a single **feature branch**, `pir/{plan}`, cut from `main` when the
coordinator starts. Workers cut **task branches**, `pir/{plan}/T{nn}`, from the feature branch, and
their finished work merges back into the feature branch. `main` receives the plan exactly once, at
the end, when the feature branch is promoted.

```
main ──●───────────────────────────────────────────────────●  (one merge, at the end)
        \                                                  /
         ● pir/{plan}  (feature branch) ──●────●────●─────●   task branches merge in, serialized
            \            \            \
             ● T01        ● T02        ● T05     (task branches, cut from the feature branch)
```

Why this and not merging each task straight to `main`:

- **`main` never holds a half-finished plan.** A plan is atomic on `main`: either the whole
  reviewed plan is there or none of it is. A run stopped by the kill switch, a crash, or the user
  walking away leaves `main` exactly as it was.
- **Workers integrate siblings' work, safely.** A task branch is cut from the feature branch and
  integrates the feature branch before handoff, so a worker sees tasks that merged before it —
  without that churn ever touching `main`.
- **The promotion is one reviewable step.** When every task is `✅` and no worker is live, the
  coordinator runs the test command on the feature branch and, if green, merges it to `main` and
  reports. The test run before promotion is the last gate; a red feature branch is not promoted,
  and the coordinator surfaces that to the user rather than merging.

This is a further, deliberate departure from the base method's "main checkout, main branch, always"
rule, on top of the worktrees parallel mode already uses. The classic single-stream flow keeps that
rule; parallel mode replaces it with this feature-branch model, and the reason — an atomic,
reviewable landing on `main` — is why. Because `pir-implement` tells every session that base rule
"applies in full", the exemption is written where those sessions read it: a parallel-mode carve-out
in `CLAUDE.md § Where sessions run` (T11) and in the `pir-worker` contract (T07), so a worker in a
task-branch worktree does not follow the base rule and halt on contact with its own worktree. The
coordinator itself runs `pir/{plan}` in its own worktree, so the user's main checkout is never
switched off `main`. The final promotion is the single most consequential action the coordinator
takes, so it is gated on the tests passing and announced to the user; making it a manual
confirmation instead is a one-line change if the user prefers.

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

- `progress.mjs` — parse `PROGRESS.md` into a structured task table (including each task's `Runs`
  marker, §2.6) and the plan-reviewed gate, and fold one finished task's row back into a
  `PROGRESS.md` text. Depends on nothing.
- `dispatch.mjs` — decide what to do this pass: which tasks to spawn a worker for (each tagged
  `auto` or `you`, so the loop spawns a builder or a hands-on scribe), which worker to move into
  review, which branch to merge, and which workers to close. A function of the task table, the
  current worker assignments, the worker ceiling and the halted flag. Depends on the `progress.mjs`
  shapes.
- `parallelism.mjs` — `analyzeParallelism` over the task graph: the longest dependency chain, the
  widest set of tasks that could run at once, and the `auto`/`you` counts (§2.7). Used by the
  planner's width report; a pure function of the task list. Depends on the `progress.mjs` shapes.
- `naming.mjs` — build and parse the agent names of §2.8: `coordinatorName`, `workerName`, and
  `parseAgentName` (a name back to its repo, plan and task). Pure string work. The loop uses
  `parseAgentName` over `claude agents --json` to rebuild the `assignments` `decideDispatch`
  consumes, so worker-to-task state comes from the names and cannot drift from separate bookkeeping.

Shell (`src/shell/`):

- `platform.mjs` — the thin wrapper over Claude Code: spawn a background worker in a worktree cwd
  with its `--name` set by `naming.mjs` (§2.8), send a worker a message and read the coordinator's
  inbox (cross-session messaging), list live workers with their state (`claude agents --json`,
  same-repo resolution, names parsed by `naming.mjs`), and close a worker (`claude stop` then
  remove its worktree). This is where the T00 spike's confirmed mechanisms live.
- `worktree.mjs` — open the feature branch off `main` in its own worktree (the coordinator works
  there, leaving the user's main checkout on `main`); create a task worktree and branch off the
  feature branch; integrate the feature branch into a task branch; merge a task branch into the
  feature branch, serialized; promote the feature branch to `main`; and remove a worktree and
  branch (§2.9).
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

It returns `{ spawn, review, merge, close, promoteToMain }`:

- If `halted`, `spawn`, `review`, `merge` are empty, `promoteToMain` is false, and `close` is
  every live worker.
- `spawn` is the ready `⬜` tasks (all deps `✅`, not already assigned), each as `{ num, runs }`
  with its `auto`/`you` marker, capped so live-plus-spawned never exceeds `maxWorkers`, lowest task
  number first. The loop spawns an autonomous builder for an `auto` entry and a hands-on scribe for
  a `you` entry (§2.6); both kinds hold a worker slot.
- `review` is the workers that reported implemented (`🔍`) and need a fresh review session. Only
  `auto` workers ever reach this — a `you` worker has no code to review and goes straight to done
  (§2.6).
- `merge` is the task branches of workers reporting done, at most one per pass (serialized), merged
  into the feature branch (§2.9).
- `close` is the workers whose task merged, plus the implement session of any task that has just
  been handed a fresh reviewer (the implementer is closed as review starts, §2.1), plus any
  assignment the agent list shows is dead.
- `promoteToMain` is true only when every task is `✅` and no worker is live: the signal to run the
  tests on the feature branch and, if green, merge it to `main` (§2.9). It is the one path to `main`.

Reconciling a finished task into shared progress is the other pure function:
`reconcileTaskRow(progressText, { num, state, notes })` returns a new `PROGRESS.md` text with only
that task's row changed and the coordinator-managed lines left alone. The coordinator applies it to
the feature branch's `PROGRESS.md` (§2.9).

### 3.4 Data flow

```
PROGRESS.md ────────parse──▶ tasks ─┐   (feature branch)
claude agents --json ──────▶ live  ─┼─▶ decideDispatch ─▶ { spawn, review, merge,
coordinator inbox (messages) ─────  ┤                         close, promoteToMain }
control flag ──────────────▶ halt ──┘                         │
                                                              ▼  shell executes via platform.mjs
                                     spawn builder|hands-on / send / spawn-review / merge→feature /
                                     close / promote feature→main (when all ✅)
                            reconcileTaskRow ◀── worker's task row ◀── (on merge into feature)
                                    │
                                    ▼
                          PROGRESS.md on the feature branch (coordinator-owned) → main at promotion
```

### 3.5 Storage

State lives on disk, plain text so a person can read it under pressure:

- `PROGRESS.md` on the **feature branch** — the task states, owned by the coordinator; it reaches
  `main` with the feature branch at promotion.
- `plans/{slug}/.parallel/control/` — the kill-switch flag file (`HALT`) and `log` for the
  ceiling-hit and lifecycle record. Gitignored (`plans/*/.parallel/`, added by T01): it is
  per-run control state, so it must never be committed to a task branch or ride the feature
  branch to `main` at promotion.
- The feature branch `pir/{plan}` and the task branches `pir/{plan}/T{nn}` and their worktrees —
  git's, under `.git/worktrees/`; `git worktree remove` is the recovery for a leaked one.

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

which runs `FORCE_COLOR=0 NO_COLOR=1 node --test --test-reporter=dot` over `src/**/*.test.mjs`
(exact invocation settled by T01 on the machine). **It is the only evidence a session may
produce on its own.**

**It is cheap to read when it passes.** The dot reporter prints one character per test and a
short summary, not a line per assertion, so a green run is a few lines, and the exit code
carries the result. To see full detail while debugging, a person runs
`node --test --test-reporter=spec src/**/*.test.mjs`.

**No colour.** `FORCE_COLOR=0` is set inside the command, not just `NO_COLOR=1`, because a set
`FORCE_COLOR` overrides `NO_COLOR`: Node's test runner then ignores `NO_COLOR` (it prints a
warning and colours anyway). Measured on this machine 2026-09-07 — `FORCE_COLOR=3` is present in
the environment, so `NO_COLOR=1` alone still produced ANSI escapes; `FORCE_COLOR=0` inside the
command produces clean dot output (FINDINGS.md). `NO_COLOR=1` is kept as the fallback for an
environment with neither set. T01 checks `env | grep -i color` on this machine and records
anything forcing it.

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
| A task branch merging into the feature branch, serialized, worktree removed | Mutates real git history |
| Promoting the feature branch to `main` at plan completion | The one merge to `main`; mutates it |
| The kill switch stopping every live worker | Requires live workers to stop |

### 5.2 Seatbelts

| Flag / mechanism | Default | Effect |
|---|---|---|
| `PARALLEL_DRY_RUN=1` | on in all tests | Spawn / message / list / close / merge hit the fakes and a scratch repo, never a real agent or `main` |
| Scratch plan + scratch repo | used for T00, T08, T10 | The dangerous operations run against a throwaway plan and repo, never the real project |
| Worker ceiling = 4 | always on | Bounds how many real agents can exist at once |
| Kill-switch flag | always available | One file halts all dispatch and delivery and stops every worker |

**Never ask the user to run the unbounded version to find something out, and never run it
yourself.** No spike or task spawns real long-running paid agents against real branches. The
first real spawn (T08) is one worker, one trivial task, on a scratch plan, ceiling at its
minimum, kill switch wired.

---

## 6. Recovery

- **A leaked worktree or branch** (worker crashed, coordinator killed mid-loop):
  `claude agents --json` lists live sessions with their state; `git worktree list` lists
  worktrees. `claude stop <id>` stops a session and `claude rm <id>` removes it and its worktree
  when clean; `git worktree remove` and `git branch -D` clean the rest. The coordinator does
  this on its next pass, but a person can do it by hand from those commands.
- **The coordinator is confused or runaway:** create the `HALT` control flag file. All dispatch
  and delivery stop and every worker is stopped. `main` is untouched (nothing merges to it until
  promotion). Remove the flag and restart the coordinator, which re-opens the feature branch
  `pir/{plan}` and continues from its `PROGRESS.md`.
- **A merge went wrong on the feature branch:** the coordinator merges one task branch at a time
  into the feature branch, only a branch a worker reported clean after integrating the feature
  branch. A bad merge is a normal `git` recovery on the feature branch; `main` is not involved.
  The task branches are on disk until close removes them.
- **Abandon the whole plan:** delete the feature branch `pir/{plan}` and its task branches. `main`
  never received anything, so there is nothing to revert.

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
- **Tasks are marked `auto` or `you`; the coordinator spawns an autonomous builder for `auto` and
  a hands-on scribe worker for `you`.** The user asked how the coordinator handles a task that
  needs a person, like the spike (2026-09-07). An autonomous worker cannot produce a spike's
  deliverable and must not spawn real paid agents itself (§5.2), so the person is irreplaceable for
  the doing. Revised the same day (2026-09-07): rather than the coordinator surfacing the task bare
  for the user to run in classic mode, it spawns a **hands-on** worker the user drives — the user
  runs the live commands, the worker records the findings — so the spike's noisy back-and-forth
  lands in the worker's context, not the coordinator's, keeping the coordinator a clean dispatcher.
- **The coordinator dispatches a specific task and phase; workers run `pir-implement Txx` /
  `pir-review Txx`, never `pir-work`.** The user pointed out that `pir-work` self-selects the next
  task, so parallel workers would all pick the same one (2026-09-07). Task selection moves to the
  coordinator's `decideDispatch`, and the worker is told exactly which task and phase to run. This
  needs `pir-implement` / `pir-review` to accept an explicit task; their logic is unchanged.
- **A feature branch per plan; task branches off it; one merge to `main` at the end.** The user
  set this branch model (2026-09-07). The coordinator works on `pir/{plan}` off `main`; workers cut
  `pir/{plan}/T{nn}` off the feature branch and merge back into it, serialized; the feature branch
  is promoted to `main` once, when every task is `✅` and the tests pass on it. Chosen over merging
  each task straight to `main` because it keeps `main` free of a half-finished plan, lets the plan
  land atomically and reviewably, and makes the kill switch and a crash leave `main` untouched
  (§2.9). It is a further deliberate departure from "main checkout, main branch, always"; the
  classic flow keeps that rule.
- **Agents are named `@{repo} / {plan}` and `@{repo} / {plan} / T{nn}`.** The user set this
  convention (2026-09-07). Deterministic names mean a worker addresses the coordinator without
  being handed an id, the coordinator identifies its workers and their tasks from the name alone
  (so worker-to-task state cannot drift from separate bookkeeping), and the user reads
  `claude agents` and sees who is doing what. Set with `claude --bg -n` (§2.8).
- **The planning method is taught to plan for parallelism, in this plan.** The user chose to fold
  this in rather than defer it (2026-09-07). `/pir-plan` declares only real dependencies, marks
  each task `auto`/`you`, and reports a plan's parallel width so the user sees how much the
  coordinator will help. The incentive rewards honest independence only; faking width by cutting a
  real dependency is explicitly out (§2.7). It changes the shared method, which the classic flow
  ignores harmlessly.
- **The main-checkout rule is carved out for parallel mode, and the coordinator runs in its own
  worktree.** Decided at plan review (2026-09-07). `pir-implement` tells every session that
  CLAUDE.md's "main checkout, main branch, always; stop if in a worktree" rule applies in full, so
  a parallel-mode worker — which lives in a task-branch worktree by design — would halt on contact
  with its own worktree. No task wrote the exemption. The fix: a parallel-mode carve-out in
  `CLAUDE.md § Where sessions run` (T11) and in the `pir-worker` contract (T07), and the coordinator
  runs `pir/{plan}` in its own worktree so the user's main checkout is never switched off `main`
  (§2.9). The alternative — switching the user's checkout to the feature branch — was declined
  because it disturbs the working copy and fights the classic flow that shares the checkout.
- **The implement session is closed when its fresh reviewer spawns.** Decided at plan review
  (2026-09-07). The design otherwise left both sessions live, so one task in review held two of the
  four worker slots and halved effective concurrency. Closing the implementer as review starts frees
  the slot, and fresh eyes are strongest once the implementer is gone; the reviewer can still
  escalate a rework need through the normal question path. `decideDispatch.close` carries this (§3.3).
- **A `you` worker records to its task branch; the coordinator folds it back and marks `✅`.**
  Decided at plan review, then revised with the user the same day (2026-09-07) when the surface-only
  model was replaced by a hands-on worker (see the `auto`/`you` entry above). The hands-on worker
  writes its findings to `FINDINGS.md` on its own task branch; when the user reports the task done
  through it, the worker signals done, and the coordinator merges the branch and records `✅` on the
  feature branch with `reconcileTaskRow` — reading the file diff, never the exploration, so it stays
  the single writer of that file (§2.6) and its context stays clean. A `you` worker skips the
  fresh-review phase: there is no code deliverable to review. A `you` task the user defers is `⛔`
  and its dependents wait, so a critical-path spike like T00 (which gates T07/T08) pauses the run at
  human speed rather than stalling it.

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
