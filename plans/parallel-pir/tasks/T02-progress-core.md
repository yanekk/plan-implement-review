# T02 — Parse `PROGRESS.md` and fold one finished task row back

**Phase:** 1 · **Depends on:** T01 · **Weight:** light · **Runs:** auto

## Goal

The two pure functions over `PROGRESS.md` that are genuinely the project's own: read the file
into the structured task table and gate the dispatch decision needs, and fold one finished
task's row back into the file without touching anything else. The parse is how every dispatch
pass learns the task states; the fold is what lets many worker branches update one shared file
without clobbering it. Pure text in, text or struct out — the filesystem read and write live in
the shell.

## Design sections this implements

DESIGN §3.2 (`progress.mjs`), §3.3 (`tasks` input and `reconcileTaskRow`), §2.1 (the reviewed
gate), §2.5 (`PROGRESS.md` contention).

## Files

- `src/core/progress.mjs` — `parseProgress` and `reconcileTaskRow`.
- `src/core/progress.test.mjs`.

## Interface

```
parseProgress(text) → {
  planReviewed: { reviewed: boolean, note: string },   // from the **Plan reviewed:** line
  tasks: [ { num: "T00", name, deps: ["T01", …], runs: "auto"|"you",
            state: "⬜"|"🟡"|"🔍"|"✅"|"⛔" } ]
}
  // Depends on: comma/space list of task numbers or "—". Runs: from the "Runs" column, "auto" or
  // "you", defaulting to "auto" when the column is absent so classic plans still parse (DESIGN §2.6).
  // Unknown state glyphs and malformed rows are reported, not dropped — a row the parser cannot
  // read is a task silently never built.

reconcileTaskRow(mainText, { num, state, notes }) → newText
  // Replaces only the target row's State and Notes cells; every other line byte-for-byte identical,
  // including the Status / Next-pir-work-will / Review queue lines. Unknown num is an error;
  // notes over the 60-word budget is an error, not a silent truncation.
```

## Tests

- [ ] `—` in Depends on yields an empty deps list; `T01, T02` yields two.
- [ ] Reads the `Runs` column as `auto`/`you`; a row/table with no `Runs` column defaults to `auto`.
- [ ] Reads the reviewed gate in both forms (not-yet and dated-verdict).
- [ ] A row with an unknown state glyph is surfaced as a parse error, not dropped.
- [ ] The legend row is not treated as a task; a file with no table yields an empty task list.
- [ ] `reconcileTaskRow` changes only the target row; a diff shows exactly its State and Notes.
- [ ] It leaves the Status, `Next pir-work will:` and Review queue lines identical.
- [ ] Unknown task number and over-budget notes each raise an error.
- [ ] The reconciled text re-parses and shows the new state; two reconciles of different tasks
      compose without undoing each other.

## Done when

- [ ] `parseProgress` returns the tasks and gate from a real `PROGRESS.md`, reporting bad rows.
- [ ] `reconcileTaskRow` folds one row in with every other line preserved, erroring on bad input.
- [ ] `npm test` is green and the module imports nothing from `shell/`.
