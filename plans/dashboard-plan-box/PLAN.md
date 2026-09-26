# Implementation plan

6 tasks in 2 phases. Each has a file in [tasks/](tasks/) with its goal, the files it touches, the
interfaces it defines, and what "done" means. Track state in [PROGRESS.md](PROGRESS.md). Read
[DESIGN.md](DESIGN.md) first.

## Shape of the build

- **The rules first.** T02 holds every decision the person can trip over (the key routing, reading
  `@name brief`, the notes) as pure functions, so the surface tasks wire a screen to rules already proven.
- **No spike.** The one load-bearing unknown, whether pi-tui's Editor wraps, caps its height and offers an
  `@` pop-up, was measured at plan time with the prototype (DESIGN §5).
- **The guard removal is independent** of the box and runs beside it; the drill checks the two together.

```
Phase 1  ▸  T01 T02 T03     guard removal, pure rules, repo scan    no screen change
Phase 2  ▸  T04 T05 T06     the list view, the wiring, the drill   the surface
```

## Phase 1 — Headless

| # | Task | Depends on |
|---|---|---|
| [T01](tasks/T01-drop-canonical-guard.md) | drop-canonical-guard | — |
| [T02](tasks/T02-plan-box-rules.md) | plan-box-rules | — |
| [T03](tasks/T03-repo-scan.md) | repo-scan | T02 |

At the end: planning and building work in any repo by name, and the box's rules and repo list exist and are tested.

## Phase 2 — The box

| # | Task | Depends on |
|---|---|---|
| [T04](tasks/T04-list-view-box.md) | list-view-box | T02 |
| [T05](tasks/T05-box-starts-plan.md) | box-starts-plan | T03, T04 |
| [T06](tasks/T06-plan-box-drill.md) | plan-box-drill | T01, T05 |

At the end: the box starts planning runs from the dashboard, driven end to end, documented, and installed.

## Main path, builder and wirer

| Step | Built by | Plugged in by |
|---|---|---|
| The box on the list, keys routed | T02 (routing), T04 (component) | T05 (`runTui` mounts it) |
| `@` pop-up of repos | T03 (scan), T04 (provider) | T05 (passes `scanRepos` in) |
| Enter starts the run and lands | T02 (parse) | T05 (`startPlanRun`, the `openPlanner` landing) |
| Planning in `plan-implement-review` | T01 | T01 (`planPreflight`, coordinator `main`) |

The rig needs no new task: the plan rig (`plan-rig.mjs`) and `driveScreen` already drive `pir`, and T05 points `PIR_REPOS` at the rig root.

## Critical path

```
T02 → T04 → T05 → T06
```

T01 and T03 are off it. The only leaf is T06, the drill.

## Parallel width

6 tasks · longest dependency chain 4 · up to 2 could run at once (`analyzeParallelism`: T01 with T02, then T03 with T04).

## Rough sizing

| Weight | Tasks |
|---|---|
| **Medium** | T04, T05, T06 |
| **Light** | T01, T02, T03 |

T04 and T05 will overrun if the list's key path is harder to share than it looks: `runTui` routes keys
by view today, and the list view becomes the first mounted component that must hand most keys back.

## Decisions still open

None.
