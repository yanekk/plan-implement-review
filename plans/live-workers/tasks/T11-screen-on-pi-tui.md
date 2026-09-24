# T11 — screen-on-pi-tui

**Phase:** 3 · **Depends on:** T10 · **Weight:** heavy

## Goal

Move the `pir` screen's painting and key handling onto pi-tui with no visible change: the runs list and
the run live view must look and behave exactly as they do today. The pure frame builders and reducer stay;
only `createScreen`, the input loop and the repaint timer are replaced. This is what the conversation view
is later added to, and it is judged alone so a regression is never confused with a new feature.

## Design sections this implements

DESIGN §2.11 (first bullet), §2.14 (restore on throw).

## Files

- `src/shell/pir-tui.mjs` (`createScreen`, `runTui`, `decodeKey` if pi-tui's key parsing replaces it)
- `src/shell/pir-tui.test.mjs`
- `src/shell/pir-view.mjs` (new, if it keeps pir-tui.mjs readable): a pi-tui component that paints
  styled-span lines with render.mjs's exact style→SGR map

## Interface

```js
// A pi-tui component wrapping today's frame builders.
class FrameView { constructor(getLines /* () => [[span…]…] */) ; render(width) → string[] ; invalidate() }
runTui({ …same options as today }) → Promise<void>   // same contract; pi-tui underneath
```

## Tests

- [ ] `FrameView.render` turns a span line into the same SGR sequence render.mjs's map produces
- [ ] lines are clipped to width, never wrapped, as today (wide characters counted correctly)
- [ ] every key today's `decodeKey` maps still yields the same reducer event
- [ ] a throw inside painting restores raw mode and leaves the alt screen before rethrowing (keep the existing test)
- [ ] frame builder tests and reducer tests pass unchanged

## Done when

- [ ] `npm test` green; `buildListFrame`/`buildWatchFrame`/`dashboardReducer` untouched or changed only in signature
- [ ] the person has compared old and new side by side and recorded the verdict in FINDINGS
- [ ] no hand-written cursor-control escape remains in pir-tui.mjs outside the style map

## Needs a person

The worker installs the old build (current main) under one name and the new under another, or gives two
commands from two checkouts, against the same running or finished runs, so they can be opened one after
the other.

```
node <old checkout>/src/shell/pir.mjs      # today's screen
node <new checkout>/src/shell/pir.mjs      # pi-tui screen
```

Expect: identical rows, colours, selection bar, footer and keys (↑↓, Enter/→, Esc, Ctrl+S ×2, Ctrl+X ×2),
no flicker, the terminal normal after quitting.
Tell me: any difference you can see or feel, however small.
