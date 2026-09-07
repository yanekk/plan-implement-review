# T04 — `analyzeParallelism` — critical path, width, auto/you counts

**Phase:** 1 · **Depends on:** T02 · **Weight:** light · **Runs:** auto

## Goal

The pure metric that lets `/pir-plan` show a user how parallel a plan actually is, and lets a
reader see whether a plan will benefit from the coordinator or is serial by nature. Given the
parsed task list with its dependencies and `Runs` markers, compute the longest dependency chain,
the widest set of tasks that could run at once, and how many tasks are `auto` versus `you`. A pure
function of the task list, so the width report is proven in the test run.

## Design sections this implements

DESIGN §2.7 (planning for parallelism, the width report), §3.2 (`parallelism.mjs`).

## Files

- `src/core/parallelism.mjs` — `analyzeParallelism`.
- `src/core/parallelism.test.mjs`.

## Interface

```
analyzeParallelism(tasks) → {
  criticalPathLength,   // longest chain of dependencies, counted in tasks
  maxWidth,             // widest topological layer: group tasks by longest-path depth from a root,
                        //   the largest group is the most that could ever run at once
  autonomousCount,      // tasks with runs === "auto"
  humanCount,           // tasks with runs === "you"
  totalTasks
}
  // tasks: [ { num, deps, runs } ] from parseProgress. maxWidth is the max-antichain proxy via
  // topological layering — simple to compute and honest: a long thin chain has maxWidth 1.
```

`maxWidth` is defined as the largest topological layer, not the true maximum antichain, because the
layer width is cheap, deterministic and good enough to tell a wide plan from a chain — and the
report's job is to inform, not to schedule.

## Tests

- [ ] A single chain T0→T1→T2 gives criticalPathLength 3, maxWidth 1.
- [ ] Three independent tasks give criticalPathLength 1, maxWidth 3.
- [ ] A diamond (A; B,C depend on A; D depends on B,C) gives criticalPathLength 3, maxWidth 2.
- [ ] auto/you counts match the markers; totalTasks is the list length.
- [ ] A task with an unknown dependency is reported, not silently treated as a root.
- [ ] An empty task list yields zeroes without throwing.

## Done when

- [ ] `analyzeParallelism` returns the four numbers correctly for chain, fan-out and diamond.
- [ ] It reads no clock and no filesystem; the boundary test passes.
- [ ] `npm test` is green.
