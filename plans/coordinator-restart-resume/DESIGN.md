# Coordinator restart resume — Design

> Read this before changing restart behaviour. Every rule carries its reason. The canonical
> behavioural spec for parallel mode is `/docs`; this file is build-time rationale for the
> restart-resume fix, and the plan's own tasks update `/docs` to the corrected behaviour.

## 1. Purpose

When a parallel run (`/pir-coordinate`) is crashed, killed or rebooted and then restarted on the
same slug, it loses in-flight work. The feature branch and its worktrees are reused correctly
(deterministic names, idempotent `openFeature`/`createTask`). But which tasks are "still to do" is
read only from the feature-branch `PROGRESS.md`, and that file advances a task past `⬜` only when
the task is merged into the feature branch. A task built (`🔍`) or built and reviewed (`✅`) on its
own task branch but not yet merged still reads `⬜` there, so on restart it is re-dispatched from
scratch, discarding the finished task-branch work. Separately, the control folder is reused rather
than cleared, so stale reports, answers, outbox messages and surfaces from the dead run can
contaminate the fresh one.

This plan makes a restart reconcile each task from its own task branch — git is ground truth —
resuming it at the pipeline stage it actually reached, and clears the stale transient control-folder
feeds on startup.

### Success criteria

- A task built and reviewed (`✅`) on its branch but unmerged is **merged** on restart, not rebuilt.
- A task built but unreviewed (`🔍`) gets a **fresh review** on restart, not a re-implement.
- A half-built task branch (implementer died before the build was committed) is **rebuilt clean**.
- Stale `reports/`, `answers`, `outbox` and `surfaced` from a dead run do not affect the fresh run.
- `npm test` and the boundary scan stay green; the reconciliation logic is proven headless, and the
  old behaviour reddens the new tests.

### Stance

Git is the durable record of what has actually landed, and the committed task-branch `PROGRESS.md`
row is the durable record of how far a task got. In-memory run state is disposable and is rebuilt
from git on restart, never trusted across a crash. A restart never rebuilds work git already holds
as finished, and never adopts work git does not hold as finished.

---

## 2. Behaviour specification

### 2.1 The resume principle — git is ground truth, read once at startup

On restart the coordinator's in-memory run state (`createRunState()`) is empty: it tracks no worker
and remembers no phase. Rather than trust the lagging feature-branch `PROGRESS.md`, the coordinator
reconstructs per-task state from git — the one place a crash cannot lie about what landed. It does
this **once, at run startup**, before the first dispatch, and calls the result *reconciliation*.

Reconciliation is not restart-only code with a restart flag. It runs at every startup and is a
no-op on a genuine first start, because a first start has no task branches to adopt. This is why
there is no "am I restarting?" test anywhere: the presence of task branches is the only thing that
matters, and a fresh run has none. The reason to avoid a restart flag is that a flag is a second
source of truth that can disagree with git; asking git directly cannot.

### 2.2 The task-branch state signal — why the committed row is trustworthy

The stage a task reached lives in its own task branch's `plans/{slug}/PROGRESS.md` row, read with
`git show pir/{slug}-T{nn}:plans/{slug}/PROGRESS.md`. The glyph in that row is the signal:

- `⬜` — the branch exists but the worker committed no build (createTask cut the branch off the
  feature branch, which carries `⬜`, and nothing advanced it). Half-built.
- `🟡` — the implementer marked in-progress because its tests were not green. Half-built.
- `🔍` — built and handed to review (an `auto` task). Adopt for review.
- `✅` — built and reviewed (an `auto` task), or verified by hand (a `you` task). Adopt for merge.

The signal is trustworthy because the glyph is committed **atomically with the work it describes**.
The implementer marks `🔍` and commits it in the same commit as the code (pir-implement steps 6–7);
the reviewer marks `✅` in its own commit; a `you` worker marks `✅` directly. So there is no window
in which committed code carries a stale `⬜`/`🟡`: either the build commit landed with its `🔍`, or
it did not land at all. A crash before the build commit leaves the row at `⬜`/`🟡` and nothing to
adopt, which is exactly the half-built case. This is why reading the committed row, and only the
committed row, is safe — uncommitted working-tree state is deliberately ignored, because a crash
cannot be trusted to have finished what it left uncommitted.

Per-task in-flight state is knowable **only** from the task branch. On the feature branch the
coordinator is the single writer and only reconciles a row to `✅` at merge; mid-flight the feature
row still reads `⬜`. So reconciliation reads the feature branch for the task list and the terminal
states (`✅`/`⛔`), and each task branch for the in-flight state.

### 2.3 The reconciliation classifier — one decision per task

For each task on the feature branch, the pure classifier decides one action from the feature-row
state and the task-branch glyph:

| Feature row | Task branch | Action | Why |
|---|---|---|---|
| `✅` | (any / absent) | **skip** (clean up a leftover branch, 2.6) | already merged; terminal |
| `⛔` | (any / absent) | **skip** | a person deferred it; its dependents wait (2.7) |
| `⬜` | `✅` | **merge** | built and reviewed; fold it in, do not rebuild or re-review |
| `⬜` | `🔍` | **review** | built, not reviewed; dispatch a fresh review, do not re-implement |
| `⬜` | `⬜`/`🟡`/other, branch exists | **rebuild** | half-built; discard the branch and re-implement clean |
| `⬜` | absent | **implement** | never started; normal dispatch handles it (no reconciliation action) |

Rebuild-clean rather than salvage a half-built branch is the user's decision (2026-09-17, recorded
in §7): a re-implement from the task doc is correct by construction, and adopting a branch that may
be half-finished code risks landing it as done. The cost is re-running an implement that may have
been nearly complete; the safety is that nothing half-finished is ever mistaken for finished.

A `you`/verify task branch has no `🔍` stage — it goes straight to `✅` — so `🔍` never appears for a
`you` task, and a partially-driven verify branch classifies as rebuild (re-run the person drill),
which the same table gives for free. No special-casing of `Runs` is needed in the classifier.

### 2.4 Where reconciliation runs — pass 0, folded into the first pass

Reconciliation runs inside `runPass`, gated on a fresh-state flag, immediately after the feature
branch is opened and before state is gathered and `decideDispatch` is asked. It is conceptually
"pass 0" folded into the first real pass, the same way `openFeature` is already first-pass-gated
(`if (!state.feature)`).

It lives inside `runPass`, not in a separate method the bin calls, so that every caller — the live
bin, the dry-run `drive()`, and the tests — gets reconciliation without having to remember to call
it. A second entry point is a second thing to forget, and forgetting it is the bug this plan fixes.

### 2.5 Executing each case, and the ceiling invariant

- **merge**: `worktree.mergeTask(branch)`; on a clean merge, reconcile the feature row to `✅`,
  commit the feature branch, and remove the task worktree and branch — exactly the loop's existing
  merge-and-close (loop.mjs 3d), reused. No worker session is involved: the branch is already `✅`,
  so there is nothing to run. Merges are applied in task order; a conflict is handled in 2.6.
- **review**: spawn a fresh reviewer session on the existing task worktree and seed the run state as
  a normal reviewing task (worktree, the reviewer's id, role `review`, phase reviewing, appear
  grace), so from the next pass the live loop owns it and reviews and merges it like any other. This
  reuses the loop's own review hand-off shape; the only difference is there is no implementer session
  to close, because it died in the crash.
- **rebuild**: remove the task worktree and branch. The feature row stays `⬜`, so the normal spawn
  step of the same pass dispatches a fresh implementer, and `createTask` re-cuts a clean branch off
  the feature branch. Discarding first is what guarantees the retry starts clean rather than on the
  leaked half-built branch.

**The ceiling invariant.** A `review` spawn counts against the worker ceiling like any other. The
number of task branches needing a fresh review session on restart is bounded by the number that
were in flight at the crash, which the ceiling already bounds — a `🔍` branch corresponded to a live
slot. So spawning a reviewer for every `🔍` branch stays within the ceiling in every reachable state.
`✅`-unmerged branches merge without a session and do not consume the ceiling. Reconciliation caps
its review spawns at the ceiling defensively and surfaces a warning if it is ever exceeded, which the
invariant says cannot happen; the cap is there so a wrong assumption fails loud, not silently over
the ceiling.

Reconciliation must not route an adopted task through the loop's normal assignment machinery without
a live session. `buildAssignments` treats a tracked task whose session is not in the live list as
**dead**, and the loop then removes its worktree and branch — which for an adopted `✅` or `🔍` branch
would discard exactly the work being adopted. This is why merges are performed directly in
reconciliation (no session) and reviews seed a task that has a real, freshly spawned session.

### 2.6 The unhappy paths

- **A `✅` branch will not merge cleanly** (a sibling changed a shared file after it was built).
  Reconciliation cannot auto-resolve, and there is no worker to resolve on its branch. It surfaces
  the conflict to the user in plain English and leaves the branch untouched, the same escalation the
  loop uses for a merge conflict. It does not rebuild — the work is reviewed and good, it only needs
  a hand to land.
- **A `🔍` branch that re-hits a conflict on review** resurfaces to the user through the normal
  review/integrate path once its fresh reviewer runs. Nothing special is needed.
- **A leftover branch for an already-merged (`✅` on feature) task** — the merge landed but close did
  not remove the branch before the crash. Reconciliation removes the leftover worktree and branch as
  cleanup, so a restart does not leave orphaned branches accumulating.
- **Uncommitted work in a task worktree** is ignored by design (2.2): the committed row is the only
  signal, so uncommitted changes classify by whatever the last commit said, usually rebuild.

### 2.7 Control-folder cleanup on restart

The control folder (`plans/{slug}/.parallel/control/`) is reused across a restart. On startup the
coordinator clears the **transient feeds** and preserves the **durable records**:

- **Cleared**: `reports/` (worker→coordinator up-channel), `answers` (the person's queued
  decisions), `outbox` (coordinator→worker down-channel), `surfaced` (the plain-English relay feed).
  Each is a live-run conversation buffer; a leftover entry from the dead run routes a stale answer to
  a fresh worker, delivers a stale down-message, or re-relays a stale surface. Clearing them at
  startup is safe because a genuine first start has them empty anyway.
- **Preserved — `log`**: the append-only event log is the audit trail of everything every run did,
  and the durable signal the test harness reads. It is never cleared; a restart appends a `restart`
  marker line so the audit trail shows the boundary between runs.
- **Preserved — `HALT`**: the kill switch is a deliberate user stop, and the documented way to
  restart is for the person to remove it. Auto-clearing it would defeat the interlock — a HALTed run
  that is restarted (by the person, a supervisor or a re-run) would blow straight past the stop. So
  reconciliation never clears `HALT`. Instead, if `HALT` is present at startup the coordinator
  refuses to start and tells the person to remove it, turning today's silent immediate self-halt into
  an explicit instruction. This is the one HALT-policy choice the brief flagged; it resolves to "never
  auto-clear" because auto-clearing is unsafe, and the refuse-with-a-message refinement is chosen over
  the current start-then-halt because it tells the person exactly what to do (§7).

---

## 3. Architecture

### 3.1 The boundary

```
src/core/   — pure: the reconciliation classifier decides an action per task from data alone.
              No clock, no I/O, no git.
src/shell/  — reads task-branch state from git, executes the classifier's actions against the
              real platform and worktree, clears the control feeds.
```

`boundary.test.mjs` scans `src/core/` for forbidden imports. The classifier reads git nowhere — it
takes the parsed feature task table and a map of task-branch glyphs as arguments and returns actions.
If the boundary test fails, the fix is to move the offending code into `src/shell/`, never to relax
the test. The reason is the usual one: everything on the pure side is proven exhaustively in
milliseconds in `npm test`, and every rule that leaks across becomes a rule only a live run can check.

### 3.2 Modules

- `src/core/resume.mjs` (new) — the pure classifier `decideResume`. Depends on nothing but its
  arguments; the glyph vocabulary it shares with `progress.mjs`.
- `src/core/progress.mjs` (unchanged) — `parseProgress` parses a task-branch `PROGRESS.md` into rows;
  reconciliation uses it to read the branch glyph. `reconcileTaskRow` folds a merged row to `✅`.
- `src/shell/worktree.mjs` (extended) — a task-branch state read (`git show <task-branch>:PROGRESS`)
  and a handle accessor for an existing task worktree, beside the existing merge/remove.
- `src/shell/loop.mjs` (extended) — the pass-0 reconciliation step in `runPass`: gather branch
  glyphs, call `decideResume`, execute merge/review/rebuild, seed run state.
- `src/shell/coordinate.mjs` (extended) — clear the transient control feeds and enforce the HALT
  refusal at bin startup; append the `restart` log marker.
- `src/shell/fake/worktree.mjs` (extended) — the fake gains the task-branch state read so the loop
  and reconciliation are tested against real scratch git.
- `src/shell/harness/` (extended) — a restart-capable run mode and a restart fixture for the live
  drill.

### 3.3 The decision function

`decideResume({ featureTasks, branchStates })` → `{ merge: [num…], review: [num…], rebuild: [num…] }`.

- `featureTasks` — the parsed feature-branch task rows (`{ num, state, deps, runs }` from
  `parseProgress`).
- `branchStates` — a map from task number to its task-branch glyph, or `null`/absent when the branch
  does not exist. The shell reads these from git; the function itself touches no git.
- Output — the tasks to merge, to review, and to rebuild. `implement` (branch absent) and `skip`
  (feature `✅`/`⛔`) produce no entry, because the normal dispatch handles the first and nothing is
  to be done for the second. A pure function of its arguments and nothing else, so the whole four-way
  classification is proven without a live agent, and a mutation that returns the old "everything ⬜ is
  a fresh implement" reddens it.

### 3.4 Data flow

Restart → `runPass` pass 0 → read feature `PROGRESS.md` (task list + terminal states) → for each
task, `worktree.taskBranchState(slug, num)` reads the committed branch glyph → `decideResume` →
execute: merge folds the branch into the feature branch and reconciles the row; review spawns a fresh
reviewer and seeds run state; rebuild removes the branch → the same pass's normal steps spawn fresh
implementers for rebuilt and never-started tasks within the ceiling → from pass 1 the loop runs
unchanged over a state that now matches git.

### 3.5 Storage

State lives in git (feature and task branches) and in the control folder on disk. Reconciliation only
reads committed git state, so a crash mid-write to a worktree cannot mislead it — an uncommitted or
torn write is simply not part of the committed row it reads. The feature-branch `PROGRESS.md` is
written by the coordinator alone via `reconcileTaskRow`, one row at a time, so a merge-reconcile is a
single-row edit that cannot corrupt another task's row. The control-folder clear truncates or unlinks
the transient feeds; a clear that races a concurrent write is not possible because only one
coordinator process owns a slug at a time (the run is single-coordinator by design).

---

## 4. Testing

- **Pure classifier** (`resume.test.mjs`) — every row of the 2.3 table, plus mutation coverage: the
  old behaviour (treat every `⬜` as a fresh implement) must redden a merge/review/rebuild test.
- **Task-branch state read** (`worktree.test.mjs`, `fake/worktree.test.mjs`) — against real scratch
  git: a branch at `⬜`/`🟡`/`🔍`/`✅` reads back the right glyph; an absent branch reads null; an
  absent file reads null.
- **Reconciliation in the loop** (`loop.test.mjs`) — against `createFakeWorktree` (real git) with the
  fake platform committing real rows: a `✅` branch is merged not rebuilt; a `🔍` branch gets a fresh
  reviewer not a re-implement; a half-built branch is rebuilt clean; a leftover `✅`-on-feature branch
  is cleaned up; the ceiling is held across reconciliation plus dispatch; a `✅`-merge conflict is
  surfaced not rebuilt.
- **Control-folder cleanup** (`coordinate.test.mjs`) — stale `reports/`/`answers`/`outbox`/`surfaced`
  are cleared; `log` is preserved and gains a `restart` marker; `HALT` present at startup refuses to
  start and is not cleared.
- **Live restart drill** (`you`, T07) — the only thing none of the above can prove: that a real
  crashed run, restarted, actually resumes over real agents instead of rebuilding from T01.

---

## 5. Environment — read this before running anything

Inherited from the parent project (`plans/parallel-pir/DESIGN.md §5`); unchanged by this plan.

| | |
|---|---|
| OS | macOS (Darwin 25.5.0), aarch64 |
| Language / runtime | Node v24.2.0 (built-in test runner), npm 11.4.2 |
| Toolchain | git 2.50.1 (worktree), `claude` 2.1.263 (cross-session messaging) |
| **Deliberately absent** | No runtime dependencies; Node standard library plus `git` and `claude` only. |

**The test command.**

```
npm test
```

which runs `FORCE_COLOR=0 NO_COLOR=1 node --test --test-reporter=dot` over `src/**/*.test.mjs`. It is
the only evidence a session may produce on its own. It is quiet on pass (one summary line per suite),
loud on failure (name, file, line, diff), and its exit code carries the result. Full detail for
debugging: `node --test --test-reporter=spec src/**/*.test.mjs`. The boundary scan is part of the
suite (`src/core/boundary.test.mjs`).

**Dependencies.** No runtime dependencies are added by this plan; the fix is Node standard library,
`git` and `claude` only, matching the parent design.

### 5.1 What the test command cannot reach

| Cannot be tested automatically | Why it needs a person |
|---|---|
| A real crashed run, restarted, resumes over real agents instead of rebuilding from T01 | Spawns live paid agents, crashes and relaunches a real coordinator, mutates real git |

Everything else — the classifier, the branch read, the reconciliation execution against real scratch
git, and the control-folder cleanup — is provable in `npm test`.

### 5.2 Seatbelts

Inherited from `plans/parallel-pir/DESIGN.md §5.2`; the live drill (T07) adds nothing new.

| Flag / mechanism | Default | Effect |
|---|---|---|
| Scratch plan + scratch repo | the harness installs one per run | The restart drill's crash, relaunch and merges hit a throwaway repo, never the real project or `main` |
| Worker ceiling (low, per scenario) | always on | Bounds how many real agents the drill can spawn |
| Harness per-scenario wall-clock timeout | on for every live-harness run | Auto-touches `HALT` so a hung real worker cannot run or cost unboundedly |
| `PARALLEL_ALLOW_HERE` / `--into <dir>` | required to run live | The runner refuses to run inside the canonical repo without an explicit scratch target |

Never run the unbounded live drill to find something out, and never run the crash-and-restart by hand
against the real project: the drill is a scratch repo at a low ceiling with the kill switch armed.

---

## 6. Recovery

This plan makes restart itself the recovery path, so the recovery notes are the behaviour: a crashed
run is recovered by restarting the coordinator on the same slug, which reconciles from git (§2). The
manual escape hatches from the parent design still hold — a leaked worktree or branch is removed with
`git worktree remove --force` and `git branch -D`; a confused coordinator is stopped with the `HALT`
flag; `main` is untouched until promotion, so an interrupted run leaves `main` as it was. If
reconciliation itself misbehaves, the task branches are all on disk and inspectable with
`git show pir/{slug}-T{nn}:plans/{slug}/PROGRESS.md`, the exact read reconciliation makes.

---

## 7. Decisions and rationale

- **Reconcile from the task branch, not the feature-branch `PROGRESS.md`.** The feature branch lags
  by design (it only advances at merge), so trusting it discards in-flight work. Git is the one record
  a crash cannot falsify. Decided in the brief (2026-09-17).
- **Half-built branch → rebuild clean, do not salvage.** A re-implement from the task doc is correct
  by construction; adopting a possibly-half-finished branch risks landing it as done. The signal that
  a build is complete is the `🔍` glyph committed atomically with the code, so anything short of `🔍`
  (or `✅`) is treated as not built. User decision (2026-09-17).
- **Reconciliation runs at every startup, not behind a restart flag.** A flag is a second source of
  truth that can disagree with git; the presence of task branches is the only signal, and a first
  start has none, so reconciliation is a no-op there. Engineering decision.
- **Reconciliation performs merges directly and seeds a live session for reviews.** The loop's
  assignment machinery treats a sessionless tracked task as dead and removes its branch, which would
  discard the adopted work; so a `✅` merge is done without a session and a `🔍` review is given a real
  fresh session. Engineering decision, forced by `buildAssignments` (§2.5).
- **Clear the transient control feeds on startup; preserve the log and `HALT`.** The feeds are live-run
  conversation buffers whose leftovers misroute a fresh run; the log is an audit trail and the harness
  signal; `HALT` is a deliberate stop whose auto-clear would defeat the kill switch. Brief asked the
  HALT policy be decided; it resolves to never-auto-clear, plus a refuse-to-start-with-a-message
  refinement over the current silent self-halt (§2.7). Engineering decision within the brief's bounds.
- **The live restart drill is a `you` task built on an `auto` harness extension.** The runner today
  reinstalls the fixture on each launch, so a restart needs a launch→kill→relaunch-on-the-same-scratch
  mode; that mechanism is testable against the fakes, but the live paid crash-and-resume is judged by a
  person, matching every other live-harness run. Engineering decision.

---

## 8. Explicitly out of scope

- **No change to how a task is built or reviewed.** Reconciliation adopts existing task-branch work;
  it does not touch `pir-implement`/`pir-review`/`pir-verify` behaviour. Reason: the `🔍`/`✅` contract
  those skills already follow is what makes the branch glyph a trustworthy signal, so it is depended on,
  not modified.
- **No pause/resume of the kill switch.** `HALT` stays hard-stop only, per the parent design; this plan
  only makes its presence at restart explicit rather than silent. Reason: pause/resume was offered and
  declined in the parent plan, and restart-from-git is the clean resume.
- **No per-pass reading of task-branch state.** Reconciliation reads git once at startup, not every
  pass. Reason: the steady-state loop learns task state from worker reports, which is cheaper and
  already correct; only a restart needs to reconstruct it, and the in-flight bound keeps a one-shot pass
  sufficient (§2.5).
- **No change to the sealed `plans/parallel-pir/DESIGN.md`.** Its banner redirects to `/docs`; the
  corrected behaviour is written to `docs/restart-recovery.md` and `docs/control-folder.md` (T05), not
  back into the finished plan.
</content>
</invoke>
