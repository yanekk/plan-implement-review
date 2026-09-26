# T04 — revive-mid-run

**Phase:** 2 · **Depends on:** T02, T03 · **Weight:** medium

## Goal

On a task's first death, revive the dead worker's own conversation in its worktree, once; fall back to
T03's path if the revive fails.

## Design sections this implements

DESIGN §2.2 (1st row), §2.3, §2.8.

## Files

- `src/shell/loop.mjs`, `src/shell/loop.test.mjs`

## Interface

```js
// step 3a, for a task decideResume puts in `revive`:
const r = platform.revive(workerId);
// ok   → keep state.tasks[num] (same workerId, role, phase, decision), deaths[num].revived = true,
//        state.tasks[num].revived = true; id NOT added to closedIds; record('revive', { task, workerId })
// !ok  → deaths[num].revived = true; record('revive-failed', { task, reason });
//        adoptTask with decideResume's fallback for the same death, this pass
//
// next passes: a task with t.revived whose worker is found dead with platform.exitOf(id).beforeInit → a failed revive:
// record('revive-failed', { task, reason: 'exited-before-start' }), fallback via adoptTask, and
// deaths[num].count is NOT bumped (DESIGN §2.8). Once its log shows init, a later exit is a normal death.
```

A revived task holds its slot and is never also in this pass's 3b spawn (see T03 on `decideDispatch`
running before 3a).

## Tests

- [ ] First death → exactly one `platform.revive` with the dead worker's id; the worker is matched again next pass under the same id and is not declared dead.
- [ ] The revived id is not in `closedIds` after the pass.
- [ ] Second death of the same task → no revive; fallback per §2.4.
- [ ] `revive` returns `failed` → fallback spawn in the same pass; never two live workers for the task.
- [ ] A revived worker that exits before init → fallback, death count unchanged; one that exits after init → count 2.
- [ ] A successful revive is not also spawned fresh by 3b in the same pass, and the ceiling holds.
- [ ] A task parked AWAITING that dies is revived with its phase and decision kept.
- [ ] `HALT` → no revive.

## Done when

- [ ] Every test above passes in `npm test`.
- [ ] A crash-heavy fake run never lists two workers for one task.
