# T03 — notify-icon

**Phase:** 1 · **Depends on:** — · **Weight:** light

## Goal

The picture every alert carries, so the person recognises pir's alerts on the lock screen. A worker draws
it in code (user 2026-09-28), so a redo is a reviewed change, and the file sits where the default icon
URL points once it reaches GitHub.

## Design sections this implements

DESIGN §2.5.

## Files

- `src/shell/notify-icon.mjs` (new): the encoder and the drawing; run directly, it writes
  `assets/pir-notify-icon.png`. In `src/` so the test glob (`src/**/*.test.mjs`) reaches its test.
- `src/shell/notify-icon.test.mjs` (new).
- `assets/pir-notify-icon.png` (new), committed.

## Interface

```
encodePng({ width, height, rgba: Uint8Array }) → Buffer   // signature, IHDR (8-bit RGBA), one zlib IDAT, IEND, CRC32
drawIcon(size = 256) → { width, height, rgba }            // the letters 'pir' on a solid colour, a 5×7-style
                                                          // block font scaled up, centred; no anti-aliasing needed
node src/shell/notify-icon.mjs                            // writes assets/pir-notify-icon.png
```

No new dependency: `node:zlib` `deflateSync` and a hand-written CRC32.

## Tests

- [ ] `encodePng` output starts with the PNG signature, its IHDR reads the given size and colour type 6,
      and `inflateSync` of the IDAT gives back the rows with filter byte 0.
- [ ] `drawIcon` is deterministic, square, and has both colours present (the letters are drawn).
- [ ] The committed PNG equals a fresh `encodePng(drawIcon())`, so the file and the script cannot drift.
- [ ] The committed PNG is under 20 KB.

## End to end

The worker opens the PNG (`open assets/pir-notify-icon.png` or reads it with its image-reading tool) and
checks that `pir` is legible at full size and at 64×64. On the phone it is the person's to judge, in T08.

## Done when

- [ ] Tests pass under `npm test`; the PNG is committed.
- [ ] Nothing else in `src/` changed.
