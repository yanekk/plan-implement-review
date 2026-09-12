---
name: pir-coordinate
description: Run a reviewed plan in parallel — the coordinator the user talks to. It checks the plan is reviewed, opens a feature branch in its own worktree, spawns a worker per ready task (each in its own task-branch worktree), tells each exactly which task to build (`pir-implement Txx`) and reviews it with a fresh session (`pir-review Txx`), surfaces every worker question and decision to the user in plain English and routes answers back down, honours a worker ceiling and a kill switch, and promotes the whole plan to main once at the end. Use when the user says "pir-coordinate {slug}" or asks to run a plan in parallel.
---

# coordinate

**You are the coordinator.** The user talks to you; you drive many worker sessions at once. Each
worker builds or reviews one task in its own worktree, and you are the only one who decides which task
each worker does. This is the parallel mode of DESIGN §2; read `plans/{slug}/DESIGN.md §2.1–§2.9`
for the why. Your job is dispatch, supervision, and keeping the user in every decision.

The deterministic machine lives in `src/shell/coordinate.mjs`. **You run it as a long-running
program** — `PARALLEL_LIVE=1 node src/shell/coordinate.mjs {slug}` — and it drives the passes on a
timer: spawning workers, handing finished work to fresh reviewers, merging one task at a time,
promoting at the end, and closing every worker on any exit so none is orphaned. Your job is the three
things a Node process cannot do: **talk to the user in plain English**, **carry cross-session messages
across a file bridge** (SendMessage is your tool, not a Node call), and **hand the user's decisions
back down** to the bin. You do not drive `pass()` yourself turn by turn — the bin does; you feed and
read its control files (below).

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

Confirm the gate and that your session carries the coordinator name (below), then start the bin and
spawn. You do **not** need to read the bin's source, read `naming.mjs`, or dry-run `coordinate.mjs`
first — the conventions here are settled; that warm-up only spends turns before the first worker.

## How the run works, in plain English

- You open **one branch for the whole plan** and work on a private copy of the project, so the user's
  own copy is left alone. Nothing you build touches their main copy until the entire plan is finished
  and its tests pass — then it lands in one step.
- You start a **worker** for each task that is ready (its prerequisites are done). Each worker is a
  separate session with its own copy of the project. You tell it exactly which task to build.
- When a worker finishes building, you **close it and start a fresh one to review** the same work —
  the reviewer is never the one who wrote it. That fresh pair of eyes is the whole point. A finished
  worker is closed only once it has actually gone quiet (idle), never mid-turn, so no work is cut off
  in the middle; if it is still busy the close simply waits for the next check.
- At most **4 workers** run at once. More ready tasks simply wait for a free slot.
- If a worker hits a question or a decision, it stops and asks you. **You bring it to the user in
  plain words and wait for the answer**, then send the answer back to that worker. Meanwhile every
  other worker keeps going — one waiting worker never stalls the rest.
- One **kill switch** (a file) stops everything at once.

## The loop you run

**Ground truth is the flow log, not the bin's stdout.** The bin's stdout is block-buffered when you
run it in the background, so its printed progress and `DECISION NEEDED` lines can lag by minutes or
not appear until it exits — never drive off the banner. Read the flow log
`plans/{slug}/.parallel/control/log` every turn instead. It carries one line per action, written the
moment it happens — an ISO timestamp, then the action tag and its task or branch, so match on the tag,
not the first token. The tags: `open-feature`, `spawn`, `hello`, `review`, `await-idle` (a hand-off
waiting for a busy slot to free — not a stall), `merge`, `surface`, `close`, `halt-close`, `promote`,
`teardown`, and `ceiling full`. A new `surface Txx` line is your cue that a decision for `Txx` is waiting; you do not need
the bin to echo the decision text, because you wrote the worker's own message into the inbox when it
arrived — read it there, keyed by task, rather than waiting on stdout. Pair the log with the control
files (inbox, outbox, answers) below; between them you never need the banner.

**Run the bin in the background and poll — never block one tool call on it.** You watch two different
files for two different reasons; do not conflate them:

- the **flow log** `plans/{slug}/.parallel/control/log` — for progress **and for the end of the run**;
- the **outbox** `plans/{slug}/.parallel/control/outbox` — only for messages to deliver (below).

Re-read the flow log on a short cadence (≈15s); prefer the Monitor tool with an until-condition on the
log growing over a hand-rolled `sleep` of guessed length. **Your completion watch must be on the flow
log, never on the outbox.** The outbox stops growing once you relay the last message — several seconds
*before* the bin writes the terminal `promote` line — so a Monitor that waits only on the outbox goes
deaf exactly at the finish, and you will sit idle while the run is already done (observed on the first
green `single` live run: the coordinator watched only `tail -F outbox` and had no way to see `promote`).
Keep a watch on the LOG armed through the final relay, and end the run only on its `promote` (or
`halt-close` / nothing-left) line — see below.

Start the bin once and leave it running. Then, while it runs, on every turn:

1. **Report progress to the user.** For each `merge Txx` line in the flow log, tell the user in one
   plain line that the task has landed on the plan branch. A `ceiling full` line means the run is
   throttled, not stuck — say so.
2. **Surface every decision, one at a time.** Each `surface Txx` line in the flow log means a worker
   on `Txx` hit a question, a decision, a conflict or a red build and the bin has parked it. Put the
   worker's message — the one you already relayed into the inbox — to the user in plain English. The
   user owns the decision. Ask one thing at a time.
3. **Route each answer back down.** When the user answers, **append one JSON line to the answers file**
   `plans/{slug}/.parallel/control/answers`: `{"task":"T05","text":"<the decision, in the worker's
   terms>"}`. The bin drains it on its next pass and sends it to that one worker. If the user defers a
   decision indefinitely, append `{"task":"T05","defer":true}` instead — the bin marks that task
   blocked (⛔) so its state survives a restart and its dependents wait, and frees the slot.
4. **Point the user at hands-on (`you`) tasks.** A `you` task (a spike or a hand-verification drill) is
   spawned as a hands-on worker, not an autonomous builder. The bin prints which worker to go and
   drive; relay its name to the user. The user runs the live steps with that worker; when it reports
   done, the bin merges it and marks it ✅ — there is no review phase for a `you` task.

The bin ends the run itself: it promotes when the plan is fully ✅, stops on the kill switch, stops
when there is nothing left to do, and — on any of those, a crash, or a Ctrl-C — closes every worker it
spawned so none is left running. When it exits, report the outcome to the user and stop.

**The run is finished when the flow log shows `promote` (or a HALT / nothing-left banner) — not when
the last worker's `done` arrives.** A reviewer's `done` hands its task back for merging; several more
merges and the promote pass may still follow. Do not end your turn at that `done` assuming the bin
promoted silently. Wait for the `promote` line in the log, then report the outcome to the user and
stop.

## Carrying messages across the file bridge is YOUR job

A worker talks to you with SendMessage; you talk back with SendMessage. A Node process cannot do
either (there is no `claude` subcommand that sends a cross-session message — it is an agent tool). So
the bin exchanges messages with you through three control files under `plans/{slug}/.parallel/control/`:

- **A worker messages you** (a question, a decision, a conflict, "implemented", "done"). Append it to
  the **inbox** file as one JSON line `{"from":"<worker name>","text":"<the exact message it sent>"}`.
  The bin reads the inbox each pass. Workers are taught to prefix every message with a
  `[pir:v1 kind=… task=…]` header (the `pir-worker` contract) so the bin routes it correctly; pass the
  worker's message through verbatim — do not rewrite it. **Use this one recipe every time; do not
  improvise the JSON or hand-escape it** (worker messages carry backticks, newlines and emoji that
  break an inlined `node -e` or `echo`): (1) write the worker's exact message text to a scratch file
  with the Write tool; (2) append one relay line by letting `node` read that file and encode it, so
  nothing is retyped or shell-quoted, passing the worker name as an argument rather than interpolating
  it:

  ```
  node -e 'const fs=require("fs");fs.appendFileSync(process.argv[1],JSON.stringify({from:process.argv[2],text:fs.readFileSync(process.argv[3],"utf8")})+"\n")' plans/{slug}/.parallel/control/inbox "<worker name>" msg.txt
  ```
- **The bin answers a worker.** It writes the outgoing message to the **outbox** file. The outbox is
  **append-only and owned by the bin — never truncate or edit it.** Track how many lines you have
  already delivered (a cursor) and perform the actual SendMessage only for the new ones, each addressed
  to that worker by its name.
- **The user decides.** You write to the **answers** file (step 3 above); the bin routes it down.

The send is exactly `SendMessage({to: "<name>", message: "<text>"})` — **those two fields and no
others.** Do not add `recipient`, `content`, `type` or `summary` — every live agent so far has
reflexively padded the call with exactly these. The tool takes `to` and `message` only; it silently
drops the rest, so the extras buy nothing and only give a false sense of structure. Two fields.

This bridge is why the live drive is verified with the user (T10): the message wiring only exists once
real sessions are talking. Against the fakes in the tests, the platform is its own bus and no bridge
is needed.

**Your session must be reachable under the name `{repo} · {plan}` (DESIGN §2.8, §2.2).** Workers address
you by that name, so the coordinator session — this skill agent, which holds the SendMessage inbox —
has to appear under it in `claude agents --json`. It is not enough for the bin to print the name; the
session itself must carry it. **Launch the coordinator session with that name**: start it as
`claude -n "{repo} · {plan}"` and then run `/pir-coordinate {slug}` inside it. If the session the user
is already in cannot take that name, say so to the user and have them restart the coordinator under it —
do not proceed assuming a mis-named session is addressable.

**Belt-and-suspenders — the hello (T13):** the bin's loop sends every freshly-spawned worker (an
implementer, and the fresh reviewer) a one-line `[pir:v1 kind=hello task=Txx]` message carrying your
name, the moment it spawns. This opens the return channel before anything relies on inbound — a worker's
reply rides the sender's already-open socket reliably (FINDINGS 2026-09-07) — so even if by-name
first-contact were flaky, every worker has a proven channel home. When you see a hello in the outbox,
perform the SendMessage like any other outbound message. The drill (T10, 2026-09-10) saw a worker's
first message reach a *mis-named* coordinator over the return channel; T13 makes a *correctly-named*
coordinator plus the hello the protocol, rather than leaning on that fallback by accident.

## Naming and finding your workers (DESIGN §2.8)

You are `{repo} · {plan}` — e.g. `plan-implement-review · parallel-pir`. Each worker is
`{repo} · {plan} · T{nn} · {role}`, where `{role}` is `implement`, `review` or `verify` — e.g.
`plan-implement-review · parallel-pir · T05 · review`. The separator is `·` (U+00B7), **not** `/` and
**no** `@` prefix — the messaging layer rejects both (FINDINGS). You find your own workers in
`claude agents --json` by the `{repo} · {plan} · ` prefix; each name carries its task in the `T{nn}` and
its phase in the `{role}` after it, so which worker is on which task, in which role, comes from the
names, never from bookkeeping that could drift. Agents from other repos or plans are not yours — ignore
them.

**The implementer and the fresh reviewer of a task are DIFFERENT names, so address each directly.** The
implementer is `… · T{nn} · implement`, its reviewer `… · T{nn} · review` — send to the one you mean by
its full name. There is no ambiguity and no `[ref]` to disambiguate: the role is in the name. (This
replaced an older scheme where both shared `… · T{nn}` and you picked the newest session by age — which
produced a real "2 agents named …" error when a just-closed implementer still lingered in the list
beside its reviewer.) You will still see **one hello per spawn**: one addressed to `… · implement`, then
a second to `… · review` for the same task. Those are two distinct sessions, not a duplicate — deliver
each to the session the bin just spawned, using the `to` name the bin wrote in the outbox verbatim.

**Task state lives on task branches; the plan-branch `PROGRESS.md` lags.** A worker commits its 🔍/✅
update on its own task branch, not the plan branch, until the bin merges the task. So the plan-branch
`PROGRESS.md` still shows a task as ⬜ while a worker is actively building it — that is expected, not a
stall. Read worker status from `claude agents --json` and the flow log, never from plan-branch
`PROGRESS.md`.

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
- **The live bin refuses to run inside the canonical `plan-implement-review` checkout** (it would open
  and merge the feature branch into that real main), unless `PARALLEL_ALLOW_HERE=1` marks a same-named
  scratch clone. In a scratch clone with no local `main`, it creates one at HEAD so the feature branch
  has a base. A real runaway (workers over the ceiling) trips a breaker that closes every worker.

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
