# Implementation plan

10 tasks in 4 phases. Each has a file in [tasks/](tasks/) with its goal, the files it touches, the
interfaces it defines, and what "done" means.

Track state in [PROGRESS.md](PROGRESS.md). Read [DESIGN.md](DESIGN.md) first.

---

## Shape of the build

- **Rules before screens.** Phase 1 proves the shared base-watch rule, the finisher's single-run
  wording and the whole new end of a single run in core, in milliseconds. Phase 2 executes them; phase 3
  draws them.
- **Extend, do not fork.** T01 lifts the build's base-watch decision into core with builds unchanged;
  T02 parameterises the existing finisher rather than copying it. Both are guarded by the build's
  existing tests.
- **The rig exists.** The single-run pty rig and its drill helpers carry the screen work; no rig task.
- **Live last.** One real run (T10) after the fake-session drill and the docs.

```
Phase 1  ▸  T01 T02 T03 T04      base watch, finisher wording, end flow, helper skill   headless
Phase 2  ▸  T05 T06              program wiring, alerts                                 headless
Phase 3  ▸  T07 T08 T09          screen, drill, docs                                    terminal UI
Phase 4  ▸  T10                  live run with the person's Go
```

---

## Phase 1 — The pieces

| # | Task | Depends on |
|---|---|---|
| [T01](tasks/T01-base-watch.md) | base-watch | — |
| [T02](tasks/T02-finisher-for-single.md) | finisher-for-single | — |
| [T03](tasks/T03-single-end-flow.md) | single-end-flow | — |
| [T04](tasks/T04-single-helpers-skill.md) | single-helpers-skill | — |

At the end: every rule of the new end sequence is decided by `decideSingleStep` and tested; the
finisher can be started for a single run; builds are unchanged.

## Phase 2 — Wiring

| # | Task | Depends on |
|---|---|---|
| [T05](tasks/T05-single-finisher-wiring.md) | single-finisher-wiring | T01, T02, T03, T04 |
| [T06](tasks/T06-single-finisher-alerts.md) | single-finisher-alerts | T05 |

At the end: a single run against the fake Claude syncs, holds its helpers, hands over to the finisher and
ends `finished`, `merged` or `closed`; the alerts follow it.

## Phase 3 — Screen, drill, docs

| # | Task | Depends on |
|---|---|---|
| [T07](tasks/T07-single-finisher-screen.md) | single-finisher-screen | T05 |
| [T08](tasks/T08-single-finisher-drill.md) | single-finisher-drill | T06, T07 |
| [T09](tasks/T09-single-finisher-docs.md) | single-finisher-docs | T05, T06, T07 |

## Phase 4 — Live

| # | Task | Depends on |
|---|---|---|
| [T10](tasks/T10-single-finisher-live.md) | single-finisher-live | T08, T09 |

Main path, builder and wirer per step:

| Step | Built by | Wired in by |
|---|---|---|
| review green → sync starts | T03 (`decideSingleStep`) | T05 (`single-run.mjs` executes `prepareBase`, `syncBase`) |
| clash → resolve helper; red → fix helper | T03 (actions, `helperInstruction`), T04 (skill) | T05 (holder spawns `resolve`/`fix`, `singleChecks` for their reports) |
| base moved / merged by hand | T01 (`baseWatchVerdict`) | T01 (`coordinate.mjs`), T05 (`single-run.mjs` facts.watch) |
| hand-over → finisher for a single run | T02 (`startFinisher` `kind: 'single'`, opening, skill) | T05 (`startFinisher` action, `withAgent` around the inbox) |
| the person's Go reaches the finisher | existing (`withAgent`, person inbox, go scan) | T05 (inbox wrap), T07 (`c`, `→` on `merge`) |
| run ends finished / merged / closed | T03 | T05 (`finish` actions, final status) |
| resume in sync or wait | T03 (facts.resume) | T05 (`launch.mjs resumeRun` path, `runSingle --resume`) |
| alerts | existing (`finisherNotifyView`, `endAlert`, `singleEndAlert`) | T06 (`alertPass` in `single-run.mjs`) |
| rows, states, progress | T03 (`singleProgress`), T07 | T07 (`singleRunState`, `plandisplay.mjs`, `dashboard.mjs`, `pir-tui.mjs`) |
| fake sessions for tests | T05 (`fake/sessions.mjs`) | T05, used by T07, T08 |

---

## Critical path

```
T03 → T05 → T06 → T08 → T10
```

T01, T02, T04 run beside T03; T07 beside T06; T09 beside T08.

Leaves: T10 only.

## Parallel width

10 tasks · longest dependency chain 5 · up to 4 could run at once.

## Rough sizing

| Weight | Tasks |
|---|---|
| **Heavy** | T03, T05 |
| **Medium** | T02, T07, T08 |
| **Light** | T01, T04, T06, T09, T10 |

T05 is where it will overrun: `single-run.mjs` is 900 lines and the wait step adds a long-lived phase
with a second kind of session (the finisher, not held by the holder) to a program that used to exit at
`ready`.

## Decisions still open

None from the user. For the plan review: the suite is timing-flaky under heavy machine load (FINDINGS);
whether that needs anything beyond rerunning the failing files is not this plan's to decide.
