# Implementation plan

10 tasks in 6 phases. Each has a file in [tasks/](tasks/). Track state in [PROGRESS.md](PROGRESS.md).
Read [DESIGN.md](DESIGN.md) first.

**Build route: classic single-stream (`/pir-work`) recommended.** The coordinator being fixed is the
one that deletes a dead worker's branch; building its own fix in parallel risks losing exactly the
work this plan protects. The sibling brief "nudge a quiet worker" also edits `src/shell/loop.mjs`:
build the two plans one after the other, never at the same time.

## Shape of the build

- **The unknown goes first.** T00 measures the death shapes and the removed-session revive before
  T03 and T06 settle the rules that depend on them.
- **Pure before shell.** T01 proves the whole decision table in `npm test` before the loop uses it.
- **Level 1 before level 2.** T03 stops the data loss and stands on its own; T04 adds the revive on
  top, so a revive problem cannot hold back the fix that keeps branches.
- **Mid-run before restart.** T06 reuses what T04 proved, and is last because it changes teardown.

```
Phase 0 ▸ T00            spike: death shapes, removed-session revive     throwaway, real sessions
Phase 1 ▸ T01 T02        decision, platform revive                        headless
Phase 2 ▸ T03 T04        loop: keep branch + give up, then revive         headless
Phase 3 ▸ T05 T06        narration, restart revive                        headless
Phase 4 ▸ T07 T08        docs, harness fixture                            headless
Phase 5 ▸ T09            live drill                                       real agents, a person
```

## Phase 0 — Prove the ground

| # | Task | Depends on |
|---|---|---|
| [T00](tasks/T00-spike-death-shapes.md) | spike-death-shapes | — |

T00 gates the death rule in T03 (is "listed without a pid" enough, or is there another shape?) and
the record-keeping in T06 (can a removed session be revived under its own id with `-n`?). Either
answer is designed for in DESIGN §2.1 and §2.7; T00 picks which branch is built.

## Phase 1 — The decision and the platform

| # | Task | Depends on |
|---|---|---|
| [T01](tasks/T01-decide-dead-worker.md) | decide-dead-worker | — |
| [T02](tasks/T02-platform-revive.md) | platform-revive | — |

End: `decideResume` answers revive/fallback/give-up; the platform can revive safely; nothing wired.

## Phase 2 — The loop

| # | Task | Depends on |
|---|---|---|
| [T03](tasks/T03-dead-worker-keeps-branch.md) | dead-worker-keeps-branch | T00, T01, T02 |
| [T04](tasks/T04-revive-mid-run.md) | revive-mid-run | T02, T03 |

End: a mid-run death keeps the branch, revives once, falls back, gives up at three (fake platform).

## Phase 3 — The person's view, and restart

| # | Task | Depends on |
|---|---|---|
| [T05](tasks/T05-narrate-deaths.md) | narrate-deaths | T04 |
| [T06](tasks/T06-revive-on-restart.md) | revive-on-restart | T04 |

## Phase 4 — Docs and the live harness

| # | Task | Depends on |
|---|---|---|
| [T07](tasks/T07-docs.md) | docs | T05, T06 |
| [T08](tasks/T08-harness-worker-death.md) | harness-worker-death | T04, T06 |

## Phase 5 — Seen working

| # | Task | Depends on |
|---|---|---|
| [T09](tasks/T09-live-worker-death-drill.md) | live-worker-death-drill | T05, T08 |

## Critical path

```
T00 → T03 → T04 → T06 → T08 → T09
```

T01 and T02 join at T03. T05 is off the path until T09. Leaves: T09 (the final deliverable) and T07,
which is terminal because docs are consumed by readers, not by a later task.

## Parallel width

10 tasks · longest dependency chain 6 · up to 3 could run at once (T00, T01, T02). Mostly a chain;
the classic route costs little.

## Rough sizing

| Weight | Tasks |
|---|---|
| Heavy | T03 |
| Medium | T02, T04, T06, T08, T09 |
| Light | T00, T01, T05, T07 |

T03 may overrun: it lifts reconcile's execution into a shared helper while changing 3a, and the
live-worker accounting in `buildAssignments` is where earlier runaways came from. T06 may overrun if
T00 finds removed sessions cannot be revived by name, because teardown then has to keep records.

## Decisions still open

- The build route (classic recommended above) is the person's to confirm at plan review.
- `src/shell/coordinate.mjs` had uncommitted edits at plan time (pass-cap removal, not this plan's).
  They must be committed or dropped by their owner before T05 or T06.
- §5.3 bins are a proposal until plan review writes them into permissions.
