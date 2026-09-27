# Implementation plan

6 tasks in 3 phases. Each has a file in [tasks/](tasks/) with its goal, the files it touches, the
interfaces it defines, and what "done" means.

Track state in [PROGRESS.md](PROGRESS.md). Read [DESIGN.md](DESIGN.md) first. `real-asking-state` must be
merged to `main` before T01 starts (DESIGN, Base).

---

## Shape of the build

- **Headless before live.** T01–T04 are proven in `npm test` with fixtures and hand-built activity; the
  only paid run is T06, bounded by ceiling 2 and a 15-minute timeout.
- **No probe.** The `background` signal is already in recorded logs, and what is unmeasured can only err
  towards a false alarm (DESIGN §2.2, §7).
- **Prose last.** The docs (T05) follow the live check, so they describe what was seen on real workers.

```
Phase 1  ▸  T01  T02  T04        background fold, stopped predicate, skill line     parallel
Phase 2  ▸  T03   T06            planning steps; live check                         T03 needs T02; T06 needs T01, T02
Phase 3  ▸  T05                  docs and README                                    needs T03, T04, T06
```

## Phase 1 — The rule and its inputs

| # | Task | Depends on |
|---|---|---|
| [T01](tasks/T01-background-fold.md) | background-fold | — |
| [T02](tasks/T02-stopped-predicate.md) | stopped-predicate | — |
| [T04](tasks/T04-worker-reports-every-ask.md) | worker-reports-every-ask | — |

T02 is its own wirer: it extends `waitingOn` and `displayPhaseFor` in `coordinate.mjs`, whose existing
callers already feed the row, the clock and Remote Control. T01's field reaches it through
`platform.workers()`, which already carries each worker's `workerActivity`. T02 is written against the
`background` shape fixed in T01's interface, so neither waits for the other.

## Phase 2 — Planning steps, and the live check

| # | Task | Depends on |
|---|---|---|
| [T03](tasks/T03-planning-steps-asking.md) | planning-steps-asking | T02 |
| [T06](tasks/T06-stopped-asking-live.md) | stopped-asking-live | T01, T02 |

T03 reuses T02's `stoppedOnPerson` and wires it into `planRunState` and the `stoppedAt` tracking in
`plan-run.mjs`. T06 runs real workers through T01's fold and T02's predicate. Its fixture forbids reports,
so it does not exercise T04's skill line, and it does not exercise T03; both are proven outside it
(DESIGN §4).

## Phase 3 — Document

| # | Task | Depends on |
|---|---|---|
| [T05](tasks/T05-docs.md) | docs | T03, T04, T06 |

T05 reaches every task: T03 → T02, T04 directly, and T06 → T01, T02. It is the only leaf.

---

## Critical path

```
T02 → T06 → T05
```

T02 → T03 → T05 is as long. T01 and T04 are off the critical path.

## Sizing

T02 and T06 medium, T01, T03, T04 and T05 light.

## Parallel width

6 tasks, longest chain 3, up to 3 can run at once (T01, T02, T04).

## Open

- No terminal-driving end-to-end test or drill: no screen is drawn or changed, only when an existing
  label applies, asserted on the run state (DESIGN §4). Plan review agreed: T06 reads the same status
  snapshots the screen paints from.
- Monitor jobs are measured in T06 (plan review, user 2026-09-27). Background subagents stay unmeasured
  (DESIGN §2.2).
