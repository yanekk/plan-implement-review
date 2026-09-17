# T01 — `decideResume` pure classifier

**Phase:** 1 · **Runs:** auto · **Depends on:** — · **Weight:** light

## Goal

The one pure decision at the heart of the fix: given the feature-branch task table and, for each
task, the committed glyph on its own task branch, decide what a restart should do with it — merge it,
review it, or rebuild it. Keeping this a pure function of its arguments is what lets the entire
four-way classification be proven in milliseconds before any git or agent is involved, and what lets
a mutation that returns the old "every `⬜` is a fresh implement" redden a test.

## Design sections this implements

DESIGN §2.3 (the classifier table), §3.1 (the boundary), §3.3 (the decision function).

## Files

- `src/core/resume.mjs` (new) — `decideResume`.
- `src/core/resume.test.mjs` (new) — its tests.

Nothing else. This task touches no git and no shell.

## Interface

```
decideResume({ featureTasks, branchStates }) → { merge: string[], review: string[], rebuild: string[] }

  featureTasks : Array<{ num: 'T01', state: '⬜'|'🟡'|'🔍'|'✅'|'⛔', deps: string[], runs: 'auto'|'you' }>
                 (exactly the shape parseProgress(...).tasks returns)
  branchStates : Record<taskNum, '⬜'|'🟡'|'🔍'|'✅'|null>
                 the committed glyph on task branch pir/{slug}-{num}, or null when the branch is
                 absent or has no readable row. The shell reads these; this function never touches git.

  returns the task numbers to merge (feature ⬜, branch ✅), to review (feature ⬜, branch 🔍), and to
  rebuild (feature ⬜, branch exists but is neither ✅ nor 🔍). Each list is sorted by task number.
```

Rules, from DESIGN §2.3:

- A task whose **feature** row is `✅` or `⛔` produces no entry — it is terminal on the feature branch
  (a leftover branch for a `✅` task is cleaned up in the shell, T03, not decided here).
- A task whose feature row is `⬜` is classified by its branch glyph: `✅` → merge, `🔍` → review, any
  other present glyph (`⬜`/`🟡`) → rebuild, absent branch (`null`) → no entry (normal dispatch
  implements it).
- `🔍` never appears for a `you` task (verify goes straight to `✅`), so no `Runs`-specific branch is
  needed; the glyph alone decides.

## Tests

- [ ] feature `⬜` + branch `✅` → merge; not review, not rebuild.
- [ ] feature `⬜` + branch `🔍` → review; not merge, not rebuild.
- [ ] feature `⬜` + branch `🟡` → rebuild.
- [ ] feature `⬜` + branch `⬜` (branch exists, no progress) → rebuild.
- [ ] feature `⬜` + branch absent (`null`) → no entry in any list.
- [ ] feature `✅` (already merged) → no entry, whatever the branch glyph.
- [ ] feature `⛔` (deferred) → no entry.
- [ ] a `you` task, feature `⬜` + branch `✅` → merge (verify folds to `✅` with no `🔍` stage).
- [ ] mixed table: several tasks across all cases classify independently and each list is sorted by
      task number.
- [ ] mutation guard: a classifier that treats every `⬜` feature row as a fresh implement (ignoring
      the branch glyph) fails the merge and review tests — i.e. the tests pin the branch glyph as the
      deciding input, not the feature row.
- [ ] empty `featureTasks` → all three lists empty.

## Done when

- [ ] `decideResume` lives in `src/core/resume.mjs`, is pure (no imports that touch git/fs/clock), and
      `src/core/boundary.test.mjs` still passes.
- [ ] `resume.test.mjs` covers every row of the DESIGN §2.3 table plus the mutation guard, and
      `npm test` is green.
- [ ] The output shape matches the interface above exactly, so T03 can consume it without adaptation.
</content>
