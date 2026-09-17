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
   `pir/{plan}-T{nn}`, cut from the **feature branch** (not from `main`), so the worker starts from
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

### 2.2 The two directions are asymmetric, and they use different transports (T25)

- **coordinator → worker: direct, immediate, over cross-session messaging.** The coordinator sends the
  worker a message and the worker acts on it. The transport is Claude Code's cross-session messaging
  (`SendMessage`), which works headless on this machine. It has to be messaging, because the receiver is
  a live agent session and only an agent can be messaged; a Node process cannot deliver one, so the bin
  writes the message to its outbox and the coordinator *skill agent* performs the SendMessage. Not
  `claude --resume -p`: that resumes a stopped session in a new terminal and does not inject a turn into
  a running one (FINDINGS.md, 2026-09-07).
- **worker → coordinator: indirect, async, over a shared file drop (T25).** The worker does NOT message
  the coordinator. It **writes its report as a file** into a shared drop-dir the coordinator's loop
  reads — `plans/{slug}/.parallel/control/reports/`, one `{from, text}` JSON file per report, written
  temp-then-rename so the loop never reads a half-written one. The loop is an ordinary Node process with
  no message inbox (SendMessage is agent-only), so the *old* design parked the coordinator agent in the
  path purely to catch each worker message and re-encode it into a file the loop read — a full agent
  turn per report, `implemented`/`done` included, measured at ~20–25% of the T19 run. Moving the report
  to a file the loop reads directly removes that agent turn entirely. The worker reaches the drop-dir
  through the shared git dir (`git rev-parse --git-common-dir`), which every worktree resolves to the
  same main checkout, so its own worktree not carrying the gitignored control dir is no obstacle. The
  loop still reads reports only at a natural break in its pass, never by interrupt. Changed with the PM
  2026-09-13 (T25), replacing the SendMessage up-channel; the measured before/after is recorded in
  FINDINGS.
- **The DOWN channel is opened lazily by the first real answer — there is no spawn hello (T30).** The
  coordinator sends a worker nothing at spawn; the worker builds from its opening prompt. The only
  down-send that ever happens is the answer to a worker that has parked on a question, decision or merge
  conflict, addressed by the worker's name. The spawn `hello` that once opened the channel eagerly was
  retired: it was a start-up ping nothing depended on (the T23 drill proved both hellos failed to send
  yet both workers still built the right thing from their spawn prompt), and its T13 "the reply rides
  the return channel" rationale was already gone once workers began reporting UP by file (T25). A moving
  part that could fail silently is removed; a genuinely undeliverable answer is now surfaced, not
  dropped (see the send-failure handling below). Decided with the user 2026-09-14 (T30); this narrows
  the T13 decision the §2.8 comms-protocol note records.
- **A failed answer down-send is surfaced, never silent (T30).** When the coordinator cannot deliver an
  answer to a parked worker — its `SendMessage` errors, or the worker is gone — it does not drop the
  message. It re-reads the outbox and retries the delivery, and if the worker is genuinely unreachable
  it tells the user in plain English and the bin records a `send-failed Txx` flow line so the failure is
  visible and capturable. The answer is the one message that genuinely matters — the user's decision
  reaching a blocked worker — so its loss must never pass unnoticed.

### 2.3 The worker lifecycle: create, drive, close

The coordinator owns a worker's whole life, and it must be able to end it, not only start it.

- **create** — spawn a background `claude` session whose cwd is a fresh worktree on a task branch
  `pir/{plan}-T{nn}` cut from the **feature branch** (§2.9), handed the one task and a short
  contract (§2.1, and the worker contract skill).
- **drive** — send the worker a message (an answer to its question, the instruction to hand off
  to review). The review session is a *separate* fresh spawn on the same worktree, and the
  implement session is closed as that reviewer starts (§2.1), so one task in review holds one slot.
- **close** — end the worker's session and remove its worktree and task branch. `claude stop`
  alone does NOT end a session: it interrupts the current turn and the session stays alive and
  listed (T08 live run, FINDINGS 2026-09-09). So close sends the worker's process SIGTERM — its
  pid comes from `claude agents --json` — which is what actually ends it. The leftover `stopped`
  record is then cleared with `claude rm <id>`, which the coordinator runs itself right after the
  close on every **normal finish** — a merged worker, a dead one it tore down, and the implementer it
  closes at a review hand-off — so a finished worker leaves the "Claude agents" view as it finishes
  instead of piling up one record per implement/review/verify session (T41). `claude rm` is
  best-effort (removing an id already gone is not an error) and acts on the same authoritative list id
  the close uses. **The kill switch is the one exception:** a HALT-killed worker's record is left in
  the view, exactly as its worktree and branch are left on disk, for forensics — removal is for
  workers that finished, not ones a hard stop killed (§2.4). The worktree and branch come down
  separately (below).
  **A close that follows a worker finishing its task waits for the worker to go idle first.** A
  worker that has just signalled `implemented` (about to be handed to a fresh reviewer) or `done`
  (about to be merged and closed) may still be finishing its turn; the agent list reports each
  session `idle` or `busy` (FINDINGS 2026-09-07), and the coordinator holds the close — keeping the
  slot — until the list shows the worker idle, so SIGTERM never cuts off work in flight. This is the
  session-idle analogue of the mid-*commit* close FINDINGS 2026-09-09 caught. Two closes do NOT wait:
  a **dead** worker (already gone from the list) is cleaned up at once — that is not a mid-work kill —
  and the **kill switch** ends every worker regardless of idleness (§2.4), because a hard stop is a
  hard stop. Decided with the user 2026-09-10 (T13).
  **The idle wait is bounded.** A worker that has already signalled `implemented`/`done` has committed
  its deliverable, so a session that stays `busy` for more than a few minutes past that signal is almost
  always a leftover background process, not work in flight — a test suite's daemon, a file-watcher, an
  `until … sleep` poll loop the worker left running. Past `AWAIT_IDLE_TIMEOUT_MS` (loop.mjs) the loop
  stops trusting the flag, forces the hand-off (or the merge-and-close), and logs a `force-idle` line.
  This UNBLOCKS the coordinator — it keeps the rule above (SIGTERM never cuts off work *in flight*, since
  a completion-reported worker's deliverable is already committed) while stopping one stuck session from
  stalling the whole run: the usage-limits run held T05 ~1h on its implementer and ~4h on its reviewer.
  **But force-idle is not cleanup.** Closing the session does NOT reliably kill the leaked process: a
  daemon that double-forks detaches from the session's process group and reparents to init, surviving the
  session's death — the usage-limits `cockpitd` daemons were still running 8+ hours later as pid-1
  orphans, and a `pkill -9` on the test *script* (rather than letting it exit) had skipped its own
  `trap … EXIT` and orphaned them in the first place. The reliable cleanup is the worker's: run the suite
  in the foreground so the script's `trap … EXIT` fires, and leave nothing running before going idle
  (`pir-worker` skill). The same rule binds the coordinator, which runs the pre-promotion suite itself —
  in the foreground, never as a background task that would leave a daemon behind when it ends. Added with
  the user's go-ahead after the usage-limits post-mortem.

**Close exists for three reasons, and all three are why it is first-class rather than an
afterthought.** Normal end-of-task teardown after a merge; the hard-stop kill switch, which
tears every worker down at once; and cleaning up a worker that crashed or was abandoned so its
worktree does not leak. A design that can spawn but not reliably close leaks workers and worktrees
and cannot honour its own kill switch. The worktree and branch come down with
`git worktree remove --force` and `git branch -D` (worktree.mjs), not `claude rm`, which keeps a
worktree that is not clean (FINDINGS.md).

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
  dispatches nothing and delivers nothing, and it ends every live worker — SIGTERM to each
  worker's pid, since `claude stop` only interrupts (§2.3, FINDINGS 2026-09-09).
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

  A conflict can also surface **later, at the coordinator's own merge**: a worker's integrate was clean
  when it signalled done, but another task changed the same lines before the coordinator merged this
  one, so `mergeTask` conflicts. The backstop here is **Option 2** (chosen 2026-09-13, built in T28):
  the coordinator **keeps that worker alive and parked** — it does not close it, remove its worktree,
  delete its task, or respawn it (a parked worker holds its slot; several stacking up throttle the run
  to human speed, which is correct). It surfaces the conflict to the user, routes the user's decision
  **down to that same worker**, and the worker resolves on its own branch — integrating the current
  feature branch, resolving the clashing file(s) as the decision says, committing, and re-signalling
  done. Only then does the coordinator merge the now-clean branch, the normal clean-merge path. The
  alternative (park it for a human and stop the whole plan) was rejected: one clash would strand the
  entire shipment until a person returned. The merge and the worker's close are **paired** — a worker
  is closed only after its branch has actually merged, so a conflict can never destroy the worker that
  must resolve it. And the coordinator never reports the decision as honoured without checking the
  merged result (the T22 live run closed the worker, respawned its task, and shipped the opposite side
  to `main` while reporting success; that whole failure is what Option 2 and this pairing close).
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
- **The kill switch fires mid-task.** In-flight workers are ended (SIGTERM). Their task branches and the
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
- **`you`** — the task's completion is a person's actions whose result is an observation: a
  spike, a hand-verification drill, or running a program a sibling `auto` task just built to
  confirm it does what it should. What makes a task `you` is that its result is something only a
  person can observe, not whether a worker produced the thing being observed — so a `you` task
  may verify a sibling `auto` task's deliverable (the build→verify split below). The coordinator
  still spawns a worker for it, but a **hands-on** one. That worker owns everything mechanical
  around the check: it brings the execution environment up and seeds it, runs whatever automated
  checks the machine can decide against it, hands the person a running thing to look at, and after
  the person has judged it tears the environment down and confirms it is down. The person's part is
  the judgement alone — looking at the running thing and saying whether it is right — not standing
  the environment up or down and not running a check a machine could run. The worker records the
  machine result it observed and the person's judgement into `FINDINGS.md` on its task branch and is
  its scribe. The user works with that worker directly, so the exploration lands in the worker's
  context, not the coordinator's.

**Setup and teardown are the worker's; judgement is the person's; guaranteed teardown is the
seatbelt.** Standing an execution environment up, seeding it, and tearing it down is mechanical,
not a judgement, so it belongs to the hands-on worker, not to the person who is there to look at
the result. The worker brings the stack up and seeds it before the hand-off, and tears it down and
confirms it is down before it marks the task done. That confirmed cleanup is what makes it safe for
a worker to bring a live environment up at all: it is the seatbelt (§5.2) that bounds the worker,
the way a dry-run flag or a scratch repo bounds any other dangerous operation. A worker that cannot
confirm teardown does not mark the task done — it escalates and says so out loud; leaving the
environment up for the person is the last resort, never the silent default. This does not loosen
§5.2's harder line: a worker still must not spawn real paid agents against real branches, and only
a person can watch a real agent run. What moves to the worker is the mechanical environment around
the check, not the judgement and not the forbidden spawn. Making teardown the worker's job also
removes a stall the T37 capstone hit: when the person owned `docker compose down`, a check-in that
the person walked away from left the worker's session busy and the coordinator's idle-gate never
cleared (the run sat idle ~4.5 min). With teardown on the worker, the worker goes idle the moment
it finishes, the idle-gate clears normally, and the coordinator surfaces what it is waiting for
instead of looking hung.

**The worker runs the automatable checks; the person judges only what a person can.** An automated
test is not a judgement — it is a mechanical, repeatable check with a machine-decidable answer, so
it belongs to the worker, not the person, exactly as bring-up and teardown do. The hands-on worker
installs whatever the check needs, runs it against the environment it brought up, and records the
machine result it actually observed (pass or fail, and the output). The person is asked only what a
machine cannot answer — the subjective look, whether the running thing is right. Pushing an
automated run onto the person is what produced the T37 capstone's one integrity blemish: asked an
ambiguous either/or, the person answered "full pass", and the scribe wrote down a specific manual
click-through the person never reported.

**The scribe records two separate confirmations and never rounds an ambiguous reply up.** The `✅`
FINDINGS row holds the machine result the worker observed and the person's judgement in the
person's own terms as two distinct facts; it never merges them into one claim, and it never
resolves an ambiguous reply toward the larger reading. If the person's answer does not clearly
cover the judgement that was asked, the worker re-asks and records only what the person explicitly
confirmed. A terse "full pass" to a two-part question is an ambiguity to resolve by asking, not by
choosing the bigger claim (`CLAUDE.md`: a genuine ambiguity is asked about, never silently
resolved).

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

**Verifying an `auto` task's deliverable: fold, or split.** Some `auto` tasks build something
whose real proof can only be a person running it — a program that has to be launched, a change
visible only on a real device or against real agents, anything the test command cannot reach.
There are two first-class ways to plan that check, and both coexist:

- **Fold** — the §2.5 question path. The builder does the check inside its own task: it builds,
  then parks and escalates through the normal question path, handing the user the exact
  seatbelted command and waiting for the answer, which it records. Use this when the check is a
  quick escalation the builder can present inline; the task stays one unit of work, one `auto`
  row.
- **Split** — the build is one `auto` task and the human check is a **separate `you` verify
  task that depends on it**. The builder is reviewed and merged on its own; the verify task is
  its own planned unit, a hands-on worker (`pir-verify`, §2.6) the user drives, and it folds
  back without review like any `you` task. Use this when the check is a first-class step whose
  result is an observation worth planning on its own — especially on real agents, real branches,
  or a real device — heavy enough that folding it would hold the builder's slot at human speed
  for too long, or valuable enough to earn its own row and dependency in the plan.

Neither replaces the other: the fold keeps a light check inside the builder, the split lifts a
heavy or first-class check into its own `you` task. A split verify task carries a **"Needs a
person" block** — what the person must judge, what to expect, and what only a person can answer —
so the hands-on worker has something concrete to put in front of the user, and, when the check
needs an environment stood up, a worker-owned setup/teardown pair beside it (the worker brings the
stack up before that block and tears it down after — the block itself is judgement only). The
dependency of the verify task on the builder is a real one (the verify cannot start until the
thing exists), so it is declared honestly and `analyzeParallelism` counts the verify task in the
`you` total like any other `you` task (§2.7).

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

- **Coordinator:** `{repo} · {plan}` — e.g. `plan-implement-review · parallel-pir`.
- **Worker:** `{repo} · {plan} · T{nn} · {role}` — e.g. `plan-implement-review · parallel-pir · T05 · review`. `{role}` is one of `implement`, `review`, `verify`.

The separator is `·` (U+00B7), not `/`: T00 found `SendMessage` rejects a name containing `/`
("to must be a bare teammate name"), because the addressing layer reads `/` as structure. The
separator is decoration, so any character with no special meaning to that parser serves; `·` was
chosen (2026-09-07). There is **no `@` prefix**: T07 confirmed live (2026-09-08) that `·` is
accepted by `SendMessage` — and, at the same time, that a name beginning with `@` draws the very
same "bare teammate name" rejection as `/`. The `@` was decorative, so the user dropped it
(2026-09-08); the name is the bare `{repo} · {plan}[ · T{nn} · {role}]`, which is also the shape
`claude agents --json` already shows (no `@`).

The name is set at spawn with `claude --bg -n "<name>"` (FINDINGS.md), and it is what
`claude agents --json` shows and what a worker uses to message the coordinator. Three things fall
out of it, which is why the convention is worth fixing rather than leaving names incidental:

- **A worker addresses the coordinator by name without being told an id.** It knows the repo and
  the plan, so it can construct `{repo} · {plan}` itself. The coordinator still passes the worker
  its own name at spawn for clarity, but the scheme means no id has to be discovered.
- **The coordinator finds and identifies its workers from the name alone.** Its workers are the
  agents whose name starts with `{repo} · {plan} · T`; the task each holds is the `T{nn}` and its
  phase the `{role}` after it. So the coordinator can rebuild "which worker is on which task, in which
  role" purely from `claude agents --json`, without separate bookkeeping that could drift from reality.
- **The user reads `claude agents` and sees exactly who is doing what**, across every repo and
  plan on the machine, because the name carries the repo, the plan and the task.

**How the coordinator session comes to carry `{repo} · {plan}` (T13, 2026-09-10).** For a worker's
by-name message to resolve, the coordinator *session* — the `pir-coordinate` skill agent that holds the
SendMessage inbox, not the `coordinate.mjs` bin it runs, which is an ordinary child process and no
addressable session — must appear under that name in `claude agents --json`. Nothing makes that happen
on its own: the T10 drill's coordinator was named `pir-t10 / pir-coordinate scratch` by the harness, a
shape that even contains `/`, which `SendMessage` rejects (FINDINGS 2026-09-07). So the coordinator
session is **launched under the deterministic name** with the same `-n` flag workers use —
`claude -n "{repo} · {plan}"`, then `/pir-coordinate {slug}` inside it (skills/pir-coordinate). The bin
computes the name with `coordinatorName` and prints it; the name is the address the coordinator sends
its answers FROM (there is no spawn hello carrying it any more, T30, and workers report UP by file not
by message, T25, so nothing depends on a worker resolving it at spawn). If a coordinator session
genuinely cannot be made to carry the name, that is a decision for the user, not a rule to invent around.

The name identifies the repo, plan, task **and role**: the implement session and the fresh review
session for one task are two distinct names (`… · T{nn} · implement` and `… · T{nn} · review`), so
the coordinator addresses each on its own, never by guessing which session was spawned most recently.
The implement session is still closed as the review session spawns (§2.1), so at most one live
session holds a task at a time; but in the brief hand-off overlap — and while a just-closed session
lingers in `claude agents --json` before it drops off — the two are told apart by name, not by age.
Putting the role in the name replaced an earlier scheme where the two shared one name and were
distinguished by recency: brittle, and it produced a real SendMessage ambiguity ("2 agents named …")
when the closed implementer still lingered beside its reviewer (single live run 2026-09-12; user
decision to rename). The coordinator still tracks lifecycle phase within a role from the worker's own
messages (implemented, done) and the task state in `PROGRESS.md`. The name gives identity, task and
role; the lifecycle gives progress within the role.

The name format is pure string work (`naming.mjs`, §3.2) so it is tested directly; T00 confirms
that `--name` sets the `agents --json` name and that messaging addresses by it on this version.

### 2.9 The branch model: a feature branch, task branches, one merge to main

The whole plan runs on a single **feature branch**, `pir/{plan}`, cut from `main` when the
coordinator starts. Workers cut **task branches**, `pir/{plan}-T{nn}`, from the feature branch, and
their finished work merges back into the feature branch. `main` receives the plan exactly once, at
the end, when the feature branch is promoted.

The task-branch separator is `-`, not `/`: git will not hold a branch `pir/{plan}` and a branch
`pir/{plan}/T{nn}` at the same time — the first is a ref file, the second needs a directory of the
same name, a directory/file clash git rejects ("cannot lock ref ... exists"). So task branches sit
beside the feature branch, not under it. Found building T05; the user chose the dash (2026-09-08).

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
  with its `--name` set by `naming.mjs` (§2.8), send a worker a message DOWN (cross-session messaging)
  and drain the worker reports the loop reads UP (the reports drop-dir, T25 — via the injected
  transport, so the module still owns only the wire format), list live workers with their state
  (`claude agents --json`,
  same-repo resolution, names parsed by `naming.mjs`), and close a worker (`claude stop` to
  interrupt, then SIGTERM its pid to actually end it — stop alone does not; the worktree comes
  down separately via worktree.mjs). This is where the platform's real, live-verified mechanisms live.
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
worker reports (drop-dir) ────────  ┤                         close, promoteToMain }
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
- `plans/{slug}/.parallel/control/` — the per-run control state: the kill-switch flag file (`HALT`),
  the `log` (the ceiling-hit and lifecycle record), and the file bridge between the loop and the
  coordinator agent (T25) — `reports/` (the worker→coordinator up-channel drop-dir, one file per
  report), `outbox` (coordinator→worker messages the agent delivers), `answers` (the user's decisions),
  and `surfaced` (each parked worker's message, rendered in plain English for the agent to relay).
  Gitignored (`plans/*/.parallel/`, added by T01): it is per-run control state, so it must never be
  committed to a task branch or ride the feature branch to `main` at promotion.
- The feature branch `pir/{plan}` and the task branches `pir/{plan}-T{nn}` and their worktrees —
  git's, under `.git/worktrees/`; `git worktree remove` is the recovery for a leaked one.

Messaging is asymmetric (§2.2, T25). DOWN (coordinator → worker) rides the platform's cross-session
messaging, not a file store — no custom mailbox to get wrong. UP (worker → coordinator) is a file store
this project does own, the `reports/` drop-dir, but it needs no locking: one file per report, written
temp-then-rename, so a reader never sees a half-written report and two workers writing at once produce
two distinct files, never a torn shared one. The other place a torn file would matter is `PROGRESS.md`,
and the coordinator is its single writer.

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
- **The live-scenario harness (Phase 5, §4.1)** turns that hand verification into repeatable,
  data-driven runs: it drives a real coordinator over real workers through a named scenario and
  captures the flow, the agent-status timeline and every transcript, then checks the run against
  declared facts. It still needs a person to launch (real paid agents), but the verdict is data,
  not recollection.

### 4.1 The live-scenario test harness (Phase 5)

The Phase 3 hand-verifications each proved a real behaviour once, by a person watching and
reporting. That is not repeatable and not data-driven: the record is a sentence in `FINDINGS.md`,
not the run itself. The harness fixes both — it runs a real coordinator over **real Claude
workers** through a scenario, captures everything the run produced, and checks it against the
facts that scenario must show. Decided with the user 2026-09-10 (Phase 5). It **folds in T10 and
T13's live half**: the drill and the comms proof become two of its scenarios, run with data
rather than by eye.

**All workers are real (PM decision 2026-09-10).** A scenario proves nothing about the
`pir-worker` contract unless a real model is the one following it, so the harness spawns real
`claude --bg` workers and drives them through hand-crafted fixture task docs designed to force
each path. The accepted cost: a live run is slower and a real model may occasionally not do
exactly what a fixture needs, so a scenario may need a re-run. Fixtures are engineered to be as
deterministic as a real worker allows (a merge conflict comes from two tasks that edit the same
line; a human decision comes from a task doc that deliberately leaves one thing unspecified, the
way the stopped drill's T01 greeting-wording question arose on its own).

**The capture layer — three durable sources, all confirmed on this machine 2026-09-10.**

- **Execution flow** is already written by the coordinator: `plans/{slug}/.parallel/control/log`,
  one ISO-timestamped line per `record()` action (`open-feature`, `spawn`, `hands-on`, `await-idle`,
  `force-idle`, `review`, `merge`, `answer`, `send-failed`, `close`, `halt-close`, `surface`, `promote`,
  `teardown`, `ceiling full`). Nothing new is built to get it; the harness reads it. (There is no `hello` tag any
  more — the spawn hello was retired in T30. The `hands-on {task}` line marks a `you` task spawning a
  hands-on scribe — the disk-visible drive signal, since `spawn` drops the role; added in T32.)
- **The agent-status timeline** must be **sampled during the run** — this is the one thing that is
  not otherwise recorded. `claude agents --json` reports each session's `id, name, status`
  (`idle`/`busy`), `state` (`working`/`done`/`blocked`/`stopped`), `pid`, `sessionId`, `startedAt`,
  `cwd`, `kind`. `status` and `pid` are present **only while the session is live**: once it ends,
  `--all` still lists it but with only its final `state`, no `status`. So proving the idle-gated
  close (a worker was `busy`, went `idle`, and only then was closed) needs periodic snapshots taken
  while the workers live; a poller appends `{ts, agents:[…]}` to the bundle every couple of seconds.
- **The transcripts** are already on disk and **survive both the worker's kill and its worktree's
  removal**, because they live under `~/.claude`, not in the worktree:
  `~/.claude/projects/<cwd-with-every-'/'-and-'.'-replaced-by-'-'>/<sessionId>.jsonl`. The
  `sessionId` from `claude agents --json` is the exact filename, so the agent-status timeline maps
  each session to its transcript. Each line is a JSON event; a `SendMessage` appears as an assistant
  `tool_use` carrying `{to, summary, message}` and an inbound message as a `user`-role entry, so the
  by-name addressing and the coordinator's answers are readable verbatim. (`claude logs <id>` prints only recent
  terminal output, not the whole conversation — the JSONL is the record.) This resolves the
  FINDINGS 2026-09-09 worry that a killed worker's transcript could not be inspected: the prior
  drill's worker transcript was read back in full 2026-09-10, and it already shows the worker
  addressing the coordinator at both the convention name and the harness name.

A **bundle** is one run's capture: the flow log, the agent-status timeline, a snapshot of every
session's transcript, and the scratch repo's `git log`. It is self-contained and dated, so a run
can be re-examined long after its workers and worktrees are gone.

**The assertion layer.** A scenario declares the facts it must show as pure predicates over a
bundle, and the harness reports each pass/fail against the captured data. Examples: "no `hello` line
in the flow at all (the spawn ping is retired)"; "no `close` of a finished worker precedes an
`idle` observation of it in the timeline"; "a `question` was surfaced and the answer reached the
worker before it resumed"; "a failed answer down-send is recorded as `send-failed`, not dropped";
"`main` gained exactly one commit — the promotion — and no task branch merged to it directly". The
predicates are unit-testable against canned bundles with no live agent; only running the scenario needs
real workers.

**The scenarios (fixtures).** Single task (spawn → implement → fresh review → merge →
promote → idle-gated close); N parallel tasks (concurrency, the ceiling, per-worker naming);
implement→review-queue handoff (a task reaches `🔍` and a fresh reviewer takes over while others
build); a clean merge (two tasks on different files, serialized into the feature branch); a merge
conflict (two tasks edit the same line — the second merge conflicts, the coordinator surfaces it
and parks, no bad merge lands); and a human decision (an underspecified task doc makes a real
worker ask, the coordinator surfaces it, the user answers, the answer is delivered down and the
worker resumes). The kill switch is drilled inside the N-parallel scenario: `HALT` mid-run, then
assert every worker was SIGTERMed, nothing was promoted, and `main` is untouched.

A seventh fixture, **hands-on** (T32), was added later to exercise the one path the first six never
did: a `you` task run end to end with a person. Its scratch plan is the build→verify split (§2.6) made
concrete — an `auto` task builds a tiny runnable program (`greet.mjs`, prints a known line) with its
own test, fresh-reviewed and merged like any `auto` task; then a `you` task depending on it carries a
"Needs a person" block asking the person to run the program and confirm its output. The coordinator
spawns a `pir-verify` scribe the person drives; the scribe records a `✅` row into `FINDINGS.md`, and
the task folds back with **no review** (§2.6). Its facts: the `you` task's worker is a hands-on verify
session (read from the timeline agent name, since the flow log drops role); it merged with no `review`
line; the plan promoted once; the ceiling held; and the hand-verified row reached `main`. It is
**attended-only** (PM decision 2026-09-14) — a `you` task emits no `surface` line, so the runner's
scripted-answer injector cannot drive it; the person drives the verify worker by hand. The runner
surfaces a durable `hands-on {task}` drive signal (the coordinator writes the flow line, the runner
announces which worker to drive) and the fixture takes a roomier wall-clock budget so a human-speed
run is not guillotined; the auto-drive channel is deliberately out of scope. The end-to-end path
cannot be forced without a person, so it is confirmed by its own attended live run (T33).

An eighth fixture, **blog-app** (T36, PM request 2026-09-15), is the capstone: the first whose
deliverable is a real multi-component program rather than a marker file, so it proves the method end
to end — several workers built at once off one contract, a person's verification folded in at the
right moments, and a genuine app out the far end. Its scratch plan is a lean database-backed blog (a
single seeded author, CRUD over posts) built as a walking skeleton: T01 pins a shared REST contract
plus the stdlib pure core, the schema/seed and runnable stubs; then T02 (docker-compose glue), T03
(the real Postgres-backed backend) and T04 (the real front end) build **concurrently** off T01,
partitioned by file so their three branches merge without conflict (T02 owns the docker files, T03 the
backend and the one `pg` dependency, T04 the front end). A `you` check-in confirms the stack runs and a
post persists; T06 adds a browser end-to-end test; a second `you` check-in is the final click-through
plus that test. It carries one new fact, **`reachedWidth(n)`** — PASS iff some timeline tick shows at
least n task-implementer slots busy at once — asserted at `reachedWidth(2)`: `ceilingHeld` only bounds
concurrency from above, and nothing before this proved work actually ran in parallel, which is the whole
point of the plan. It reuses `ceilingHeld(3)`, `oneMergeToMain`, and `verifyWorkerSpawned`/
`youNeverReviewed` for both check-ins. `npm test` stays install-free throughout because only the pure
core is tested; the `pg` shell, the browser and the running stack are hand-verified, so the app can
declare runtime deps (`pg`, `@playwright/test`) without breaking the green baseline — not a §5 breach,
since §5 governs the coordinator's own portability, not the throwaway app a fixture builds. Its Docker
precondition and container cleanup (teardown stops Claude sessions, not containers) live in its
TEST-HARNESS note. It is attended (two `you` check-ins) and confirmed live by T37.

**Seatbelts (§5.2 carries the row).** Every scenario runs on a scratch plan in a scratch repo, at
the lowest ceiling the scenario needs, with the kill switch wired and a per-scenario wall-clock
timeout that auto-touches `HALT` so a hung real worker cannot run — or cost — unboundedly. Because
the runs spawn real paid agents, the harness's live runner is a `you` task launched by the user,
never started unattended by a session (§5.2, the standing rule).

**The reflection pass (part of every fixture, PM decision 2026-09-13).** A green fact report proves
the scenario's declared facts held — not that the run was clean or cheap. A run can pass while the
coordinator improvises around a gap, guesses at an ambiguity, sleep-polls, or spends a fifth of its
wall-clock relaying messages. So a fixture is not done at the green report: the session then reads the
bundle it just captured — the flow log, the scratch repo's `git log`, the agent-status timeline, and
the transcripts of **this run's own sessions** (the coordinator and its workers; ignore any
`role:foreign` sessions swept in) — for three things: how the run actually flowed; where the
coordinator or a worker got lost, hesitated, retried, guessed, or addressed the wrong session (with
quoted evidence, session and timestamp); and where wall-clock or tokens were spent for no gain. The
findings go in `FINDINGS.md` with the date, and any hardening or efficiency change they imply is
surfaced to the PM, who decides whether it becomes a task — the fixture session does not implement the
fix itself (scope), it feeds the next hardening task the way T18's reflection produced T24 and T19's
produced T25 and T26. A fixture is done ✅ only when its facts are green **and** its reflection is
logged. The how-to is [TEST-HARNESS.md](TEST-HARNESS.md) § The reflection pass.

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
| Closing a worker: `claude stop` interrupts, SIGTERM its pid ends it, then worktree removed | Acts on a live session and real worktrees |
| A task branch merging into the feature branch, serialized, worktree removed | Mutates real git history |
| Promoting the feature branch to `main` at plan completion | The one merge to `main`; mutates it |
| The kill switch stopping every live worker | Requires live workers to stop |

### 5.2 Seatbelts

| Flag / mechanism | Default | Effect |
|---|---|---|
| `PARALLEL_DRY_RUN=1` | on in all tests | Spawn / message / list / close / merge hit the fakes and a scratch repo, never a real agent or `main` |
| Scratch plan + scratch repo | used for T00, T08, T10 | The dangerous operations run against a throwaway plan and repo, never the real project |
| Worker ceiling = 4 | always on | Bounds how many real agents can exist at once |
| Kill-switch flag | always available | One file halts all dispatch and delivery and ends every worker (SIGTERM) |
| Harness per-scenario timeout | on for every live-harness run (§4.1) | A wall-clock cap that auto-touches `HALT`, so a hung real worker in a scenario cannot run or cost unboundedly. Each scenario also fixes its own low ceiling. |

**Never ask the user to run the unbounded version to find something out, and never run it
yourself.** No spike or task spawns real long-running paid agents against real branches. The
first real spawn (T08) is one worker, one trivial task, on a scratch plan, ceiling at its
minimum, kill switch wired.

---

## 6. Recovery

- **A leaked worktree or branch** (worker crashed, coordinator killed mid-loop):
  `claude agents --json` lists live sessions with their state; `git worktree list` lists
  worktrees. `claude stop <id>` only interrupts a session's turn; `kill <pid>` (pid from
  `claude agents --json`) ends the process, and `claude rm <id>` clears the leftover `stopped`
  record; `git worktree remove --force` and `git branch -D` clean the worktree and branch. The
  coordinator does this on its next pass, but a person can do it by hand from those commands.
- **The coordinator is confused or runaway:** create the `HALT` control flag file. All dispatch
  and delivery stop and every worker is ended (SIGTERM). `main` is untouched (nothing merges to it until
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
  `pir/{plan}-T{nn}` off the feature branch and merge back into it, serialized; the feature branch
  is promoted to `main` once, when every task is `✅` and the tests pass on it. Chosen over merging
  each task straight to `main` because it keeps `main` free of a half-finished plan, lets the plan
  land atomically and reviewably, and makes the kill switch and a crash leave `main` untouched
  (§2.9). It is a further deliberate departure from "main checkout, main branch, always"; the
  classic flow keeps that rule.
- **Agents are named `{repo} · {plan}` and `{repo} · {plan} · T{nn}`.** The user set this
  convention (2026-09-07). Deterministic names mean a worker addresses the coordinator without
  being handed an id, the coordinator identifies its workers and their tasks from the name alone
  (so worker-to-task state cannot drift from separate bookkeeping), and the user reads
  `claude agents` and sees who is doing what. Set with `claude --bg -n` (§2.8). The separator was
  `/` at plan time; changed to `·` (2026-09-07) after T00 found `SendMessage` rejects a `/` in a
  name and the user picked `·` as a plain, non-structural replacement. The name also carried a
  leading `@` at plan time; T07 confirmed live (2026-09-08) that `·` is accepted but that a name
  starting with `@` draws the same rejection as `/`, so the user dropped the `@` — the name is now
  the bare `{repo} · {plan}`, matching what `claude agents --json` already shows.
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

- **The comms protocol: a lazily-opened down-channel, a coordinator launched under its own name, and an
  idle-gated close.** Decided with the user 2026-09-10 (T13), narrowed by T25 (up-channel by file) and
  T30 (the hello retired), to settle the two worker↔coordinator behaviours the earlier work could only
  build and defer. (1) **The down-channel (coordinator → worker) is opened lazily by the first real
  answer, addressed by name — there is no spawn hello (§2.2).** T13 opened it eagerly with a hello at
  spawn as belt-and-suspenders over by-name addressing; T30 retired that. The hello was proven
  non-load-bearing (T23: both hellos failed to send yet both workers built the right thing from their
  spawn prompt), and its "the reply rides the return channel" rationale was already gone once workers
  reported UP by file (T25). So the only down-send is the answer to a parked worker, and a failed
  down-send is surfaced to the user (with a `send-failed` flow line), never silently dropped — the
  message that carries the user's decision must never be lost unnoticed. (2) The coordinator session is
  launched under `{repo} · {plan}` with `claude -n` (§2.8), because nothing otherwise makes the skill
  agent carry the addressable name it sends answers from, and the harness-given name may be
  `SendMessage`-invalid (the drill's contained `/`). (3) A close that follows a worker finishing waits
  for the agent list to show it idle before SIGTERM (§2.3), so a finished worker is never cut off
  mid-turn — the session-idle analogue of the mid-commit close FINDINGS 2026-09-09 caught; a dead worker
  and the kill switch still close at once. The automated halves are proven against the fakes; the
  by-name delivery, the idle timing, and the no-hello retirement are the live halves the user confirms
  (T13/T18–T23, and the T30 review-queue re-run).

- **A reusable, data-driven live-scenario test harness, over real workers (Phase 5).** Decided with
  the user 2026-09-10, in place of the one-off manual drills. The design is §4.1. Two choices were
  the user's. (1) **All workers are real** — a scenario proves nothing about the `pir-worker`
  contract unless a real model follows it, so the harness spawns real `claude --bg` workers on
  fixture task docs engineered to force each path; the accepted cost is a slower run that may need a
  re-run. Scripted stubs were declined for that reason. (2) **The harness folds in T10 and T13's
  live half** rather than running alongside them: the full multi-worker + kill-switch drill (T10)
  becomes its N-parallel scenario, and T13's live comms proof becomes its single-task scenario, so
  there is one data-driven path, not two manual ones and a duplicate. The capture rests on three
  sources confirmed on this machine 2026-09-10 — the coordinator's existing flow log, a sampled
  `claude agents --json` status timeline (status is live-only, so it must be sampled during the
  run), and the on-disk session transcripts under `~/.claude/projects/…/<sessionId>.jsonl` (which
  survive a worker's kill and its worktree's removal). The runner is a `you` task because it spawns
  real paid agents; the capture, assertion and fixture layers are `auto` and unit-tested with no
  live agent.

- **The worker→coordinator up-channel is a shared file drop, not cross-session messaging (T25).**
  Decided with the PM 2026-09-13, after the T19 reflection measured the old relay at ~20–25% of the run.
  The coordinator's decision loop is an ordinary Node process with no message inbox (SendMessage is
  agent-only), so the old design parked the coordinator *agent* in the path of every worker message —
  even routine `implemented`/`done` — purely to re-encode it into a file the loop read, a full agent
  turn each. Now a worker writes its report as a file into `plans/{slug}/.parallel/control/reports/` and
  the loop reads it directly; no agent turn on the up-channel. The down-channel stays SendMessage,
  because there its receiver is a live agent (§2.2). The PM weighed this against keeping SendMessage and
  making the relay one cheap step (rejected: the cost is the agent *turn*, not the encoding, so it would
  recover little) and against moving the whole loop into the agent (rejected: it discards the tested,
  live-agent-free decision core, §3.1, §4). Reachability was verified first: every worktree resolves the
  shared git dir to the one main checkout, so a worker can always reach the control dir. The measurement
  is folded in: the T19 review-queue bundle is the token baseline (FINDINGS 2026-09-13; `harness/tokens.mjs`
  computes it), and one combined review-queue re-run after T25+T26 is the after-measurement (PM decision).

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
