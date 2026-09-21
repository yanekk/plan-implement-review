# The branch and worktree model

The whole plan runs on a single **feature branch**, `pir/{plan}`, cut from `main` when the command
starts. Workers cut **task branches**, `pir/{plan}-T{nn}`, from the feature branch, and their
finished work merges back into it. `main` never receives the plan from the command: when every task
is done and the feature branch is green, the command **hands the person a `git merge` to run by
hand**. All of the branch work is in `src/shell/worktree.mjs`.

```
main ──●                                                            (the command never merges here;
        \                                                            the person runs `git merge` by hand)
         ● pir/{plan}  (feature branch) ──●────●────●─────●   task branches merge in, serialized
            \            \            \
             ● T01        ● T02        ● T05     (task branches, cut from the feature branch)
```

Why this rather than merging each task straight to `main`: `main` never holds a half-finished plan
(a kill switch, a crash, or the person walking away leaves it exactly as it was); workers integrate
siblings' merged work off the feature branch without that churn ever touching `main`; and the
person judges one finished feature branch. This is a deliberate departure from the classic flow's
"main checkout, main branch, always" rule, carved out for parallel mode in `CLAUDE.md § Where
sessions run` and in the `pir-worker` contract so a worker in a task-branch worktree does not halt
on its own worktree.

## Worktrees

Each branch is checked out in its own worktree, so several sessions work at once without touching
each other's files:

- The **command** works in the feature-branch worktree at `.claude/worktrees/pir-{slug}`, leaving
  the person's main checkout on `main`.
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
branch, not under it. Do not "tidy" the dash back to a slash. (This is the branch-name separator;
the agent-name separator is a different `/`, below.)

## Merges

- **Task branch → feature branch** (`mergeTask`): serialized, one per pass. `PROGRESS.md` is
  protected — the command is its single writer on the feature branch. It is no longer discarded
  wholesale: the merge keeps the feature's version of everything that already exists (every
  pre-existing task row and every cross-cutting single-line field), and **adopts only genuinely new
  task rows** the branch added — a worker-introduced task (`adoptNewTaskRows`, see
  [task-state.md](task-state.md)). Each adopted row lands with its state forced to `⬜`; a row that
  would edit an existing task, or names a dependency that does not exist, is rejected and surfaced,
  never applied (see [control-folder.md](control-folder.md)). This holds whether the merge was clean
  or conflicted only on `PROGRESS.md`. A code conflict anywhere else aborts cleanly and returns the
  conflicting files, and the worker is parked to resolve it (see [human-flow.md](human-flow.md)).
- **Worker integrates the feature branch** (`integrate`): before it signals done, a worker merges
  the current feature branch into its task branch, so at merge time its only change to shared files
  is its own task's work. Never auto-resolves; a conflict is the worker's to resolve or escalate.
- **Feature branch → `main`**: not a command action. When the feature branch is green, the command
  prints `git merge pir/{slug}` and exits; the person runs that merge in their own checkout, in their
  own time. Merging the finished plan to `main` is the one irreversible act in the system, and it
  belongs to the person, not an automated command. A red feature branch gets no `git merge` line.

Every commit-creating git call the command makes forces `commit.gpgsign=false` per-invocation,
because the automated run has no one to type a passphrase. It does not change the repo's config, so
the person's own signing setting is untouched for their own commits.

Tearing a worktree down uses `git worktree remove --force --force` and `git branch -D`: the doubled
force removes a locked worktree, which is exactly the abandoned-worker state recovery must handle.

### Known limitation: only `PROGRESS.md` is fold-protected

The fold above protects `PROGRESS.md` alone. A worker-introduced task also writes a row into
`PLAN.md` and a line into `FINDINGS.md`, and those two files merge through git's ordinary line
merge, not the fold. So if two additions land close together — two workers each add a task, or one
adds a task while another appends a finding — git cannot combine the two edits to the same file and
the merge conflicts on `PLAN.md` or `FINDINGS.md`. This is not special-cased: it takes the existing
merge-conflict path, parking the introducing worker to resolve it (see [human-flow.md](human-flow.md)).
Nothing is lost and the run pauses one worker, not the whole run. It is an accepted limitation, not a
bug — the common case adds a single task and never hits it (see
`plans/dynamic-tasks/DESIGN.md § 2.5, § 8`).

## Agent names

Every worker has a deterministic name (`src/core/naming.mjs`), so the command finds and addresses
its workers from the name alone, without an id handed around out of band:

- **Worker:** `{repo} / {plan} / {task} / {slug} / {role}` — five fields separated by ` / `. For
  example `plan-implement-review / non-agentic-coordinator / T01 / stop-promoting / implement`. The
  `{role}` is `implement` or `review` — the only two roles; the old `verify` role is gone with the
  hands-on path. `{slug}` is the task's kebab name (see [task-state.md](task-state.md)).
- **The command has no agent name at all**, because it is a plain process and never appears in
  `claude agents`. There is no coordinator name.

The separator is `/`, and there is no leading `@`. It was `·` only because the old down-channel used
cross-session messaging, which rejected a `/`; with the down-channel gone the separator reverts to
`/` for readability (DESIGN of `non-agentic-coordinator`, §2.9). The role is part of the name so a
task's implementer and its fresh reviewer are two distinct addresses, told apart directly rather
than by which spawned most recently. The task number, not the slug, stays the identity the command
matches on: `parseAgentName` extracts it so a restart still matches a live worker to its task by
number regardless of the slug, and only agents whose name matches this run's `{repo} / {plan} / …`
count against the ceiling, so a foreign session is never miscounted. `{repo}` is the basename of the
main checkout.
