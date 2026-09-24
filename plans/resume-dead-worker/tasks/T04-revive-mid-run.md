# T04 — revive-mid-run

**Phase:** 2 · **Depends on:** T02, T03 · **Weight:** medium

## Goal

On a task's first death, revive the dead worker's own conversation in its worktree, once; fall back
to T03's path in the same pass if the revive fails.

## Design sections this implements

DESIGN §2.2 (1st row), §2.3, §2.8.

## Files

- `src/shell/loop.mjs`, `src/shell/loop.test.mjs`

## Interface

```js
// step 3a, for a task decideResume puts in `revive`:
const r = platform.revive({ id, sessionId, cwd: t.worktree.path, plan: slug });
// ok   → keep state.tasks[num] (same role, phase), grace = APPEAR_GRACE, deaths[num].revived = true,
//        id NOT added to closedIds; record('revive', { task, workerId: id })
// !ok  → deaths[num].revived = true; record('revive-failed', { task, reason });
//        adoptTask with decideResume's fallback for the same death, this pass
```

## Tests

- [ ] First death with a session id → exactly one `revive` call, with the task worktree as cwd; the worker is matched again next pass by name and is not declared dead.
- [ ] The revived id is not in `closedIds` after the pass.
- [ ] Second death of the same task → no revive; fallback per §2.4.
- [ ] Revive `failed` or `copy` → fallback spawn in the same pass; never two live sessions for the task.
- [ ] A task parked AWAITING that dies is revived with its phase and decision kept.
- [ ] `HALT` → no revive.

## Done when

- [ ] Every test above passes in `npm test`.
- [ ] A crash-heavy fake run never lists two sessions for one task.
