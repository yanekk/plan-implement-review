# T03 — plan-home

**Phase:** 1 · **Depends on:** — · **Weight:** light

## Goal

A build finds its plan where `pir plan` leaves it: on branch `pir/{slug}` when it is not in the main
checkout. Every place the launcher and the coordinator read `PROGRESS.md` or `DESIGN.md` from the main
checkout goes through one resolver, so a hand-made plan on `main` behaves exactly as today and a
branch-home plan passes the same gates.

## Design sections this implements

DESIGN §2.9.

## Files

- `src/shell/plan-home.mjs` (new), `src/shell/plan-home.test.mjs` (new)
- `src/shell/coordinate.mjs`: `readReviewGate`, `readTestBlockGate`, `runFeatureTests`, the `design` read
  for `makePrepare` in `main()`, the dry-run `PROGRESS.md` read
- `src/shell/launch.mjs`: the pre-flight reads
- their existing tests where a signature changes

## Interface

```js
// planHome(slug, { root, exec, fs }) → { where: 'main'|'branch'|'none', read(file) → string|null }
//   'main'   when <root>/plans/{slug}/PROGRESS.md exists in the working tree; read() reads the file there
//   'branch' else when `git cat-file -e pir/{slug}:plans/{slug}/PROGRESS.md` succeeds; read() is
//            `git show pir/{slug}:plans/{slug}/{file}`
//   'none'   otherwise
export function planHome(slug, opts) → { where, read }
```

`readReviewGate` and `readTestBlockGate` keep their signatures and return shapes; they read through
`planHome`, and `missing` means `where === 'none'`.

## Tests

- [ ] Plan only on `main` (working tree): `where 'main'`, gates as before.
- [ ] Plan only committed on `pir/{slug}`: `where 'branch'`, reviewed gate and test block read from the branch.
- [ ] Plan on both: `main` wins, including an uncommitted edit on `main`.
- [ ] Uncommitted edit in the branch's worktree is not seen.
- [ ] Neither: `none`, `startRun` refuses `no-plan`.
- [ ] `runFeatureTests` on a branch-home plan reads the block from the branch.
- [ ] A slug containing `..` or `/` is refused before any git call.

## Done when

- [ ] Every row passes in `npm test` against scratch repos; every existing coordinator and launch test passes.
- [ ] No read of `plans/{slug}/PROGRESS.md` or `DESIGN.md` in `coordinate.mjs` or `launch.mjs` bypasses `planHome` (grep).
