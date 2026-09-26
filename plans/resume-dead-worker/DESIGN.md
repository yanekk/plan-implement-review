---
setup:
  - test ! -f package-lock.json || npm ci
test:
  - npm test
---

# Resume a dead worker — Design

> Build-time rationale for the dead-worker fix in parallel mode. How parallel mode behaves is
> canonical in `/docs`; this plan's tasks update `/docs` (restart-recovery.md, run-lifecycle.md,
> human-flow.md) to the new behaviour. Every rule carries its reason.
>
> Re-planned 2026-09-26 onto live workers (`plans/live-workers`, merged b6656f8). The first plan
> (1594674, reviewed f69bb52) was written for `claude --bg` sessions; live-workers §7 required this plan
> be re-planned before it is built. The user decisions of 2026-09-24 all stand (§7); only the mechanics
> under them changed.

## 1. Purpose

When a worker dies mid-run, the coordinator's step 3a in `loop.mjs` closes it, deletes its task
worktree and branch, and forgets the task. The row is still ⬜, so `decideDispatch` respawns the task
from scratch, often in the same pass. Every commit, every uncommitted edit and all of the worker's
context are lost. The restart path already does better: `reconcile` with `decideResume` keeps the
branch and continues it. This plan makes the mid-run path at least as good as restart, adds a revive of
the dead worker's own conversation, and puts a brake on a task whose workers keep dying.

Since live-workers, every worker is a child process of the coordinator, started through the Agent SDK
under a session id pir chose, with its whole conversation saved to disk by Claude Code and mirrored in
`control/conversations/`. That makes the revive simpler and safer than the first plan assumed: pir owns
the process, so it knows exactly when a worker has died and there is no second copy of the session to
race.

### Success criteria

- A mid-run worker death never deletes a task worktree or branch.
- The first death of a task's worker revives that same conversation, in its task worktree, under its
  own id; a failed revive or a later death hands the kept branch to a fresh worker, reviewer or merge
  by `decideResume`.
- The third death of a task's workers in one run stops retrying that task for the rest of the run
  and tells the person; a restart gives it fresh tries.
- A restart revives each unfinished task's previous worker once, by the same rule.
- Never two live processes on one task or one session; `HALT` still means stop; `npm test` and the
  boundary scan stay green.

### Stance

Work a worker produced is the person's money and is never discarded by the coordinator. A dead
worker's own conversation is the best continuation there is, but it is tried once, because a
conversation can itself be the cause of the death.

---

## 2. Behaviour specification

### 2.1 What a death is

A tracked worker is dead when its process has exited and pir did not close it. `platform.list()` holds
only live children, so a tracked task whose worker is not listed is dead at once; `buildAssignments`
already reads it that way (live-workers T05). A `sdk-error` is handled as an exit (live-workers §2.14),
and worker-proc terminates the process when it logs one, so it is a death too. A worker the loop closed
itself (`closedIds`) is never a death.

The `claude --bg` shapes the first plan designed for (vanished, listed without a pid, woken by the
daemon) and its `APPEAR_GRACE` rule no longer exist.

### 2.2 The sequence on a task's deaths

Deaths are counted per task, in memory, for the life of one run. They are not written to git.

| Death | What happens | Why |
|---|---|---|
| 1st | Revive the same conversation (§2.3), if its role matches the branch's next step (§2.4). Otherwise as for the 2nd. | The worker remembers what it was doing and any question it had parked on the person. |
| 2nd, or a failed revive | Keep the branch; `decideResume` picks merge, fresh review, or a fresh implementer on the kept branch. | Same code as restart, so the two paths cannot disagree again. |
| 3rd | Give up on the task for this run (§2.5), unless its branch is ✅: that merges (§2.4). | A task or a machine fault that kills every worker would otherwise respawn forever, silently, at real cost. The runaway breaker does not catch it, because the live count never exceeds the ceiling. |

User decisions 2026-09-24: build the revive (level 2) and cap it at one per task per run; stop at 3
deaths, this run only; a restart gets fresh tries.

### 2.3 Reviving a conversation

The revive starts a new child through the same `startWorker` path as a spawn, with the SDK option
`resume: <id>` in place of `sessionId: <id>` (the SDK rejects both together without `forkSession`,
sdk.d.ts 0.3.282), the task worktree as `cwd`, the same `name`, and every other option as a spawn.
Measured at plan time (FINDINGS 2026-09-26, Claude Code 2.1.283, SDK 0.3.282): a worker SIGKILLed in
the middle of a foreground Bash command, resumed this way, continues under the same session id, writes
to the same `~/.claude/projects/…/<id>.jsonl`, keeps its memory, and accepts `--name`; no copy is
started.

- **Same id everywhere.** The revived worker is registered in the platform under its old id, so
  `buildAssignments` finds it by `state.tasks[num].workerId` with no change, and the id must not be in
  `closedIds` (the dead path must not add it), or the loop would filter it out and call it dead again.
- **Same conversation log.** The revived worker appends to its existing
  `conversations/{Txx}-{role}-{n}.ndjson`, not the next `n`: it is the same worker (live-workers §2.3
  gives a new `n` to a *new* worker), and the resumed stream does not replay the history, so a new file
  would show the person only the part after the revive. A `revived` note is logged before the
  continuation message.
- **Never two processes on one session.** The revive runs only when the old process is gone: the
  platform refuses to revive an id that is still live. On restart the old process may belong to the
  dead coordinator, so the restart revive runs only after the reap and never for a session whose
  recorded pid could not be verified (§2.7).
- **The cwd is load-bearing.** Claude Code keys a saved session by its project folder, so the resume
  must run in the task worktree the worker was spawned in. It always is: that worktree is the one the
  task keeps.
- **Person grants.** "Do not ask this worker again" grants (live-workers §2.6) are held per worker id
  in the coordinator's memory, so they carry over a mid-run revive and are lost on a restart revive,
  like everything else in the coordinator's memory.

The continuation message is fixed text, sent from `pir` as the revived worker's first user message:

> Your session was interrupted and has just been resumed. Before you do anything else, re-check where
> the work actually stands: `git status --short`, `git log --oneline pir/{plan}..HEAD`, and your
> task's row in `plans/{plan}/PROGRESS.md`. An edit or commit you believe you made may not have
> landed, and a command you started may not have finished. Then carry on with the same instruction
> you were given, under the pir-worker contract.

It names the checks because a killed session's last tool call has no result. In the plan-time probe
the resumed worker said its command "never started", which was wrong (it was killed mid-run), so the
worker cannot be trusted to work out on its own what landed.

### 2.4 Which role is revived

A revive continues a conversation, so it only makes sense when that conversation's job is the next
step. Given the committed task-branch glyph:

| Dead role | Branch glyph | 1st death | Later / fallback |
|---|---|---|---|
| implement | ⬜ / 🟡 / other | revive | fresh implementer on the kept branch (`resume`) |
| implement | 🔍 | fresh reviewer (`review`); no revive | same |
| review | 🔍 | revive | fresh reviewer (`review`) |
| any | ✅ | merge directly; no revive | same |

An implementer that already committed 🔍 has finished its job, so the next step is a fresh-eyes
review, never the author. A ✅ branch is merged exactly as restart merges it. This reverses the old
`decideDispatch` comment that a dead done worker "cannot be trusted": the committed ✅ glyph is the
same evidence restart already trusts (restart-recovery.md).

### 2.5 Giving up on a task

At the third death the task is given up for this run. It is not marked ⛔ in `PROGRESS.md`; it is
held out of dispatch in memory (`decideDispatch` gets the set), so its dependants wait and the run
eventually goes quiet and ends as a stall. The branch is kept. A ✅ branch is merged instead, even at
the cap: a merge needs no worker, so there is nothing for the brake to stop (user decision
2026-09-24). A restart forgets the count and tries again, because a restart is the person's deliberate
act (user decision 2026-09-24). Holding it in memory and not filtering it from the task list matters:
a filtered ⬜ task would make `complete` true on a plan that is not finished.

### 2.6 What the person sees

User-approved 2026-09-24. One line per event, printed by the coordinator:

```
↻ T05's worker stopped unexpectedly — woke its conversation to carry on
↻ T05's worker stopped again — started a new worker on its kept branch (2 of 3)
⚠ T05's worker died 3 times this run — no more retries; its branch is kept.
  Its dependants wait. Re-run the plan to try again.
```

The fallback line names what `decideResume` chose: "started a new worker", "sent it to a fresh
reviewer", or "merged its finished branch". A given-up task's row reads `gave up · worker died 3×`
instead of `queued`. A task that has had a death this run and is still live shows its phase label
followed by `· worker restarted N×` (N = its deaths), e.g. `implementing · worker restarted 1×`. Under
`pir` the coordinator's lines go to `run.log` and the screen paints only the task rows, so the row is
where a `pir` user sees a death (user decision 2026-09-24). On a restart, the existing
`restart-summary` line also names what it woke ("woke T03, T05 where they left off").

In the conversation view (live-workers §2.11) a revived worker's conversation carries on in the same
view: the `exited` note, then a `revived` note, then pir's continuation message, then the worker. The
view needs one new note line, worded after the approved coordinator line:
`↻ the worker stopped unexpectedly — pir woke this conversation to carry on`. Everything else it
already draws.

### 2.7 Restart revives too

Decision 2026-09-24: the same revive-once rule applies on restart, built last. At restart the
in-memory state is empty. The session to revive is found on disk: the newest
`conversations/{Txx}-{role}-{n}.ndjson` for the role the branch glyph needs (§2.4), whose first `init`
event carries the session id (`core/stream.mjs` reads `init.sessionId`). Conversation logs survive a
restart (live-workers §2.3), so no record-keeping change is needed; the first plan's worry about
`claude rm` destroying the session is gone with `claude --bg`.

The restart revive runs after startup hygiene has reaped `workers.json`. A session whose recorded pid
was skipped by the reap because it could not be verified (no recorded start time) is not revived: that
process may still be running on the session, so the task gets a fresh worker instead.

### 2.8 The unhappy paths

- **`HALT`.** The halted branch of `runPass` returns before any death handling, so nothing is revived
  or respawned. Unchanged.
- **The revive fails.** The resume can fail only after the child is started (a missing session file,
  a protocol error), so it shows as the revived worker exiting before its log shows a new `init`. That
  is a failed revive, not a new death: the next pass falls back per the 2nd row of §2.2 without
  counting another death. A revive that cannot even start (spawn throws) falls back in the same pass.
- **The revived session dies after it started.** For example its context is exhausted. That is the
  2nd death, so a fresh worker takes the branch. This is the risk the one-revive cap exists for.
- **A worker parked on a question or a permission request dies.** Its pending request dies with it and
  the person's late answer is logged `undelivered` (live-workers §2.14). A revive keeps the question in
  its conversation and the worker asks again; a fresh worker would start the task's thinking over.
- **Orphaned child processes.** A killed worker's running command can outlive it. The coordinator
  cannot reliably kill it (see `AWAIT_IDLE_TIMEOUT_MS`); the continuation message tells the worker its
  command may not have finished. Recorded, not solved.

---

## 3. Architecture

### 3.1 The boundary

```
src/core/   pure: decideResume (extended), decideDispatch (gains givenUp). No clock, fs, child_process or npm package.
src/shell/  loop.mjs executes; platform.mjs and worker-proc.mjs start and revive children; coordinate.mjs narrates.
```

`src/core/boundary.test.mjs` scans `src/core/` for forbidden imports. If it fails, move the code to
`src/shell/`; never relax the test.

### 3.2 Modules

- `src/core/resume.mjs` — `decideResume` gains optional per-task death input and returns `revive` and
  `giveUp` beside `merge`/`review`/`resume`. One decision for both paths.
- `src/core/dispatch.mjs` — `decideDispatch` gains `givenUp` (a set of task numbers never spawned).
- `src/shell/worker-proc.mjs` — `startWorker` and `workerOptions` take `resume` as an alternative to
  `sessionId`; the worker reports whether its process exited before its first `init`.
- `src/shell/platform.mjs` — `revive()`, `exitOf()`, `continuationMessage()` beside
  `openingInstruction`, and `lastConversation()` for restart.
- `src/shell/fake/platform.mjs` — `revive`, `exitOf`, and a `crashAfterCommit` behaviour.
- `src/shell/loop.mjs` — the death counter, a shared adoption helper used by both `reconcile` and the
  dead path, the revive, the restart revive.
- `src/shell/coordinate.mjs`, `src/core/display.mjs`, `src/core/conversation.mjs` — the lines, the row
  label and the `revived` note line of §2.6.
- `src/shell/harness/` — `worker-death` fixtures that SIGKILL one worker and let the run continue.

### 3.3 The decision function

```
decideResume({ featureTasks, branchStates, deaths = {}, maxDeaths = 3 })
  → { merge, review, resume, revive, giveUp }        // each a sorted list of task numbers

deaths[num] = { count, role, sessionId, revived }    // absent: no death this run (restart: count 0)
```

With `deaths` empty it returns exactly what it returns today (plus empty `revive` and `giveUp`), so
restart behaviour is unchanged until T06 passes revive candidates. Rules, in order: ✅ → `merge`;
`count >= maxDeaths` → `giveUp`; branch absent → no entry; revive eligible per §2.4 and `!revived` and
`sessionId` → `revive`; 🔍 → `review`; else `resume`. Mid-run `sessionId` is the worker id, always
known; on restart it is null when no conversation log is found or its pid was unverifiable (§2.7).

### 3.4 State

Run state gains `deaths: { [num]: { count, revived } }` and `givenUp: Set`, both outside
`state.tasks[num]` because 3a deletes that entry. Nothing new is persisted; a crash loses the counts,
which is the "per run" rule.

---

## 4. Testing

`npm test` proves the decision table exhaustively (core); `startWorker` with `resume` and the platform's
`revive` against the fake `claude` (`fake/claude-stream.mjs`) through the real SDK, as live-workers
tests its spawn; and the loop's dead path against the fake platform and real scratch git
(loop.test.mjs): branch kept, revive issued once, fallback, give-up, no id in `closedIds`, no
duplicate, `HALT` untouched. The harness `worker-death` fixtures prove it over real agents, and a worker
drill judges the `pir` rows on a real terminal (the `pir-e2e` skill).

---

## 5. Environment

| | |
|---|---|
| OS | macOS (Darwin 25.5.0) |
| Runtime | Node, ES modules, `node:test` |
| Claude Code | 2.1.283; `@anthropic-ai/claude-agent-sdk` 0.3.282 pinned. The resume facts in §2.3 were measured on this pair. |
| Deliberately absent | no new dependencies |

**The test command** is the `test` line of the block this file opens with, `npm test`, which is
`FORCE_COLOR=0 NO_COLOR=1 node --test --test-reporter=dot 'src/**/*.test.mjs'`: quiet on green, loud on
failure. To debug one file, run it with `--test-reporter=spec`. It is the only evidence a session may
produce on its own. A fresh worktree needs `npm ci` first, which the `setup` line runs.

**After changing engine code, run `./install.sh`** and grep the change in `~/.claude/pir-engine/`, but
never while a parallel run is live (§5.3).

### 5.1 What the test command cannot reach

| Cannot be tested automatically | Why |
|---|---|
| A real worker killed mid-task and revived, continuing real work on its branch | Needs paid live agents (T08 harness, T09) |
| The task rows and the conversation view reading right in `pir` on a real terminal | A worker drill drives and judges it (T09, `pir-e2e`) |

### 5.2 Seatbelts

| Mechanism | Default | Effect |
|---|---|---|
| `PARALLEL_MAX_WORKERS=1` | harness ceiling 1 | One paid worker at a time in every live check |
| Scratch repo | harness `--into` a trusted scratch path | Never the canonical checkout (`PARALLEL_ALLOW_HERE` unset) |
| Harness `timeoutMs` | 10 min | A stuck live run is torn down |
| `perl -e 'alarm N; exec @ARGV'` | every direct probe | macOS has no `timeout`; the probe dies at N s |
| `workers.json` reap | on stop, restart, teardown | No orphaned worker survives a killed coordinator |
| `HALT` | available | Stops every worker of the run at once |

Scratch paths must already be trusted by Claude Code (`hasTrustDialogAccepted` in `~/.claude.json`);
trust does not inherit from a parent folder (FINDINGS).

### 5.3 Outside the code — who acts

| Action | Command | Bin | Why this bin | Way back | Cost |
|---|---|---|---|---|---|
| Kill a scratch worker | `kill -9 <pid>` of a fixture worker, pid from its run's `control/workers.json` | `worker` | Only this plan's scratch workers | Revive or re-run | none |
| Live harness run | `node src/shell/harness/run.mjs worker-death --into <scratch>` (and `worker-death-twice`) | `worker` | Exception, user 2026-09-24: runs may go without a yes, told after; bounded by ceiling 1, 10-min timeout, scratch only | HALT; scratch deleted | a few dollars |
| Watched live run | `PARALLEL_MAX_WORKERS=1 node src/shell/pir.mjs worker-death` in a fixture scratch, driven in a pseudo-terminal by the worker | `worker` | Same exception; the worker drives and judges the screen (CLAUDE.md, `pir-e2e`) | Ctrl+S twice or HALT; scratch deleted | a few dollars |
| `./install.sh` | refresh the installed engine, after `pir/resume-dead-worker` is merged to main | `worker` | Local copy, idempotent; never while any parallel run is live, whose workers use the installed engine and skills | Re-run from the previous commit | none |

---

## 6. Recovery

If a revive misbehaves in a live run: `touch plans/{slug}/.parallel/control/HALT`. No exit path
deletes a task branch, so a re-run continues every task. A worker left running by a killed coordinator
is reaped from `workers.json` by the next start or a stop (restart-recovery.md).

---

## 7. Decisions and rationale

- 2026-09-24, user: build both levels; revive capped at one per task per run. The probe showed the
  revive works on this machine; the cap bounds a conversation that is itself the cause.
- 2026-09-24, user: give up at 3 deaths per task per run, in memory, not ⛔. The person is present at a
  restart, and a ⛔ would add a hand-clear chore next to the merge-conflict one.
- 2026-09-24, user: restart revives by the same rule, built last, so the mid-run fix is proven first.
- 2026-09-24, user: the §2.6 lines and row label, as proposed.
- 2026-09-24, user (plan review): build in parallel mode, not the classic route recommended at plan time.
- 2026-09-24, user: a ✅ branch merges even on the 3rd death; the brake only stops work that needs a worker.
- 2026-09-24, user: a live task row carries `· worker restarted N×`, because under `pir` the lines are unseen.
- 2026-09-24, user: live harness and watched runs move from `ask` to `worker`, told after.
- 2026-09-26, re-plan onto live workers: the death-shape spike (old T00) is dropped. The shapes it
  would measure belonged to `claude --bg`; the one fact the revive still needed (an SDK resume of a
  SIGKILLed worker keeps its id, file and memory) was measured at re-plan time (FINDINGS 2026-09-26).
- 2026-09-26, re-plan: the watched run is judged by the worker driving `pir` in a pseudo-terminal, not
  by the person. CLAUDE.md rules that a screen the project draws is driven and judged by a session.
- 2026-09-26, re-plan: the revived worker continues its own conversation log. It is the same session,
  and a new file would hide the history before the death from the conversation view.
- 2026-09-26, re-plan: a revive whose process exits before its first `init` is a failed revive, not a
  death. The 2026-09-24 rule "a failed revive falls back and the death still counts" counted only the
  original death; with an asynchronous start this keeps it that way.
- Extend `decideResume` and reuse `reconcile`'s merge/review/resume execution as one helper, not a
  second decision: two resume decisions are how the two paths came to disagree.
- The cezar per-task handoff file is not copied: the kept branch and the conversation already carry
  the state, and a third record could disagree with both.

## 8. Out of scope

- Persisting death counts across a restart: "per run" is the decision, and a crash that loses the
  count loses at most three tries.
- Killing a dead worker's orphaned child processes: not reliably possible from the coordinator
  (`AWAIT_IDLE_TIMEOUT_MS` note in loop.mjs).
- Nudging a quiet but live worker: `nudge-quiet-worker`, which is also due a re-plan onto live workers.
- Carrying "do not ask again" grants across a restart: they are in-memory by live-workers §2.6.
