# T05 — why-yours

**Phase:** 1 · **Depends on:** — · **Weight:** light

## Goal

Record, per worker, why its waiting question is the person's: passed on by the agent, timed out, reserved,
the agent unavailable, or no agent in the run. The alert names this reason, and today the routing forgets
a passed item the moment it passes, so the record has to be kept where the routing is.

## Design sections this implements

DESIGN §2.1 (the reason table), §3.4.

## Files

- `src/shell/coordinate.mjs`: in `startCoordinator`, a `passed` map (itemKey → item) filled in `route()`'s
  pass loop and cleared by `release` and on agent death like the other maps; items first waiting while the
  agent is down or whose brief failed are remembered as `unavailable`; `whyPerson()` on the returned object.
- `src/shell/coordinate.test.mjs` (or the file that tests `route`).

## Interface

```
coordinator.whyPerson() → Map<workerId, 'passed'|'timeout'|'reserved'|'unavailable'|'off'>
  // one entry per worker that has at least one waiting item which is the person's, from its oldest such item:
  //   startAgent null                                   → 'off'
  //   agent null (failed to start) or not alive         → 'unavailable'
  //   key in timedOut (a late pass included)            → 'timeout'
  //   item.reserved, or key in reserved                 → 'reserved'
  //   key in passed                                     → 'passed'
  //   waiting, not held, never briefed                  → 'unavailable'
  // a worker with no item (waitingOn without itemsOf) is absent: its reason is null.
```

It only reads the maps; it changes nothing the row, the tally or Remote Control see.

## Tests

- [ ] One case per reason through `startCoordinator` with the fake platform and a fake agent: pass,
      reserved `permission` turned into a pass, hold-limit timeout, a late pass of a timed-out item stays
      `timeout`, reserved, agent dead, agent failed to start, first waiting while down, `startAgent` null.
- [ ] A held item is absent; an answered item leaves the map on the pass it closes.
- [ ] A worker with two person items reports the older one's reason.
- [ ] Existing coordinator routing tests unchanged and green.

## Done when

- [ ] Tests pass under `npm test`.
- [ ] `heldByAgent()` and `remoteWanted` behave exactly as before (their tests untouched).
