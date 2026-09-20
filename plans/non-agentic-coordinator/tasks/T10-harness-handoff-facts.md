# T10 — harness-handoff-facts

**Phase:** 3 (addendum) · **Runs:** auto · **Depends on:** T05 · **Weight:** light

## Goal

Convert the harness's stale promotion assertion to the no-promotion **hand-off** model so the live
fixtures pass under the shipped coordinator. This plan removed promotion (§2.4): the run never merges
to `main`, it stops at a green feature branch and hands the person `git merge pir/{slug}`. But
`assertions.mjs`'s `oneMergeToMain` still asserts "main gained exactly one commit — the promotion"
(a `promote` flow line + a `Merge branch 'pir/{plan}'` into main). So `single`, `review-queue` and
`clean-merge` — which use it — FAIL a live run even though the coordinator is correct. The `single`
live run on 2026-09-20 confirmed this: correct behaviour (main untouched, green `pir/single` handed
off, fresh review) but a red report on `oneMergeToMain` (FINDINGS). This is the unfinished half of
T05's fixture rework (T05 FINDINGS deferred it "until the live run is revisited").

## Design sections this implements

DESIGN §2.4 (no promotion; the run hands off a green feature branch) and §4 (the live-scenario harness
proves the new model).

## Files

- `src/shell/harness/assertions.mjs` — replace `oneMergeToMain` with a hand-off fact (e.g.
  `handedOffGreenBranch`) that asserts the §2.4 end state instead of a promotion.
- `src/shell/harness/fixtures/single.mjs`, `.../review-queue.mjs`, `.../clean-merge.mjs` — use the new
  fact in place of `oneMergeToMain()`.
- `src/shell/harness/assertions.test.mjs` — update the canned bundles/cases for the new fact, including
  a regression case that a bundle carrying a `promote` line (the removed model) now FAILS.

## Interface

```js
// handedOffGreenBranch() → the run ended by handing off a green feature branch, main untouched (§2.4).
// From the capture bundle, asserts:
//   - ZERO `promote` flow lines (the coordinator no longer touches main);
//   - the git log shows NO `Merge branch 'pir/{plan}'` merge into main (main gained nothing beyond the
//     fixture seed);
//   - the feature branch pir/{plan} received the task merge(s) — the plan was assembled there.
// The printed `git merge` hand-off line is NOT checkable here: run.mjs launches the coordinator with
// stdio ignored, so the bundle never captures the coordinator's stdout (FINDINGS). Assert from the
// flow log and git only.
export function handedOffGreenBranch() { ... }
```

## Tests

- [ ] `handedOffGreenBranch` PASSes on a bundle with no `promote` line, `main` at the seed, and the
      feature branch carrying the task merge(s).
- [ ] It FAILs on a bundle that carries a `promote` line and/or a `Merge branch 'pir/{plan}'` into main
      — a regression guard so the removed promotion cannot silently return.
- [ ] `single`, `review-queue`, `clean-merge` reference the new fact; grep confirms no live fixture
      still imports `oneMergeToMain`.
- [ ] `npm test` is green.

## Out of scope — a separate decision

- **The `merge-conflict` fixture and its `mergeConflictResolved` fact.** They still assume the removed
  down-channel (a `scriptedAnswer` written to `answers`, and an `answer` flow line the loop no longer
  emits). Under the new model a merge conflict is resolved by the person attaching to the worker
  directly (§2.8), which a harness cannot script. So it needs a different fix — either drop the fixture
  (as `hands-on`/`blog-app` were dropped when their model became person-only) or convert it to check
  only "conflict surfaced + worker held alive + nothing promoted." That is a PM decision, tracked
  separately (FINDINGS), not this task.

## Done when

- [ ] `oneMergeToMain` is replaced by the hand-off fact; `single`/`review-queue`/`clean-merge` use it;
      `assertions.test.mjs` covers the new fact and the regression case; `npm test` is green.
- [ ] (The live confirmation that a `single` run now reports `PASS` end-to-end is T09's, not this task's
      — this task is proven by the canned assertion tests.)
