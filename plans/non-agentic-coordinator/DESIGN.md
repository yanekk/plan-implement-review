# Non-agentic coordinator — Design

> This plan changes how parallel mode behaves. The canonical account of parallel mode lives in
> `/docs`, and this plan updates `/docs` (task T08) rather than re-opening the sealed
> `plans/parallel-pir/DESIGN.md`. This file is the build-time rationale for the change: what is
> removed, what replaces it, and why. Section numbers here are cited from `tasks/` and commits.

## 1. Purpose

Parallel mode's coordinator has two halves today: an agentic Claude Code session (the
`pir-coordinate` skill) that the product manager talks to, and a deterministic loop
(`src/shell/loop.mjs`, driven from `src/shell/coordinate.mjs`) it steps. This plan removes the
agentic half. The coordinator becomes a plain foreground command that spawns workers, keeps the
branches and the scoreboard, and prints a live status display — with no agent, daemon, web UI or
MCP server.

The agentic half is removed because it costs and earns nothing. Its only job was to relay a
worker's question up to the person and the answer back down; it exercised no judgement, because the
worker already holds `DESIGN.md` and its task doc and can re-read them, so a relay does not need a
model. Worse, an agentic coordinator has to sit idle in a session while workers work, and a long
wait inside a session does not survive — the just-finished `coordinator-restart-resume` plan proved
that a live crash of an agentic coordinator cannot even be tested, because a background session
rotates its process pool each turn and has no stable process to kill (that plan's T07). A plain
foreground program has a stable process, a real Ctrl-C, and its state on disk in git — so the
restart-and-resume this whole design rests on becomes real and checkable for the first time.

### Success criteria

- The run is driven by a plain command (`node src/shell/coordinate.mjs {slug}`); there is no
  coordinator session, no `pir-coordinate` skill, no down-channel.
- The command prints a live, in-place task display in the shape approved in the prototype
  (`prototype/cli-display.html`): one line per task, per-task status and elapsed time, the ceiling,
  the tasks asking for the person, and the hand-off.
- The person answers a blocked worker directly in that worker's own session; nothing relays.
- Ctrl-C closes every worker and leaves `main` untouched; re-running the command rebuilds from
  committed work.
- The run never merges to `main`: it stops at a green feature branch and hands the person the
  branch to merge by hand.
- There is no `auto`/`you` task distinction; every task is dispatched to an autonomous worker.
- `npm test` is green; the live end-to-end behaviour is hand-verified with the person (T09).

### Stance

- **The person talks to workers, not to a middleman.** The single thing worth keeping about
  supervision is that the person owns every decision; routing that through an agent added latency
  and unreliability, not judgement.
- **State is reconstructed from git and the live agent list, never carried in memory.** A run is
  safe to kill and re-run at any point. This is the property that replaces a resilient long-lived
  session.
- **One entry point.** The command runs in the foreground and prints what it does; `status`
  collapses into the scrolling display, `halt` into Ctrl-C. The one irreversible act — merging to
  `main` — is not the command's to perform.

---

## 2. Behaviour specification

### 2.1 The coordinator is a plain foreground program, not a session

The run is `node src/shell/coordinate.mjs {slug}`, foreground, printing as it goes, until the plan
is done or the person stops it with Ctrl-C. It refuses a plan whose `PROGRESS.md` is not marked
reviewed (`readReviewGate`), opens the feature branch in its own worktree, and steps `runPass` once
per iteration — spawn ready tasks, hand off reviews, merge one done task, all against the real
`claude` CLI and git. The pass is the internal unit the tests and harness drive (`runPass`,
`drain`); it is not a verb the person types. The live seatbelt stays: without `PARALLEL_LIVE=1` the
command does the safe half (confirm the gate, print what it would dispatch) and stops (§5.2).

Reason: everything above already exists in `coordinate.mjs`'s `main()`. What made the coordinator
"agentic" was never the loop; it was the message bridge described in §2.2. Removing the session is
mostly deletion.

### 2.2 The person talks to blocked workers directly; there is no down-channel

A worker that cannot continue on its own still escalates rather than guessing — the classic rule is
unchanged. What changes is the routing. Today the loop writes the worker's rendered question to a
`surfaced` feed, the `pir-coordinate` skill agent relays it to the person with `AskUserQuestion`,
writes the answer to `answers`, and the loop delivers it down to the worker with `SendMessage` (via
an `outbox` the skill drains). All of that is removed: `createAgentBridge`, the `outbox`, `answers`
and `surfaced` feeds, the down-channel `send`, `answer()`, and the `send-failed` path.

Instead, the person finds the asking worker in their own `claude agents` view, attaches to its
session, and answers there. The worker un-parks itself and continues; the program never sees the
answer and routes nothing.

The worker's up-signal stays. When a worker asks, it still drops a one-line `question`/`decision`
report into the control folder (`reports/`), which is a plain file drop a Node process reads
directly — no agent needed. The program uses that signal for two things only: to keep the worker's
slot under the ceiling (a parked worker is alive, not dead), and to print the question in the live
display so the person can see who is asking and correlate several at once themselves. It does not
relay it.

Reason (measured 2026-09-19, claude 2.1.277): `claude agents --json` reports only `state`
(`working`/`done`) and `status` (`busy`) — it cannot distinguish a worker waiting for the person
from one mid-build. So the program cannot infer "parked" from the agent list; the worker's own
report is what tells it. The person, by contrast, spots a waiting worker in the interactive
`claude agents` view directly, so no separate human-facing "asks" file is built.

### 2.3 The live status display

The command's output is a `docker compose up`-style display: one line per task, updating in place,
with a summary line and a footer. The shape was confirmed with the person against
`prototype/cli-display.html` (2026-09-19). Per line: a state glyph, the task id and its slug (§2.9,
shown as `T01 stop-promoting`), a status label, and elapsed time. Summary: tasks done / total, how many are running, how many are asking the
person, how many waiting, and the worker ceiling (marked when full). Footer: the current asking
worker and how to reach it (`claude agents`, attach, answer there), or, at the end, the green
feature branch and the `git merge` hand-off (§2.4).

The status vocabulary, drawn from what a pass already computes: `waiting` (a dependency is not
`✅`, naming which), `queued` (ready but the ceiling is full), `building` (an implement worker),
`reviewing` (the fresh review session), `merging`, `merged`/done, and `asking you` (a parked
worker). A `you`-style hand-verification is not a separate state — it is a worker `asking you`
(§2.5).

This splits across the boundary (§3.1). The **display model is pure**: a function of the run state
a pass produces (tasks, their phases, the counts, the ceiling) returning the rows, summary and
footer as data, with no I/O and no clock — the current time and the spinner frame arrive as
arguments. It is tested exhaustively. The **renderer is shell**: it paints the model in place on a
TTY using cursor control and ticks the spinner, and it is hand-verified (T09).

Reason for the split: in-place terminal painting can only be judged by a person watching a real
terminal, but the status a person reads off each line is a rule, and a rule only a person can check
is a rule that rots. Keeping the model pure makes the vocabulary and the counts testable in
milliseconds; only the painting itself needs eyes.

The renderer must degrade when stdout is not a TTY — piped, redirected, or captured by the test
harness — to plain append-only lines, because cursor-control escapes garble a non-terminal and the
harness reads the output as text. A plain run to a terminal gets the live display; everything else
gets readable lines.

### 2.4 No promotion; the run hands off a green feature branch

The command never merges to `main`. When every task is `✅` and no worker is live, it runs the test
command on the feature branch and prints the result and the branch name; if green, it hands the
person `git merge pir/{slug}` and exits. Removed: the automatic `promoteToMain` decision, the
loop's promote step, `worktree.promote`, and the `canPromoteHere` guard's promotion rationale.

Reason: merging the finished plan to `main` is the one irreversible act in the system and it is a
`what`, which belongs to the person (`CLAUDE.md`). The person asked to do it by hand with
`git merge`; a program that performs it, even behind a `[y/N]`, is doing the person's job. Running
the tests first and refusing to hand off a red branch stays, because telling the person a red
branch is ready to merge would be a lie the tests can catch.

A live run still must not open and mangle the feature branch inside the canonical repo by accident,
so the `canPromoteHere` guard stays as a branch-safety guard (refuse a live run in the canonical
repo without `PARALLEL_ALLOW_HERE=1`), reworded away from its promotion framing.

### 2.5 No `auto`/`you` distinction; a worker that needs the person prepares and asks

Every task is dispatched to an autonomous worker; there is no per-task `Runs` marker, no hands-on
worker, and no `pir-verify` path. A task whose real proof is a person's judgement is handled the
way the classic flow always handled it: the worker builds and prepares up to the point where the
only missing thing is the person's eyes, then asks a specific question through the same escalation
path as any other worker (§2.2) — a running thing and a list of what to look at, not "can you
check this."

Removed: the `Runs` column from `PROGRESS.md` parsing, the `runs` field on the dispatch decision,
the `you` count in the width report, the `verify` worker role, the `hands-on` log tag, the verify
attestation, the `pir-verify` skill, and the `pir-parallelize-plan` skill (whose whole job was
adding the `Runs` column and tagging `you`).

Reason: classifying a task `you` at plan time forces a guess, long before anyone knows, about which
tasks will need the person's hands. It also existed partly to keep an agentic coordinator's context
clean (a spike's noisy back-and-forth on a separate hands-on worker, commit cd8c5ef) — a reason
that is moot once there is no coordinator session to protect. The risk this removes an adjective
for is real: "genuinely cannot verify it itself" is judgement living in a prompt, too eager and a
worker parks on something it could have checked, too reluctant and it ships unverified. So the bar
is written explicitly into the worker contract (`pir-worker`), not left to an adjective (T07).

### 2.6 State is reconstructed, never carried; Ctrl-C kills, re-run rebuilds

The program holds no state that must survive its own death. Each pass rebuilds which worker holds
which task by matching `claude agents --json` names against the run's naming convention
(`buildAssignments`, `parseAgentName`); the durable task state is the committed glyph on each task
branch (`taskBranchState`, `decideResume`). A process restart starts with empty in-memory state and
reconstructs: it reaps any leftover worker sessions from the dead run, then adopts each task branch
by its committed state — merge a `✅` branch, hand a `🔍` branch to a fresh reviewer, rebuild a
half-built one. This reconciliation already exists (from `coordinator-restart-resume`).

Ctrl-C (SIGINT) closes every live worker of the run and exits, leaving `main` untouched
(`teardownOnce` already installed on SIGINT/SIGTERM). Re-running the command reaps whatever it left
and rebuilds from committed work. A worker's uncommitted in-progress work since its last commit is
lost and that task restarts — the accepted cost of killing cleanly rather than leaving up to four
paid agents running unattended.

Reason: with Ctrl-C killing the workers, a re-run finds none live and takes the simplest
reconstruction path — pure git truth — so there is no need to re-adopt live worker sessions. This
is why "kill on Ctrl-C" and "rebuild from git on re-run" are one decision, not two.

### 2.7 Build this plan in classic flow, not parallel mode

This plan rebuilds the parallel coordinator. Running it under the parallel coordinator would have
the coordinator change its own code mid-run — the `runPass` a live run depends on is exactly what
several tasks here rewrite. So this plan is built in the classic single-stream flow, one `/pir-work`
at a time. The task graph is honest about parallelism (§ PLAN width) but the plan is not meant to be
dispatched by the thing it is dismantling.

Reason: correctness beats dogfooding. A coordinator that swaps out its own decision function
between passes is not a test of the new design, it is a way to corrupt a run.

### 2.8 The unhappy paths

- **A worker asks and the person is away.** The worker parks, holds its slot, and the run throttles
  to human speed as parked workers stack up — correct, the person is the bottleneck for those
  decisions only, and every independent task keeps moving. Nothing is guessed.
- **A worker goes quiet (stuck, not asking).** The program does nothing special; a parked worker
  and a hung worker look alike to it (§2.2, measured), and the person is already watching the
  `claude agents` view and the live display. Chosen over an activity-timeout that would risk killing
  a worker doing slow-but-real work.
- **A merge conflict at the coordinator's own merge.** Unchanged from today: the worker is kept
  alive and parked, the person resolves it by attaching to that worker (now directly, §2.2), and the
  branch merges only once clean. The merge and the worker's close stay paired.
- **The feature branch is red at the end.** The command prints the failure and the branch, and does
  not hand off a `git merge` line — it never tells the person a red branch is ready.
- **Ctrl-C during cleanup.** A second Ctrl-C while teardown is running forces immediate exit; some
  workers may then be left for the next re-run to reap (which it does). `main` is untouched
  regardless.
- **Extending the plan mid-run.** The person stops the run, edits `PROGRESS.md` and the task docs,
  and re-runs — no second writer races the program, and it exercises the restartability the design
  rests on. A `hold` flag that drains live work while blocking new spawns is a fallback if
  stop-and-restart proves too heavy; it is not built now.

### 2.9 Task slugs and agent names

Every task has a kebab-case slug that is its name everywhere: the Task column in `PROGRESS.md`, the
filename `tasks/T{nn}-{slug}.md`, the row in the live display (shown as `T01 stop-promoting`), and the
worker's session name. The worker name is `{repo} / {plan} / {task} / {slug} / {role}`, five fields
separated by ` / ` — for example `plan-implement-review / non-agentic-coordinator / T01 /
stop-promoting / implement`. The coordinator has no agent name at all, because it is a plain process
and never appears in `claude agents`.

The task number stays the identity the program uses: dependencies reference it, and `parseAgentName`
extracts it from the name so a restart still matches a live worker to its task by number
(`buildAssignments`) regardless of the slug. The slug is a readable label carried alongside.

Reason: today a worker's name carries only its number, so `claude agents` cannot tell you what `T01`
is doing — the whole point of the name convention (§2.8 of the sealed parallel-pir design: state
reconstruction and picking a worker out of the list) is served better when the name says what the
task is. The separator is `/` because the only reason it was ever `·` — SendMessage rejecting `/` —
is removed with the down-channel (§2.2); reverting is worth the small churn for readability, and the
launch-time acceptance of a `/` in a name is confirmed in the capstone (§5.1). The slug lives in the
filename already, so making it the `PROGRESS.md` Task value keeps one source, not two to sync; the
match between the filename and the Task cell is a plan-authoring discipline the plan review checks.

---

## 3. Architecture

### 3.1 The boundary

```
src/core/   — pure. Takes inputs as parameters (including the clock and the spinner frame),
              returns decisions and view data. No clock, no I/O, no network, no `claude`, no git.
src/shell/  — everything platform-shaped: the `claude` CLI, git, the filesystem, the terminal.
```

The boundary is unchanged from parallel-pir and enforced by `src/core/boundary.test.mjs`, which
scans the pure side for forbidden imports. If it fails, the fix is to move the code to `src/shell/`,
never to relax the test. The new pure code this plan adds — the display model (§2.3) — sits in
`src/core/` and is a function of its arguments and nothing else, which is what makes the status
vocabulary and the counts testable without a terminal.

### 3.2 Modules touched

Pure (`src/core/`):
- `progress.mjs` — remove `Runs` column parsing and the `runs` field (§2.5).
- `dispatch.mjs` — remove `runs` from the spawn decision and remove `promoteToMain`; the "plan
  complete" signal becomes a `complete` flag the shell reads to run the tests and hand off (§2.4).
- `parallelism.mjs` — remove the `you`/human count from the width report (§2.5).
- `naming.mjs` — revert the separator to ` / `, add the task slug as a name field, and drop both the
  coordinator name and the `verify` role; a worker name is `{repo} / {plan} / {task} / {slug} / {role}`
  and roles become `implement` and `review` (§2.9, §2.5). Sequenced across two tasks so the suite stays
  green at each: the separator and the slug field land in T02 (kept backward-tolerant); the
  `coordinatorName` and `verify`-role deletions land in T05, once their last callers — in the harness,
  and `capture.mjs` for `coordinatorName` — are gone. T04 removes the verify *code path* in the loop and
  platform in between.
- `display.mjs` (new) — the pure display model (§2.3).

Shell (`src/shell/`):
- `coordinate.mjs` — remove `createAgentBridge`, `answer`, the `surfaced`/`answers`/`outbox`
  handling and `send-failed`; `main()` renders the live display (§2.3) and prints the hand-off
  (§2.4); the `canPromoteHere` guard is reworded to branch-safety (§2.4).
- `loop.mjs` — remove the down-routing, the promote step, and the `verify`/`hands-on`/attestation
  branches; keep the `question`/`decision` up-signal as log-only (§2.2, §2.5); pass the task slug into
  the worker name at spawn (§2.9).
- `platform.mjs` — remove the down-channel `send` and the `verify` opening instruction; keep the
  `reports/` inbox up-channel (§2.2).
- a new terminal renderer for the display model (§2.3), TTY-aware with a plain fallback.

Skills and docs:
- delete `pir-coordinate`, `pir-verify`, `pir-parallelize-plan`; rewrite `pir-implement`,
  `pir-review`, `pir-worker` to drop every assumption that the coordinator is an agent (T07).
- rewrite `/docs` and the `CLAUDE.md` parallel-mode carve-out (T08).

### 3.3 The decision function

`decideDispatch` stays the one place the scheduling decision is made, minus `runs` and
`promoteToMain`. The display is a second pure function (`display.mjs`) downstream of a pass: it
takes the run state a pass produces and the current clock/spinner frame and returns the view. Both
are functions of their arguments alone.

### 3.4 Data flow

Each pass: read the kill state → list workers (`claude agents --json`), match this run's own by
name, drain the `reports/` up-channel → parse `PROGRESS.md` on the feature branch → `decideDispatch`
→ execute (spawn / review hand-off / one merge) against `claude` and git → fold the merged row to
`✅` on the feature branch. The foreground command feeds the resulting run state to the display model
and paints it. When the pass reports `complete`, the command runs the tests and prints the hand-off.

### 3.5 Storage

Durable task state is the committed glyph on each task branch and the folded `PROGRESS.md` on the
feature branch — unchanged. The control folder (`plans/{slug}/.parallel/control/`, gitignored)
keeps `reports/` (the worker up-channel) and `log` (the audit/harness signal); `outbox`, `answers`
and `surfaced` are removed with the down-channel (§2.2). In-memory run state is disposable and
rebuilt each pass (§2.6).

---

## 4. Testing

Three layers, same as parallel-pir. The **pure core** (`decideDispatch`, `progress`, `parallelism`,
`naming`, `resume`, and the new `display` model) is tested exhaustively and in milliseconds. The
**loop over the fake platform** (`loop.test.mjs`, `coordinate.test.mjs`) drives whole runs against
`src/shell/fake/` with `PARALLEL_DRY_RUN=1`, proving dispatch, review hand-off, serialized merge,
the parked-worker-holds-a-slot behaviour, and kill-and-rebuild. The **live-scenario harness**
(`src/shell/harness/`) runs the fixtures; this plan reworks them to the new model (T05) — the
message-relay round-trip and the hands-on fixture go, and a parked-worker-holds-slot fixture and a
restart-after-Ctrl-C fixture stay or arrive.

What none of them can prove: that the in-place terminal painting looks right, and that a real
person can find and answer a blocked worker in `claude agents` and re-run after a Ctrl-C. That is
T09, hand-verified with the person on a scratch plan.

---

## 5. Environment — read this before running anything

| | |
|---|---|
| OS | macOS (darwin 26.5.1, measured 2026-09-19) |
| Language / runtime | Node.js v24.2.0, ES modules (`.mjs`) |
| Toolchain | `git` 2.50.1; `claude` CLI 2.1.277 (`--bg`, `-n`, `agents --json`, `attach`, `stop`, `rm`) |
| **Deliberately absent** | no build step, no bundler, no test framework beyond Node's built-in `node --test`, no TypeScript |

**The test command.**

```
npm test
```

which runs `FORCE_COLOR=0 NO_COLOR=1 node --test --test-reporter=dot 'src/**/*.test.mjs'`. It is
the only evidence a session may produce on its own. `FORCE_COLOR=0` is set inside the command
because this machine has `FORCE_COLOR` set in the environment, which overrides `NO_COLOR` and makes
Node's runner colour anyway; the dot reporter keeps a passing run to a few lines and prints failures
in full. For a person debugging, `node --test --test-reporter=spec 'src/**/*.test.mjs'`.

**Dependencies.** None may be added. The project is dependency-free by design (the coordinator must
be portable into any repo that installs the framework); a new runtime dependency needs the person's
decision.

### 5.1 What the test command cannot reach

| Cannot be tested automatically | Why it needs a person |
|---|---|
| The live in-place terminal display | Only a person watching a real terminal can say the painting reads right (§2.3) |
| Finding and answering a blocked worker in `claude agents` | The attach-and-answer interaction is interactive and depends on the person's terminal (§2.2) |
| Ctrl-C killing real workers, then a real re-run resuming | A real SIGINT against real paid `claude` sessions, then a real restart (§2.6) |
| `claude --bg -n "name/…"` accepting a `/` at launch, and the picker rendering it | Launch-time and interactive-UI behaviour; not reachable headless. Now load-bearing since names use `/` (§2.9); low risk (names with `/` already appear in `claude agents` here), confirmed live in T09 |

### 5.2 Seatbelts

| Flag / mechanism | Default | Effect |
|---|---|---|
| `PARALLEL_LIVE` unset | dry by default | The command confirms the gate and prints what it would dispatch; it spawns no real worker and touches no branch |
| `PARALLEL_DRY_RUN=1` | on in all tests | Spawn / message / list / close hit the fakes and a scratch repo, never a real agent |
| `PARALLEL_MAX_WORKERS` | 4 | The worker ceiling; the capstone's first live run sets it to 1 |
| `canPromoteHere` guard | on | Refuses a live run inside the canonical repo unless `PARALLEL_ALLOW_HERE=1`, so a run cannot open and mangle the real repo's branches by accident (§2.4) |
| Scratch plan + scratch repo | used for T09 | The live drill runs on a throwaway plan in a throwaway clone, never the real project |

Never ask the person to run the unbounded version to find something out, and never run it yourself.
The first live run (T09) is one worker, one trivial task, on a scratch plan, ceiling 1.

---

## 6. Recovery

The run's only irreversible act is removed: the command never merges to `main`, so a bad run leaves
`main` untouched and the worst case is a stray feature branch and its task branches plus some
worktrees under `.claude/worktrees/`. To recover: `git worktree remove --force` each stray worktree,
`git branch -D pir/{slug}` and its `pir/{slug}-T*` task branches. A killed run is resumed by
re-running the command (§2.6). The reverted debris from the abandoned `coordinator-trust` run is in
a labeled `git stash` (2026-09-19), recoverable if anything in it turns out to be wanted.

---

## 7. Decisions and rationale

All decided with the person on 2026-09-19 unless noted.

- **The conclusion holds; the CLI can do the coordinator's job.** The foreground loop already
  exists in `coordinate.mjs`'s `main()`; the agentic half only relayed. The one genuine loss is that
  a single agentic channel could notice two workers stuck on the same decision — a plain command can
  only list them, and the person correlates. Accepted.
- **you/auto removal is folded into this plan** (its own phase), not a separate follow-up, because
  a worker with a question and a worker needing the person's eyes become the same thing on the same
  channel.
- **The person spots blocked workers in the `claude agents` view**, so no human-facing "asks" file
  is built. The worker's own report signal stays, for the program's slot-keeping and the display.
- **Ctrl-C kills workers; a re-run rebuilds from committed work.** Alternative — leave workers alive
  and re-adopt — was declined: it leaves paid agents running unattended and needs new re-adoption
  code.
- **No promotion machinery.** The command hands off the green feature branch; the person runs
  `git merge`. Alternative — a `[y/N]` prompt or a `pir promote` command — was declined as doing the
  person's `what`.
- **No new "record the answer" gate.** Workers already write `FINDINGS.md` under their normal
  contract, which worked in the sequential flow; no extra machinery is added.
- **Quiet workers: the program does nothing; the person watches.**
- **The old `pir-coordinate` skill is deleted**; a "think through the plan" session is just a normal
  session with the files open.
- **Worker names revert to the `/` separator and gain a task slug (§2.9).** The `·` separator
  existed only because SendMessage rejected `/`; with the down-channel gone, names go back to
  `/`-separated, and a worker's name becomes `{repo} / {plan} / {task} / {slug} / {role}`. The one
  unverified point — whether `claude --bg -n` accepts a `/` at launch — is low risk (names with `/`
  already appear in `claude agents` on this machine) and is confirmed live in the capstone. Superseded
  the earlier "keep `·`" position after the person asked for `/` (2026-09-19).
- **A task's slug is its identity.** Every task already carries a kebab slug in its doc filename
  (`T01-stop-promoting.md`); this makes it first-class. The slug is the task's name in `PROGRESS.md`'s
  Task column, in the live display, and in the worker's agent name — one name everywhere, the full
  description living in the task doc's Goal. This is a method-wide convention (all plans, classic and
  parallel), so the templates and `pir-plan` guidance change with it (T07). The task number stays the
  dependency key and the thing the program matches a worker on; the slug is a readable label attached
  to it.
- **The classifier headache is folded in, not a separate plan.** Removing the coordinator session
  removes the hard part (an agent keeping itself awake was refused). What remains is small: ship a
  narrow `permissions.allow` so a worker's own `git`/`npm test` clears, and have `install.sh` apply the
  per-user `autoMode.allow` rule when a person runs it, with the manual `/permissions` step as a printed
  fallback (T06; PM chose the installer over a documented manual prerequisite, 2026-09-19). The
  `autoMode` rule lives in user-global `~/.claude/settings.json` because the classifier ignores
  `autoMode` in a project file; whether `permissions.allow` alone already clears a worker's own commands
  is confirmed live (T09).
- **The live display shape was approved against `prototype/cli-display.html`** (2026-09-19): the
  `docker compose up`-style in-place task list, the status vocabulary, the ceiling pill, the
  asking-you footer, and the `git merge` hand-off. Parked as a non-binding reference for the session
  that builds the renderer (T03).
- **This plan is built in classic flow** (§2.7).
- **The abandoned `coordinator-trust` debris was swept into a labeled stash** for a clean base.

---

## 8. Explicitly out of scope

- **A `hold` flag for mid-run plan edits.** Stop-and-restart is the chosen mechanism (§2.8); a hold
  flag is a fallback only if that proves too heavy, and building it now is speculative.
- **Re-adopting live worker sessions across a restart.** Not needed once Ctrl-C kills workers
  (§2.6); building it would be dead weight.
- **A second `status` command or a web/MCP surface.** The foreground display is the status; a second
  reader from another terminal is not wanted (§1).
- **Reworking the separate `classifier-survival` brief in full.** Only the small worker-side piece
  is folded in (T06); the rest was made moot by removing the coordinator session.
- **Any change to the classic single-stream flow.** This plan changes parallel mode only; the
  classic `/pir-work` routine is untouched.
