# T03 — dead-worker-keeps-branch

**Phase:** 2 · **Depends on:** T00, T01, T02 · **Weight:** heavy

## Goal

Rewrite the loop's dead-worker step so a death never deletes work: count it, keep the branch and the
session record, and hand the task to the same merge/review/resume execution restart uses, or give it
up at the cap. No revive yet (T04); here the `revive` list is treated as `resume`/`review` by its
fallback so this task stands alone.

## Design sections this implements

DESIGN §2.1, §2.2 (2nd and 3rd rows), §2.4, §2.5, §2.8, §3.4.

## Files

- `src/shell/loop.mjs`, `src/shell/loop.test.mjs`

## Interface

```js
createRunState() → { feature, tasks, closedIds, reconciled, deaths: {}, givenUp: new Set() }

// Lifted out of reconcile, used by both reconcile and step 3a. Same behaviour reconcile has today.
adoptTask({ num, action: 'merge'|'review'|'resume', platform, worktree, repo, slug, state,
            featureProgressPath, slugByNum, record }) → void

// flow actions recorded by 3a
record('worker-died', { task, workerId, count, action })     // action: what adoptTask did
record('give-up', { task, count })
```

Death rule in `buildAssignments`: absent, or listed without `pid`, past `APPEAR_GRACE`, adjusted to
T00's finding. 3a: `platform.close` only (no `platform.remove`, no `worktree.remove`), bump
`state.deaths[num].count`, read `taskBranchState`, call `decideResume` for that one task with its
death entry, execute via `adoptTask`, pass `state.givenUp` to `decideDispatch`. `state.tasks[num].sessionId`
is refreshed from the list in `buildAssignments`.

## Tests

- [ ] Fake `crashAfterCommit`: the branch and its commit survive the death, and the respawned implementer is spawned into the same worktree.
- [ ] Dead implementer on a 🔍 branch → a fresh reviewer, not an implementer; dead worker on a ✅ branch → merged, row ✅.
- [ ] Three deaths of one task → `give-up`, never spawned again this run, dependants never spawned, run ends as a stall; other tasks finish.
- [ ] A listed-without-pid worker past grace is dead; within grace it is not.
- [ ] The dead worker's record is never `remove`d on the death path; merge path still removes.
- [ ] `HALT` pass: no death handling runs.
- [ ] Reconcile tests still pass unchanged through `adoptTask`.
- [ ] Never more live workers than the ceiling across a crash-heavy fake run.

## Done when

- [ ] No code path in step 3a calls `worktree.remove`; every test above passes in `npm test`.
- [ ] `reconcile` and 3a both execute through `adoptTask`.
