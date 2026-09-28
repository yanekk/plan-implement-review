# T03 — box-completion

**Phase:** 2 · **Depends on:** T01 · **Weight:** medium

## Goal

Make the box's pop-up walk the person through the grammar: repos, then the two commands, then the repo's
buildable plans with their progress, each pick writing its piece and opening the next list. The rules are
T01's `completionContext`; this task carries them out in the list view's autocomplete provider and adds the
re-open step pi-tui does not do on its own.

## Design sections this implements

DESIGN §2.2, §2.5 (the hint lines), §3.3.

## Files

- `src/shell/list-view.mjs`, `src/shell/list-view.test.mjs`

## Interface

```js
createListView({ …, plansOf = () => [], building = (repo, slug) => false })
// plansOf(repo) → [{ slug, done, total }] (T02's scanPlans shape, injected; cached per repo by the view until bare).
// building(repo, slug) → true when a build of that slug in that repo is running now.

boxCompletion({ currentRepos, plansOf, building, home }) → pi-tui AutocompleteProvider   // replaces repoCompletion
//   repo    rows { value: name, label: '@'+name, description: tildified path }  → applies `@name/`
//   command rows { value, label: value, description } from COMMANDS             → applies `@name/{cmd} `
//   slug    rows { value: slug, label: slug, description: '3/8 done' | '3/8 done · building' } → applies the slug

TYPED_HINT (unchanged), START_HINT = '↵ start the build · esc clear', BARE_HINT_SUFFIX = ' · type @repo to plan or build'
```

After the editor handles a typed character, a deletion or a repo or command pick, and the pop-up is not showing,
the view calls `editor.tryTriggerAutocomplete()` when `completionContext` is not null and the cursor is at the end
of the first line (DESIGN §3.3). Not after Esc, not after a slug pick.

## Tests

- [ ] `@sk` Enter → `@skaut/` and the command pop-up is showing (await pi-tui's async request).
- [ ] Tab on `start` → `@skaut/start ` and the slug pop-up shows the repo's plans, `3/8 done`, `· building` where `building` says so.
- [ ] Enter on a slug → the slug written, pop-up closed and not reopened after a render; `plan` pick → no pop-up.
- [ ] Typing `/` by hand after `@skaut` opens the command pop-up; typing `st` narrows it to `start`.
- [ ] A repo pick on `@sk/plan brief` (cursor in the name) keeps `/plan brief` and adds no second `/`.
- [ ] Esc closes an open pop-up and it stays closed; Esc again resets to `@`.
- [ ] A repo with no buildable plan opens no slug pop-up.
- [ ] `plansOf` called once per repo per typed stretch; again after the box goes bare.
- [ ] Pinning test: `Editor.prototype.tryTriggerAutocomplete` is a function (a pi-tui upgrade that drops it fails here).
- [ ] The `/start` hint and the new bare suffix; the armed-chord line still wins.

## Done when

- [ ] Every test above passes against pi-tui's stub host.
- [ ] `npm test` green.

## End to end (the worker drives this)

Driven in T04, once `runTui` passes `plansOf` and `building` in; this task's surface is not reachable from `pir` before then.
