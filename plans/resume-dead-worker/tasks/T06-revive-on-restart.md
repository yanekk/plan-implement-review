# T06 — revive-on-restart

**Phase:** 3 · **Depends on:** T04 · **Weight:** medium

> The working tree had uncommitted edits to `src/shell/coordinate.mjs` (pass-cap removal) at plan
> time. They must be committed or dropped by their owner before the run starts (PLAN.md).

## Goal

Apply the revive-once rule on restart: find each unfinished task's previous worker by name and revive
it before falling back to a fresh one, and stop destroying the records that makes possible.

## Design sections this implements

DESIGN §2.7, and §2.3 for the revive itself.

## Files

- `src/shell/loop.mjs` (reconcile), `src/shell/loop.test.mjs`
- `src/shell/coordinate.mjs` (`teardownRun`), `src/shell/coordinate.test.mjs`

## Interface

```js
// reconcile: after the reap, before decideResume
const past = platform.history();          // newest per (task, role) whose name parses to this plan
deaths[num] = { count: 0, role, sessionId, revived: false }   // only for tasks with a kept branch
// decideResume → revive list → platform.revive; fallback as T04
// ok → state.closedIds.delete(id) (the reap just added it; DESIGN §2.3), seed state.tasks[num]
//      { worktree, workerId: id, role, slug, phase, grace: APPEAR_GRACE } so dispatch sees it held
// restart-summary gains `woke ${list} where they left off`
```

Per T00: if `-n` plus cwd restores a removed session under its own id, `teardownRun` and the reap keep
calling `platform.remove` and the restart revive passes the name; otherwise both skip `remove` for
workers of unfinished tasks and the finish paths still remove.

## Tests

- [ ] Restart with a half-built branch and a matching past session → one revive in the worktree, no fresh spawn.
- [ ] A worker the reap closed and the revive woke is not in `closedIds` and is not declared dead next pass.
- [ ] Same with no past session, or revive fails → a fresh implementer, as today.
- [ ] 🔍 branch with a past reviewer → reviewer revived; with only a past implementer → fresh reviewer.
- [ ] The restart-summary names the woken tasks; a first start prints no summary.
- [ ] Teardown keeps or removes records per the T00 answer; a merged task's record is still removed.
- [ ] Existing restart tests pass.

## Done when

- [ ] Every test above passes in `npm test`.
- [ ] A restart never has two live sessions for one task.
