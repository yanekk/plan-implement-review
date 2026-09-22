# T07 — snapshot-store

**Phase:** 2 · **Depends on:** T03 · **Weight:** medium

## Goal

The filesystem side of the live snapshot: write `status.json` into a run's control folder without a
reader ever seeing a half-written file, and read it back. The coordinator writes it each pass (T10)
and the dashboard reads it (T12). This task owns only the atomic write and the read; the format is
T03's.

## Design sections this implements

DESIGN §2.4 (the live view), §3.5 (storage — status snapshot), §2.10 (crash mid-write).

## Files

- `src/shell/snapshot-store.mjs` — new.
- `src/shell/snapshot-store.test.mjs` — new.

## Interface

```
snapshotPath(controlDir) → string                        // {controlDir}/status.json
writeSnapshot(controlDir, snap, { fs } = {}) → void       // serialize (T03) + temp file + rename
readSnapshot(controlDir, { fs } = {}) → snap | null       // parse (T03); null if absent or malformed
```

- Write is temp-then-rename in the same directory as `status.json`, so a concurrent reader gets
  either the previous complete file or the new one, never a torn one (§2.10).
- `readSnapshot` returns `null` for an absent file (a run that has not written one yet) and for a
  malformed one (skip, do not throw) — the dashboard shows such a run without a live block rather
  than crashing.

## Tests

- [ ] `writeSnapshot` then `readSnapshot` round-trips a snapshot.
- [ ] `readSnapshot` of an absent file → `null`.
- [ ] `readSnapshot` of a malformed file → `null` (no throw).
- [ ] the write leaves no temp file behind on success.
- [ ] a second `writeSnapshot` replaces the first in place (single live snapshot per run).
- [ ] the file lands at `snapshotPath(controlDir)`.

## Done when

- [ ] The snapshot writes atomically and reads back through T03's parse.
- [ ] An absent or malformed snapshot reads as `null`, never a throw.
- [ ] `npm test` passes.
