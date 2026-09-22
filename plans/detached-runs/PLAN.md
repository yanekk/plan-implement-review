# Implementation plan

13 tasks in 5 phases. Each has a file in [tasks/](tasks/) with its goal, the files it touches,
the interfaces it defines, and what "done" means.

Track state in [PROGRESS.md](PROGRESS.md). Read [DESIGN.md](DESIGN.md) first.

---

## Shape of the build

- **Everything testable automatically is built and tested before anything draws a pixel.** The
  run-state logic, the file formats and the dashboard's keyboard behaviour are all pure and proven
  before the terminal app that wires them together exists. The front-end then paints logic already
  known to be correct.
- **The detached-launch mechanism was verified in planning, not spiked.** `spawn(detached)` +
  `unref` was proven to outlive its parent on this machine (FINDINGS), so there is no throwaway
  Phase 0. The launcher (T08) is a real task carrying a hand-verified survival check instead.
- **Recovery before the thing that keeps it alive.** The coordinator records its own final status
  and the front-end classifies a gone process as crashed (T01, T10) before start ties a keep-awake
  hold to a run (T08) — so a run is always readable and recoverable, never a mystery held awake.
- **The thing only a person can judge is built last.** The live TUI (T12) and the survival check
  (T08) are the two hand-verified pieces; everything they need is green before they are built.

```
Phase 1  ▸  T01 … T04     pure core, headless        no UI exists
Phase 2  ▸  T05 … T09     the machine, faked in tests
Phase 3  ▸  T10           the coordinator self-reports
Phase 4  ▸  T11 … T12     the front-end               hand-verified
Phase 5  ▸  T13           write it down
```

---

## Phase 1 — The decision logic (pure, headless)

| # | Task | Depends on |
|---|---|---|
| [T01](tasks/T01-run-state.md) | run-state | — |
| [T02](tasks/T02-index-record.md) | index-record | — |
| [T03](tasks/T03-snapshot-model.md) | snapshot-model | — |
| [T04](tasks/T04-dashboard-model.md) | dashboard-model | T01 |

At the end: a run's four-state classification, the index-entry and snapshot formats, and the
dashboard's list model and keyboard behaviour are all implemented and tested without a terminal.

## Phase 2 — Touching the machine (shell, OS faked in tests)

| # | Task | Depends on |
|---|---|---|
| [T05](tasks/T05-process-identity.md) | process-identity | T01 |
| [T06](tasks/T06-index-store.md) | index-store | T02 |
| [T07](tasks/T07-snapshot-store.md) | snapshot-store | T03 |
| [T08](tasks/T08-start-detached.md) | start-detached | T05, T06 |
| [T09](tasks/T09-stop-and-remove.md) | stop-and-remove | T05, T06 |

At the end: a run can be launched detached and registered, held awake, stopped immediately, and
removed — all provable with the process and filesystem calls injected, plus the hand-verified
survival check on T08.

## Phase 3 — The coordinator reports on itself

| # | Task | Depends on |
|---|---|---|
| [T10](tasks/T10-coordinator-reporting.md) | coordinator-reporting | T07 |

At the end: a detached coordinator writes its live snapshot each pass, records its own final
status on every exit path, and handles the stop signal — leaving worktrees and marking `stopped`.

## Phase 4 — The front-end (hand-verified)

| # | Task | Depends on |
|---|---|---|
| [T11](tasks/T11-pir-command.md) | pir-command | T08 |
| [T12](tasks/T12-dashboard-tui.md) | dashboard-tui | T04, T07, T09, T10, T11 |

At the end: `pir {slug}` and `pir` work end to end, and the dashboard reads right to a person.

## Phase 5 — Write it down

| # | Task | Depends on |
|---|---|---|
| [T13](tasks/T13-docs-and-install.md) | docs-and-install | T12 |

The Task cell is the task's kebab slug, matching its `tasks/T{nn}-{slug}.md` filename (DESIGN §2.9).
Every task is built by an autonomous worker; the two whose real proof is a person's judgement (T08,
T12) have the worker build and prepare, then ask the person through the normal question path.

---

## Critical path

```
T01 → T05 → T08 → T11 → T12 → T13
```

Off the path and able to slot in wherever convenient: T02, T03, T04, T06, T07 (all of Phase 1 and
the two other stores), and T09 and T10, which land any time before T12.

## Parallel width

13 tasks · longest dependency chain 6 · up to 4 could run at once (the four Phase-1-plus-stores
tasks T04/T05/T06/T07 share a layer). Wide enough that a coordinator run helps in the middle
phases; the front end (T11 → T12 → T13) is a serial tail because each needs the one before. These
are the numbers `analyzeParallelism` reports from the task table; every dependency here is real.

## Rough sizing

| Weight | Tasks |
|---|---|
| **Heavy** | T12 (the live TUI), T10 (coordinator integration), T08 (detached launcher) |
| **Medium** | T04, T05, T06, T07, T09, T11 |
| **Light** | T01, T02, T03, T13 |

Where it may overrun: T12, because a raw-mode terminal app is fiddly and the feel needs a person
in the loop; and T10, because it edits the live coordinator and must not disturb the classic
foreground path (the `PIR_RUN` guard is what keeps that risk contained).

## Decisions still open

Nothing blocks. Two `how` details left to the implementing sessions, each with a default in the
task doc: the exact grace period before stop escalates to a force-kill (T09), and whether the live
view polls the snapshot on an interval or watches the file (T12 — polling is the safe default, as
FSEvents behaviour with atomic renames is the kind of thing that bites).
