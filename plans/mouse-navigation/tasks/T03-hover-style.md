# T03 — hover-style

**Phase:** 1 · **Depends on:** — · **Weight:** light

## Goal

The row under the pointer paints slightly brighter, distinct from the selected row's grey band, as the
user approved in the spike. This task adds that paint to the one place spans become terminal strings, so
the screen tasks only have to say which line is hovered.

## Design sections this implements

DESIGN §2.2, §3.4.

## Files

- `src/shell/pir-view.mjs` — `paintLine`, `FrameView`
- `src/shell/palette.mjs` — the lifted-dim hover colour, both tables
- `src/shell/pir-tui.test.mjs` (where `paintLine` and `FrameView` are tested today)
- `src/shell/palette.test.mjs` — the hover colour in both tables. The test command sets `NO_COLOR=1`, so
  `pir-view.mjs`'s module-level `SGR` is the basic table under test; the 24-bit case is reachable only by
  giving the paint a palette explicitly or testing the palette's own tables.

## Interface

```
paintLine(spans, width, colour = true, { hovered = false } = {}) → string
  hovered && colour && first span is not 'selected':
    every span painted bold; a span whose style paints dim ('dim', 'ended', 'idle', 'hint', 'bar-idle')
    painted in the hover-lift colour instead (Mocha subtext1 #bac2de on 24-bit, plain bold on the basic table)
  hovered && selected → exactly the selected band, as without hover
  colour off → identical to unhovered

new FrameView(getLines, { colour, getHoverY = () => null })
  render: line y === getHoverY() && frame[y].hit → painted hovered; any other line as before
```

## Tests

- [ ] a hovered plain line gains bold; its text and clipping are unchanged
- [ ] a hovered dim span uses the lift colour on the 24-bit table and bold without dim on the basic table
- [ ] hovered + selected equals unhovered selected, byte for byte
- [ ] colour off: hovered equals unhovered
- [ ] FrameView paints only the hovered line, and only when that line has a `hit`; getHoverY null paints as before

## Done when

- [ ] `paintLine` and `FrameView` take the hover as above, and every existing paint test is unchanged.
- [ ] The tests above pass.
- [ ] `npm test` is green.
