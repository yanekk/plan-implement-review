# T04 — list-view-box

**Phase:** 2 · **Depends on:** T02 · **Weight:** medium

## Goal

Turn the runs list into a mounted pi-tui component that draws the list (unchanged rows, now windowed to
keep the selection visible) above the box, its head line, the note and the hint. This is the whole
surface; T05 connects it to `runTui` and to starting a run.

## Design sections this implements

DESIGN §2.1, §2.2, §2.4 (pop-up), §2.6, §2.7, §3.2; the prototype for the look.

## Files

- `src/shell/list-view.mjs` (new), `src/shell/list-view.test.mjs` (new)
- `src/shell/pir-tui.mjs`: `buildListFrame` gains `{ rows }` windowing and returns the footer separately
  or takes an option to omit it; the empty-list line text (§2.7). `pir-tui.test.mjs` for those.
- optionally a shared editor-theme helper used by `brief-box.mjs` and `list-view.mjs` (DESIGN §6)

## Interface

```js
// buildListFrame(dashboard, ui, { columns, rows }) — rows: the line budget for the list block; absent = today's
// unwindowed frame, so the non-TTY path and existing tests are unchanged.
export function createListView({ tui, colour, repos, roots, dashboard, ui, onSubmit, onListKey, onQuit }) → Component & {
  update({ dashboard, ui, note }),   // runTui calls on every refresh and keypress
  text,                              // current box text
  reset(),                           // text back to '@', note cleared
}
//   repos(): the scanned repo list, called when the box leaves bare (§2.4) and cached until bare again
//   onSubmit(text)       — routeBoxKey said 'submit'; T05 parses and starts
//   onListKey(data)      — routeBoxKey said 'list'; T05 runs today's decodeKey/reducer path with it
//   onQuit()             — 'quit'
// render(width): list lines windowed to terminal rows minus box, head, note and hint; box via Editor.render
```

The autocomplete provider has `triggerCharacters: ['@']`, suggests only while the cursor is in the first
token and that token starts with `@`, and applies `@name `.

## Tests

- [ ] Bare: render ends with head `start with @repo`, the box showing `@`, and the list footer as today.
- [ ] Typed `@sk` with `skaut` listed: `isShowingAutocomplete()` after the provider settles; Tab gives `@skaut `.
- [ ] A 200-character brief at 80 columns wraps to three box lines and every line fits 80.
- [ ] 30 runs at 80×12: the selected row is visible at top, middle and bottom selections; `↑ n more`/`↓ n more` counts are right.
- [ ] `update` with an armed chord shows the armed footer line on a bare box.
- [ ] `repos()` is called once per typed stretch, again after `reset()`.
- [ ] Esc on a typed box calls neither `onQuit` nor `onListKey`, and the text is `@`.

## Done when

- [ ] The component renders the §2.6 lines at 80 and 120 columns, all within the width.
- [ ] `buildListFrame` without `rows` is byte-identical to before (existing tests unchanged).
- [ ] `npm test` green.

## End to end (the worker drives this)

The component is driven through a pty in T05 once `runTui` mounts it; here it is tested with pi-tui's
stub host, as `brief-box.test.mjs` does.
