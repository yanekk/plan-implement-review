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

- `src/shell/pir-tui.mjs` (`createScreen`, `runTui`, `decodeKey` if pi-tui's key parsing replaces it). `runTui`
  is not exported; `openDashboard` and `openWatch` are the entry points `pir.mjs` uses, and they keep their options
- `src/shell/pir-tui.test.mjs`
- `src/shell/pir-view.mjs` (new, if it keeps pir-tui.mjs readable): a pi-tui component that paints
  styled-span lines with pir-tui.mjs's own `SGR` map (a superset of render.mjs's six keys; the list view's
  head, bar, selected, count, hint, armed and dim styles exist only there)

## Interface

```js
// A pi-tui component wrapping today's frame builders.
class FrameView { constructor(getLines /* () => [[span…]…] */) ; render(width) → string[] ; invalidate() }
openDashboard/openWatch({ …same options as today }) → Promise<void>   // same contract; pi-tui underneath
// pi-tui is created behind the existing `makeScreen` seam, so the restore-on-throw test keeps injecting one
```

## Tests

- [ ] `FrameView.render` turns a span line into the same SGR sequence render.mjs's map produces
- [ ] lines are clipped to width, never wrapped, as today (wide characters counted correctly)
- [ ] every key today's `decodeKey` maps still yields the same reducer event (CSI and SS3 arrows, CR and LF,
      lone Esc and Ctrl+C quit, Ctrl+S, Ctrl+X)
- [ ] a non-TTY output still gets plain text with no escapes; a frame taller than the terminal is cut at its rows
- [ ] a throw inside painting restores raw mode and leaves the alt screen before rethrowing (keep the existing test)
- [ ] frame builder tests and reducer tests pass unchanged

## Done when

- [ ] `npm test` green; `buildListFrame`/`buildWatchFrame`/`dashboardReducer` untouched or changed only in signature
- [ ] the person has compared old and new side by side and recorded the verdict in FINDINGS
- [ ] no hand-written cursor-control escape remains in pir-tui.mjs outside the style map

## Needs a person

The worker makes a second checkout of the commit before T11 (`git worktree add --detach <job tmp>/old <sha>`;
`install.sh` has one fixed launcher name, so the old screen runs from that checkout, not from an install) and
gives two commands against the same running or finished runs, so they can be opened one after the other.
The worker removes that checkout afterwards.

```
node <old checkout>/src/shell/pir.mjs      # today's screen
node <new checkout>/src/shell/pir.mjs      # pi-tui screen
```

Open runs in each state the screen draws: running, asking, merge conflict with its paste block, crashed with
its log tail, end-of-run tests running, red with its reason, green hand-off, and two runs of one slug from
two repos.

Expect: identical rows, colours, selection bar, footer and keys (↑↓, Enter/→, Esc, Ctrl+C, Ctrl+S ×2, Ctrl+X ×2),
no flicker, the terminal normal after quitting.
Tell me: any difference you can see or feel, however small.
