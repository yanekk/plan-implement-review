# T02 — index-record

**Phase:** 1 · **Depends on:** — · **Weight:** light

## Goal

The shape of one run's entry in the cross-repo index, and the pure parse and serialize for it. An
entry is a pointer plus enough to classify the run without opening its repo. This task owns only
the format and its validation; where the files live and how they are written is the store (T06).
A malformed entry must parse to nothing rather than throw, so one corrupt pointer cannot blind the
dashboard to every other run.

## Design sections this implements

DESIGN §2.8 (the index) and §3.5 (storage — index entry).

## Files

- `src/core/runrecord.mjs` — new.
- `src/core/runrecord.test.mjs` — new.

## Interface

```
serializeRecord(record) → string            // canonical JSON text
parseRecord(text) → record | null           // null on malformed / missing required fields

record = {
  version: 1,
  slug, repo, repoPath, controlDir,          // strings; repoPath and controlDir absolute
  pid,                                        // number
  startTime,                                  // string, the ps lstart captured at launch
  startedAt,                                  // ISO 8601 string
  branch,                                     // e.g. "pir/{slug}"
  finalState,                                 // 'finished' | 'stopped' | null
  updatedAt                                   // ISO 8601 string
}
```

Required for a valid parse: `version`, `slug`, `repo`, `repoPath`, `controlDir`, `pid`,
`startTime`, `branch`. `finalState` defaults to `null`, `startedAt`/`updatedAt` may be absent.
Reason `pid` and `startTime` are both required: the classify decision (T01) needs both to tell a
live run from a reused number.

## Tests

- [ ] round-trip: `parseRecord(serializeRecord(r))` deep-equals `r` (with defaults filled).
- [ ] missing a required field → `null`.
- [ ] non-JSON text → `null` (no throw).
- [ ] JSON of the wrong type (an array, a number) → `null`.
- [ ] a wrong/absent `version` → `null` (so an old format is ignored, not misread).
- [ ] `finalState` absent parses to `null`; a value outside the allowed set → `null` record.
- [ ] extra unknown fields are ignored, not rejected.

## Done when

- [ ] `parseRecord` never throws on any string input.
- [ ] The format carries `pid` and `startTime` so a reader can classify without opening the repo.
- [ ] `npm test` passes, boundary test still green.
