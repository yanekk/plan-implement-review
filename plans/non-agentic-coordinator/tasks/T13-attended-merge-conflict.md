# T13 — attended-merge-conflict

**Phase:** 4 · **Runs:** you (attended) · **Depends on:** T05, T10, T11, T14 · **Weight:** medium (gated on the person)

## Goal

Convert the stale `merge-conflict` fixture from the removed down-channel model into an **attended**
fixture a person resolves live, so a real coordinator merge conflict is tested end-to-end under the
non-agentic model. Today the fixture cannot pass: it carries a `scriptedAnswer` the runner used to
inject through the coordinator→worker channel, and its `mergeConflictResolved` fact still requires an
`answer` flow line — both assume the down-channel this plan removed (DESIGN §2.2). The loop no longer
emits `answer`, so the fixture can never go green (FINDINGS 2026-09-20).

The coordinator itself needs **no change**. It already parks a conflicting worker alive and retries the
merge once that worker re-signals done (`loop.mjs:514-523`). The only thing that changed is that the
worker now learns the resolution from a **person attaching to it directly** (§2.8), not from a routed
answer. This task reworks the fixture and its assertion to that reality and makes the run complete when
the person resolves the conflict by hand.

## Design sections this implements

DESIGN §2.8 (merge conflict — the worker is kept alive and parked; the person resolves it by attaching
to that worker directly; the branch merges only once clean), §2.2 (no down-channel), §2.4 (hand-off,
never a merge to main).

## The live flow this fixture exercises

1. Two tasks (`T01`, `T02`) each edit the same line of `greeting.txt` from a common base, ceiling 2, so
   the second to merge conflicts at the coordinator's own merge step.
2. The coordinator hits the conflict, parks that worker (`AWAITING`), keeps its session/worktree/task,
   and records a `surface … kind: conflict` line. It does **not** close the worker or merge past it.
3. The coordinator shows a ready-to-paste resolution prompt for that worker (T14). The **person** copies
   it, fills the keep-which-side blank with **`hello there`** (the fixed decided side, so the run is
   deterministic), attaches to that worker in `claude agents`, and pastes it. The worker merges the
   feature branch into its own branch, resolves, commits, and re-signals done.
4. The coordinator's next pass retries the merge for that now-done worker, it lands clean, the branch
   folds in, and the run **completes** (`expectedTerminal: 'completed'`) and hands off `pir/merge-conflict`.

## Files

- `src/shell/harness/fixtures/merge-conflict.mjs` — remove `scriptedAnswer` and its export; keep the
  two same-line-edit tasks, ceiling 2, the `probe` (`expect: 'conflict'`), and `finalContent`
  (`greeting.txt` → `hello there`). Add a `seatbelts.timeoutMs` of ~25 min (a human-speed budget, as the
  old hands-on fixture had) and a "Needs a person" resolution block naming exactly what the person does
  in step 3. `expectedTerminal` stays `completed` (the run finishes once the person resolves).
- `src/shell/harness/assertions.mjs` — rework `mergeConflictResolved({ file, content })`: drop the
  requirement for an `answer` flow line (the down-channel is gone). Assert instead, task-agnostic
  (the loser of the merge race is whichever surfaced): a `surface … kind: conflict` for that task with
  no `merge` of it before it; the **same** worker resumed to a clean `merge` of that task (no respawn —
  compose with / mirror `resumedNotRebuilt`/`noRebuildFrom`); the run handed off (compose with
  `handedOffGreenBranch`: zero `promote`, no merge to main, ≥1 `merge T{nn}`); and the handed-off
  feature branch's `greeting.txt` reads exactly `content` (`hello there`), not the losing `hi world`.
  Keep `ceilingHeld(2)` in the fixture's fact list.
- `src/shell/harness/assertions.test.mjs` (and any merge-conflict-specific canned-data test) — update
  the canned flow/bundle inputs to the new fact shape: a `surface` conflict line and a later `merge` by
  the same worker with no `answer` line, and a regression case that FAILs when the feature branch's
  final `greeting.txt` reads the losing side.

## Interface

- `node src/shell/harness/run.mjs merge-conflict --into <dir>` runs **attended**: it spawns the real
  coordinator over real workers, the coordinator parks on the conflict, and the runner waits (within the
  ~25 min budget) while the person resolves it live; the run then completes with an all-green fact
  report and a bundle path. No scripted injection anywhere in the path.
- `mergeConflictResolved({ file: 'greeting.txt', content: 'hello there' })` is the load-bearing fact,
  plus `ceilingHeld(2)`.

## Acceptance criteria — done when

- [ ] `scriptedAnswer` is gone from the fixture and no assertion depends on an `answer` flow line.
- [ ] The reworked `mergeConflictResolved` passes on the live attended run and, on canned data, FAILs
      when the feature branch's final `greeting.txt` reads the losing `hi world` or when the conflicted
      task was respawned rather than resumed.
- [ ] A live `run.mjs merge-conflict --into <dir>`, resolved by copying the coordinator's prompt (T14)
      and keeping `hello there`, ends `completed` (not a timeout) with an all-green report; its bundle
      path is recorded.
- [ ] `npm test` is green.
- [ ] Because it is attended, the live half is a person-verified `✅` row in `FINDINGS.md` with the date
      (the machine facts alone do not close it), and the scratch/`--into` dir is torn down.

## Notes for the building session

- The conflict-path comments in `loop.mjs` (around lines 490, 517-518) still say the decision is "routed
  down by `answer()`" — stale wording from the removed down-channel. Correcting them is optional here and
  otherwise a FINDINGS item; do not let the stale comment mislead the rework — the person, not a routed
  answer, drives the resolution now.
- The operator guide `plans/parallel-pir/TEST-HARNESS.md` still documents the old scripted-answer
  behaviour for this scenario. That guide belongs to a sealed plan; leave it, and note its staleness in
  FINDINGS rather than editing it here. This task doc is the current recipe.
- Keeping `hello there` as the fixed resolution wording is a deterministic-test choice, not a product
  rule; it matches the old decided side so the regression assertion stays meaningful.
