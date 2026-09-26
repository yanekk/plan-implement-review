# Implementation plan

9 tasks in 5 phases (T01–T09; the old T00 spike was dropped at the 2026-09-26 re-plan onto live
workers, DESIGN §7). Each has a file in [tasks/](tasks/). Track state in [PROGRESS.md](PROGRESS.md).
Read [DESIGN.md](DESIGN.md) first.

**Build route: parallel mode (user decision at plan review, 2026-09-24).** Classic was recommended:
the installed coordinator building this plan is the one that deletes a dead worker's branch, so a
worker death during the build loses that task's work and it restarts from scratch. The sibling plan
`nudge-quiet-worker` also edits `src/shell/loop.mjs` and is also due a re-plan onto live workers: build
the two plans one after the other, never at the same time. Do not run `./install.sh` during the run;
run it once `pir/resume-dead-worker` is merged to main (DESIGN §5.3).

## Shape of the build

- **No spike.** The one unknown, an SDK resume of a killed worker, was measured at re-plan time
  (FINDINGS 2026-09-26).
- **Pure before shell.** T01 proves the whole decision table in `npm test` before the loop uses it.
- **Level 1 before level 2.** T03 stops the data loss and stands on its own; T04 adds the revive on
  top, so a revive problem cannot hold back the fix that keeps branches.
- **Mid-run before restart.** T06 reuses what T04 proved on the mid-run path.

```
Phase 1 ▸ T01 T02        decision, platform revive                        headless
Phase 2 ▸ T03 T04        loop: keep branch + give up, then revive         headless
Phase 3 ▸ T05 T06        narration, restart revive                        headless
Phase 4 ▸ T07 T08        docs, harness fixture                            headless
Phase 5 ▸ T09            live drill                                       real agents, worker drill
```

## Phase 1 — The decision and the platform

| # | Task | Depends on |
|---|---|---|
| [T01](tasks/T01-decide-dead-worker.md) | decide-dead-worker | — |
| [T02](tasks/T02-platform-revive.md) | platform-revive | — |

End: `decideResume` answers revive/fallback/give-up; the platform can revive a dead child under its own
id; nothing wired.

## Phase 2 — The loop

| # | Task | Depends on |
|---|---|---|
| [T03](tasks/T03-dead-worker-keeps-branch.md) | dead-worker-keeps-branch | T01, T02 |
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
T01 → T03 → T04 → T06 → T08 → T09
```

T02 joins at T03. T05 is off the path until T09. Leaves: T09 (the final deliverable) and T07,
which is terminal because docs are consumed by readers, not by a later task.

## Parallel width

9 tasks · longest dependency chain 6 · up to 2 could run at once (T01, T02; later T05, T06). Mostly a chain.

## Rough sizing

| Weight | Tasks |
|---|---|
| Heavy | T03 |
| Medium | T02, T04, T06, T08, T09 |
| Light | T01, T05, T07 |

T03 may overrun: it lifts reconcile's execution into a shared helper while changing 3a, and the
live-worker accounting around `decideDispatch` is where earlier runaways came from.
