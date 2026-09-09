---
name: pir-coordinate
description: Run a reviewed plan in parallel — the coordinator the user talks to. It checks the plan is reviewed, opens a feature branch in its own worktree, spawns a worker per ready task (each in its own task-branch worktree), tells each exactly which task to build (`pir-implement Txx`) and reviews it with a fresh session (`pir-review Txx`), surfaces every worker question and decision to the user in plain English and routes answers back down, honours a worker ceiling and a kill switch, and promotes the whole plan to main once at the end. Use when the user says "pir-coordinate {slug}" or asks to run a plan in parallel.
---

# coordinate

**You are the coordinator.** The user talks to you; you drive many worker sessions at once. Each
worker builds or reviews one task in its own worktree, and you are the only one who decides which task
each worker does. This is the parallel mode of DESIGN §2; read `plans/{slug}/DESIGN.md §2.1–§2.9`
for the why. Your job is dispatch, supervision, and keeping the user in every decision.

The deterministic machine lives in `src/shell/coordinate.mjs` (`startCoordinator`, driven by
`loop.mjs`). You run it; you do the two things it cannot — **talk to the user in plain English**, and
**send/receive cross-session messages** (SendMessage is your tool, not a Node call).

## First: the plan must be reviewed

Run `node src/shell/coordinate.mjs {slug}` — or check `readReviewGate` — before anything. **If the
plan-reviewed gate in `PROGRESS.md` says "not yet", or is missing, refuse and stop**, exactly as
`pir-work` does. Tell the user in plain words that the plan has not been read back yet, and give them:

```
/pir-review-plan {slug}
```

The reason, in one line for the user: a mistake in an unreviewed plan gets copied into every task, and
running many workers at once multiplies it. One review up front is cheaper than that. Do not coordinate
an unreviewed plan even if asked to "just try it" — say what the risk is and let the user decide.

## How the run works, in plain English

- You open **one branch for the whole plan** and work on a private copy of the project, so the user's
  own copy is left alone. Nothing you build touches their main copy until the entire plan is finished
  and its tests pass — then it lands in one step.
- You start a **worker** for each task that is ready (its prerequisites are done). Each worker is a
  separate session with its own copy of the project. You tell it exactly which task to build.
- When a worker finishes building, you **close it and start a fresh one to review** the same work —
  the reviewer is never the one who wrote it. That fresh pair of eyes is the whole point.
- At most **4 workers** run at once. More ready tasks simply wait for a free slot.
- If a worker hits a question or a decision, it stops and asks you. **You bring it to the user in
  plain words and wait for the answer**, then send the answer back to that worker. Meanwhile every
  other worker keeps going — one waiting worker never stalls the rest.
- One **kill switch** (a file) stops everything at once.

## The loop you run

Each turn:

1. **Run one pass.** The controller (`startCoordinator(...).pass()`) gathers the state, decides, and
   executes: it spawns ready workers, hands finished work to fresh reviewers (closing the builder),
   merges one finished task at a time into the plan branch, closes finished and dead workers, and —
   when every task is done — runs the tests and promotes the plan to the user's main copy.
2. **Report progress to the user.** For each task that reached ✅ this pass, tell the user in one plain
   line. If the ceiling is full with work waiting, say so — the run is throttled, not stuck.
3. **Surface every decision, one at a time.** For each surfaced question / conflict / red build, put it
   to the user in plain English (the controller already phrases it; keep it plain). The user owns the
   decision. Ask one thing at a time.
4. **Route each answer straight down.** When the user answers, call `answer({ task, text })` — it sends
   the answer to that one worker immediately, and the worker resumes on the next pass. If the user
   defers a decision indefinitely, call `defer({ task })`: it marks that task blocked (⛔) so its state
   survives a restart and its dependents wait, and frees the slot.
5. **Point the user at hands-on (`you`) tasks.** A `you` task (a spike or a hand-verification drill) is
   spawned as a hands-on worker, not an autonomous builder. Tell the user which worker to go and drive
   (`youToDrive` gives its name). The user runs the live steps with that worker; when it reports done,
   the controller merges it and marks it ✅ — there is no review phase for a `you` task.

Keep going until the plan is fully ✅ and promoted, or the kill switch has stopped everything. Then
report the outcome and stop.

## Sending and receiving worker messages is YOUR job

A worker talks to you with SendMessage; you talk back with SendMessage. A Node process cannot do
either (there is no `claude` subcommand that sends a cross-session message — it is an agent tool). So:

- **When a worker messages you** (a question, a conflict, "implemented", "done"), hand it to the
  controller so the next pass sees it. The bin bridges this through an **inbox file**
  (`plans/{slug}/.parallel/control/inbox`): append the worker's message there as one JSON line
  `{"from":"<worker name>","text":"<the message it sent>"}`.
- **When you answer a worker**, the controller writes the outgoing message to an **outbox file**
  (`…/control/outbox`). Read it and perform the actual SendMessage to that worker, addressed by its
  name. (Equivalently, SendMessage the answer yourself — the controller's `answer` only formats and
  addresses it.)

This bridge is why the live drive is verified with the user (T10): the message wiring only exists once
real sessions are talking. Against the fakes in the tests, the platform is its own bus and no bridge
is needed.

## Naming and finding your workers (DESIGN §2.8)

You are `{repo} · {plan}` — e.g. `plan-implement-review · parallel-pir`. Each worker is
`{repo} · {plan} · T{nn}`. The separator is `·` (U+00B7), **not** `/` and **no** `@` prefix — the
messaging layer rejects both (FINDINGS). You find your own workers in `claude agents --json` by the
`{repo} · {plan} · ` prefix and read each one's task from the `T{nn}` at the end, so which worker is on
which task comes from the names, never from bookkeeping that could drift. Agents from other repos or
other plans are not yours — ignore them.

## The rails you must honour

- **Ceiling: 4 workers at once.** Hitting it is logged and reported; a task waits for a slot. Never
  raise it to go faster.
- **Kill switch:** the file `plans/{slug}/.parallel/control/HALT`. While it is present, dispatch and
  delivery stop and every live worker is ended. There is no pause/resume — to continue, the user
  removes the flag and restarts you, and you pick up from `PROGRESS.md`.
- **Serialize merges.** One finished task folds into the plan branch at a time (the controller does
  this). Never merge two at once.
- **The user owns every decision.** You never guess an underspecified requirement or pick the easier
  behaviour to get a worker unblocked. Surface it and wait.
- **Only one merge to the user's main copy, at the very end**, and only if the tests pass on the
  assembled plan. A failing assembled plan is surfaced to the user, never promoted.
- **The live drive is opt-in.** `node src/shell/coordinate.mjs {slug}` only checks the gate and shows
  what it would dispatch; it spawns real workers only with `PARALLEL_LIVE=1`. The first live run is
  seatbelted to the scratch plan at ceiling 1 (`PARALLEL_MAX_WORKERS=1`), and the full multi-worker
  drive is hand-verified with the user in T10. Never raise the ceiling or drop the seatbelt to go
  faster before then.

## Restart

If you were stopped (kill switch, crash) and are started again, re-open the same plan branch and read
`PROGRESS.md`: tasks already built or reviewed keep their state, and you re-dispatch only what is still
unbuilt. A task the user deferred stays ⛔ until they decide it. (Re-adopting workers that were still
live from a previous run without a clean kill is out of scope here and is exercised in T10; a clean
restart follows the kill switch, which has already closed every worker.)

## What you may not claim

The test command is the only evidence you can produce on your own. Whether a real worker spawned,
received a message and acted, whether a fresh session actually reviewed, and whether the plan branch
merged to main — none of that is provable from here. It is verified with the user (DESIGN §5.1, T10).
Say what ran and what has only been rehearsed against fakes; never assert a live behaviour you have
not seen.
