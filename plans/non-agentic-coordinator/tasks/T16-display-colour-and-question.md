# T16 — display-colour-and-question

**Phase:** 4 · **Runs:** auto · **Depends on:** T15 · **Weight:** small

## Goal

Colour the live coordinator display by status, and make the parked "asking you" pointer stand out, so
a person watching the board reads its state at a glance and never misses a worker waiting on them.
Decided with the PM (2026-09-20) after T09's by-eye pass: **full status colours** and a **stand-out
pointer with no question text**.

The colours (layered on the glyphs the renderer already draws — colour is never the only signal):

- **done / merged** → green
- **asking you** (parked worker) → amber (yellow), **bold** — the standout; the row and its footer line
- **building / reviewing / merging** (active) → cyan
- **waiting / queued** (idle) → dim grey
- **failure / interrupted** (the red and Ctrl-C states) → red
- the summary header stays neutral except when the run is **finished** (green) or **interrupted** (red)

The parked worker's **question text is still not drawn in the live frame** (§2.2, T15): the compact
one-line pointer is coloured and bolded so it cannot be missed, but the full question stays where the
person reads and answers it — the worker's own session (`claude agents`). This is the PM's decision, and
it is what keeps the bounded region safe from the wrap/streaming bug T15 fixed.

## Approach — colour is a paint-time layer, TTY-only, off when unwanted

Colour is the renderer's, exactly like the cursor control (DESIGN §2.3, the pure-model / thin-renderer
split). It must obey three rules already load-bearing in this file:

- **`formatLines` stays escape-free.** A test asserts the content block carries no escapes; those are
  added by `paint` on a TTY only. So the SGR colour codes are applied in `paint`, never inside the
  content the model/formatter produces. Refactor so `formatLines` and the paint path share one
  line-ordering source (e.g. a `styledLines` helper returning `{ text, style }`, with `formatLines` =
  its texts) — the styles must line up with the lines with no chance of drift.
- **Colour never reaches a non-TTY stream.** The harness and any pipe read coordinator stdout as text
  and depend on zero escapes (DESIGN §2.3). Gate colour on `isTTY` **and** honour `NO_COLOR` (any value
  in the environment disables it). Injectable for tests: `createRenderer({ stream, colour })`, where
  `colour` defaults to `isTTY && !('NO_COLOR' in process.env)` and a non-TTY stream is never coloured
  even if `colour: true` is passed.
- **Clip before colour.** Every line is still clipped to `columns` on its visible text; the SGR codes
  wrap the already-clipped text and do not count toward the width. The row budget and the constant frame
  height (T15) are unchanged.

No runtime dependency (the project ships zero); the SGR codes are plain string constants like the
cursor escapes already in `render.mjs`.

## Design sections

DESIGN §2.3 (the live display; the pure-model / thin-renderer split; TTY vs non-TTY). This is renderer
work only — the model (`src/core/display.mjs`) already carries the `kind` per row and per footer that the
colour maps onto; it does not change.

## Files

- `src/shell/render.mjs` — add the SGR colour constants and a style-per-line layer; apply colour in
  `paint` after clipping, TTY-only and `NO_COLOR`-aware; `createRenderer` gains an injectable `colour`
  option. Keep `formatLines` escape-free.
- `src/shell/render.test.mjs` — the tests below.

## Testability (provable without a real TTY)

Using the existing fake stream (`isTTY`, `columns`, `rows`, records writes):

- with colour on (TTY), an **active** row carries the cyan code, a **done** row green, an **idle**
  (waiting/queued) row dim, and the **asking** row and its footer line carry the amber **bold** code;
- the summary header is green when the run is finished and red when interrupted, neutral otherwise;
- with `colour: false` (or `NO_COLOR` set), a TTY paint contains the cursor-control escapes but **no SGR
  colour escape** (`\x1b[...m`);
- a non-TTY stream gets **no** SGR escape even when `colour: true` is passed;
- clipping still holds with colour on: the **visible** text of every drawn line (escapes stripped) is
  ≤ `columns`, and the frame height is constant paint to paint (the T15 regression, re-asserted);
- `formatLines` still carries no escapes of its own;
- the parked footer is still one compact line and the full question is still absent from the frame.

## Acceptance criteria — done when

- [ ] The live display is coloured by status per the map above, with the amber bold parked pointer
      standing out, proven by the fake-stream tests. (By-eye confirmation of the actual colours on a real
      terminal is the person's — hand it over in the report.)
- [ ] Colour is applied only on a TTY and is disabled by `NO_COLOR`; no SGR escape ever reaches a
      non-TTY stream. Green in `npm test`.
- [ ] The full question is still not drawn in the live frame; the parked pointer stays one compact line.
- [ ] No runtime dependency added; `formatLines` stays escape-free; T15's clip/row-budget/constant-height
      behaviour is unchanged.
