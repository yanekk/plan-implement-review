# T02 — Parse `PROGRESS.md` into tasks and the gate line

**Phase:** 1 · **Depends on:** T01 · **Weight:** light

## Goal

Turn a `PROGRESS.md` file into the structured data the dispatch decision needs: the task table
(number, name, dependencies, state) and whether the plan-reviewed gate is satisfied. This is
the coordinator's read of the single source of truth for task state, and every dispatch pass
starts from it. Pure text in, struct out — no filesystem here, the read happens in the shell.

## Design sections this implements

DESIGN §3.2 (`progress.mjs`, the parse half), §3.3 (the `tasks` input to `decideDispatch`),
§2.1 (the reviewed-gate refusal).

## Files

- `src/core/progress.mjs` — add `parseProgress`.
- `src/core/progress.test.mjs`.

## Interface

```
parseProgress(text) → {
  planReviewed: { reviewed: boolean, note: string },   // from the **Plan reviewed:** line
  tasks: [ { num: "T00", name: string, deps: ["T01", …], state: "⬜"|"🟡"|"🔍"|"✅"|"⛔" } ]
}
```

The gate line is `**Plan reviewed:** not yet …` (reviewed=false) or `**Plan reviewed:** {date}
— {verdict}` (reviewed=true). Task rows come from the `| # | Task | Depends on | State | Notes |`
table; `Depends on` is a comma/space list of task numbers or `—` (no deps). Unknown state
glyphs and malformed rows are reported, not silently dropped, because a row the parser cannot
read is a task the coordinator would silently never build.

## Tests

- [ ] Parses the states legend row correctly and does not treat it as a task.
- [ ] `—` in Depends on yields an empty deps list; `T01, T02` yields two.
- [ ] Reads the reviewed gate in both forms (not-yet and dated-verdict).
- [ ] A row with an unknown state glyph is surfaced as a parse error, not dropped.
- [ ] A file with no task table yields an empty task list and a clear reviewed gate, not a throw.
- [ ] Round-trips the real `plans/parallel-pir/PROGRESS.md` shipped with this plan.

## Done when

- [ ] `parseProgress` returns the tasks and the gate from a real `PROGRESS.md`.
- [ ] Malformed rows and unknown states are reported rather than dropped.
- [ ] `npm test` is green and the module imports nothing from `shell/`.
