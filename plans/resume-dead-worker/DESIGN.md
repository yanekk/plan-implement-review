# Resume a dead worker — Design

> Build-time rationale for the dead-worker fix in parallel mode. How parallel mode behaves is
> canonical in `/docs`; this plan's tasks update `/docs` (restart-recovery.md, run-lifecycle.md) to
> the new behaviour. Every rule carries its reason.

## 1. Purpose

When a worker disappears mid-run, the coordinator treats it as dead and, in `loop.mjs` step 3a,
closes it, `claude rm`s its record, deletes its task worktree and branch, and forgets the task. The
row is still ⬜, so `decideDispatch` respawns the task from scratch, often in the same pass. Every
commit, every uncommitted edit and all of the worker's context are lost. The restart path already
does better: `reconcile` with `decideResume` keeps the branch and continues it. This plan makes the
mid-run path at least as good as restart, adds a revive of the dead worker's own conversation, and
puts a brake on a task whose workers keep dying.

### Success criteria

- A mid-run worker death never deletes a task worktree or branch.
- The first death of a task's worker revives that same conversation, in its task worktree, under its
  own name; a failed revive or a later death hands the kept branch to a fresh worker, reviewer or
  merge by `decideResume`.
- The third death of a task's workers in one run stops retrying that task for the rest of the run
  and tells the person; a restart gives it fresh tries.
- A restart revives each unfinished task's previous worker once, by the same rule.
- Never two live sessions for one task; `HALT` still means stop; `npm test` and the boundary scan
  stay green.

### Stance

Work a worker produced is the person's money and is never discarded by the coordinator. A dead
worker's own conversation is the best continuation there is, but it is tried once, because a
conversation can itself be the cause of the death.

---

## 2. Behaviour specification

### 2.1 What a death is

A tracked worker is dead when the live list (`claude agents --json`) no longer shows it as a running
session past `APPEAR_GRACE`. Today "shown" means "listed". The plan-time probe (FINDINGS 2026-09-24)
found three shapes of a killed session: it vanishes from the list (killed while idle); it stays
listed with no `pid` (killed while a background job ran); and the Claude Code daemon may wake it on
its own a minute later to deliver a pending notification. A worker listed with no process is not
working, so the rule becomes: absent, or listed without a `pid`, for longer than the grace. T00
measures the true mid-turn shape; if it finds another shape, T03 widens the rule to cover it and
records why. A worker the loop closed itself (`closedIds`) is never a death.

### 2.2 The sequence on a task's deaths

Deaths are counted per task, in memory, for the life of one run. They are not written to git.

| Death | What happens | Why |
|---|---|---|
| 1st | Revive the same conversation (§2.3), if the task has a recorded session id and its role matches the branch's next step (§2.4). Otherwise as for the 2nd. | The worker remembers what it was doing and any question it had parked on the person. |
| 2nd, or a failed revive | Keep the branch; `decideResume` picks merge, fresh review, or a fresh implementer on the kept branch. | Same code as restart, so the two paths cannot disagree again. |
| 3rd | Give up on the task for this run (§2.5), unless its branch is ✅: that merges (§2.4). | A task or a machine fault that kills every worker would otherwise respawn forever, silently, at real cost. The runaway breaker does not catch it, because the live count never exceeds the ceiling. |

User decisions 2026-09-24: build the revive (level 2) and cap it at one per task per run; stop at 3
deaths, this run only; a restart gets fresh tries.

### 2.3 Reviving a conversation

The revive is `claude stop <id>` and then `claude --bg --resume <sessionId> "<continuation>"`, run
with the task worktree as its working directory and no other flags. Each part has a measured reason
(probe 2026-09-24, Claude Code 2.1.281):

- A resumed session whose record still exists continues under the same id, the same name, and its
  original cwd, with its memory intact. So the name-based match in `buildAssignments` finds it again
  with no change.
- Resuming a session that is still running starts a copy with a new id, the same name, and the
  caller's cwd. The `stop` first makes sure it is not running; the revive also parses `started a copy
  as <id>` from the output, and on seeing it closes and removes the copy and treats the revive as
  failed. Two sessions on one task is the failure this plan must never cause.
- Passing flags (`-n`) to a session whose record exists also starts a copy, so no flags are passed.
- After `claude rm` the conversation still resumes, but in the caller's cwd under an auto-generated
  name. So the dead path no longer `rm`s a worker's record until its task is finished with it, and
  the cwd is always the task worktree as a second guard. T00 measures whether `-n` plus cwd restores
  a removed session under its own id; T06 uses the answer (§2.7).

The session id is the full `sessionId` from `claude agents --json`, recorded on the task each pass
while the worker is alive, because a dead worker is absent from the list when it is needed.

The revived session keeps its id, so that id must not be in `closedIds`, or the loop would filter it
out of the live list and call it dead again. The revived task gets `APPEAR_GRACE` like a spawn.

The continuation message is fixed text, the same for every revive:

> Your session was interrupted and has just been resumed. Before you do anything else, re-check where
> the work actually stands: `git status --short`, `git log --oneline pir/{plan}..HEAD`, and your
> task's row in `plans/{plan}/PROGRESS.md`. An edit or commit you believe you made may not have
> landed, and a command you started may not have finished. Then carry on with the same instruction
> you were given, under the pir-worker contract.

It names the checks because a killed session's last tool call has no result, and the worker would
otherwise assume it succeeded.

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
the cap: a merge needs no worker, so there is nothing for the brake to stop (user decision 2026-09-24). A restart forgets the count and tries
again, because a restart is the person's deliberate act (user decision 2026-09-24). Holding it in
memory and not filtering it from the task list matters: a filtered ⬜ task would make `complete` true
on a plan that is not finished.

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
followed by `· worker restarted N×` (N = its deaths), e.g. `implementing · worker restarted 1×`. The row
is the only place a `pir` user sees a death: under `pir` the coordinator's lines go to `run.log`, and
the `pir` view paints only the task rows (user decision 2026-09-24). On a restart, the existing `restart-summary` line also names what it woke
("woke T03, T05 where they left off"). Today a death prints nothing and a ⛔ or held task reads
`queued`, which is why these are specified.

### 2.7 Restart revives too

Decision 2026-09-24: the same revive-once rule applies on restart, built last. At restart the
in-memory state is empty, so the session to revive is found by name in `claude agents --json --all`
(the newest session whose name parses to this plan, task and the role the branch glyph needs). That
listing only holds sessions whose record was not removed, so `teardownRun` and the reconcile reap
stop `claude rm`ing workers of unfinished tasks, unless T00 shows `-n` plus cwd restores a removed
session under its own id, in which case removal stays and the revive passes the name. The cost of
keeping records is `stopped` entries in the person's `claude agents` view between a stop and the
next restart; the finish paths (merge, clean hand-off) still remove them.

### 2.8 The unhappy paths

- **`HALT`.** The halted branch of `runPass` returns before any death handling, so nothing is revived
  or respawned. Unchanged.
- **The revive command fails** (non-zero exit, no id, a copy). Fall back in the same pass to the 2nd
  death row of §2.2. The death still counts.
- **The daemon wakes the dead session on its own** at the moment the coordinator revives it. The
  `stop` before the resume makes this the same case as a normal revive; a copy that slips through is
  caught by the output parse.
- **The revived session dies at once**, for example because its context is exhausted. That is the
  2nd death, so a fresh worker takes the branch. This is the risk the one-revive cap exists for.
- **A worker parked on a question dies.** A revive keeps the question in its conversation and the
  person can still attach to it; a fresh worker would ask again.
- **Orphaned child processes.** A killed session's running command survives it (probe: `sleep 90`
  outlived its session). The coordinator cannot reliably kill it (see `AWAIT_IDLE_TIMEOUT_MS`); the
  continuation message tells the worker its command may not have finished. Recorded, not solved.

---

## 3. Architecture

### 3.1 The boundary

```
src/core/   pure: decideResume (extended), decideDispatch (gains givenUp). No clock, fs or claude.
src/shell/  loop.mjs executes; platform.mjs runs claude; coordinate.mjs narrates and tears down.
```

`src/core/boundary.test.mjs` scans `src/core/` for forbidden imports. If it fails, move the code to
`src/shell/`; never relax the test. Every rule proven in core is proven in milliseconds; every rule
that leaks into the shell can only be proven by a live run.

### 3.2 Modules

- `src/core/resume.mjs` — `decideResume` gains optional per-task death input and returns `revive` and
  `giveUp` beside `merge`/`review`/`resume`. One decision for both paths, as the brief requires.
- `src/core/dispatch.mjs` — `decideDispatch` gains `givenUp` (a set of task numbers never spawned).
- `src/shell/platform.mjs` — `parseAgents` and `list()` carry `sessionId`; new `revive()` and
  `history()`; the continuation message beside `openingInstruction`.
- `src/shell/fake/platform.mjs` — session ids, `revive`, `history`, and a crash after a commit.
- `src/shell/loop.mjs` — death detection, the death counter, a shared adoption helper used by both
  `reconcile` and the dead path, the revive.
- `src/shell/coordinate.mjs`, `src/core/display.mjs` — the lines and the row label of §2.6; the
  teardown record change of §2.7.
- `src/shell/harness/` — `worker-death` fixtures that SIGKILL one worker and let the run continue; capture
  reads the list through `parseAgents` instead of its own copy.

### 3.3 The decision function

```
decideResume({ featureTasks, branchStates, deaths = {}, maxDeaths = 3 })
  → { merge, review, resume, revive, giveUp }        // each a sorted list of task numbers

deaths[num] = { count, role, sessionId, revived }    // absent: no death this run (restart: count 0)
```

With `deaths` empty it returns exactly what it returns today (no `revive`, no `giveUp`), so restart
behaviour is unchanged until T06 passes revive candidates. Rules, in order: ✅ → `merge`;
`count >= maxDeaths` → `giveUp`; branch absent → no entry; revive eligible per §2.4 and `!revived` and
`sessionId` → `revive`; 🔍 → `review`; else `resume`.

### 3.4 State

Run state gains `deaths: { [num]: { count, revived } }` and `givenUp: Set`, both outside
`state.tasks[num]` because 3a deletes that entry. `state.tasks[num].sessionId` is refreshed from the
list each pass. Nothing new is persisted; a crash loses the counts, which is the "per run" rule.

---

## 4. Testing

`npm test` proves the decision table exhaustively (core), the argv, output parsing and copy handling
of `revive` against an injected runner (platform), and the loop's dead path against the fake platform
and real scratch git (loop.test.mjs): branch kept, revive issued once, fallback, give-up, no id in
`closedIds`, no duplicate, `HALT` untouched. The harness `worker-death` fixture proves it over real
agents; the person judges the on-screen lines.

---

## 5. Environment

| | |
|---|---|
| OS | macOS (Darwin 25.5.0) |
| Runtime | Node, ES modules, `node:test` |
| Claude Code | 2.1.281 — every revive fact above was measured on it |
| Deliberately absent | no new dependencies; no npm packages beyond what `package.json` has |

**The test command.**

```
npm test
```

Which is `FORCE_COLOR=0 NO_COLOR=1 node --test --test-reporter=dot 'src/**/*.test.mjs'`: quiet on
green, colour off inside the command, loud on failure. To debug one file verbosely, run it with
`--test-reporter=spec`. It is the only evidence a session may produce on its own.

**After changing engine code, run `./install.sh`** and grep the change in `~/.claude/pir-engine/`.

### 5.1 What the test command cannot reach

| Cannot be tested automatically | Why |
|---|---|
| How a real session looks in `claude agents --json` after each kind of death | Only a real daemon produces it (T00) |
| A real revive continuing real work on its branch | Needs paid live agents (T08 harness, T09) |
| The task rows reading right in the `pir` view | A person judges the wording on a real TTY (T09) |

### 5.2 Seatbelts

| Mechanism | Default | Effect |
|---|---|---|
| `PARALLEL_MAX_WORKERS=1` | harness ceiling 1 | One paid worker at a time in every live check |
| Scratch repo | harness `--into` a trusted scratch path | Never the canonical checkout (`PARALLEL_ALLOW_HERE` unset) |
| Harness `timeoutMs` | 10 min | A stuck live run is torn down |
| `HALT` | available | Stops every worker of the run at once |
| Probe cleanup | `claude stop`, kill pid, `claude rm`, delete scratch | T00 leaves no session or folder behind |

Scratch paths must already be trusted by Claude Code (`hasTrustDialogAccepted` in `~/.claude.json`);
`claude --bg` refuses an untrusted cwd and trust does not inherit from a parent folder (FINDINGS).

### 5.3 Outside the code — who acts

| Action | Command | Bin | Why this bin | Way back | Cost |
|---|---|---|---|---|---|
| Probe sessions | `claude --bg` on a scratch repo, one-word prompts | `worker` | Seconds of model time, cleaned up | `claude stop` + `claude rm` + delete scratch | cents |
| Kill a scratch worker | `kill -9 <pid>` of a listed `pirprobe`/fixture worker | `worker` | Only this plan's scratch sessions | Revive or re-run | none |
| Live harness run | `node src/shell/harness/run.mjs worker-death --into <scratch>` (and `worker-death-twice`) | `worker` | Exception, user 2026-09-24: runs may go without a yes, told after; bounded by ceiling 1, 10-min timeout, scratch only | HALT; scratch deleted | a few dollars |
| Watched live run | `PARALLEL_MAX_WORKERS=1 node src/shell/pir.mjs worker-death` in a fixture scratch | `worker` | Same exception; the person only watches it | `touch` HALT; scratch deleted | a few dollars |
| `./install.sh` | refresh the installed engine, after `pir/resume-dead-worker` is merged to main | `worker` | Local copy, idempotent; never during the build run, whose workers use the installed engine and skills | Re-run from the previous commit | none |

---

## 6. Recovery

If a revive misbehaves in a live run: `touch plans/{slug}/.parallel/control/HALT`. No exit path
deletes a task branch, so a re-run continues every task. A stray copy session is ended with `kill
<pid>` and `claude rm <id>` (restart-recovery.md § Manual recovery).

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
- 2026-09-24, user: the worker starts the watched live run; the person only watches and judges.
- 2026-09-24, user: live harness and watched runs move from `ask` to `worker`, told after.
- 2026-09-24, user: one `claude agents --json` reader; the harness capture switches to `parseAgents`.
- Extend `decideResume` and reuse `reconcile`'s merge/review/resume execution as one helper, not a
  second decision: two resume decisions are how the two paths came to disagree.
- The cezar per-task handoff file is not copied: the kept branch and the conversation already carry
  the state, and a third record could disagree with both.

## 8. Out of scope

- Persisting death counts across a restart: "per run" is the decision, and a crash that loses the
  count loses at most three tries.
- Killing a dead worker's orphaned child processes: not reliably possible from the coordinator
  (`AWAIT_IDLE_TIMEOUT_MS` note in loop.mjs).
- Nudging a quiet but live worker: the sibling brief `nudge a quiet worker` plans that separately.
