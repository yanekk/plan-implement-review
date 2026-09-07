# Implementation plan

10 tasks in 4 phases. Each has a file in [tasks/](tasks/) with its goal, the files it touches,
the interfaces it defines, and what "done" means.

Track state in [PROGRESS.md](PROGRESS.md). Read [DESIGN.md](DESIGN.md) first — the architecture
leans on Claude Code's own primitives (background sessions, per-session worktrees, cross-session
messaging, stop/remove) and builds only the PIR-specific glue on top.

---

## Shape of the build

- **The PIR decision core is built and proven with no live agents before anything real is
  spawned.** By the end of Phase 1 the two decisions that are genuinely ours — which task is
  ready and how a finished task folds back into the shared file — are implemented and unit-tested
  in milliseconds. Phase 3 then wires those to the platform's real agents and real merges.
- **The riskiest unknown goes first, as a spike.** T00 confirms on this machine that the
  platform primitives behave as the survey says: a background worker spawns in a worktree,
  coordinator and worker exchange messages, a fresh session reviews on the same worktree, and
  close removes the worktree. If any differs, the worker contract and the loop change.
- **A fake platform before the real one.** Phase 2 runs the whole loop against fake spawn /
  message / list / close and a scratch repo, so the wiring is proven before a paid agent or the
  real `main` is touched.
- **Recovery before the thing that keeps it alive.** The worktree create / merge / **close**
  plumbing (T05) is built before the first real spawn (T07), so a runaway or abandoned worker can
  always be torn down. The kill switch is wired into that first real spawn, not after it.
- **The dangerous thing small before full size.** The first real spawn is one worker on one
  trivial task (T07); the full multi-worker run with the kill-switch drill is last (T09), with
  the user watching.

```
Phase 0  ▸  T00              prove the platform primitives      throwaway
Phase 1  ▸  T01 … T03        the PIR decision core, headless     no agents
Phase 2  ▸  T04              a fake platform to rehearse in      no real agents
Phase 3  ▸  T05 … T09        real orchestration, small first     hand-verified
```

---

## Phase 0 — Prove the ground

Nothing is designed on top of a platform behaviour that has not been checked on this machine.

| # | Task | Depends on |
|---|---|---|
| [T00](tasks/T00-platform-spike.md) | Platform primitives spike: spawn, message, fresh review, close | — |

**T00 gates the real-orchestration tasks (T06, T07) and the lifecycle in DESIGN §2.3.** It
confirms, seatbelted, that `claude --bg` spawns a worker in a worktree; that cross-session
messaging carries a turn both ways and the worker acts on it; that a fresh session reviews a
`🔍` task on the same worktree; and that close stops the session and removes the worktree.
Throwaway code, deleted afterwards.

## Phase 1 — The PIR decision core (headless, no agents)

At the end of this phase the parts that are genuinely ours are decidable and proven with no
live agent.

| # | Task | Depends on |
|---|---|---|
| [T01](tasks/T01-scaffold-and-test-command.md) | Project scaffold, `npm test`, the boundary test | — |
| [T02](tasks/T02-progress-core.md) | Parse `PROGRESS.md` and fold one finished task row back | T01 |
| [T03](tasks/T03-dispatch-decision.md) | `decideDispatch` — spawn / review / merge / close | T02 |

## Phase 2 — A fake platform to rehearse in

At the end of this phase the whole loop drains a fake plan to all-`✅` with no real agent.

| # | Task | Depends on |
|---|---|---|
| [T04](tasks/T04-fake-platform-and-loop.md) | Fake spawn/message/list/close + the coordinator loop | T03 |

## Phase 3 — Real orchestration, small first

Each task here has a hand-verification half; the dangerous capability is built last.

| # | Task | Depends on |
|---|---|---|
| [T05](tasks/T05-worktree-lifecycle.md) | Real worktree create / integrate / merge / close | T04 |
| [T06](tasks/T06-worker-contract.md) | `pir-worker` contract skill + cross-session wiring | T00 |
| [T07](tasks/T07-real-spawn-one-worker.md) | One real worker, one trivial task, seatbelted | T05, T06 |
| [T08](tasks/T08-pir-coordinate-skill.md) | The `pir-coordinate` skill the user talks to | T07 |
| [T09](tasks/T09-full-parallel-run.md) | Full multi-worker run + kill-switch drill | T08 |

---

## Critical path

```
T01 → T02 → T03 → T04 → T05 → T07 → T08 → T09
```

T00 is off this line but gates T06 and T07; it can run first or alongside Phase 1, and the pure
core does not depend on it. T06 (the worker contract) depends only on T00 and can be built any
time after the spike, before T07 needs it.

## Rough sizing

Not hours — a relative sense of where the weight is.

| Weight | Tasks |
|---|---|
| **Heavy** | T07 (first real spawn + messaging + review), T08 (coordinator skill), T09 (full run + drill) |
| **Medium** | T00 (spike), T04 (fake platform + loop), T05 (worktree plumbing) |
| **Light** | T01 (scaffold), T02 (progress core), T03 (dispatch), T06 (worker contract) |

Where this will overrun: T07, because live CLI and messaging behaviour rarely matches the docs
on the first try, and the T00 spike is what de-risks it; and T09, because a kill-switch drill on
real workers is what surfaces the last unhandled state.

## Decisions still open

Nothing blocks the build. The worker ceiling of 4 is a settled, tunable constant. The platform
primitives are confirmed by the survey (FINDINGS.md) and re-confirmed on this version by T00
before T07 needs them.
