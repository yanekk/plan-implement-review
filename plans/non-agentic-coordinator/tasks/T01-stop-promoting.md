# T01 — Stop promoting; hand off the green feature branch

**Phase:** 1 · **Runs:** auto · **Depends on:** — · **Weight:** medium

## Goal

Make the run stop at a green feature branch instead of merging to `main`. The single irreversible
act in the system — merging the finished plan to `main` — becomes the person's, done by hand with
`git merge`. When every task is done, the command runs the tests on the feature branch and, if
green, prints the branch name and the merge command and exits; if red, it prints the failure and
does not offer a merge. This removes the automatic promotion entirely.

## Design sections this implements

DESIGN §2.4 (no promotion; hand off the branch) and §2.8 (a red feature branch at the end).

## Files

- `src/core/dispatch.mjs` (+ `dispatch.test.mjs`) — replace `promoteToMain` with a `complete` flag.
- `src/shell/loop.mjs` (+ `loop.test.mjs`) — remove the promote step; on `complete`, run the tests
  and carry a ready-to-merge (or red) result out of the pass.
- `src/shell/coordinate.mjs` (+ `coordinate.test.mjs`) — `main()` prints the hand-off; reword the
  `canPromoteHere` guard from promotion-safety to branch-safety (it still refuses a live run in the
  canonical repo without `PARALLEL_ALLOW_HERE=1`, because a live run opens and writes the feature
  branch here).
- `src/shell/worktree.mjs` (+ `worktree.test.mjs`) — remove `promote()` and its test; nothing calls
  it once the loop no longer promotes.

## Interface

```
decideDispatch(...) → { spawn, review, merge, close, complete }
  // complete === (tasks.length > 0 && every task ✅ && no live worker). No promoteToMain.

runPass(...) → { ..., complete, testsPassed?, readyToMerge? }
  // when decision.complete: run runTests(featurePath).
  //   green → readyToMerge = { branch: 'pir/{slug}' }, testsPassed = true
  //   red   → testsPassed = false, readyToMerge = null (a red-feature result the shell prints)
  // never calls worktree.promote; never touches main.

// coordinate.mjs main(): on readyToMerge, print e.g.
//   "✔ all N tasks green on pir/{slug} · tests pass. Yours to merge:  git merge pir/{slug}"
//   on red: print the failure and the branch; no merge line. Then exit.
```

## Tests

- [ ] `decideDispatch` `complete` is true only when there is at least one task, all are `✅`, and no
      worker is live; false if any task is not `✅` or any worker is live.
- [ ] A halted decision never reports `complete`.
- [ ] `runPass` on `complete` + green tests carries `readyToMerge={branch}` and `testsPassed=true`,
      and calls `worktree.promote` never (assert it is absent / not called).
- [ ] `runPass` on `complete` + red tests carries `testsPassed=false` and no `readyToMerge`.
- [ ] `main()` prints the `git merge pir/{slug}` hand-off on green and prints the failure with no
      merge line on red (assert on captured output).
- [ ] `canPromoteHere` still refuses a live run in the canonical repo without `PARALLEL_ALLOW_HERE=1`.

## Done when

- [ ] No code path merges the feature branch into `main` (`worktree.promote` is gone; grep for it).
- [ ] A finished green run prints the branch and `git merge` and exits; a finished red run prints the
      failure and no merge line.
- [ ] `npm test` is green.
