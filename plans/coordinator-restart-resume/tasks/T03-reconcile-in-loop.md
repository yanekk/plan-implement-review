# T03 — Reconciliation pass in `runPass`

**Phase:** 2 · **Runs:** auto · **Depends on:** T01, T02 · **Weight:** heavy

## Goal

Wire the classifier (T01) and the branch read (T02) into the coordinator loop so that a restart
reconciles from git before it dispatches anything. On the first pass, after the feature branch is
opened, the loop reads each task branch's committed glyph, asks `decideResume` what to do, and
executes it: merge a built-and-reviewed branch, hand a built-but-unreviewed branch to a fresh
reviewer, and discard a half-built branch so it rebuilds clean. This is the task that turns the fix
from a decision into behaviour, and the one place the delicate live-worker accounting must not be
disturbed.

## Design sections this implements

DESIGN §2.1 (resume principle), §2.4 (where reconciliation runs), §2.5 (executing each case and the
ceiling invariant), §2.6 (the unhappy paths).

## Files

- `src/shell/loop.mjs` — add the first-pass reconciliation step (reap → adopt → narrate) to `runPass`;
  a small helper is fine.
- `src/shell/loop.test.mjs` — the reconciliation tests, against `createFakeWorktree` (real git) and
  the fake platform.
- `src/shell/coordinate.mjs` — print the reconciliation's plain-English restart summary in the bin so
  the skill relays it (DESIGN §2.8). ONLY the restart-summary print here; T04 owns the control-folder
  clear, the HALT refusal and the restart marker in this same file.

Do not touch the docs (T05).

## Interface

Reconciliation is internal to `runPass`; no new exported signature is required. It runs once per run,
gated on a fresh-state flag, after `openFeature` and before the gather/`decideDispatch` steps:

```
runPass(...):
  0.  openFeature (existing)
  0.5 if (!state.reconciled) {           // pass 0, folded into the first pass (DESIGN §2.4)
        reap the dead run's leftover sessions FIRST (DESIGN §2.5):
          for each platform.list() worker isWorkerOf(slug):
            platform.close(id); platform.remove?.(id); state.closedIds.add(id)
          // session-only — NEVER worktree.remove here; the branches are what we adopt below
        featureTasks = parseProgress(feature PROGRESS.md).tasks
        branchStates = { for each task: worktree.taskBranchState(slug, num) }
        { merge, review, rebuild } = decideResume({ featureTasks, branchStates })
        execute merge / review / rebuild (below)
        cleanup leftover branches for feature-✅ tasks (DESIGN §2.6)
        compose a plain-English summary of what was adopted and record it (DESIGN §2.8)
        state.reconciled = true
      }
  1.  gather (existing) …  2. decide …  3. execute …
```

Execution, mirroring the loop's own steps (DESIGN §2.5):

- **merge**: `worktree.mergeTask(taskBranch)`; on `ok`, `reconcileTaskRow(feature PROGRESS, { num,
  state:'✅', notes:'' })`, write it, `worktree.commitFeature('reconcile {num} → ✅')`, then
  `worktree.remove(handle)` (worktree + branch). On `{ conflict }`, `record('surface', { task: num,
  kind:'conflict', text })` and leave the branch untouched — do not rebuild. Apply merges in task
  order.
- **review**: get the existing task worktree handle (`worktree.taskWorktreeHandle` /
  `createTask` reuse), `platform.spawn({ cwd: handle.path, name: workerName(role:'review'),
  phase:'review' })`, seed `state.tasks[num] = { worktree: handle, workerId: reviewerId,
  role:'review', phase: 'reviewing', grace: APPEAR_GRACE }`, `record('review', { task: num,
  adopted:true })`. Cap total review spawns at `maxWorkers`; if somehow exceeded, `record('surface',
  { kind:'over-ceiling', … })` (DESIGN §2.5 says the in-flight bound makes this unreachable — the cap
  fails loud rather than over-spawning).
- **rebuild**: `worktree.remove(handle)` (worktree + branch). The feature row stays `⬜`; the same
  pass's normal spawn step re-dispatches a fresh implementer, and `createTask` re-cuts a clean branch.
- **cleanup**: for a task whose feature row is `✅` but a task branch still exists, `worktree.remove`
  the leftover branch/worktree (DESIGN §2.6).

Non-obvious constraints, each with its reason:

- **Never seed a sessionless tracked task for the loop to merge/close.** `buildAssignments` marks a
  tracked task with no live session as dead and removes its branch, discarding the adopted work
  (DESIGN §2.5). So merges are done directly in step 0.5 (no session), and a review seeds a task that
  has a real, freshly spawned reviewer session with appear-grace, exactly like the loop's own review
  hand-off.
- **Re-read the feature `PROGRESS.md` after the merges** before the normal gather, so a row just
  reconciled to `✅` is seen as `✅` this pass and not re-dispatched.
- **The ceiling spans reconciliation and dispatch.** Seeded reviewers count as live via their
  appear-grace assignment, so `decideDispatch`'s slot maths already subtracts them and cannot
  over-spawn implementers for rebuilt/never-started tasks.
- **Reap leftover sessions session-only, before adopting.** The dead run's worker sessions may still be
  alive (a real crash skips the SIGTERM teardown — DESIGN §2.5). Stop every listed worker of this slug
  first, with `platform.close`/`platform.remove` only — **never** `worktree.remove` here, or the
  branches reconciliation is about to adopt are destroyed. Add the reaped ids to `state.closedIds` so a
  lingering listing is not recounted against the ceiling.
- **Narrate the restart (DESIGN §2.8).** Compose one plain-English line naming what was merged, sent to
  review, rebuilt and started, and record/surface it so the bin (this task's `coordinate.mjs` print)
  relays it to the user. A first start adopts nothing, so the line is empty/absent.
- **First-start is a no-op.** With no task branches and no leftover sessions, the reap does nothing,
  `branchStates` is all null, `decideResume` returns empty lists, the summary is empty, and step 0.5
  does nothing but set the flag — so every existing loop test that starts from an empty scratch repo is
  unaffected.

## Tests

- [ ] restart with a task branch at `✅`, feature row `⬜`: the branch is merged, the feature row
      becomes `✅`, the task worktree/branch is removed, and no implementer is spawned for it.
- [ ] restart with a task branch at `🔍`, feature row `⬜`: a fresh reviewer is spawned on that
      worktree, the task is tracked as reviewing, and no implementer is spawned for it.
- [ ] restart with a half-built branch (`⬜`/`🟡`): the branch/worktree is removed and a fresh
      implementer is dispatched (a clean branch is re-cut).
- [ ] restart with a `✅` branch whose merge conflicts: a conflict is surfaced and the branch is left
      untouched, not rebuilt.
- [ ] a leftover branch for a feature-`✅` task is cleaned up (removed) on restart.
- [ ] a `you` task branch at `✅` is merged (folds to `✅`, no review spawned).
- [ ] mixed restart: T01 `✅`-merge, T02 `🔍`-review, T03 half-built rebuild, T04 never-started
      implement — all handled in one first pass, and the ceiling is not exceeded across reconciliation
      plus dispatch.
- [ ] restart with a leftover worker session of this slug still listed: it is stopped session-only on
      the first pass — its task branch/worktree is NOT removed — and it is not counted against the
      ceiling on the next pass. (A `✅`/`🔍` branch whose session is reaped is still merged/reviewed.)
- [ ] the reconciliation pass records a plain-English summary naming what it merged/reviewed/rebuilt/
      implemented; a first start (no task branches) records no summary (or an empty one).
- [ ] first start (no task branches): reconciliation is a no-op; behaviour is identical to today
      (an existing happy-path loop test still passes unchanged).
- [ ] the mutation guard: reverting to "dispatch every `⬜` feature row as a fresh implement" reddens
      the merge and review tests here, proving the old behaviour is caught end-to-end.

## Done when

- [ ] a restart merges `✅` branches, reviews `🔍` branches, and rebuilds half-built ones, all proven
      against real scratch git in `loop.test.mjs`.
- [ ] no adopted branch is ever discarded by the dead-worker path (the `buildAssignments` hazard is
      covered by a test).
- [ ] leftover worker sessions of the slug are reaped session-only on restart (branches kept), so the
      ceiling starts clean; the restart records a plain-English summary of what it adopted.
- [ ] first-start behaviour is unchanged and all pre-existing loop tests still pass; `npm test` and the
      boundary scan are green.
</content>
