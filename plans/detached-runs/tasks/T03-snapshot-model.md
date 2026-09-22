# T03 — snapshot-model

**Phase:** 1 · **Depends on:** — · **Weight:** light

## Goal

The shape of the live status snapshot the coordinator writes each pass and the dashboard repaints,
and its pure parse and serialize. The snapshot carries the process facts plus the run state a pass
produced — the same run state the existing live display consumes — so the dashboard paints it with
`buildDisplay` and its own clock rather than inventing a second display. This task owns the format
and its validation only; the atomic file write and read are the store (T07).

## Design sections this implements

DESIGN §2.4 (the live view), §3.4 (data flow) and §3.5 (storage — status snapshot).

## Files

- `src/core/snapshot.mjs` — new.
- `src/core/snapshot.test.mjs` — new.

## Interface

```
serializeSnapshot(snap) → string
parseSnapshot(text) → snap | null            // null on malformed

snap = {
  version: 1,
  proc: { pid, startTime, slug, repo, branch, startedAt },
  finalState,                                 // 'finished' | 'stopped' | null
  runState                                    // exactly the object buildDisplay() consumes:
    // { branch, ceiling, complete?, readyToMerge?, interrupted?,
    //   tasks: [{ id, slug, deps, done, phase, since, doneMs, question, prompt }] }
}
```

`runState` matches the interface `src/core/display.mjs` documents, so
`buildDisplay(snap.runState, { now })` works directly. `since` is an absolute ms timestamp from the
coordinator's clock, and the reader computes the elapsed as `now - since` — the two run on the same
machine, so the clocks agree (DESIGN §2.4). Do not restate the display fields' meanings here;
`display.mjs` owns them.

## Tests

- [ ] round-trip: `parseSnapshot(serializeSnapshot(s))` deep-equals `s`.
- [ ] a parsed `runState` is accepted by `buildDisplay` without error (import it and call it).
- [ ] non-JSON, wrong top-level type, or wrong `version` → `null`.
- [ ] missing `proc` or `runState` → `null`.
- [ ] `finalState` absent → `null`; an out-of-set value → `null` snapshot.
- [ ] an empty `tasks` array is valid (a run that has not dispatched yet).

## Done when

- [ ] The snapshot carries a `runState` that `buildDisplay` consumes unchanged.
- [ ] `parseSnapshot` never throws on any string.
- [ ] `npm test` passes, boundary test still green.
