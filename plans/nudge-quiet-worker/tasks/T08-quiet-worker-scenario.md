# T08 — quiet-worker-scenario

**Phase:** 3 · **Depends on:** T04, T05, T06 · **Weight:** medium

## Goal

A live-harness scenario, `quiet-worker`, whose one task reliably sends its worker into a needless
wait-loop, plus the facts that decide from the captured run whether the nudge happened and worked.
Everything short of launching real agents is proven in the dry-run harness tests, so T09 only has to
run it and judge.

## Design sections this implements

DESIGN §5.1, §5.2 (the drill's seatbelts), §2.6 (the log lines the facts key on).

## Files

- `src/shell/harness/fixtures/quiet-worker.mjs` (new), registered in `fixtures.mjs`. Its scenario is a
  `defineScenario(...)` value in this file, as every fixture's is: `seatbelts: { ceiling: 1, timeoutMs:
  25 min }`, `answerPending` off, `nudgeMs: 120000`.
- `src/shell/harness/scenario.mjs`: `defineScenario` accepts and validates the new `nudgeMs` field (a
  positive number or absent), carried through like `holdMerges`.
- `src/shell/harness/run.mjs`: `seatbeltEnv` gains `nudgeMs` → `PARALLEL_NUDGE_MS`, the way `holdMerges`
  became `PARALLEL_HOLD_MERGES`.
- `src/shell/harness/assertions.mjs`: the new facts.
- Matching `*.test.mjs` files.

## Interface

The fixture's single task must produce a wait the worker can judge unnecessary once nudged. A
suggested shape, which the implementing session may improve: the task's own test script starts a
helper that never exits, and the task doc tells the worker to wait for a "ready" file the helper
never writes, checking every 30 seconds. The real work (one small file and its test) needs neither.
It must not tell the worker to ask the person, and must not be solvable only by guessing what the
person wants. The helper must write nothing inside the task worktree that git would list: any such write
is real output under DESIGN §2.2 and would keep the worker from ever being nudged.

Facts, over the flow log, the task's conversation log (the bundle carries conversations since
live-workers T16) and the final files:

```
nudgedAtLeastOnce      — ≥1 `nudge <task>` line, and a `from:"pir"` message starting `[pir:nudge 1/2]`
                         in the task's conversation log
noNudgeFailed          — no `nudge-failed` line
unstuckAfterNudge      — an `unstuck <task>` or `review <task>` line follows the first nudge
noQuestionSurfaced     — no `surface <task>` line, and no AskUserQuestion `request` entry in the
                         task's conversation log
neverStuck             — no `stuck <task>` line
handedOffGreenBranch   — the existing fact in assertions.mjs, reused
```

`noQuestionSurfaced` and `neverStuck` are the machine half of "freed itself without asking the
person". The judgement half is T09's.

## Tests

- [ ] The fixture installs into a scratch repo and its PROGRESS/tasks parse.
- [ ] Each new fact passes on a hand-built bundle that shows the good path and fails on one that
      shows the bad path (no nudge, nudge-failed, a question report, an AskUserQuestion request, stuck).
- [ ] The scenario passes `PARALLEL_NUDGE_MS=120000` and ceiling 1 to the coordinator env (asserted on
      `seatbeltEnv` and the runner's injected spawn, no live agent).

## Done when

- [ ] `node src/shell/harness/run.mjs quiet-worker --into <dir>` is a valid invocation (the dry-run
      tests prove the wiring).
- [ ] All new facts have passing good-path and bad-path tests in `npm test`.
- [ ] The fixture's wait is needless by construction and says nothing about asking the person.
