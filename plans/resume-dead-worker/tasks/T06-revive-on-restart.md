# T06 — revive-on-restart

**Phase:** 3 · **Depends on:** T04 · **Weight:** medium

## Goal

Apply the revive-once rule on restart: find each unfinished task's previous worker in its conversation
log and revive it before falling back to a fresh one.

## Design sections this implements

DESIGN §2.7, and §2.3 for the revive itself.

## Files

- `src/shell/loop.mjs` (reconcile), `src/shell/loop.test.mjs`
- `src/shell/coordinate.mjs` (pass the reap's unverified pids to the loop), `src/shell/coordinate.test.mjs`

## Interface

```js
// startupControlHygiene already reaps workers.json before the first pass. Its result gains the ids of
// recorded workers it skipped as unverifiable (alive, no startTime); the bin hands them to the loop.
runPass({ ..., unverifiedIds = new Set() })

// reconcile, before decideResume: for each task with a kept branch, the role the glyph needs (§2.4)
const last = lastConversation(controlDir, num, role);      // T02
deaths[num] = { count: 0, role, sessionId: last && !unverifiedIds.has(last.id) ? last.id : null, revived: false }
// decideResume → revive list → platform.reviveSession({ id, cwd: handle.path, name, task, role, logPath })
// ok   → seed state.tasks[num] { worktree, workerId: id, role, slug, phase, revived: true }
// !ok  → the fallback as T04, same pass
// restart-summary gains `woke ${list} where they left off`
```

## Tests

- [ ] Restart with a half-built branch and a matching conversation log → one revive in the worktree under the logged id, no fresh spawn.
- [ ] Same with no log, a log with no `init`, an unverified id, or a failed revive → a fresh implementer, as today.
- [ ] 🔍 branch with a reviewer's log → reviewer revived; with only an implementer's log → fresh reviewer.
- [ ] A restart-revived worker that exits before init falls back without a counted death (T04 rule).
- [ ] The restart-summary names the woken tasks; a first start prints no summary.
- [ ] Existing restart tests pass.

## Done when

- [ ] Every test above passes in `npm test`.
- [ ] A restart never has two live workers for one task.
