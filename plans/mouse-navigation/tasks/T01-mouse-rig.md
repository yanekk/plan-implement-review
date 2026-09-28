# T01 — mouse-rig

**Phase:** 1 · **Depends on:** — · **Weight:** light

## Goal

The pty rig that drives the real `pir.mjs` cannot yet send a mouse event or see whether mouse reporting
is on: its screen model drops private-mode sequences and every SGR attribute. This task extends the
existing rig so the later tasks can drive clicks, pointer moves and the wheel end to end and assert that
mouse modes are switched on while `pir` runs and off after it exits, and which cells are bold (hover).

## Design sections this implements

DESIGN §4 (end to end), §5 (end-to-end tooling).

## Files

- `src/shell/conversation-rig.mjs` — `createScreenModel`, `openScreen`, new exported byte helpers
- `src/shell/conversation-rig.test.mjs`

## Interface

```
// SGR (1006) mouse bytes, 1-based col/row as the terminal sends them.
mouseBytes.press(col, row, { button = 'left' } = {})   → '\x1b[<0;{col};{row}M'   (right 2, middle 1)
mouseBytes.release(col, row, { button = 'left' } = {}) → '\x1b[<0;{col};{row}m'
mouseBytes.click(col, row)                             → press + release
mouseBytes.move(col, row)                              → '\x1b[<35;{col};{row}M'
mouseBytes.drag(col, row)                              → '\x1b[<32;{col};{row}M'
mouseBytes.wheel(col, row, 'up' | 'down')              → '\x1b[<64;…M' / '\x1b[<65;…M'

createScreenModel(...) gains:
  modes() → Set<number>   // private modes currently set: ?Nh adds N, ?Nl removes it (1000, 1002, 1003, 1006, …)
  boldAt(row, col) → boolean  // SGR 1 sets bold, 22 and 0 clear it; 38/48 colour params are skipped, not misread as 1
openScreen(...) gains modes() and boldAt(row, col), delegating to the model.
```

## Tests

- [ ] each `mouseBytes` helper emits the exact sequence above, including right and middle buttons
- [ ] `?1000h?1003h` sets both modes; `?1003l` removes one; a combined `\x1b[?1000;1006h` sets both
- [ ] a mode sequence split across two writes is still read (the model's `pending` path)
- [ ] `boldAt` true inside `\x1b[1m…\x1b[0m`, false after `\x1b[22m`, and not set by `\x1b[38;2;1;2;3m`
- [ ] every existing rig test passes unchanged (the model's text output is unaffected)

## Done when

- [ ] The helpers and the two model queries exist, are exported, and have the tests above.
- [ ] `openScreen` on today's `pir` reports no mouse mode (1000, 1002, 1003, 1004, 1006) in `modes()` while 1049
      (the alternate screen) is present, proving the reading; `modes()` is never empty while pi-tui runs.
- [ ] `npm test` is green.
