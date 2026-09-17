# T02 — Read a task branch's committed state

**Phase:** 1 · **Runs:** auto · **Depends on:** — · **Weight:** medium

## Goal

Give the coordinator the one capability it does not have today: reading how far a task got directly
from its own task branch, without checking the branch out. The reconciliation in T03 needs, for each
task, the committed glyph in `pir/{slug}-T{nn}:plans/{slug}/PROGRESS.md`. This task adds that read to
both the real worktree module and the fake, so T03 and its tests can ask git the same question the
same way. No production code reads task-branch state by ref today (confirmed at plan time); this is
the new primitive.

## Design sections this implements

DESIGN §2.2 (the task-branch state signal), §3.2 (modules).

## Files

- `src/shell/worktree.mjs` — add `taskBranchState` and a handle accessor for an existing task
  worktree; wire both into the `createWorktree` factory.
- `src/shell/worktree.test.mjs` — tests against a real scratch repo.
- `src/shell/fake/worktree.mjs` — the matching methods on the fake (it already has a
  `progressOn(ref)` git-show helper to build on).
- `src/shell/fake/worktree.test.mjs` — tests for the fake's version.

## Interface

```
// module-level, stateless, deriving paths from git — matches the existing worktree.mjs style
taskBranchState(plan, task, { root }) → '⬜'|'🟡'|'🔍'|'✅'|'⛔'|null
  Reads pir/{plan}-{task} : plans/{plan}/PROGRESS.md via `git show`, parses it with parseProgress,
  and returns the State glyph of the row whose # is `task`. Returns null when the branch does not
  exist, the file is absent on it, or there is no such row. Never throws on a missing ref/file —
  a missing branch is a normal answer (null), not an error.

taskWorktreeHandle(plan, task, { root }) → { path, branch } | null
  The registered worktree path and branch name for pir/{plan}-{task}, or null if none is checked
  out. Lets T03 hand an existing task worktree to remove()/spawn without re-deriving it.

// bound onto createWorktree({ root }):
worktree.taskBranchState(plan, task)
worktree.taskWorktreeHandle(plan, task)
```

Non-obvious points, each with its reason:

- **Read by ref, do not check out.** `git show pir/{plan}-{task}:{progressPath}` reads the committed
  file without touching any worktree, so reconciliation stays cheap and never disturbs a worktree that
  may still be needed for review.
- **`progressPathFor(plan)`** gives the path; the plan is the feature branch's slug. Reuse it so the
  location stays in one place (it already is, in `progress.mjs`).
- **Parse, do not grep.** Use `parseProgress` to find the row and read its glyph, so a reformatted or
  reordered table still reads correctly — the same parser the rest of the system trusts.
- **Null, not throw, on absence.** A restart routinely asks about tasks whose branch never existed;
  that is a `null` answer the classifier expects, not an exception.

## Tests

- [ ] a scratch repo with a task branch whose row is `🔍` → `taskBranchState` returns `🔍`.
- [ ] the same for `✅`, `🟡`, `⬜`.
- [ ] a task branch that exists but has no `PROGRESS.md` on it → null.
- [ ] a task number with no branch at all → null (no throw).
- [ ] a branch whose table has no row for that task number → null.
- [ ] `taskWorktreeHandle` returns `{ path, branch }` for a checked-out task worktree and null when
      none is registered.
- [ ] the fake `worktree.taskBranchState` returns the same glyphs for branches the fake platform's
      workers committed (`🔍` from implement, `✅` from review/verify), so T03's loop tests can rely on
      it.
- [ ] reading a glyph does not modify the branch or any worktree (a follow-up `git status`/`git show`
      is unchanged).

## Done when

- [ ] `taskBranchState` and `taskWorktreeHandle` exist on both the real and fake worktree, return the
      committed glyph (or null) as specified, and never throw on a missing ref or file.
- [ ] both are reachable through `createWorktree(...)` / `createFakeWorktree(...)` so T03 injects them
      like every other worktree method.
- [ ] `npm test` is green, including the new real-git and fake tests.
</content>
