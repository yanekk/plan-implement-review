# T06 — Fold one finished task row into `PROGRESS.md`

**Phase:** 1 · **Depends on:** T02 · **Weight:** light

## Goal

The pure function that lets many branches update one shared file without clobbering it: given
`main`'s `PROGRESS.md` text and a single finished task's new state and notes, return a new text
with only that task's row changed and every other line — the other tasks' rows and the
coordinator-managed Status, `Next pir-work will:` and Review queue lines — left exactly as they
were. This is what makes the coordinator the single writer of the cross-cutting fields while
still recording each worker's result, and it sidesteps the guaranteed git conflict on the
single-line fields that several branches would all edit.

## Design sections this implements

DESIGN §2.5 (`PROGRESS.md` contention), §3.3 (`reconcileTaskRow`), §3.5 (coordinator-owned
`PROGRESS.md`).

## Files

- `src/core/progress.mjs` — add `reconcileTaskRow` (alongside `parseProgress` from T02).
- `src/core/progress.test.mjs` — extend.

## Interface

```
reconcileTaskRow(mainText, { num, state, notes }) → newText

  Finds the table row whose # column is `num`, replaces its State and Notes cells,
  and returns the whole file otherwise byte-for-byte identical.

  - Only the target row changes; other task rows are untouched.
  - The Status / Last updated / Next-pir-work-will / Review queue lines are NOT touched.
  - Notes is clamped to the 60-word budget the file documents; over-budget input is an error,
    not a silent truncation, so the caller fixes it rather than losing detail.
  - An unknown `num` is an error (a row that does not exist must not be invented).
```

## Tests

- [ ] Changes only the target row's State and Notes; a diff shows exactly those two cells.
- [ ] Leaves Status, `Next pir-work will:` and Review queue lines identical.
- [ ] Two sequential reconciles of different tasks compose (neither undoes the other).
- [ ] An unknown task number is reported as an error.
- [ ] A notes value over the word budget is reported, not truncated.
- [ ] The result re-parses with `parseProgress` and shows the new state.

## Done when

- [ ] One task's row can be folded in with every other line preserved byte-for-byte.
- [ ] Errors on unknown task and over-budget notes rather than corrupting the file.
- [ ] `npm test` is green and the module stays pure.
