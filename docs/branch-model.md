# The branch and worktree model

The whole plan runs on a single **feature branch**, `pir/{plan}`, cut from `main` when the
coordinator starts. Workers cut **task branches**, `pir/{plan}-T{nn}`, from the feature branch, and
their finished work merges back into it. `main` receives the plan exactly once, at the end, when
the feature branch is promoted. All of this is in `src/shell/worktree.mjs`.

```
main ──●───────────────────────────────────────────────────●  (one merge, at the end)
        \                                                  /
         ● pir/{plan}  (feature branch) ──●────●────●─────●   task branches merge in, serialized
            \            \            \
             ● T01        ● T02        ● T05     (task branches, cut from the feature branch)
```

Why this rather than merging each task straight to `main`: `main` never holds a half-finished
plan (a kill switch, a crash, or the person walking away leaves it exactly as it was); workers
integrate siblings' merged work off the feature branch without that churn ever touching `main`; and
the promotion is one reviewable step. This is a deliberate departure from the classic flow's "main
checkout, main branch, always" rule, carved out for parallel mode in `CLAUDE.md § Where sessions
run` and in the `pir-worker` contract so a worker in a task-branch worktree does not halt on its own
worktree.

## Worktrees

Each branch is checked out in its own worktree, so several sessions work at once without touching
each other's files:

- The **coordinator** works in the feature-branch worktree at `.claude/worktrees/pir-{slug}`,
  leaving the person's main checkout on `main`.
- Each **worker** works in a task-branch worktree at `.claude/worktrees/pir-{slug}-T{nn}`.

Worktrees live under `<main>/.claude/worktrees`, the same place Claude Code puts its own linked
worktrees. A registered worktree directory is excluded from the parent repo's status by git, so
nothing there shows as an untracked file on `main`.

## Deterministic and reused

Every branch and worktree name is derived, not remembered: `pir/{plan}`, `pir/{plan}-T{nn}`, and
their worktree paths are computed from the slug and task number. `openFeature` and `createTask`
each check whether the branch and worktree already exist and **reuse** them if so, rather than
recreating. This is what makes a restart land on the same feature worktree instead of a duplicate —
and it is also part of a known limitation about in-flight task work; see
[restart-recovery.md](restart-recovery.md).

The task-branch separator is `-`, not `/`: git will not hold a ref `pir/{plan}` and a ref
`pir/{plan}/T{nn}` at once (a directory/file clash it rejects). Task branches sit beside the feature
branch, not under it. Do not "tidy" the dash back to a slash.

## Merges

- **Task branch → feature branch** (`mergeTask`): serialized, one per pass. `PROGRESS.md` is
  protected — the coordinator is its single writer on the feature branch, so whatever the task
  branch did to `PROGRESS.md` is discarded and the feature's version kept, whether the merge was
  clean or conflicted only on `PROGRESS.md`. A code conflict anywhere else aborts cleanly and
  returns the conflicting files, and the worker is parked to resolve it (see
  [human-flow.md](human-flow.md)).
- **Worker integrates the feature branch** (`integrate`): before it signals done, a worker merges
  the current feature branch into its task branch, so at merge time its only change to shared files
  is its own task's work. Never auto-resolves; a conflict is the worker's to resolve or escalate.
- **Feature branch → `main`** (`promote`): the one and only merge to `main`, run in the main
  worktree that has stayed on `main` throughout. Gated on the feature branch's tests passing.

Every commit-creating git call forces `commit.gpgsign=false` per-invocation, because an automated
coordinator has no one to type a passphrase. It does not change the repo's config, so the person's
own signing setting is untouched for their own commits.

Tearing a worktree down uses `git worktree remove --force --force` and `git branch -D`: the doubled
force removes a locked worktree, which is exactly the abandoned-worker state recovery must handle.

## Agent names

Every agent has a deterministic name (`src/core/naming.mjs`), so the coordinator finds and
addresses its workers from the name alone, without an id handed around out of band:

- **Coordinator:** `{repo} · {plan}` — e.g. `plan-implement-review · parallel-pir`.
- **Worker:** `{repo} · {plan} · T{nn} · {role}`, where `{role}` is `implement`, `review`, or
  `verify` — e.g. `plan-implement-review · parallel-pir · T05 · review`.

The separator is `·` (U+00B7), not `/`, and there is no leading `@`: cross-session messaging rejects
a name containing `/` or beginning with `@`. The role is part of the name so a task's implementer
and its fresh reviewer are two distinct addresses, told apart directly rather than by which spawned
most recently. `{repo}` is the basename of the main checkout. The coordinator counts only agents
whose name matches this run's `{repo} · {plan} · T…` against the ceiling, so a foreign session or
its own session is never miscounted.
