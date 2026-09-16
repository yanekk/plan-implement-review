# Gap: `/pir-coordinate` cannot run a plan that lives in another repo

**Found:** 2026-09-16, while trying to run `/pir-coordinate usage-limits` for the
`agentic-ide` project.

**Resolved:** 2026-09-16 by Option 1. The engine (`src/`) is now installed user-scoped under
`~/.claude/pir-engine/` by `install.sh` (`install_engine`), exactly as the skills are, and the
`pir-coordinate` skill invokes `~/.claude/pir-engine/src/shell/coordinate.mjs` rather than an
in-repo path. Because the engine already resolves its target repo from the coordinator session's
cwd, an installed engine launched from any product repo operates on that repo — no target-repo
argument was needed (Option 2 avoided). The canonical-repo guard still protects the engine's own
dev checkout. Verified: installed engine resolves its imports and reads the plan from the caller's
cwd; `npm test` green. The one thing still unproven from here is a real end-to-end parallel run in
another repo — that is a live, hand-verified check (DESIGN §5.1 / T10).

## What happened

The `usage-limits` plan was authored inside the **`agentic-ide`** repo
(`~/src/agentic-ide/plans/usage-limits/`) and converted to the parallel format
(commit `plan(usage-limits): convert for the parallel pir-coordinate flow`). Its
review gate is green — `PROGRESS.md` says *"Plan reviewed: 2026-09-16 — 6 fixed, 1
decided with the user"* — so it is ready to build.

Invoking `/pir-coordinate usage-limits` from inside `agentic-ide` fails
immediately: the skill runs `node src/shell/coordinate.mjs {slug}`, and there is no
`src/shell/coordinate.mjs` in `agentic-ide`. The engine exists only here, in
`~/src/plan-implement-review/src/shell/coordinate.mjs`.

## Why pointing this engine at `agentic-ide` does not work either

The engine has no target-repo argument. It resolves the repo it operates on from
its own working directory:

```
// src/shell/coordinate.mjs
const root = mainWorktree(process.cwd()) || process.cwd();
```

and then looks for `plans/{slug}/` under that root, opens a feature branch in that
repo, spawns worker worktrees of that repo, merges tasks into that repo's `main`,
and promotes there. It is **self-hosting by design**: it refuses to run inside the
canonical `plan-implement-review` checkout and expects to be pointed at a
*same-named scratch clone of itself* (`PARALLEL_ALLOW_HERE=1`). There is no path by
which it coordinates a plan that lives in a *different* product repo.

So today the parallel coordinator can only drive plans that live in the same repo
as the engine (i.e. `plan-implement-review` and its scratch clones). A plan
authored in a real product repo — which is the actual use case `agentic-ide`
represents — has nowhere to run.

## The mismatch, stated plainly

- The **skills** (`pir-plan`, `pir-work`, `pir-review`, `pir-coordinate`, …) are
  installed globally and are usable from any repo.
- The sequential path (`/pir-work`) needs no engine and works in `agentic-ide`
  today.
- The **parallel path** (`/pir-coordinate`) needs `src/shell/coordinate.mjs`, which
  is *not* a globally-installed tool — it is a source file that lives only in this
  repo and only operates on this repo. So converting a plan in another repo to the
  parallel format produces a plan that cannot be coordinated.

## Options to close it (for the PIR developer to decide)

1. **Ship the engine as an installed tool.** Have `install.sh` / `pir-install`
   place `coordinate.mjs` (and `naming.mjs` and its deps) somewhere on the user's
   machine that any repo can invoke, and change the `pir-coordinate` skill to call
   that installed path rather than `src/shell/coordinate.mjs` relative to cwd. Then
   it runs against whatever repo the coordinator session is launched in.

2. **Add a target-repo argument/env.** Let the engine coordinate a repo other than
   its own cwd, so it can be launched from `plan-implement-review` and aimed at
   `agentic-ide`. (Heavier — every path that assumes `process.cwd()` is the target
   would need auditing, and the canonical-repo / promote guards were written around
   the self-hosting assumption.)

3. **Accept the limit and document it.** State in the `pir-coordinate` skill and in
   `pir-parallelize-plan` that parallel mode only applies to plans inside the
   engine's own repo, so nobody converts an external plan expecting to run it. In
   that case `agentic-ide`'s `usage-limits` is built with sequential `/pir-work`.

## Note specific to `usage-limits`

Even with the engine available, this particular plan gets limited benefit from
parallelism: tasks **T00** and **T06** are `you` tasks needing the user's live
Claude subscription, T00 gates most of the rest, and the only real concurrency is
T05 overlapping T03/T04. Sequential `/pir-work` costs almost nothing here.
