# Implementation plan

15 tasks in 4 phases. Each has a file in [tasks/](tasks/) with its goal, the files it touches, the
interfaces it defines, and what "done" means.

Track state in [PROGRESS.md](PROGRESS.md). Read [DESIGN.md](DESIGN.md) first.

---

## Shape of the build

- **Precondition.** `real-asking-state` is merged into main before T00 starts (DESIGN §7). T00 checks
  it and stops if it has not landed.
- **Probe first.** T00 measures what the real CLI sends for reserved requests and whether the agent's
  allowance holds (DESIGN §3.4). T01's rulebook and T03's gate are built on its answers.
- **Headless before the screen.** T01 to T05 are proven in `npm test` with the fake worker and fake
  platform; the screen (T06) wires onto rules already proven, then a drill (T07) uses it whole.
- **The only paid run is last** (T09), bounded by ceiling 2 and a 20-minute timeout.

```
Phase 0  ▸  T00                      probe                       needs the precondition
Phase 1  ▸  T01  T02  T03            rulebook, skill, the held agent
Phase 2  ▸  T04 → T05                 routing, then the end of run
Phase 3  ▸  T06 → T07,  T08 → T09    screen, drill, docs, live check
```

## Phase 0 — Prove the ground

| # | Task | Depends on |
|---|---|---|
| [T00](tasks/T00-coordinator-probe.md) | coordinator-probe | — |

T00 gates two things. If `matchedAskRule` is not set for rule-forced asks, the rulebook relies on the
`permissions.ask` match alone (already planned as the second check). If the allowance does not hold
(default mode lets a tool through unprompted, or an absolute-path Write is refused), T03's gate
changes shape and the person is asked before T03 starts.

## Phase 1 — The agent, headless

| # | Task | Depends on |
|---|---|---|
| [T01](tasks/T01-coordinator-rulebook.md) | coordinator-rulebook | T00 |
| [T02](tasks/T02-coordinator-skill.md) | coordinator-skill | — |
| [T03](tasks/T03-coordinator-session.md) | coordinator-session | T01 |

T03 builds the held agent and its decision path; it is wired into a run by T04 and T05. T02's skill is
consumed by the agent's opening instruction (T03 names it) and documented by T08.

## Phase 2 — Wire it into the run

| # | Task | Depends on |
|---|---|---|
| [T04](tasks/T04-answer-first-routing.md) | answer-first-routing | T03 |
| [T05](tasks/T05-end-of-run-handoff.md) | end-of-run-handoff | T04 |

T04 is the wirer for answering: it starts the agent in `coordinate.mjs`, briefs it each pass, and adds
`--no-coordinator`. T05 is the wirer for the end: it replaces the complete-pass hand-off in
`coordinate.mjs`. T05 follows T04 because its end sequence needs the agent T04 starts in the run.

## Phase 3 — Screen, drill, docs, live

| # | Task | Depends on |
|---|---|---|
| [T06](tasks/T06-coordinator-screen.md) | coordinator-screen | T04, T05 |
| [T07](tasks/T07-coordinator-drill.md) | coordinator-drill | T06 |
| [T08](tasks/T08-docs.md) | docs | T02, T04, T05, T06 |
| [T09](tasks/T09-live-coordinator-check.md) | live-coordinator-check | T07, T08 |
| [T10](tasks/T10-end-tests-fix.md) | end-tests-fix | T05; blocks T09 |
| [T11](tasks/T11-end-helper-row.md) | end-helper-row | T06, T10; blocks T09 |
| [T12](tasks/T12-coordinator-row.md) | coordinator-row | T06, T11 |
| [T13](tasks/T13-hold-timeout.md) | hold-timeout | T04, T12; blocks T14 |
| [T14](tasks/T14-live-concurrent-check.md) | live-concurrent-check | T12, T13 |

At the end of phase 3 the feature is documented and seen working on a real run with the person's phone.

---

## Critical path

```
T00 → T01 → T03 → T04 → T05 → T06 → T07 → T09
```

T02 is off the path and can run at any time before T08. T08 runs beside T07.

Leaves: T09, T14. T12–T14 were added after T09 (2026-09-28): T12 → T13 → T14. T13 follows T12 because both change the row display.

## Parallel width

10 tasks · longest dependency chain 8 · up to 2 could run at once (`analyzeParallelism`). Serial by nature: each part plugs
into the one before it.

## Rough sizing

| Weight | Tasks |
|---|---|
| **Heavy** | T04, T05 |
| **Medium** | T00, T01, T03, T06, T07, T09 |
| **Light** | T02, T08 |

T04 and T05 change the live run's pass loop and its end; both are where a restart or a race will
surface something the fake did not script.

## Decisions still open

- T03's gate shape depends on T00. If the allowance does not hold as planned, the person is asked
  before T03.
- The exact destructive list (DESIGN §3.3) is a starting set; T01 may add to it, never remove.
