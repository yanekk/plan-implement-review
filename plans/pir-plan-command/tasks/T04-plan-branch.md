# T04 — plan-branch

**Phase:** 1 · **Depends on:** — · **Weight:** light

## Goal

Cut a planning run's temporary branch and worktree off `main`, and rename both to the plan's slug
once it is known, safely and repeatably. The planning program's rename (T07) and the launcher (T08)
call these.

## Design sections this implements

DESIGN §2.2 (branch and worktree), §2.5 (the "slug is free" check), §2.6 steps 1–2.

## Files

- `src/shell/worktree.mjs`, `src/shell/worktree.test.mjs`

## Interface

```js
export function openPlanBranch(runId, { root }) → { path, branch }   // pir/{runId} from local main
//   throws 'no-main' when refs/heads/main is missing; never runs checkout on the main worktree
export function slugTaken(slug, { root, indexHas }) → null | 'branch'|'main-plan'|'index'
export function renamePlanBranch(runId, slug, { root }) → { path, branch, done: { branch, worktree } }
//   each sub-step skipped when already done; throws if the target branch or path exists and is not ours
```

## Tests

- [ ] `openPlanBranch` creates `pir/plan-3f9a` at `main`'s commit and the worktree under `.claude/worktrees`.
- [ ] `openPlanBranch` with no `main` throws `no-main` and leaves the repo unchanged.
- [ ] `slugTaken` for each of branch, plan committed on `main`, index entry, and free.
- [ ] `renamePlanBranch` moves branch and worktree; the worktree reports `pir/{slug}`.
- [ ] Re-running after the branch rename only, and after both, completes or no-ops.
- [ ] A target branch that already exists is refused and nothing moves.
- [ ] The person's main checkout branch and HEAD are unchanged by every call.

## Done when

- [ ] Every row passes in `npm test` against scratch repos.
- [ ] Commit-creating calls force `commit.gpgsign=false` as the rest of `worktree.mjs` does.
