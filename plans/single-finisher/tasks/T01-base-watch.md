# T01 — base-watch

**Phase:** 1 · **Depends on:** — · **Weight:** light

## Goal

The build's "has the base moved, or has the person merged?" decision lives inside `coordinate.mjs`'s
`watchBase` closure. Single runs need the same rule (DESIGN §2.9). Lift the decision into a pure core
module and have `coordinate.mjs` call it, with builds behaving exactly as before, so T05 uses the same
rule rather than a copy.

## Design sections this implements

DESIGN §2.9, §6 (reuse, not copy).

## Files

- `src/core/basewatch.mjs` (new), `src/core/basewatch.test.mjs` (new)
- `src/shell/coordinate.mjs` (`watchBase` only)

## Interface

```js
// The verdict of one look at the base while a run waits for its merge.
// containsTip: whether any watched ref (local base, remote-tracking base) holds the branch tip.
// localTip:    the local base's commit now; localSeen: the local tip recorded at the last sync.
// watched:     prepareBase's result if the remote was fetched this pass, else null.
// baseSha:     the commit the last sync merged.
export function baseWatchVerdict({ containsTip, localTip, localSeen, watched, baseSha }) // → 'merged' | 'moved' | null

// Whether the remote is due a fetch this pass. watchFrom null means never fetched: not due, start the clock.
export function watchDue({ now, watchFrom, watchMs }) // → { due: boolean, watchFrom: number }
```

`coordinate.mjs` `watchBase` keeps its I/O (`prepareRunBase('watch')`, `baseContains`, `baseTip`,
`handoff.lastWatch*`) and returns `baseWatchVerdict(...)`.

## Tests

- [ ] `containsTip` true → `merged`, whatever else moved.
- [ ] local tip differs from `localSeen` → `moved`.
- [ ] `watched.ok` with `sha !== baseSha` → `moved`; `watched.ok === false` (fetch failed) → not moved by the remote.
- [ ] nothing changed → `null`.
- [ ] `watchDue`: first call starts the clock and is not due; due at exactly `watchMs`; not due just before.
- [ ] `boundary.test.mjs` passes with the new module.
- [ ] Every existing coordinator, finisher and hand-over test passes unchanged (`coordinate*.test.mjs`, `finisher-handover.test.mjs`).

## Done when

- [ ] `src/core/basewatch.mjs` exists with the interface above and its tests.
- [ ] `coordinate.mjs` `watchBase` calls it; no other line of `coordinate.mjs` changes behaviour.
- [ ] `npm test` green.
