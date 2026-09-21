# T04 — docs-and-rules

**Phase:** B · **Depends on:** T02 · **Weight:** light

## Goal

Make worker-introduced tasks canonical. How parallel mode behaves lives in `/docs`, not in a plan's
`DESIGN.md`, so the new behaviour is documented there; and `CLAUDE.md`'s governance and scope rules
gain the parallel-mode carve-out that lets an approved worker add a task. This is the record a later
session reads to understand the behaviour without reading this plan.

## Design sections this implements

DESIGN §2 (behaviour), §3 (the merge change), documented for the canonical `/docs` audience.

## Files

- `docs/branch-model.md` — the merge no longer discards a task branch's `PROGRESS.md` wholesale; it
  keeps the feature's version of existing rows and single-line fields and adopts genuinely new task
  rows (add-only). Update the "Merges" section.
- `docs/task-state.md` — the task set can grow mid-run; a new row is adopted at the introducing
  task's merge, forced to `⬜`; the single-writer rule is refined, not broken (the coordinator still
  writes the feature copy).
- `docs/run-lifecycle.md` — note in the "Spawn ready tasks" and merge steps that a merge may adopt
  new rows and a later pass dispatches them; the `adopt` and `bad-plan-change` log kinds.
- `docs/control-folder.md` — the log gains `adopt` and `bad-plan-change`; a proposal reuses the
  existing `decision` report and is approved in-session (no new report kind).
- `CLAUDE.md` — the governance section (`Who decides what`, `Scope is strict`): in parallel mode a
  worker may, with the person's in-session approval, ADD a task (never edit an existing one), and
  the coordinator adopts it — the one sanctioned break from strict scope, alongside the worktree
  carve-out.

## Interface

Not a code interface. The done-state is that a session reading `/docs` and `CLAUDE.md` understands:
the approval-first, add-only model; that a new task appears at the introducing task's merge; that a
forbidden edit or bad addition is surfaced, not applied; and that the dispatch brain did not change.

## Tests

Prose deliverable — no automated test; checkable by reading and cross-checking against the code:

- [ ] Each doc's statements about the merge and adoption match the T01/T02 code (read side by side).
- [ ] The `CLAUDE.md` carve-out matches the worker contract in T03 (add-only, approval-first,
      parallel-mode only).
- [ ] No doc claims dispatch changed (it did not) or that a proposal is visible before merge.
- [ ] The log kinds named in `control-folder.md` match those `loop.mjs` actually records.

## Done when

- [ ] `docs/branch-model.md`, `docs/task-state.md`, `docs/run-lifecycle.md` and
      `docs/control-folder.md` describe the adoption behaviour accurately.
- [ ] `CLAUDE.md` carries the parallel-mode add-a-task carve-out in its governance/scope sections.
- [ ] The docs agree with each other and with the code; no stale claim about the old
      discard-wholesale merge remains where it now describes adoption.
