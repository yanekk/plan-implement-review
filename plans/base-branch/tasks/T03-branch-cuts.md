# T03 — branch-cuts

**Phase:** 1 · **Depends on:** — · **Weight:** medium

## Goal

Make `worktree.mjs` branch-name-agnostic. Branches are cut from a commit the caller gives, the base is
recorded on the branch as `pirBase`, and the slug check, the end-of-run merge and the "has the person
merged" checks all take the base as an argument. Callers keep passing `main` until T05–T07 wire the real
base, so behaviour does not change in this task.

## Design sections this implements

DESIGN §2.5, §2.6 (slug check), §2.8 (contains checks), §3.2.

## Files

- `src/shell/worktree.mjs`, `src/shell/worktree.test.mjs`, `src/shell/worktree-plan.test.mjs`
- `src/shell/fake/worktree.mjs` if its fake mirrors these signatures
- callers updated to pass `base: 'main'` explicitly (`coordinate.mjs`, `launch.mjs`, `plan-run.mjs`), no other change

## Interface

```js
openFeature(plan, { root, base, from })        // from: sha to cut from (default refs/heads/<base>); records pirBase on create
openPlanBranch(runId, { root, base, from })    // same; throws code 'no-base-branch' when from does not resolve
recordRunBase(root, branch, base)              // git config branch.<branch>.pirBase <base>
readRunBase(root, branch) → string|null
slugTaken(slug, { root, base, indexHas }) → 'branch'|'base-plan'|'index'|null   // 'main-plan' renamed
syncBase(featurePath, { baseSha, base }) → { state, baseSha, files }   // was syncMain; commit msg `sync {base} into {branch}`
baseContains(branch, { root, refs: [ref, …] }) → boolean  // true if ANY ref contains the branch tip
baseTip({ root, ref }) → sha|null
```

`syncMain`, `mainContains`, `mainTip`, `noMain` are removed, not aliased.

## Tests

- [ ] openFeature/openPlanBranch cut from the given sha, not the branch tip, and record pirBase
- [ ] reusing an existing branch does not rewrite its pirBase
- [ ] `git branch -m` of a planning branch keeps pirBase (renamePlanBranch path)
- [ ] slugTaken finds a plan committed on `dev` when base is dev, and ignores one only on main
- [ ] syncBase merges the given sha with the base-named message; conflict left in progress as today
- [ ] baseContains true when only the second ref contains the tip
- [ ] readRunBase null for a branch with no pirBase

## Done when

- [ ] no function in `worktree.mjs` names `main` as a branch
- [ ] callers pass `main` explicitly and every existing test still passes
- [ ] `npm test` green
