# Implementation plan

13 tasks in 4 phases. Each has a file in [tasks/](tasks/) with its goal, the files it touches, the
interfaces it defines, and what "done" means.

Track state in [PROGRESS.md](PROGRESS.md). Read [DESIGN.md](DESIGN.md) first.

**Start condition.** This plan is built on base-branch (DESIGN, top). Before `pir start single-runs`:
merge `pir/base-branch` into `main`, then `main` into `pir/single-runs` (user, 2026-09-29).

---

## Shape of the build

- **Rules before screens.** Phase 1 proves the settings rule and the whole run's decision function in
  milliseconds; phase 2 executes them; phase 3 wires the box and the row to logic already proven.
- **Extract before extend.** T03 moves session holding out of `plan-run.mjs` with planning unchanged, so
  the single program is built on the shared holder rather than a copy.
- **The rig before the surfaces.** T08 extends the planning rig with fake builder and reviewer scripts;
  T09 and T10 prove themselves through it; T11 drills the whole flow.
- **Live last.** One real run (T12) after the fake-session drill, then the docs (T13) describe what was
  seen.

```
Phase 1  ▸  T01 T02 T03          settings, the flow, the shared holder     headless
Phase 2  ▸  T04 T05 T06 T07      program, launch, alerts, skill            headless
Phase 3  ▸  T08 T09 T10 T11      rig, box, row, drill                      terminal UI
Phase 4  ▸  T12 T13              live run, docs
```

## Phase 1 — The rules

| # | Task | Depends on |
|---|---|---|
| [T01](tasks/T01-settings-commands.md) | settings-commands | — |
| [T02](tasks/T02-single-flow.md) | single-flow | — |
| [T03](tasks/T03-held-sessions.md) | held-sessions | — |

At the end: the settings files carry setup/test, `decideSingleStep` decides a whole run, and planning
runs on the shared holder with its tests unchanged.

## Phase 2 — The running program

| # | Task | Depends on |
|---|---|---|
| [T04](tasks/T04-single-program.md) | single-program | T02, T03 |
| [T05](tasks/T05-single-launch.md) | single-launch | T01, T02 |
| [T06](tasks/T06-single-alerts.md) | single-alerts | T04 |
| [T07](tasks/T07-single-skill.md) | single-skill | T02 |

At the end: `startSingleRun` starts a run that goes from setup to `ready` with fake sessions and real
git, alerts the phone, and the skill exists for real sessions.

## Phase 3 — The screen

| # | Task | Depends on |
|---|---|---|
| [T08](tasks/T08-single-rig.md) | single-rig | T04, T05 |
| [T09](tasks/T09-box-single.md) | box-single | T05, T08 |
| [T10](tasks/T10-single-row.md) | single-row | T04, T08 |
| [T11](tasks/T11-single-drill.md) | single-drill | T06, T09, T10 |

At the end: a person can start, follow, answer, stop, resume and finish a single run from `pir`.

## Phase 4 — For real

| # | Task | Depends on |
|---|---|---|
| [T12](tasks/T12-single-live.md) | single-live | T07, T11 |
| [T13](tasks/T13-docs-and-readme.md) | docs-and-readme | T12 |

---

## Critical path

```
T02 → T04 → T08 → T09 → T11 → T12 → T13
```

Off it: T01 (needed by T05), T03 (needed by T04), T05, T06, T07, T10.

Leaves: T13 only.

## Parallel width

13 tasks · longest dependency chain 7 · up to 3 could run at once.

## Rough sizing

| Weight | Tasks |
|---|---|
| **Heavy** | T03, T04, T10 |
| **Medium** | T02, T05, T08, T09, T11, T12 |
| **Light** | T01, T06, T07, T13 |

T03 is where this will overrun: `plan-run.mjs` is 834 lines with its session holding interleaved with
the planning flow, and its 774-line test file must stay green unchanged. T04 overruns if the red-round
and baseline plumbing is not kept inside `decideSingleStep`.

## Decisions still open

None blocks. If base-branch's merged interfaces differ from the names DESIGN cites, the task docs are
read against the merged code (DESIGN, top).
