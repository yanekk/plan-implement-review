# T03 — dead-worker-keeps-branch

**Phase:** 2 · **Depends on:** T01, T02 · **Weight:** heavy

## Goal

Rewrite the loop's dead-worker step so a death never deletes work: count it, keep the branch, and hand
the task to the same merge/review/resume execution restart uses, or give it up at the cap. No revive
yet (T04); here the `revive` list is treated as `resume`/`review` by its fallback so this task stands
alone.

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

The death rule is unchanged: `buildAssignments` already marks a tracked task whose worker is not in
`platform.list()` as dead (live-workers T05). 3a: `platform.close` only (a no-op on an exited child,
kept for any other platform) and no `worktree.remove`; bump `state.deaths[num].count`; read
`taskBranchState`; call `decideResume` for that one task with its death entry; execute via `adoptTask`;
pass `state.givenUp` to `decideDispatch`.

Today `decideDispatch` runs before 3a, so its `spawn` list already holds the dead task (not live, row
⬜) and may have handed the dead worker's slot to another ready task. The dead path must not let 3b
spawn a second worker for a task it adopted as `review` or `merge` or gave up, and its own reviewer
spawn must stay under the ceiling. A `resume` still reaches the fresh implementer through 3b's
`createTask` on the kept branch, as reconcile's does. Handling deaths before `decideDispatch`, as
reconcile does, is one way; the tests below are the contract.

The existing loop.test.mjs cases driven by the fake's `{ crash: true }` (e.g. "a crashed worker is
closed as dead and its worktree reclaimed, freeing its slot") assert the old removal. They are the one
set of existing expectations this task changes: rewrite them to the kept branch. `crash: true` crashes
every spawn of the task, so it is also the fixture for the give-up test.

## Tests

- [ ] Fake `crashAfterCommit`: the branch and its commit survive the death, and the respawned implementer is spawned into the same worktree.
- [ ] Dead implementer on a 🔍 branch → a fresh reviewer, not an implementer; dead worker on a ✅ branch → merged, row ✅.
- [ ] Three deaths of one task → `give-up`, never spawned again this run, dependants never spawned, run ends as a stall; other tasks finish.
- [ ] A worker the loop closed itself (`closedIds`) is never counted as a death.
- [ ] `HALT` pass: no death handling runs.
- [ ] Reconcile tests still pass unchanged through `adoptTask`.
- [ ] Never more live workers than the ceiling across a crash-heavy fake run.
- [ ] A death adopted as `review`, `merge` or `give-up` is not also spawned as an implementer that pass.
- [ ] Ceiling 2, one live worker, a dead task and another ready task: at most 2 live after the pass.

## Done when

- [ ] No code path in step 3a calls `worktree.remove`; every test above passes in `npm test`.
- [ ] `reconcile` and 3a both execute through `adoptTask`.
