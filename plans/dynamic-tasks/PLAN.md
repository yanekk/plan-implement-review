# Implementation plan

6 tasks in 3 phases. Each has a file in [tasks/](tasks/) with its goal, the files it touches, the
interfaces it defines, and what "done" means.

Track state in [PROGRESS.md](PROGRESS.md). Read [DESIGN.md](DESIGN.md) first.

---

## Shape of the build

- **Everything testable automatically is built and tested before any prose.** Phase A (T00–T02)
  is the whole mechanism, proven against the pure core and a scratch git repo. By its end the
  coordinator adopts and dispatches worker-introduced tasks and both scenarios pass in `loop.test`.
- **The riskiest part goes first.** The subtle piece is telling a genuinely new task from an edit
  of an existing one while enforcing add-only — that is T00, isolated as a pure function and tested
  exhaustively before anything calls it.
- **Small before full size.** The merge change (T01) is proven on the scratch repo before the loop
  wires it end to end (T02), and the live run against real agents (T05) comes last.
- **Prose describes built behaviour.** The worker contract (T03) and the docs (T04) are written
  after the machine works, so they describe what the code does rather than what it was meant to.

```
Phase A  ▸  T00 → T01 → T02     the mechanism (pure core + merge + loop)   headless, fully tested
Phase B  ▸  T03, T04            the worker contract and the docs           prose, after the machine
Phase C  ▸  T05                 the live drill                             a person in the loop
```

---

## Phase A — the mechanism

| # | Task | Depends on |
|---|---|---|
| [T00](tasks/T00-adopt-rule.md) | adopt-rule | — |
| [T01](tasks/T01-merge-adopts.md) | merge-adopts | T00 |
| [T02](tasks/T02-dispatch-adopted.md) | dispatch-adopted | T01 |

At the end of Phase A the coordinator adopts a new task row from a merging branch, refuses a
forbidden edit or a broken addition, and dispatches an adopted task by its dependencies — with
both DESIGN scenarios green in `loop.test.mjs`. No worker or doc has changed yet.

## Phase B — the worker contract and the docs

| # | Task | Depends on |
|---|---|---|
| [T03](tasks/T03-worker-add-task.md) | worker-add-task | T02 |
| [T04](tasks/T04-docs-and-rules.md) | docs-and-rules | T02 |

The Task cell is the task's kebab slug, matching its `tasks/T{nn}-{slug}.md` filename (DESIGN §2.9,
in the parallel-mode docs). At the end of Phase B a worker knows how to propose and, once approved,
add a task, the reviewer knows to validate it, and `/docs` plus `CLAUDE.md` document the behaviour.
T03 and T04 have no dependency on each other and can run at once.

## Phase C — the live drill

| # | Task | Depends on |
|---|---|---|
| [T05](tasks/T05-live-drill.md) | live-drill | T02, T03, T04 |

A harness fixture whose designed path is a worker introducing a task, plus the hands-on live run the
person drives — a real worker proposes a task, the person approves it, the coordinator adopts and
dispatches it. The automated half (the fixture installs and its spec validates) is a worker check;
the judgement of the live run is the person's (DESIGN §5.1).

---

## Critical path

```
T00 → T01 → T02 → { T03, T04 } → T05
```

T03 and T04 are the only tasks that can run together; everything else is one chain.

## Parallel width

6 tasks · longest dependency chain 5 · up to 2 could run at once. This is a mostly serial plan:
each layer of the mechanism needs the one below it, and the two prose tasks are the only pair that
overlap. Running it in parallel drains little faster than one task at a time; the dependencies are
honest, not padded to look wider (`analyzeParallelism` over this table returns the same numbers).

## Rough sizing

| Weight | Tasks |
|---|---|
| **Heavy** | — |
| **Medium** | T00 (the rule and its edge cases), T02 (loop wiring + both end-to-end scenarios) |
| **Light** | T01 (one merge step, real + fake), T03 (skill prose), T04 (docs prose), T05 (one fixture + a drill) |

Where it could overrun: T00's collision/edit detection has more edge cases than it first looks
(the merging task's own row differs only by glyph and must not read as an edit); and T02's scenario
tests need the fake worker to commit realistic rows on its branch.

## Decisions still open

None blocks the build. The two behaviours the person flagged at planning — a rare number collision
surfaced rather than auto-fixed, and a proposed task discarded if its author is rebuilt — are
settled in DESIGN §2.5 and §7 and need no further decision unless the plan review reopens them.
