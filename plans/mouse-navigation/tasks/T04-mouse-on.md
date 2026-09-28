# T04 — mouse-on

**Phase:** 2 · **Depends on:** T01 · **Weight:** medium

## Goal

Switch mouse reporting on in the `pir` screen and make it safe: pointer moves reported inside tmux too,
drag-to-copy reaching the macOS clipboard, and every exit path turning mouse reporting off so the
person's shell is never left printing escape codes. It also gives the screen's root a `handleMouse` that
forwards to the mounted component or to a hook `runTui` will fill (T05), so no pir handler yet takes a
press and pi-tui's text selection works everywhere from this task on.

## Design sections this implements

DESIGN §2.2 (multiplexer hover), §2.5, §2.7, §3.2.

## Files

- `src/shell/pir-tui.mjs` — `createScreen`, `runTui` (passing `onMouse` through `listen`)
- `src/shell/pir-tui.test.mjs`, a pty case in `src/shell/conversation-rig.test.mjs` or `plan-rig.test.mjs`

## Interface

```
createScreen({ stream, colour, terminal, copy = defaultCopy, env = process.env, onExit = process })
  → TuiAltScreen(terminal, false, undefined, { mouse: true, wheelScrollLines: 3, copySelection: copy })
    (on a non-darwin platform copySelection is omitted, keeping pi-tui's OSC 52)
  after tui.start(): under TMUX / STY / ZELLIJ / TERM tmux* or screen*, write '\x1b[?1003h'
  guarded.handleMouse(ev) → mounted ? mounted.handleMouse?.(ev) : onMouse?.(ev)
  listen(onInput, onError, onMouse)   // third argument new; undefined keeps today's behaviour
  exit restore: on process 'exit', SIGTERM, SIGHUP, SIGINT, while the screen is started and not closed,
    write synchronously '\x1b[?1006l\x1b[?1004l\x1b[?1003l\x1b[?1002l\x1b[?1000l' plus leaving the
    alternate screen and showing the cursor; for a signal, then exit 128+signo. Handlers are removed on close().

defaultCopy(text) → Promise<true | string>   // execFile('pbcopy') with text on stdin; error message on failure
```

`copy`, `env` and `onExit` are injected so tests never touch the real clipboard, environment or process.

## Tests

- [ ] fake terminal: start writes `?1003h` among the enabled modes; with `env.TMUX` set, a `?1003h` follows pi-tui's button-motion enable
- [ ] fake terminal: a drag across two lines then release calls the injected `copy` with that text
- [ ] fake terminal: a press + release in place with no handler registered produces no copy and no throw
- [ ] `guarded.handleMouse` forwards to the mounted component when one is mounted, to `onMouse` otherwise, and returns their result
- [ ] a handler returning undefined for press keeps selection working (drag still copies)
- [ ] exit restore: emitting 'exit' on an injected emitter writes the mouse-off sequence once; after close() it writes nothing
- [ ] pty: running `pir` reports modes 1000, 1003, 1006 on; after Esc they are all off
- [ ] pty: SIGTERM to `pir` leaves every mode off in the screen model

## Done when

- [ ] `pir` runs with mouse reporting on, hover-capable under a multiplexer, copying via the injected copy.
- [ ] Quit, error and SIGTERM/SIGHUP/SIGINT all leave the terminal with mouse reporting off (pty-proven for Esc and SIGTERM).
- [ ] `npm test` is green and no key test changed.

## End to end (the worker drives this)

- suite: `conversation-rig.test.mjs` / `plan-rig.test.mjs` via T01's `modes()` · sizes: 80×24
- [ ] start `pir`, read `modes()` → 1000, 1003, 1006 present
- [ ] Esc → process exits, `modes()` empty
- [ ] start again, SIGTERM → `modes()` empty
