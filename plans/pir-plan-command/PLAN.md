# Implementation plan

18 tasks in 3 phases. Each has a file in [tasks/](tasks/) with its goal, the files it touches, the
interfaces it defines, and what "done" means.

Track state in [PROGRESS.md](PROGRESS.md). Read [DESIGN.md](DESIGN.md) first.

---

## Shape of the build

- **No spike.** The one load-bearing unknown, resuming a held session after its process died, was
  measured the same day by `plans/resume-dead-worker` (DESIGN §2.14); the state machine goes first.
- **Everything testable without a screen is built first.** By the end of Phase 1 a planning run goes
  from brief to reviewed plan with fake sessions, headless, and the build reads its plan from the
  branch; Phase 2 then puts the screen on machinery already proven.
- **The free end-to-end path comes before the paid one.** The fake Claude and the rig (T05, T10) prove
  the whole flow in `npm test`; the one real-Claude run (T18) comes last, after the skills speak the
  report protocol.
- **Nothing is deleted and `main` is never written**, so no task needs a recovery route built before
  it; the stop and reap it relies on already exist.

```
Phase 1  ▸  T01 … T09             the machinery, headless        no new screen
Phase 2  ▸  T10 … T14             the screens                    driven by the rig
Phase 3  ▸  T15 … T18             skills, docs, the real run
```

---

## Phase 1 — The machinery

| # | Task | Depends on |
|---|---|---|
| [T01](tasks/T01-plan-flow-core.md) | plan-flow-core | — |
| [T02](tasks/T02-run-record-type.md) | run-record-type | — |
| [T03](tasks/T03-plan-home.md) | plan-home | — |
| [T04](tasks/T04-plan-branch.md) | plan-branch | — |
| [T05](tasks/T05-fake-claude-sessions.md) | fake-claude-sessions | — |
| [T06](tasks/T06-plan-run-planner.md) | plan-run-planner | T01, T02, T04, T05 |
| [T07](tasks/T07-plan-run-review.md) | plan-run-review | T06 |
| [T08](tasks/T08-plan-launch.md) | plan-launch | T02, T03, T04 |
| [T09](tasks/T09-pir-commands.md) | pir-commands | T08 |

At the end of Phase 1, `startPlanRun` starts a detached planning run that, against fake sessions, ends
with a reviewed plan on `pir/{slug}`; `pir start {slug}` builds it from the branch; `pir {slug}` is an
error.

## Phase 2 — The screens

| # | Task | Depends on |
|---|---|---|
| [T10](tasks/T10-plan-rig.md) | plan-rig | T05 |
| [T11](tasks/T11-dashboard-type.md) | dashboard-type | T02, T07, T08, T10 |
| [T12](tasks/T12-plan-watch-view.md) | plan-watch-view | T07, T08, T10, T11 |
| [T13](tasks/T13-brief-box.md) | brief-box | T09, T12 |
| [T14](tasks/T14-plan-screen-drill.md) | plan-screen-drill | T11, T12, T13 |

At the end of Phase 2 the whole flow, brief box to green hand-off, is driven through the real screen
against fakes in `npm test`, and a worker has judged it against DESIGN and the prototype.

## Phase 3 — Skills, docs, the real run

| # | Task | Depends on |
|---|---|---|
| [T15](tasks/T15-planning-skills.md) | planning-skills | T01 |
| [T16](tasks/T16-docs-readme.md) | docs-readme | T14, T15 |
| [T17](tasks/T17-harness-plan-fixture.md) | harness-plan-fixture | T07, T08, T15 |
| [T18](tasks/T18-live-plan-run.md) | live-plan-run | T14, T16, T17 |

At the end of Phase 3 a real planner and reviewer, driven by `pir plan` in a scratch repo, produced a
reviewed plan whose build went green, and the docs say how.

---

## Wiring of the main path

| Step | Built by | Plugged in by |
|---|---|---|
| `pir plan …` / `pir start` / error | T09 | T09 (`pir.mjs`) |
| Brief box, landing in the planner | T13 | T13 (`pir.mjs`) |
| Temporary branch and worktree | T04 | T08 (`startPlanRun`) |
| Detached planning program | T06, T07 | T08 (spawn), T11 (resume chord) |
| Planner and reviewer sessions, answers | T06, T07 | T06 (`startPersonInbox`), T12 (steps → conversation) |
| Report verification, rename | T01, T07 | T07 (`plan-run.mjs`) |
| Skills speaking the reports | T15 | T06/T07 opening instructions (DESIGN §2.3) |
| TYPE, plan rows, resume | T02, T11 | T11 (`pir-tui.mjs`) |
| The go question, start and not now | T12 | T12 (`pir-tui.mjs` → `startRun`) |
| Build reading the plan from the branch | T03 | T03 (`coordinate.mjs`, `launch.mjs`) |

## Critical path

```
T01 → T06 → T07 → T11 → T12 → T13 → T14 → T16 → T18
```

T02, T03, T04, T05, T08, T09 and T10 feed it from the side and can run while T01 does. T15 can
run any time after T01.

Leaves: T18 only.

## Parallel width

18 tasks · longest dependency chain 9 · up to 5 could run at once (`analyzeParallelism`, 2026-09-26).

## Rough sizing

| Weight | Tasks |
|---|---|
| **Heavy** | T06, T07, T12, T18 |
| **Medium** | T01, T05, T08, T10, T11, T13, T14, T15, T16, T17 |
| **Light** | T02, T03, T04, T09 |

T18 will overrun: a real planner's conversation with a stand-in is the least predictable thing here,
and T17's answerer is guessed until T18 watches it. T12 carries both the steps frame and the go flow
into a fake build; if its "Done when" does not fit a session, the fake build to green is the part to
move to T14.

## Decisions still open

- §5.3 bins are proposals until the plan review places them.
