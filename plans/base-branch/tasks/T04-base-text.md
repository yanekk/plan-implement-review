# T04 — base-text

**Phase:** 1 · **Depends on:** — · **Weight:** medium

## Goal

Every string pir shows or sends that names `main` takes the base branch name instead, including the
hand-off. The functions gain a `base` parameter, defaulting to `'main'` so this task changes no output
until T07 passes the real base.

## Design sections this implements

DESIGN §2.9.

## Files

- `src/core/conflict.mjs` (main-sync and tests-fix prompts), `src/core/coordinator-brief.mjs` (SYNC_WORDS, hand-off, `resyncedFor`), `src/core/coordinator-report.mjs` (`branchFooter`), `src/core/notify.mjs`, `src/shell/render.mjs` (preparing line, ^C line), `src/shell/coordinate.mjs` (`renderHandoff`, `renderFinished` only)
- their tests

## Interface

```js
buildConflictPrompt({ kind, slug, plan, files, audience, base = 'main' })
syncWords(base) → { 'up-to-date': …, merged: …, resolved: …, unresolved: … }
branchFooter({ baseSha, base = 'main', tests, syncedAt, unresolved, fix })   // mainSha → baseSha
resyncedFor({ slug, baseSha, base = 'main', tests, unresolved })
renderHandoff({ branch, base = 'main', … })   // prints `git switch {base} && git merge {branch}`
renderFinished({ branch, base = 'main', … })  // `✔ {branch} is in {base}. The run is finished.`
render preparing line: `preparing: syncing {base}, writing the report`, or the hold text when a hold is given
notify end-of-run red: `Merge with {base} unresolved on pir/{slug}`
```

Rename `mainSha` fields to `baseSha` in these modules and their callers in one go; the `main-sync` label
and `MAIN_SYNC_TASK` stay (DESIGN §2.9).

## Tests

- [ ] each function with `base: 'dev'` says dev and never main
- [ ] each with the default reproduces today's text exactly (existing assertions unchanged except the hand-off line)
- [ ] hand-off line is `git switch main && git merge pir/{slug}` by default
- [ ] the preparing line shows a hold reason when one is passed

## Done when

- [ ] `grep -n "\bmain\b"` in these modules finds only the kept `main-sync` label and comments
- [ ] existing text tests pass with the default base
- [ ] `npm test` green
