# T04 — interrupt-gate

**Phase:** 2 · **Depends on:** T01 · **Weight:** light

## Goal

The pure rules behind the Esc warning and the note: when the warning arms, what each key does while it
is armed, which helpers an interrupt stopped and has not yet been reported, and the exact text of the
warning and the note. T05 wires them into the screen and the message path.

## Design sections this implements

DESIGN §2.5, §2.6, §2.8.

## Files

- `src/core/helpers.mjs`: the functions below.
- `src/core/helpers.test.mjs`.

## Interface

```js
// interruptGate(gate, key, running) → { gate, send }
//   gate:    null | { armed: true, helpers: Helper[] }   (the view holds it)
//   key:     'escape' | 'ctrl+c-empty' | 'other'
//   running: runningHelpers(entries) at the moment of the key
//   - gate null, interrupt key, running empty      → { gate: null, send: true }
//   - gate null, interrupt key, running non-empty  → { gate: { armed: true, helpers: running }, send: false }
//   - gate armed, interrupt key                    → { gate: null, send: true }   (even if running is now empty)
//   - gate armed, 'other'                          → { gate: null, send: false }  (the view then handles the key as usual)
//   - gate null, 'other'                           → { gate: null, send: false }
export function interruptGate(gate, key, running) {}

// gateWarning(gate) → string, DESIGN §2.5:
//   'esc again to interrupt · this also stops 1 helper: Survey the code'
//   'esc again to interrupt · this also stops 2 helpers: Survey the code; Check the tests'
export function gateWarning(gate) {}

// stoppedByInterrupt(entries) → Helper[] ended 'stopped' by an interrupt (end index after an `out
// interrupt` and before that turn's `result`) and not listed in the `helpersStopped` of any later
// `out message` entry. Start order. A helper stopped by a `resumed` note is not included.
export function stoppedByInterrupt(entries) {}

// helpersNote(helpers) → null when empty, else DESIGN §2.6's text:
//   '[pir] Before this message, the person\'s interrupt stopped your helpers: "A", "B". They will not
//    report back. Start them again or do the work yourself if it is still needed.'
//   (one helper: 'stopped your helper: "A". It will not report back. Start it again …')
export function helpersNote(helpers) {}
```

## Tests

- [ ] Every row of the `interruptGate` table, including armed + interrupt key with `running` now empty.
- [ ] `gateWarning` singular and plural, description order kept.
- [ ] `stoppedByInterrupt` on `helper-sample.ndjson`: the one helper after the interrupt's `result`;
      empty once a later `out message` lists its id in `helpersStopped`.
- [ ] A helper that ended `completed` after an interrupt, or `stopped` with no interrupt before it
      (the agent stopped it itself): not included.
- [ ] Two interrupts, one helper stopped by each, no message between: both, in start order.
- [ ] `resumed` note: a helper it ended is not included.
- [ ] `helpersNote` singular, plural, empty → null; a description with a double quote is kept readable.

## Done when

- [ ] All five functions exist with the shapes above and every test passes in `npm test`.
- [ ] `boundary.test.mjs` still passes.
