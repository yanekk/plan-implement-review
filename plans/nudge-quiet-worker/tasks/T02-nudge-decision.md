# T02 — nudge-decision

**Phase:** 1 · **Depends on:** T00 · **Weight:** light

## Goal

The pure decision "nudge now, mark stuck, or do nothing" for one worker, and the one fixed message
text. Both are in `src/core/` so every threshold and the exact wording are proven in the ordinary test
run, and so the text has exactly one source.

## Design sections this implements

DESIGN §2.3, §2.4 (eligibility is decided by the caller and passed in), §2.5, §3.3.

## Files

- `src/core/nudge.mjs` (new)
- `src/core/nudge.test.mjs` (new)

## Interface

```js
export const DEFAULT_NUDGE_MS = 15 * 60 * 1000;
export const MAX_NUDGES = 2;

decideNudge({ now, eligible, lastActivityAt, lastNudgeAt /* null */, nudges, stuck, quietMs, maxNudges })
  → { action: 'none' } | { action: 'nudge', n } | { action: 'stuck' }
// quietSince = max(lastActivityAt, lastNudgeAt ?? -Infinity)
// !eligible or stuck                          → none
// now - quietSince <  quietMs                 → none
// now - quietSince >= quietMs, nudges < max   → nudge, n = nudges + 1
// now - quietSince >= quietMs, nudges >= max  → stuck

nudgeMessage({ n, max, quietMs }) → string   // DESIGN §2.5, one line, "[pir:nudge n/max] …"
// minutes = Math.round(quietMs / 60000); "about 1 minute" singular when it rounds to 1
```

## Tests

- [ ] Not eligible → none, whatever the times.
- [ ] Already stuck → none (stuck is logged once, by the caller, on the transition).
- [ ] One millisecond under the quiet period → none; exactly at it → nudge 1.
- [ ] After nudge 1, the clock runs from `lastNudgeAt`: under → none, at → nudge 2.
- [ ] After nudge 2 and another quiet period → stuck.
- [ ] Activity after a nudge (`lastActivityAt > lastNudgeAt`) pushes the next decision out.
- [ ] `nudges` reset to 0 by the caller → the next quiet period gives nudge 1 again.
- [ ] `nudgeMessage({n:1,max:2,quietMs:900000})` equals the DESIGN §2.5 text exactly (joined into one
      line); it contains no newline.
- [ ] The minutes figure follows `quietMs` (2 min for 120000).
- [ ] The text includes the waiting-on-the-person sentence and "Do not reply".

## Done when

- [ ] `decideNudge` and `nudgeMessage` exist with the shapes above, and every listed test passes.
- [ ] The message test pins the full string, so any wording change is a visible diff.
- [ ] `boundary.test.mjs` is green.
