# Where task state lives

The task state of a parallel run lives in one file: `plans/{slug}/PROGRESS.md` **on the feature
branch**. The coordinator is its single writer there. Workers do not edit the feature branch's
copy; each worker edits only its own task's row on its own task branch, and the coordinator folds
that row back at merge time. This is what lets many worker branches share one file without git's
line merge colliding on the cross-cutting single-line fields (`Status`, `Next pir-work will:`, the
review queue).

The parser and the reconcile are the two pure functions in `src/core/progress.mjs`:

- `parseProgress(text)` reads the file into a task table plus the plan-reviewed gate.
- `reconcileTaskRow(text, { num, state, notes })` returns new text with **only** that one task's
  State and Notes cells changed, every other line byte-for-byte identical.

## The task table

The table is located by its header, not its position: the parser finds the first pipe-delimited
header row that names at least the `#`, `Task`, and `State` columns and is followed by a separator
row. Columns are matched by name, so a table with extra or missing optional columns still parses.
The columns it reads: `#` (the task id, `T` followed by digits), `Task` (name), `Depends on` (the
task ids this one waits for), `Runs` (the `auto`/`you` marker), `State` (the glyph), and `Notes`.

A row the parser cannot read — a bad task id, an unknown state glyph, the wrong number of cells —
is reported in an `errors` list, never dropped or silently mis-read. A row silently skipped would
be a task never built.

## The state glyphs

A task row carries one of five states:

| Glyph | Meaning |
|---|---|
| `⬜` | ready — not yet built; a candidate to dispatch once its dependencies are `✅` |
| `🟡` | in progress (classic-flow marker; a parallel worker's in-flight work shows as `⬜` on the feature branch until it merges) |
| `🔍` | implemented, awaiting review (lives on the task branch; see below) |
| `✅` | done — reviewed and merged into the feature branch |
| `⛔` | blocked / deferred — a person deliberately parked it; its dependents wait |

What the coordinator dispatches from is the **feature branch** copy of `PROGRESS.md`. That copy
only advances a task past `⬜` when the task's branch is merged and its row is reconciled to `✅`.
While a worker is building or reviewing on its own task branch, the task's `🔍`/`✅` progress lives
on that branch; on the feature branch the row still reads `⬜`. This is central to restart
behaviour — see [restart-recovery.md](restart-recovery.md).

`⛔` is written by the coordinator when a person defers a task (`defer` in `coordinate.mjs` calls
`reconcileTaskRow` and commits the feature branch), so a deferred decision survives a restart and
nothing downstream of it is dispatched.

## The `Runs` marker

Each task carries a `Runs` marker, `auto` or `you`, decided at plan time. It defaults to `auto`
when a plan predates the column, so classic plans still parse.

- **`auto`** — an autonomous worker produces the deliverable (code and tests). Most tasks.
- **`you`** — the task's completion is a person's observation: a spike, a hand-verification drill,
  or running something an `auto` task built to confirm it behaves. The coordinator still spawns a
  worker, but a hands-on one the person drives. See [human-flow.md](human-flow.md).

The marker drives dispatch: `decideDispatch` tags each spawn with its `Runs` value, and the loop
spawns a builder for `auto` and a hands-on scribe for `you`. A `you` task has no code to review, so
it skips the review phase and folds straight from hands-on to `✅` at merge.

The classic single-stream flow ignores the `Runs` marker entirely; it changes nothing there.

## The plan-reviewed gate

`PROGRESS.md` carries a `**Plan reviewed:**` line. The gate reads as **not reviewed** on anything
short of a positive note — a missing line, an empty note, or one beginning "not yet." The
coordinator refuses to start until it reads as reviewed (see [run-lifecycle.md](run-lifecycle.md)).
