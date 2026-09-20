# T15 — display-in-place-render

**Phase:** 4 · **Runs:** auto · **Depends on:** T03 · **Weight:** medium

## Goal

Make the live coordinator display repaint reliably **in place**, and prove it with automated tests.
Today it does not: on a real terminal the frames stream down the screen instead of overwriting
(FINDINGS 2026-09-20, by-eye). Root cause: `render.mjs:119` moves the cursor up by the *logical* line
count (`lines.length`) and clears, but any line that **wraps** occupies more terminal rows than logical
lines — and the summary/status line already wraps on a normal-width terminal, so the clear lands
mid-frame and every tick leaves a copy behind. It is broken from the first paint, not only when a worker
parks. The display is unusable as shipped.

## Approach — dependency-free, and it must not count wrapped rows

The project has **zero runtime dependencies** and an install-free test suite (`package.json`: "pure
core, thin shell"). **Do not add a TUI library** unless the PM directs it (see the open call at the
bottom). Fix it by having the renderer own a bounded region rather than reasoning about wrap heights:

- **On a TTY:** enter the alternate screen buffer on start (`\x1b[?1049h`) and hide the cursor; each
  frame, home the cursor (`\x1b[H`) and clear (`\x1b[2J` or clear-to-end), then draw the frame **clipped
  to the terminal size** — every line truncated to `stream.columns`, total rows capped at `stream.rows`
  — so nothing wraps or scrolls and the frame height is always known. On teardown, show the cursor,
  leave the alternate screen (`\x1b[?1049l`), and print the one-off hand-off summary to the normal
  screen.
- **Parked worker shows as a COMPACT row** (e.g. `T01 · asking you — attach in claude agents to
  answer`), never the worker's full multi-paragraph question — the person reads and answers that in the
  worker's own session (§2.2). This is what keeps the frame bounded, and it is why the streaming was
  worst while a worker was parked.
- **Keep the non-TTY path** plain-append with no escape sequences: the harness reads the coordinator's
  stdout as text (DESIGN §2.3), so the alt-screen/clip path is TTY-only.
- **Do not interleave raw `console.log` with the live frame** — it desyncs any in-place scheme. Route the
  run-critical notes (the `HALT`/ABORT path, the control dir, the ceiling) into the frame (a header or
  footer) or print them once *before* entering the alt screen.

## Design sections

DESIGN §2.3 (the live display; TTY in-place vs non-TTY plain text for the harness) and the pure-model /
thin-renderer split from T03 (the display model stays pure; this is the renderer).

## Files

- `src/shell/render.mjs` — the renderer rewrite: alt-screen enter/leave, per-frame home+clear,
  width/height clipping, and a `close()`/teardown method. Keep the injected `{ stream }` seam.
- `src/core/display.mjs` / `formatLines` — a compact parked-row form; expose or clip so no line exceeds
  the width.
- `src/shell/coordinate.mjs` — call the renderer teardown on every exit path including SIGINT (pair with
  the existing Ctrl-C teardown), so the alt screen is always left; move the startup notes so they do not
  fight the live frame.
- `src/shell/render.test.mjs` (new) — the tests below.

## Testability (the crux — provable without a real TTY)

Inject a fake stream that captures writes and reports `isTTY=true`, `columns`, `rows`. Assert:

- the first paint enters the alt screen and hides the cursor;
- each paint homes the cursor and clears before drawing;
- **no** written content line exceeds `columns`, and total drawn rows ≤ `rows` (clipping holds);
- a second paint fully replaces the first — the bytes between two `home` sequences are exactly one
  frame, with no accumulation across paints;
- teardown leaves the alt screen and shows the cursor;
- **regression for the reported bug:** with `columns` narrow enough that the summary line would wrap, the
  frame still clips to the row budget and its height is constant across paints;
- non-TTY: plain lines only, zero escape sequences.

## Acceptance criteria — done when

- [ ] The live display repaints in place on a real terminal with no streaming — including when the
      summary line would otherwise wrap and when a worker is parked. (By-eye re-check by the person; this
      is what T09's display item needs.)
- [ ] The renderer's in-place behaviour is covered by the fake-stream tests above (alt-screen, clip,
      no-accumulation, teardown, non-TTY, the wrap regression), all green in `npm test`.
- [ ] No runtime dependency was added (unless the PM chose a TUI library).
- [ ] The alt screen is always left on exit, including Ctrl-C.

## Open call for the PM

The recommendation above is dependency-free, to preserve the project's install-free property. If the PM
would rather adopt a TUI library (e.g. a small terminal-UI package) despite it being the first runtime
dependency, that is a reversible choice they can make — the acceptance (reliable in-place repaint, proven
by tests) is the same either way.
