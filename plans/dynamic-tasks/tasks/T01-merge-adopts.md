# T01 — merge-adopts

**Phase:** A · **Depends on:** T00 · **Weight:** light

## Goal

Make the merge step adopt new task rows. Today `mergeTask` protects `PROGRESS.md` by restoring the
feature's copy verbatim, discarding whatever the task branch did to it. This task replaces that
verbatim restore with `adoptNewTaskRows`, so a merging branch's new task rows land on the feature
branch while every existing row and single-line field still keeps the feature's version. Because
both the live merge and the restart-reconcile merge call `mergeTask`, this one change serves both.

## Design sections this implements

DESIGN §2.2, §3.1, §3.2 (the merge module), §2.5 (restart uses the same path).

## Files

- `src/shell/worktree.mjs` — `mergeTask`: read the merging branch's committed `PROGRESS.md`
  (`git show {taskBranch}:{progressRel}`), call `adoptNewTaskRows(savedFeature, branchText)`, write
  the returned `text`, and return `{ ok, added, errors }`.
- `src/shell/fake/worktree.mjs` — the same change; the fake is a real scratch repo and must match.
- `src/shell/worktree.test.mjs` and any fake-worktree test — the cases below.

## Interface

```
mergeTask(taskBranch, opts?) → { ok: true, added: string[], errors: string[] }
                             | { conflict: true, files: string[] }        // unchanged

  added   task numbers adopted from this branch (from adoptNewTaskRows)
  errors  rejected-row messages (from adoptNewTaskRows); the merge still lands the code
```

Behaviour:

- Read `branchText` from the branch's committed `PROGRESS.md`, not the post-merge working tree, so
  it is clean and works even on a `PROGRESS.md`-only conflict.
- Where the code previously did `writeFileSync(progressPath, savedFeature)`, instead compute
  `adoptNewTaskRows(savedFeature, branchText)` and write its `text`; return its `added`/`errors`.
- A code conflict outside `PROGRESS.md` still aborts and returns `{ conflict, files }` unchanged —
  adoption only happens on a merge that otherwise lands.
- Do not surface errors here (that is the loop's job, T02); just return them.

## Tests

- [ ] Merge a branch that added T03 → the feature branch's `PROGRESS.md` gains T03 as `⬜`; `added`
      is `['T03']`.
- [ ] The feature's single-line fields (Status, Next pir-work will, Review queue) are unchanged
      after the merge.
- [ ] Merge a branch that made no plan change → feature `PROGRESS.md` unchanged; `added` empty (the
      existing protection still holds — this is the regression guard for current behaviour).
- [ ] Merge a branch with a forbidden edit (changed an existing row's deps) → the code merges,
      `errors` is non-empty, and the feature's `PROGRESS.md` is unchanged.
- [ ] A non-`PROGRESS.md` code conflict still returns `{ conflict, files }` and leaves the feature
      branch clean.
- [ ] The real `worktree.mjs` and the fake produce the same outcome on the same scratch inputs.

## Done when

- [ ] `mergeTask` returns `{ ok, added, errors }` and adopts via `adoptNewTaskRows` in both the real
      and fake worktree modules.
- [ ] All existing `mergeTask`/merge tests still pass (the no-change case is unchanged behaviour).
- [ ] `npm test` is green.
