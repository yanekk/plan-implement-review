# T01 — box-grammar

**Phase:** 1 · **Depends on:** — · **Weight:** light

## Goal

Replace the box's `@name brief` reading with the two-command grammar, and add the pure decisions the list
view and the submit need: which pop-up context the cursor is in, the new notes, and the new head line. Every
rule the person can trip over stays in `planbox.mjs`, tested in milliseconds.

## Design sections this implements

DESIGN §2.1, §2.2 (the context table), §2.4 (the notes and their order), §2.5 (the head line).

## Files

- `src/core/planbox.mjs`, `src/core/planbox.test.mjs`
- `src/shell/list-view.test.mjs`, `src/shell/pir-tui.test.mjs`, `src/shell/plan-rig.test.mjs`: only the assertions
  and typed keys that used the old `@name brief` grammar, its notes or its head line (a repo pick still writes
  `@name ` until T03, so those tests type `/plan` by hand)

## Interface

```js
export const COMMANDS = [
  { name: 'plan', description: 'plan something new' },
  { name: 'start', description: 'build a reviewed plan' },
];

// plansOf(repo) → [{ slug }] buildable in that repo; called only for a /start text, after the repo resolved.
parseBoxText(text, repos, { roots, plansOf = () => [] })
  → { ok: true, command: 'plan', repo, brief }
  | { ok: true, command: 'start', repo, slug }
  | { ok: false, reason, note, name?, paths?, command?, slug? }
// reason, in DESIGN §2.4's order: 'no-at' | 'unknown-repo' | 'ambiguous-repo' | 'no-command' |
//   'unknown-command' | 'empty-brief' | 'no-slug' | 'extra-words' | 'unknown-slug'

// line: the first line; col: the cursor's column in it. null outside the three contexts.
completionContext(line, col)
  → { kind: 'repo', query } | { kind: 'command', name, query } | { kind: 'slug', name, query } | null

headLine(text, repos, { roots, plansOf }) → { text, style }   // DESIGN §2.5; plansOf read only for /start
startBuildFailedNote(name, slug, reason) → string              // DESIGN §2.4, the startRun row

NOTES gains: noCommand(name), unknownCommand(name, cmd), emptyBrief(name) (now names /plan),
  noSlug(name), extraWords(name), unknownSlug(name, slug); noAt() changes text.
```

`routeBoxKey`, `absorbAt`, `isBare`, `rankRepos` and `startFailedNote` are unchanged.

## Tests

- [ ] `@skaut/plan a brief\nmore` → plan, brief with its newline kept; `@skaut/start foo` → start, slug `foo`.
- [ ] Each §2.4 row, and two that could both apply resolve to the earlier row (`@nope/bogus` is unknown-repo).
- [ ] `@skaut brief`, `@skaut`, `@skaut/` are all no-command; `@skaut/Plan x` is unknown-command.
- [ ] `/start` with a slug `plansOf` does not return, with a prefix of one, with two words, with a newline then a word.
- [ ] `plansOf` is not called for a `/plan` text or before the repo resolves.
- [ ] `completionContext` for `@`, `@sk`, `@skaut/`, `@skaut/st`, `@skaut/start `, `@skaut/start fo`, and null for
      `@skaut/plan x`, `@skaut/start foo bar`, `@skaut/start foo ` and a cursor inside the name token of a longer line
      (returns repo with the query up to the cursor).
- [ ] Every §2.5 head-line row; `plansOf` not called for any row but `/start`.
- [ ] Every note and head line at an 18-character repo name and slug fits 80 columns.

## Done when

- [ ] `parseBoxText`, `completionContext` and `headLine` cover every §2.1, §2.2, §2.4 and §2.5 row, each with a test.
- [ ] `npm test` green (list-view, pir-tui and plan-rig tests that asserted the old grammar are updated to the new one, nothing else).
