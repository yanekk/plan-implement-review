# T04 — base-text

**Phase:** 1 · **Depends on:** — · **Weight:** medium

## Goal

Every string pir shows or sends that names `main` takes the base branch name instead, including the
hand-off. The functions gain a `base` parameter, defaulting to `'main'` so this task changes no output
until T07 passes the real base.

## Design sections this implements

DESIGN §2.9.

## Files

- `src/core/conflict.mjs` (main-sync and tests-fix prompts), `src/core/coordinator-brief.mjs` (SYNC_WORDS, `handoffFor`, `resyncedFor`), `src/core/coordinator-report.mjs` (`branchFooter`), `src/core/notify.mjs` (`endAlert`: ready and red messages), `src/shell/render.mjs` (the no-agent `handoff` footer, the agent `ready to merge` line, preparing line, ^C line), `src/shell/coordinate.mjs` (`renderHandoff`, `renderFinished`, `HELPER_SLUG` only)
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
notify end-of-run red: `Merge with {base} unresolved on pir/{slug}`; ready: `… git switch {base} && git merge pir/{slug}`
render: every `git merge {branch}` line (no-agent footer, agent ready line) becomes `git switch {base} && git merge {branch}`; the footer object carries `base`
HELPER_SLUG[MAIN_SYNC_TASK] = 'resolve-base-merge'   // display only; the label and agent name stay main-sync
```

Rename `mainSha` fields to `baseSha` in these modules and their callers in one go; the `main-sync` label
and `MAIN_SYNC_TASK` stay (DESIGN §2.9).

## Tests

- [ ] each function with `base: 'dev'` says dev and never main
- [ ] each with the default reproduces today's text exactly (existing assertions unchanged except the hand-off line)
- [ ] hand-off line is `git switch main && git merge pir/{slug}` by default
- [ ] the preparing line shows a hold reason when one is passed

## Done when

- [ ] `grep -nw main` in these modules finds only the kept `main-sync` label (`MAIN_SYNC_TASK`), `main()` entry functions and comments
- [ ] existing text tests pass with the default base
- [ ] `npm test` green
