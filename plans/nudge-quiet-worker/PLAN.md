# Implementation plan

11 tasks in 4 phases. Each has a file in [tasks/](tasks/) with its goal, the files it touches, the
interfaces it defines, and what "done" means.

Track state in [PROGRESS.md](PROGRESS.md). Read [DESIGN.md](DESIGN.md) first.

---

## Shape of the build

- **The riskiest unknown goes first.** Whether a worker's own hooks can show it the coordinator's note,
  looping and idle, is unproven (DESIGN §2.1). T00 settles it on this machine before anything is built
  on it, decides the idle path, and captures the real transcript lines T01 parses.
- **Everything testable automatically comes before the live run.** Phases 1 and 2 are proven against
  the pure core, the hook script against a temp notes dir, scratch git, and the fake platform with an injected
  clock. By the end of Phase 2 a whole stuck stretch (nudge, nudge, stuck, unstuck) passes in
  `loop.test.mjs`.
- **Small before full size.** The live drill runs one worker with a 2-minute quiet period and a
  25-minute cap on a scratch repo, never the 15-minute default on a real plan.
- **Prose after the machine.** The worker skill (T07) follows the fixed text (T02); the docs (T08)
  follow the wiring (T05, T06, T07), so they describe what was built.

```
Phase 0  ▸  T00                          prove the inbox              throwaway spike
Phase 1  ▸  T01 T02 T03 T04 T06          pure rules + shell parts     headless, parallel
Phase 2  ▸  T05, T07, T08                wire it, teach it, doc it
Phase 3  ▸  T09 → T10                    scenario, then the live drill with the person
```

---

## Phase 0 — Prove the ground

| # | Task | Depends on |
|---|---|---|
| [T00](tasks/T00-prove-the-inbox.md) | prove-the-inbox | — |

**T00 gates the whole plan** (DESIGN §2.8). If hooks passed at spawn do not load, or the tool hook cannot
show the note, there is no supported channel and the plan returns to the person. If the idle wake fails,
the idle case uses stop-and-resume (DESIGN §2.1) without a new decision. The note location it records
feeds T04; its transcript fixture is T01's test input.

## Phase 1 — The rules and the parts

| # | Task | Depends on |
|---|---|---|
| [T01](tasks/T01-activity-signals.md) | activity-signals | T00 |
| [T02](tasks/T02-nudge-decision.md) | nudge-decision | T00 |
| [T03](tasks/T03-activity-reader.md) | activity-reader | T00 |
| [T04](tasks/T04-nudge-sender.md) | nudge-sender | T00 |
| [T06](tasks/T06-dashboard-label.md) | dashboard-label | T00 |

At the end of Phase 1 every rule is proven in `src/core/`, the platform can observe a worker and
write a note its hooks show, and the dashboard can render the suffix, but nothing calls any of it yet. T06 is numbered
after T05 but has no dependency on it; it reads two optional fields whose names DESIGN §2.6 fixes.

## Phase 2 — Wire, teach, document

| # | Task | Depends on |
|---|---|---|
| [T05](tasks/T05-loop-wiring.md) | loop-wiring | T01, T02, T03, T04 |
| [T07](tasks/T07-worker-skill.md) | worker-skill | T02 |
| [T08](tasks/T08-docs.md) | docs | T05, T06, T07 |

At the end of Phase 2 a real coordinator would nudge real workers, workers know what a nudge is, and
`/docs` describes it. T05 is the wirer for every Phase 1 part: it builds the nudge step in `runPass`,
threads `PARALLEL_NUDGE_MS` and `now` through `coordinate.mjs`, and copies `nudges`/`stuck` into
`buildRunState`, which is what connects T06's label to live data.

## Phase 3 — See it for real

| # | Task | Depends on |
|---|---|---|
| [T09](tasks/T09-quiet-worker-scenario.md) | quiet-worker-scenario | T05, T06, T07 |
| [T10](tasks/T10-live-nudge-drill.md) | live-nudge-drill | T09 |

T10 reaches every build task through T09 → T05 → T01–T04, T09 → T06 and T09 → T07.

---

## Critical path

```
T00 → T01 → T05 → T09 → T10
```

T01, T03 and T04 are equally long feeders into T05. T02, T06, T07 and T08 are off the critical path.

Leaves: T10 is the final deliverable. T08 is also a leaf because the docs are consumed by readers,
not by any later task; the live drill does not read them.

## Parallel width

11 tasks · longest dependency chain 5 · up to 5 could run at once (T01, T02, T03, T04, T06 after T00).

## Rough sizing

| Weight | Tasks |
|---|---|
| **Heavy** | T05 |
| **Medium** | T01, T03, T04, T09, T10 |
| **Light** | T00, T02, T06, T07, T08 |

T05 is where overruns will happen: the per-task state
has to survive phase changes without disturbing the existing idle-gate accounting. T00 may overrun if
delivery turns out to depend on settings, in which case it stops and asks rather than working around it.

## Coordination with sibling work

A sibling brief ("resume a crashed worker") also edits `src/shell/loop.mjs` around dead-worker
handling. If both plans are built, do not run their loop tasks at the same time. Under the idle fallback
(DESIGN §2.1), this plan's T04 builds on that plan's T02 (`platform.revive`); if T00 chooses the
fallback and that task is not built yet, T04 stops and raises it with the person. There are also
uncommitted edits to `src/shell/coordinate.mjs` and three docs (the `MAX_PASSES` removal) in the working
tree at plan time; T05 and T08 touch the same files and should start after that change is committed.

## Decisions still open

None block. T00's answers may adjust T03's transcript lookup and T04's note location and hook output
format; both task docs say so.
