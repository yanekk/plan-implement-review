# T09 — box-single

**Phase:** 3 · **Depends on:** T05, T08 · **Weight:** medium

## Goal

`@repo/single <change>` in the runs list's box: the third command, its pop-up entry, head line, hint,
refusal notes, and the submit that calls `startSingleRun` and lands in the builder's conversation, with
the view following into the reviewer's.

## Design sections this implements

DESIGN §2.1, §2.8 (where the box lands, following).

## Files

- `src/core/planbox.mjs`, `src/core/planbox.test.mjs`
- `src/shell/pir-tui.mjs`, `src/shell/pir-tui.test.mjs` (submit, landing, `followStep` for single)
- `src/shell/list-view.mjs`, `src/shell/list-view.test.mjs` (hint line)
- `src/shell/plan-rig.test.mjs` (end-to-end cases)

## Interface

```js
COMMANDS = [plan, start, { name: 'single', description: 'change something small' }]
parseBoxText(...) → … | { ok: true, command: 'single', repo, prompt }
                   | { ok: false, reason: 'empty-prompt', name, command, note: NOTES.emptyPrompt(name) }
NOTES: noAt, noCommand, unknownCommand reworded; emptyPrompt added      // DESIGN §2.1 table, verbatim
headLine: '/single' → { text: `change in ${name}`, style: 'dim' }; the others reworded
startSingleFailedNote(name, reason) → `Could not start the change in ${name}: ${words}`
openBuilder(key, deps)   // pir-tui: as openPlanner, for a single run; `starting the builder…` until named
```

## Tests

- [ ] parseBoxText: `@r/single fix it` ok with prompt; `@r/single` and `@r/single   ` → empty-prompt; multi-line prompt kept
- [ ] every reworded note and head line text equals the DESIGN §2.1 table
- [ ] command pop-up lists plan, start, single in that order; picking single writes `single ` and opens no pop-up
- [ ] startSingleFailedNote words each refusal reason; an unknown reason passes through
- [ ] hint line reads `↵ start the change · shift+↵ new line · esc clear` for a `/single` text

## End to end (the worker drives this)

- suite: the planning rig (T08) · sizes: 80×24, 120×40
- [ ] type `@repo/single fix the typo`, `↵` → the box resets to `@` and the screen is the builder's conversation
- [ ] `@repo/sin` + Tab from the command pop-up → `@repo/single `
- [ ] `@repo/single` `↵` → the note `say what to change after @repo/single`, text kept
- [ ] a scratch repo with no test key → `Could not start the change in repo: no setup/test commands in its .pir/settings.json`
- [ ] with `single-asks`: the question shows, the person answers in the conversation, the builder goes on
- [ ] the reviewer starts while the builder's conversation is open → the view follows, headed `the builder finished; the reviewer has started`

## Done when

- [ ] the box starts a single run and lands in its conversation, proven in the rig at both sizes
- [ ] every text in DESIGN §2.1 is asserted verbatim
- [ ] `npm test` green
