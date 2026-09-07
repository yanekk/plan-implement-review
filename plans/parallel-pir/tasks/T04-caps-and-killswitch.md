# T04 — Caps, hop depth, the halted check

**Phase:** 1 · **Depends on:** T01 · **Weight:** light

## Goal

The safety rails as pure decisions: is this agent over its message rate, has this handoff chain
run too deep, and is the kill switch thrown. Each returns allow-or-deny and a reason string for
the log, because a cap that fires silently is a runaway nobody can see. Time and the presence of
the control flag arrive as arguments, so the whole thing is proven in the test run.

## Design sections this implements

DESIGN §2.4 (the caps and their numbers), §2.5 (halted behaviour), §3.2 (`caps.mjs`), §3.3
(halted is an input to dispatch).

## Files

- `src/core/caps.mjs` — `checkRate`, `checkHop`, `isHalted`, and the default limits.
- `src/core/caps.test.mjs`.

## Interface

```
LIMITS = { ratePerMin: 5, hopMax: 6, maxWorkers: 4 }   // tunable constants, DESIGN §2.4

checkRate({ agentTimestamps, now, ratePerMin }) → { allow: boolean, reason: string }
  // agentTimestamps: ms timestamps of that agent's recent sends. now: ms, passed in.
  // deny when count within the last 60_000ms ≥ ratePerMin.

checkHop({ hop, hopMax }) → { allow: boolean, reason: string }
  // deny when hop ≥ hopMax (the chain dies after hopMax hops).

isHalted({ haltFlagPresent }) → boolean
  // pure: the shell reads the flag file; this decides on its presence.

reason strings name the cap and the agent, e.g. "rate: agent w3 sent 5 in 60s (limit 5)".
```

`now` is always a parameter, never `Date.now()` — that is the boundary rule, and the boundary
test enforces it.

## Tests

- [ ] Rate allows the 5th send in a minute and denies the 6th; timestamps older than 60s drop out.
- [ ] The rate window is measured against the passed `now`, not the wall clock.
- [ ] Hop allows hop 5 and denies hop 6 with hopMax 6.
- [ ] `isHalted` is true only when the flag is present.
- [ ] Every deny carries a non-empty reason naming the cap and the agent.

## Done when

- [ ] The three checks decide correctly at their boundaries and every deny has a log reason.
- [ ] No clock or filesystem is read in `caps.mjs`; the boundary test passes.
- [ ] `npm test` is green.
