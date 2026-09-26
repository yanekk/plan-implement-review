# Implementation plan

9 tasks in 3 phases. Each has a file in [tasks/](tasks/) with its goal, the files it touches, the
interfaces it defines, and what "done" means.

Track state in [PROGRESS.md](PROGRESS.md). Read [DESIGN.md](DESIGN.md) first.

Re-planned 2026-09-26 on `live-workers` (DESIGN, head note). The first version had 11 tasks; its T00
(hook probe) and T04 (note sender and worker hooks) are dropped because the nudge now goes over
`platform.send`, and the rest are renumbered in order.

---

## Shape of the build

- **No probe first.** The channel is the line `live-workers` built and measured (DESIGN §2.1), so
  there is no unproven ground to settle before building. The only unmeasured thing, how a real worker
  reacts to the text, is what the live drill (T09) is for.
- **Everything testable automatically comes before the live run.** Phase 1 is the pure core, the
  platform's observer against scratch git and the fake worker entries, and the display. By the end of
  Phase 2 a whole stuck stretch (nudge, nudge, stuck, unstuck) and an unpark pass in `loop.test.mjs`.
- **Small before full size.** The live drill runs one worker with a 2-minute quiet period and a
  25-minute cap on a scratch repo, never the 15-minute default on a real plan.
- **Prose after the machine.** The worker skill (T06) follows the fixed text (T02); the docs and README
  (T07) follow the wiring (T04, T05, T06), so they describe what was built.

```
Phase 1  ▸  T01 T02 T03 T05              pure rules + observer + label     headless, parallel
Phase 2  ▸  T04, T06, T07                wire it, teach it, doc it
Phase 3  ▸  T08 → T09                    scenario, then the live drill
```

---

## Phase 1 — The rules and the parts

| # | Task | Depends on |
|---|---|---|
| [T01](tasks/T01-activity-signals.md) | activity-signals | — |
| [T02](tasks/T02-nudge-decision.md) | nudge-decision | — |
| [T03](tasks/T03-worker-observer.md) | worker-observer | — |
| [T05](tasks/T05-dashboard-label.md) | dashboard-label | — |

At the end of Phase 1 every rule is proven in `src/core/`, the platform can hand the loop a worktree
fingerprint and a worker's new log entries, and the dashboard can render the suffix, but nothing calls
any of it yet. T05 is numbered after T04 but has no dependency on it; it reads two optional fields whose
names DESIGN §2.6 fixes.

## Phase 2 — Wire, teach, document

| # | Task | Depends on |
|---|---|---|
| [T04](tasks/T04-loop-wiring.md) | loop-wiring | T01, T02, T03 |
| [T06](tasks/T06-worker-skill.md) | worker-skill | T02 |
| [T07](tasks/T07-docs.md) | docs | T04, T05, T06 |

At the end of Phase 2 a real coordinator would nudge real workers, workers know what a nudge is, and
`/docs` and `README.md` describe it. T04 is the wirer for every Phase 1 part: it builds the nudge and
unpark steps in `runPass`, threads `PARALLEL_NUDGE_MS` and `now` through `coordinate.mjs`, copies
`nudges`/`stuck` into `buildRunState` (which connects T05's label to live data), and adds the send-text
guard.

## Phase 3 — See it for real

| # | Task | Depends on |
|---|---|---|
| [T08](tasks/T08-quiet-worker-scenario.md) | quiet-worker-scenario | T04, T05, T06 |
| [T09](tasks/T09-live-nudge-drill.md) | live-nudge-drill | T08 |

T09 reaches every build task through T08 → T04 → T01–T03, T08 → T05 and T08 → T06.

---

## Critical path

```
T01 → T04 → T08 → T09
```

T01 and T03 are equally long feeders into T04. T02, T05, T06 and T07 are off the critical path.

Leaves: T09 is the final deliverable. T07 is also a leaf because the docs are consumed by readers,
not by any later task; the live drill does not read them.

## Parallel width

9 tasks · longest dependency chain 4 · up to 4 could run at once (T01, T02, T03, T05).

## Rough sizing

| Weight | Tasks |
|---|---|
| **Heavy** | T04 |
| **Medium** | T01, T08, T09 |
| **Light** | T02, T03, T05, T06, T07 |

T04 is where overruns will happen: the per-task state has to survive phase changes, the unpark has to
leave the conflict-sent park alone, and neither may disturb the existing idle-gate accounting.

## Coordination with sibling work

`resume-dead-worker` also edits `src/shell/loop.mjs` around dead-worker handling, and it too was
designed on `claude --bg` workers and is to be re-planned on `live-workers` before it is built. Do not
run the two plans' loop tasks at the same time. This plan no longer depends on anything from it: the
old stop-and-resume fallback that would have used its `platform.revive` is gone.

## Decisions still open

None block the build. Plan review should confirm with the user the one behaviour this re-plan derived
rather than was told: a worker fixing a merge conflict pir sent it is eligible for a nudge (DESIGN
§2.4, §7).
