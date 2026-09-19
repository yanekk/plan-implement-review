# T03 — Remove the auto/you distinction and the verify path (code)

**Phase:** 2 · **Runs:** auto · **Depends on:** T02 · **Weight:** medium

## Goal

Remove the `auto`/`you` task distinction from the code. Every task is dispatched to an autonomous
implement→review worker; a task that needs the person's judgement is an ordinary worker that prepares
the ground and asks (the worker-contract half of this is T06). This deletes the `Runs` marker from
parsing and dispatch, the `you` count from the width report, and the whole `verify`/hands-on path.
The parser must still tolerate a `Runs` column when one is present, because older plans (and this
plan's own `PROGRESS.md`) still carry it.

## Design sections this implements

DESIGN §2.5 (no auto/you distinction; a worker that needs the person prepares and asks).

## Files

- `src/core/progress.mjs` (+ `progress.test.mjs`) — stop requiring/interpreting the `Runs` column;
  drop `KNOWN_RUNS` and the `runs` field. A `Runs` column that is present is ignored, not an error.
- `src/core/dispatch.mjs` (+ `dispatch.test.mjs`) — drop `runs` from the spawn decision.
- `src/core/parallelism.mjs` (+ `parallelism.test.mjs`) — drop the `you`/human count; keep the
  chain-length and width numbers for the planner.
- `src/core/naming.mjs` (+ `naming.test.mjs`) — drop the `verify` worker role; roles become
  `implement` and `review`.
- `src/shell/loop.mjs` (+ `loop.test.mjs`) — remove the `verify` spawn branch, the `hands-on` log
  tag, and the verify attestation handling; every ready task spawns an `implement` worker.
- `src/shell/platform.mjs` (+ `platform.test.mjs`) — `openingInstruction` maps only
  `implement→pir-implement` and `review→pir-review`; the `verify→pir-verify` mapping goes.

## Interface

```
parseProgress(text) → { planReviewed, tasks: [{ num, name, deps, state }], errors }
  // no `runs` field. A `Runs` column present in the table is ignored without error.

decideDispatch(...) .spawn → [ num, ... ]   // task numbers only; no { num, runs }

analyzeParallelism(tasks) → { criticalPathLength, maxWidth, totalTasks, errors }
  // no humanCount / autonomousCount.

WORKER_ROLES = ['implement', 'review']   // no 'verify'
```

## Tests

- [ ] `parseProgress` parses a table with no `Runs` column and a table *with* a `Runs` column
      (including a `you` row) identically — both yield the same task list, no error from the column.
- [ ] `decideDispatch.spawn` carries task numbers and no `runs`.
- [ ] `analyzeParallelism` returns no human/`you` count and its chain/width numbers are unchanged.
- [ ] `naming` has no `verify` role; `parseAgentName` round-trips `implement` and `review` names.
- [ ] `loop` spawns an `implement` worker for every ready task; no `verify`/`hands-on` action or
      attestation is emitted.
- [ ] `openingInstruction` maps only implement and review.
- [ ] No `runs`, `verify`, `hands-on`, or attestation reference remains in `src/` (grep).

## Done when

- [ ] The code has no `auto`/`you` distinction and no verify path; every task dispatches as an
      ordinary implement→review worker.
- [ ] `parseProgress` tolerates a `Runs` column so older plans and this plan's `PROGRESS.md` still
      parse.
- [ ] `npm test` is green.
