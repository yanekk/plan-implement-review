# Where task state lives

The task state of a parallel run lives in one file: `plans/{slug}/PROGRESS.md` **on the feature
branch**. The command is its single writer there. Workers do not edit the feature branch's copy;
each worker edits only its own task's row on its own task branch, and the command folds that row
back at merge time. This is what lets many worker branches share one file without git's line merge
colliding on the cross-cutting single-line fields (`Status`, `Next pir-work will:`, the review
queue).

The parser and the reconcile are the two pure functions in `src/core/progress.mjs`:

- `parseProgress(text)` reads the file into a task table plus the plan-reviewed gate.
- `reconcileTaskRow(text, { num, state, notes })` returns new text with **only** that one task's
  State and Notes cells changed, every other line byte-for-byte identical.

## The task table

The table is located by its header, not its position: the parser finds the first pipe-delimited
header row that names at least the `#`, `Task`, and `State` columns and is followed by a separator
row. Columns are matched by name, so a table with extra or missing optional columns still parses.
The columns it reads: `#` (the task id, `T` followed by digits), `Task` (the task's slug),
`Depends on` (the task ids this one waits for), `State` (the glyph), and `Notes`. A parsed row is
`{num, name, deps, state}`. A `Runs` column, if a plan still carries one, **maps to nothing and its
cell is ignored** — not an error; older plans and some in-flight plans still print the column, and
the parser tolerates it (the `auto`/`you` distinction it once drove is gone — see below).

A row the parser cannot read — a bad task id, an unknown state glyph, the wrong number of cells —
is reported in an `errors` list, never dropped or silently mis-read. A row silently skipped would
be a task never built.

## The task slug

Every task has a kebab-case **slug** that is its one name everywhere:

- the `Task` cell in `PROGRESS.md` (for example `stop-promoting`),
- the task-doc filename, `tasks/T{nn}-{slug}.md`,
- the row in the live display, shown as `T01 stop-promoting`,
- and the worker's agent name, `{repo} / {plan} / T01 / stop-promoting / {role}` (see
  [branch-model.md](branch-model.md)).

One name, one source — the full description lives in the task doc's Goal, not in the slug. The task
**number** stays the identity the machinery uses: dependencies reference it, and the command matches
a live worker to its task by number regardless of the slug. The slug is a readable label carried
alongside. Keeping the filename slug and the `Task` cell identical is a plan-authoring discipline the
plan review checks.

## The state glyphs

A task row carries one of five states:

| Glyph | Meaning |
|---|---|
| `⬜` | ready — not yet built; a candidate to dispatch once its dependencies are `✅` |
| `🟡` | in progress (classic-flow marker; a parallel worker's in-flight work shows as `⬜` on the feature branch until it merges) |
| `🔍` | implemented, awaiting review (lives on the task branch; see below) |
| `✅` | done — reviewed and merged into the feature branch |
| `⛔` | blocked / deferred — a person deliberately parked it; its dependents wait |

What the command dispatches from is the **feature branch** copy of `PROGRESS.md`. That copy only
advances a task past `⬜` when the task's branch is merged and its row is reconciled to `✅`. While a
worker is building or reviewing on its own task branch, the task's `🔍`/`✅` progress lives on that
branch; on the feature branch the row still reads `⬜`. This is central to restart behaviour — see
[restart-recovery.md](restart-recovery.md).

`⛔` is written by the command when a person defers a task (`defer` in `coordinate.mjs` calls
`reconcileTaskRow` and commits the feature branch), so a deferred decision survives a restart and
nothing downstream of it is dispatched.

## One kind of worker

There is no per-task `Runs` marker driving dispatch any more, and no `auto`/`you` distinction. Every
`⬜` task whose dependencies are `✅` is dispatched the same way: an autonomous builder
(`pir-implement Txx`), then a fresh reviewer (`pir-review Txx`). A task whose real proof is a
person's judgement is not a separate type — it is an ordinary worker that prepares the ground and
then asks the person a specific question through the escalation path (see [human-flow.md](human-flow.md)).
The classic single-stream flow never read a `Runs` marker either.

## The plan-reviewed gate

`PROGRESS.md` carries a `**Plan reviewed:**` line. The gate reads as **not reviewed** on anything
short of a positive note — a missing line, an empty note, or one beginning "not yet." The command
refuses to start until it reads as reviewed (see [run-lifecycle.md](run-lifecycle.md)).
