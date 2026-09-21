# T00 — adopt-rule

**Phase:** A · **Depends on:** — · **Weight:** medium

## Goal

The pure rule at the heart of the plan: given the feature branch's `PROGRESS.md` and a merging task
branch's `PROGRESS.md`, decide which task rows on the branch are genuinely new tasks, adopt them,
and reject anything that would edit an existing task. This is where add-only is enforced and where a
broken addition is caught, all as pure text so it can be tested exhaustively before any merge or
loop calls it.

## Design sections this implements

DESIGN §2.2 (what counts as a new task, add-only enforcement), §3.1 and §3.3 (the boundary and the
function), §2.5 (the error cases).

## Files

- `src/core/progress.mjs` — add `adoptNewTaskRows`, exported. Reuse the existing `parseProgress` and
  the table-location helpers already in the file. No new dependency, no I/O.
- `src/core/progress.test.mjs` — the cases below.

## Interface

```
adoptNewTaskRows(featureText, branchText) → { text, added, errors }

  featureText  string — the feature branch's PROGRESS.md (authoritative)
  branchText   string — the merging task branch's PROGRESS.md

  returns:
    text    string  — featureText with each new task row appended to the task table, state ⬜.
                      Byte-identical to featureText when nothing is adopted AND when errors is
                      non-empty (adoption is atomic per branch: any error adopts nothing).
    added   string[] — adopted task numbers in table order, e.g. ['T03']. Empty when errors set.
    errors  string[] — one human-readable message per rejected row; empty on success.
```

Rules, per branch task row:

- Id absent from featureText → new. Adopt: append to the feature table with state forced to `⬜`,
  keeping its slug and `Depends on`. Every dependency must name a task present in featureText or
  among this change's other new rows; a dependency on an unknown task is an `errors` entry.
- Id present in featureText, slug and deps identical → ignore (pre-existing row, including the
  merging task's own — state is not compared, so a glyph difference is not an edit).
- Id present in featureText, slug or deps differ → `errors` entry (a forbidden edit or a duplicate
  number). This enforces add-only.

Non-obvious points, each worth a comment in the code:

- **Compare slug and deps, never state.** The merging task's own row differs from the feature's
  only by its glyph; comparing state would misread every merge as an edit.
- **Force `⬜`.** The coordinator owns task state; a branch row marked `🔍`/`✅` must still be adopted
  as `⬜` or the new task would skip its build.
- **Preserve the table's column layout** when appending (same columns, same order as the located
  table), so `reconcileTaskRow` can still find and fold rows afterward.
- **Atomic.** Collect all errors first; if any, return `{ text: featureText, added: [], errors }`.

## Tests

- [ ] A branch adding one new row (T03, deps T01) → `text` has T03 as `⬜`; `added` is `['T03']`.
- [ ] Existing rows and the single-line fields (Status, Next pir-work will, Review queue) are
      byte-identical in `text`.
- [ ] The merging task's own row, glyph `✅` on the branch and `⬜` on the feature, is ignored (not
      adopted, not an error).
- [ ] A new row whose branch glyph is `✅` or `🔍` is adopted as `⬜`.
- [ ] A new row with a dependency on a task that exists nowhere → one `errors` entry, `added` empty,
      `text` unchanged.
- [ ] A branch row that changes an existing task's deps (or slug) → `errors` entry, nothing adopted.
- [ ] A duplicate number: branch's T03 has a different slug from feature's existing T03 → `errors`.
- [ ] Two new rows in one change, the second depending on the first → both adopted, deps validate
      against the other new row.
- [ ] One good new row and one bad new row in the same change → atomic: nothing adopted, the bad
      one's error returned.
- [ ] Nothing new on the branch → `text` byte-identical to featureText, `added` empty, `errors`
      empty.
- [ ] Adopted `text` still parses with `parseProgress` and `reconcileTaskRow` can still set the new
      row's state (layout preserved).

## Done when

- [ ] `adoptNewTaskRows` is exported from `src/core/progress.mjs` and matches the interface above.
- [ ] Every test case above is covered and `npm test` is green.
- [ ] `boundary.test.mjs` still passes (the function is pure — no fs, no clock, no platform import).
