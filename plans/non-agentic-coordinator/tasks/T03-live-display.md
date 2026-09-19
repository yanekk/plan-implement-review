# T03 — live-display

**Phase:** 1 · **Runs:** auto · **Depends on:** T01, T02 · **Weight:** heavy

## Goal

Turn the foreground command's output into the `docker compose up`-style live display confirmed with
the person (`prototype/cli-display.html`), and remove the message bridge that made the coordinator
agentic. The person talks to blocked workers directly, so the down-channel and its relay go; the
worker's up-signal stays, used only to keep a parked worker's slot and to show its question in the
display. The display is split across the boundary: a pure model that turns run state into rows, a
summary and a footer, and a thin terminal renderer that paints the model in place on a TTY and falls
back to plain lines when output is not a terminal. Each row shows the task's number and slug (§2.9).

## Design sections this implements

DESIGN §2.2 (no down-channel; the up-signal stays as log-only), §2.3 (the live display, its pure
model and its renderer, the non-TTY fallback), and §2.9 (each row shows `T01 stop-promoting`).

## Files

- `src/core/display.mjs` (new) + `display.test.mjs` (new) — the pure display model.
- `src/shell/render.mjs` (new) + `render.test.mjs` (new) — the terminal renderer.
- `src/shell/coordinate.mjs` (+ `coordinate.test.mjs`) — remove `createAgentBridge`, `answer`, the
  `outbox`/`answers`/`surfaced` handling and `send-failed`; `main()` builds run state, feeds the
  display model, and paints via the renderer. Also drop the coordinator-session log lines (the
  `coordinatorName(...)` "launch the session under it" output) — the plain command has no session to
  launch. The `coordinatorName` symbol itself is deleted from `naming.mjs` in T05, once the harness
  stops calling it.
- `src/shell/loop.mjs` (+ `loop.test.mjs`) — remove the down-routing; a `question`/`decision` report
  becomes log-only (record it, keep the worker's slot) with no answer routed.
- `src/shell/platform.mjs` (+ `platform.test.mjs`) — remove the down-channel `send`; keep `inbox()`
  (the `reports/` up-channel).

## Interface

```
// pure — src/core/display.mjs
buildDisplay(runState, { now, spinnerFrame }) → { summary, rows, footer }
  rows: [{ id, slug, kind, label, elapsedMs|null }]   // id = 'T01', slug = 'stop-promoting'
    kind ∈ 'waiting'|'queued'|'building'|'reviewing'|'merging'|'asking'|'done'
    label: e.g. 'building', 'reviewing', 'queued · ceiling full', 'needs T04', 'asking you', 'merged'
    elapsedMs: now − since for an active row, the final duration for a done row, null otherwise
  summary: { done, total, running, asking, waiting, ceiling, ceilingFull, finished }
  footer: { kind:'asking', task, slug, question } | { kind:'handoff', branch }
        | { kind:'red', branch } | { kind:'running' } | { kind:'interrupted' }
  // pure: no I/O, no Date.now — `now` and `spinnerFrame` are arguments; glyph chars are the
  // renderer's, the model carries `kind`. The slug comes from the parsed PROGRESS Task cell (§2.9).

// shell — src/shell/render.mjs
createRenderer({ stream = process.stdout }) → { paint(display), line(text) }
  // stream.isTTY: paint clears the previously-painted block (cursor up N + clear) and redraws in
  // place. Not a TTY (piped, redirected, harness-captured): append plain lines, no cursor escapes.
```

## Tests

- [ ] `buildDisplay` maps a run state with tasks in every `kind` to the right rows (id + slug),
      labels and `elapsedMs` (computed from `now − since`).
- [ ] `summary.ceilingFull` is true exactly when running ≥ ceiling; `asking`/`waiting`/`done` counts
      are correct.
- [ ] `footer.kind` is `handoff` with the branch on a finished green run, `red` on a finished red
      run, `asking` (naming the task and its slug and question) when a worker is parked, `running`
      otherwise.
- [ ] The display model passes the boundary import scan (`boundary.test.mjs`) — it is pure.
- [ ] `createRenderer` on a non-TTY stream emits plain lines and no ANSI cursor-control escapes.
- [ ] `createRenderer` on a stream with `isTTY=true` emits cursor-up/clear escapes and redraws one
      block rather than appending.
- [ ] No `createAgentBridge`, `outbox`, `answers`, `surfaced`, `send-failed`, or down-channel `send`
      remains in the files this task owns (`coordinate.mjs`, `loop.mjs`, `platform.mjs`). The harness
      and fake-platform copies of this vocabulary are removed with the harness rework in T05, so scope
      the grep to these files, not all of `src/`.
- [ ] A `question`/`decision` report keeps the worker's slot and is recorded, and no answer is routed.

## Done when

- [ ] The down-channel and the agent bridge are gone; the worker up-signal (`reports/`) still parks a
      worker and shows in the display.
- [ ] `main()` renders the live display via the pure model + renderer, matching the prototype's shape
      (rows showing id + slug, summary, ceiling, asking footer, hand-off); the model is pure and
      tested, the in-place painting is left for T09 to confirm by eye.
- [ ] `npm test` is green.
