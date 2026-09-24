# Implementation plan

12 tasks in 4 phases. Each has a file in [tasks/](tasks/). Track state in [PROGRESS.md](PROGRESS.md).
Read [DESIGN.md](DESIGN.md) first.

## Shape of the build

- **No spike.** Nothing here rests on an unmeasured machine claim: the parser is text, the runner is
  `/bin/sh -c`, and the async child fits the existing pass loop by polling.
- **Pure and plumbing first.** T01 (parser), T02 (runner), T05 (red reason) and T06 (spawn note)
  depend on nothing and are each proven in `npm test` before the engine uses them.
- **Engine, then method, then proof.** The skills (T08, T09) describe behaviour T03, T04 and T07
  build; T12 runs one real fixture through all of it and installs.

```
Phase 1 ▸ T01 T02 T05 T06        parser, runner, red reason, spawn note     headless
Phase 2 ▸ T03 T04 T07            start refusal, end gate, worker setup      headless
Phase 3 ▸ T08 T09 T10            planner, review + pir-work, fixtures       skills text, fixtures
Phase 4 ▸ T11 T12                docs, live proof + install                 real agents, a person looks
```

## Phase 1 — Foundations

| # | Task | Depends on |
|---|---|---|
| [T01](tasks/T01-parse-test-block.md) | parse-test-block | — |
| [T02](tasks/T02-command-runner.md) | command-runner | — |
| [T05](tasks/T05-red-reason-visible.md) | red-reason-visible | — |
| [T06](tasks/T06-spawn-note.md) | spawn-note | — |

## Phase 2 — Engine

| # | Task | Depends on |
|---|---|---|
| [T03](tasks/T03-start-refusal.md) | start-refusal | T01 |
| [T04](tasks/T04-end-gate-from-block.md) | end-gate-from-block | T01, T02 |
| [T07](tasks/T07-worker-setup.md) | worker-setup | T01, T02, T06 |

At the end of phase 2 the engine refuses a plan without a block, prepares every worker's worktree,
and gates on the declared lines.

## Phase 3 — Method

| # | Task | Depends on |
|---|---|---|
| [T08](tasks/T08-planner-writes-block.md) | planner-writes-block | T01 |
| [T09](tasks/T09-review-verifies-block.md) | review-verifies-block | T01 |
| [T10](tasks/T10-harness-fixture-block.md) | harness-fixture-block | T01 |

## Phase 4 — Finish

| # | Task | Depends on |
|---|---|---|
| [T11](tasks/T11-docs.md) | docs | T03, T04, T05, T07 |
| [T12](tasks/T12-prove-and-install.md) | prove-and-install | T03, T04, T05, T07, T08, T09, T10, T11 |

## Main path: who builds, who wires

| Step | Built by | Wired by |
|---|---|---|
| Planner writes the block | T08 (template, pir-plan) | T08 |
| Review verifies it, narrow pass | T09 | T09 (pir-review-plan) |
| `pir-work` refuses without it | T09 | T09 (pir-work gate) |
| `pir` refuses without it | T01 parser | T03 (`coordinate.mjs` main, `launch.mjs`, `pir.mjs`) |
| Setup in worker worktree | T02 runner, T06 note | T07 (`loop.mjs` 3b, `coordinate.mjs` `displayPhaseFor`) |
| End-of-run gate | T01, T02 | T04 (`runFeatureTests`, its `runTests` injection) |
| Red reason on the screen | T05 | T05 (`buildRunState`, `pir-tui.mjs`) |

## Critical path

```
T06 → T07 → T11 → T12      (T01 → T07 and T02 → T07 are the same length)
```

Leaves: T12 only.

## Parallel width

12 tasks, longest chain 4, up to 6 at once (`analyzeParallelism`; T03 T04 T07 T08 T09 T10 after phase 1).

## Build route and open points

- T05 and T07 both edit `display.mjs`, `render.mjs` and `coordinate.mjs`; T04 and T07 both edit
  `coordinate.mjs`. In parallel mode expect merge conflicts there, handled by the conflict flow.
- `resume-dead-worker` and `nudge-quiet-worker` also edit `loop.mjs` and `coordinate.mjs`. Build these
  plans one after another, never at the same time; the order is the user's call.
- In parallel mode, T12's `./install.sh` runs only after `pir/declared-test-command` is merged to main
  (DESIGN §5.3). Once installed, those two plans refuse to start until `/pir-review-plan` adds their
  block (DESIGN §6).
