# T02 — plan-scan

**Phase:** 1 · **Depends on:** — · **Weight:** light

## Goal

Find the plans in a repo that `pir start` would build or resume, with their progress, for the box's slug
pop-up and its exact-slug check. The rule of which plan counts is pure; finding the plans on disk and on
`pir/*` branches is the shell's, through `planHome` so the list and `startRun` never disagree on where a plan is.

## Design sections this implements

DESIGN §2.3.

## Files

- `src/core/buildable.mjs` (new), `src/core/buildable.test.mjs`
- `src/shell/plan-scan.mjs` (new), `src/shell/plan-scan.test.mjs`

## Interface

```js
// core/buildable.mjs — uses parseProgress (core/progress.mjs) and parseTestBlock (core/testblock.mjs).
buildablePlan({ progress, design }) → { done, total } | null
// null unless: progress is reviewed, design has a valid setup/test block, total ≥ 1, done < total (done = ✅ rows).

// shell/plan-scan.mjs
scanPlans(repoPath, { exec, fs }) → [{ slug, done, total }]   // sorted by slug; never throws
// candidates: dirs under <repoPath>/plans/ holding PROGRESS.md, ∪ `git for-each-ref --format=%(refname:strip=3)
// refs/heads/pir/` names passing validSlug; each read through planHome(slug, { root: repoPath, exec, fs }).
```

## Tests

- [ ] `buildablePlan`: unreviewed → null; no or invalid test block → null; all ✅ → null; no tasks → null;
      ⬜/🟡/🔍/⛔ mixed with ✅ → the right `done`/`total`.
- [ ] `scanPlans` against real git in a temp folder: a plan in the working tree only; one on `pir/x` only; the
      same slug in both (the working tree's progress wins); a finished plan and an unreviewed one left out;
      a `pir/plan-a1b2` branch with no plan under its own name left out; a repo with no `plans/` → `[]`;
      a path that is not a repo → `[]`, no throw.
- [ ] Sorted by slug.

## Done when

- [ ] Both modules exist with the interface above and every test listed.
- [ ] `src/core/boundary.test.mjs` passes with `buildable.mjs` in it; `npm test` green.
