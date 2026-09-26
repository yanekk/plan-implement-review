# T02 — run-record-type

**Phase:** 1 · **Depends on:** — · **Weight:** light

## Goal

The index record learns what kind of run it is, a planning run's label before it has a slug, and the
person's go decision, and a record can be renamed from its temporary key to its slug. The dashboard's
TYPE column, one-row-per-slug and the go question all read these fields.

## Design sections this implements

DESIGN §2.2 (label), §2.6 step 4, §2.8 (`go`), §2.10, §3.5.

## Files

- `src/core/runrecord.mjs`, `src/core/runrecord.test.mjs`
- `src/shell/index-store.mjs`, `src/shell/index-store.test.mjs`

## Interface

```js
// record gains: kind: 'plan'|'work' (parse: absent → 'work'), label: string|null (absent → null),
//               go: null|'declined' (absent → null). serializeRecord writes all three.
export function labelFromBrief(brief) → string   // first non-empty line, ≤24 chars, '…' when cut
// index-store
export function renameRecord({ repo, from, to }, { dir, fs }) → record   // temp-then-rename; refuses if `to` exists
export function updateRecord({ repo, slug }, patch, { dir, fs }) → record
```

`renameRecord` writes the new file before removing the old one, so a crash between leaves two entries
rather than none; the loader already drops neither, and the planning program's resume finishes the
rename (DESIGN §2.6).

## Tests

- [ ] An old record with none of the fields parses as `kind 'work'`, `label null`, `go null`.
- [ ] Round trip of a plan record with a label and `go: 'declined'`.
- [ ] An unknown `kind` value is a parse error, not a silent `work`.
- [ ] `labelFromBrief`: short, long, multi-line, leading blank lines, emoji at the cut.
- [ ] `renameRecord` moves the entry, refuses an existing target, leaves the source on refusal.
- [ ] `updateRecord` patches `go` and keeps every other field.

## Done when

- [ ] Every row passes in `npm test`.
- [ ] Existing dashboard tests pass unchanged (old records read as work).
