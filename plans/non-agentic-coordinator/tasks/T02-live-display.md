# T02 — Replace the agent bridge with the live status display

**Phase:** 1 · **Runs:** auto · **Depends on:** T01 · **Weight:** heavy

## Goal

Turn the foreground command's output into the `docker compose up`-style live display confirmed with
the person (`prototype/cli-display.html`), and remove the message bridge that made the coordinator
agentic. The person talks to blocked workers directly, so the down-channel and its relay go; the
worker's up-signal stays, used only to keep a parked worker's slot and to show its question in the
display. The display is split across the boundary: a pure model that turns run state into rows, a
summary and a footer, and a thin terminal renderer that paints the model in place on a TTY and falls
back to plain lines when output is not a terminal.

## Design sections this implements

DESIGN §2.2 (no down-channel; the up-signal stays as log-only) and §2.3 (the live display, its pure
model and its renderer, and the non-TTY fallback).

## Files

- `src/core/display.mjs` (new) + `display.test.mjs` (new) — the pure display model.
- `src/shell/render.mjs` (new) + `render.test.mjs` (new) — the terminal renderer.
- `src/shell/coordinate.mjs` (+ `coordinate.test.mjs`) — remove `createAgentBridge`, `answer`, the
  `outbox`/`answers`/`surfaced` handling and `send-failed`; `main()` builds run state, feeds the
  display model, and paints via the renderer.
- `src/shell/loop.mjs` (+ `loop.test.mjs`) — remove the down-routing; a `question`/`decision` report
  becomes log-only (record it, keep the worker's slot) with no answer routed.
- `src/shell/platform.mjs` (+ `platform.test.mjs`) — remove the down-channel `send`; keep `inbox()`
  (the `reports/` up-channel).

## Interface

```
// pure — src/core/display.mjs
buildDisplay(runState, { now, spinnerFrame }) → { summary, rows, footer }
  rows: [{ id, name, kind, label, elapsedMs|null }]
    kind ∈ 'waiting'|'queued'|'building'|'reviewing'|'merging'|'asking'|'done'
    label: e.g. 'building', 'reviewing', 'queued · ceiling full', 'needs T04', 'asking you', 'merged'
    elapsedMs: now − since for an active row, the final duration for a done row, null otherwise
  summary: { done, total, running, asking, waiting, ceiling, ceilingFull, finished }
  footer: { kind:'asking', task, question } | { kind:'handoff', branch }
        | { kind:'red', branch } | { kind:'running' } | { kind:'interrupted' }
  // pure: no I/O, no Date.now — `now` and `spinnerFrame` are arguments. Glyph characters are the
  // renderer's; the model carries `kind`.

// shell — src/shell/render.mjs
createRenderer({ stream = process.stdout }) → { paint(display), line(text) }
  // stream.isTTY: paint clears the previously-painted block (cursor up N + clear) and redraws in
  // place. Not a TTY (piped, redirected, harness-captured): append plain lines, no cursor escapes.
```

## Tests

- [ ] `buildDisplay` maps a run state with tasks in every `kind` to the right rows, labels and
      `elapsedMs` (computed from `now − since`).
- [ ] `summary.ceilingFull` is true exactly when running ≥ ceiling; `asking`/`waiting`/`done` counts
      are correct.
- [ ] `footer.kind` is `handoff` with the branch on a finished green run, `red` on a finished red
      run, `asking` (naming the task and its question) when a worker is parked, `running` otherwise.
- [ ] The display model passes the boundary import scan (`boundary.test.mjs`) — it is pure.
- [ ] `createRenderer` on a non-TTY stream emits plain lines and no ANSI cursor-control escapes.
- [ ] `createRenderer` on a stream with `isTTY=true` emits cursor-up/clear escapes and redraws one
      block rather than appending.
- [ ] No `createAgentBridge`, `outbox`, `answers`, `surfaced`, `send-failed`, or down-channel `send`
      remains (grep).
- [ ] A `question`/`decision` report keeps the worker's slot and is recorded, and no answer is routed
      (the loop makes no down-send).

## Done when

- [ ] The down-channel and the agent bridge are gone; the worker up-signal (`reports/`) still parks a
      worker and shows in the display.
- [ ] `main()` renders the live display via the pure model + renderer, matching the prototype's shape
      (rows, summary, ceiling, asking footer, hand-off); the model is pure and tested, the in-place
      painting is left for T08 to confirm by eye.
- [ ] `npm test` is green.
