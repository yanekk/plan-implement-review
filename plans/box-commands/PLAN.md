# Implementation plan

5 tasks in 2 phases. Each has a file in [tasks/](tasks/) with its goal, the files it touches, the
interfaces it defines, and what "done" means. Track state in [PROGRESS.md](PROGRESS.md). Read
[DESIGN.md](DESIGN.md) first, and `plans/dashboard-plan-box/DESIGN.md` §2 for the box this changes.

## Shape of the build

- **The rules first.** T01 holds the grammar, the pop-up contexts, the notes and the head line as pure
  functions; T02 the buildable-plan rule and the scan. The surface tasks wire a screen to rules already proven.
- **No spike.** The one unknown, whether pi-tui can reopen its pop-up after a pick, was measured at plan time
  (DESIGN §3.3).
- **Extend, not add.** The box, its routing, its repo scan, `startPlanRun` and `startRun` all exist; nothing is
  built a second time.

```
Phase 1  ▸  T01 T02         grammar, buildable plans      no screen change
Phase 2  ▸  T03 T04 T05     pop-ups, wiring, drill        the surface
```

## Phase 1 — Headless

| # | Task | Depends on |
|---|---|---|
| [T01](tasks/T01-box-grammar.md) | box-grammar | — |
| [T02](tasks/T02-plan-scan.md) | plan-scan | — |

At the end: the new grammar and the buildable-plan list exist and are tested; nothing on screen has changed yet
except the old form's refusal.

## Phase 2 — The box

| # | Task | Depends on |
|---|---|---|
| [T03](tasks/T03-box-completion.md) | box-completion | T01 |
| [T04](tasks/T04-box-starts-build.md) | box-starts-build | T01, T02, T03 |
| [T05](tasks/T05-box-commands-drill.md) | box-commands-drill | T04 |

At the end: `@repo/plan` and `@repo/start` work from the dashboard, driven end to end, documented, and installed.

## Main path, builder and wirer

| Step | Built by | Plugged in by |
|---|---|---|
| `@` pop-up of repos, pick writes `@repo/` | T01 (context), T03 (provider, re-open) | already mounted by `runTui` |
| Command pop-up, pick writes `/plan ` or `/start ` | T01, T03 | already mounted |
| Slug pop-up with progress and building | T02 (scan), T03 (rows) | T04 (`runTui` passes `plansOf`, `building`) |
| Enter on `/plan` starts planning | T01 (parse) | T04 (`submitBox`, today's `startPlanRun` path) |
| Enter on `/start` starts or opens the build | T01 (parse) | T04 (`submitBox` → `startRun`, the live-view landing) |

The rig needs no new task: the plan rig and `driveScreen` already drive `pir`, and its `coordinator-drill` set
already commits a reviewed plan to build.

## Critical path

```
T01 → T03 → T04 → T05
```

T02 is off it. The only leaf is T05, the drill.

## Parallel width

5 tasks · longest dependency chain 4 · up to 2 could run at once (T01 with T02).

## Rough sizing

| Weight | Tasks |
|---|---|
| **Medium** | T03, T04, T05 |
| **Light** | T01, T02 |

T03 is where the risk sits: pi-tui's pop-up is asynchronous and its trigger rules were written for a chat
box, so the re-open rule (DESIGN §3.3) may need care in tests to await the request.

## Decisions still open

None.
