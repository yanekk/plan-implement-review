# T06 — index-store

**Phase:** 2 · **Depends on:** T02 · **Weight:** medium

## Goal

The filesystem side of the cross-repo index: list every run's entry under `~/.pir/runs/`, write or
update one atomically, and remove one. This is what lets `pir` from any directory see runs across
every repo. It reads and writes the format T02 owns; it tolerates a malformed or half-written file
by skipping it, so the dashboard never crashes on one bad pointer.

## Design sections this implements

DESIGN §2.8 (the index), §3.5 (storage — index entry), §2.10 (malformed entry, stale entry).

## Files

- `src/shell/index-store.mjs` — new.
- `src/shell/index-store.test.mjs` — new.

## Interface

```
indexDir({ env = process.env } = {}) → string           // ${HOME}/.pir/runs, honouring $PIR_HOME for tests
listRecords({ dir, fs } = {}) → record[]                 // parse each *.json; skip nulls; never throw
writeRecord(record, { dir, fs } = {}) → void             // temp file + rename; mkdir -p the dir
removeRecord({ repo, slug }, { dir, fs } = {}) → void     // unlink the entry; no error if absent
recordPath(repo, slug, { dir } = {}) → string            // {dir}/{repo}__{slug}.json
```

- Filename is `{repo}__{slug}.json`, so the same slug in two repos never collides (§2.8).
- Writes are temp-then-rename within the same directory, because a rename on the same filesystem is
  atomic and a reader mid-write must never see a partial entry.
- `$PIR_HOME` overrides `$HOME` for the index root so tests write to a scratch dir, never the real
  `~/.pir`.

## Tests

- [ ] `writeRecord` then `listRecords` returns the record; the file is at `recordPath`.
- [ ] `writeRecord` of an existing repo+slug overwrites in place (one entry per run).
- [ ] `listRecords` skips a file whose contents are malformed JSON, returning the valid others.
- [ ] `listRecords` on an absent directory returns `[]` (no throw).
- [ ] `removeRecord` deletes the entry; a second `removeRecord` on the same run does not throw.
- [ ] the write is temp-then-rename: assert no non-`.json` temp file is left behind on success.
- [ ] `indexDir` honours `$PIR_HOME`.

## Done when

- [ ] Entries round-trip through the store and one bad file cannot break a list.
- [ ] Writes are atomic (temp + rename) and tests never touch the real `~/.pir`.
- [ ] `npm test` passes.
