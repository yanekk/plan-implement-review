# Implementation plan

18 tasks in 6 phases (T12, T13 added 2026-09-10; T14–T17, the live-scenario test harness, added
2026-09-10). Each has a file in [tasks/](tasks/) with its goal, the files it touches, the interfaces
it defines, and what "done" means.

Track state in [PROGRESS.md](PROGRESS.md). Read [DESIGN.md](DESIGN.md) first — the architecture
leans on Claude Code's own primitives (background sessions, per-session worktrees, cross-session
messaging, stop/remove) and builds only the PIR-specific glue on top. Two later concerns are
folded in: a human-required (`you`) task runs on a hands-on worker the coordinator spawns and the
user drives, folded back without review (§2.6), and `/pir-plan` is taught to plan for parallelism
(§2.7).

---

## Shape of the build

- **The PIR decision core is built and proven with no live agents before anything real is
  spawned.** By the end of Phase 1 the decisions that are ours — which task is ready, who runs it
  (a worker or the user), how a finished task folds back, and how parallel a plan is — are
  implemented and unit-tested in milliseconds. Phase 3 wires them to real agents and merges.
- **The riskiest unknown goes first, as a spike.** T00 confirms on this machine that the platform
  primitives behave as the survey says. If any differs, the worker contract and the loop change.
- **A fake platform before the real one.** Phase 2 runs the whole loop against fakes and a scratch
  repo, so the wiring is proven before a paid agent or the real `main` is touched.
- **Recovery before the thing that keeps it alive.** The worktree create / merge / **close**
  plumbing (T06) is built before the first real spawn (T08), so a runaway or abandoned worker can
  always be torn down. The kill switch is wired into that first real spawn, not after it.
- **The dangerous thing small before full size.** The first real spawn is one worker on one
  trivial task (T08); the full multi-worker run with the kill-switch drill is last (T10).
- **The planner is taught last.** Teaching `/pir-plan` to plan for parallelism (T11) depends only
  on the width metric (T04) and is independent of the coordinator, so it slots in at the end.

```
Phase 0  ▸  T00              prove the platform primitives      throwaway, you-run
Phase 1  ▸  T01 … T04        the PIR decision core, headless     no agents
Phase 2  ▸  T05              a fake platform to rehearse in      no real agents
Phase 3  ▸  T06 … T09,T12,T13 real orchestration, small first    hand-verified
Phase 4  ▸  T11              teach /pir-plan to plan parallel     shared method
Phase 5  ▸  T14 … T17        the live-scenario test harness       data-driven, you-run
```

T10's full drill is folded into Phase 5 (T17's parallel scenario), so Phase 3 now ends at T13.

---

## Phase 0 — Prove the ground

Nothing is designed on top of a platform behaviour that has not been checked on this machine.

| # | Task | Runs | Depends on |
|---|---|---|---|
| [T00](tasks/T00-platform-spike.md) | Platform primitives spike: spawn, message, fresh review, close | you | — |

**T00 gates the real-orchestration tasks (T07, T08) and the lifecycle in DESIGN §2.3.** Throwaway
code, deleted afterwards. It is a `you` task — a person runs it and records what they saw.

## Phase 1 — The PIR decision core (headless, no agents)

At the end of this phase the parts that are genuinely ours are decidable and proven with no
live agent.

| # | Task | Runs | Depends on |
|---|---|---|---|
| [T01](tasks/T01-scaffold-and-test-command.md) | Project scaffold, `npm test`, the boundary test | auto | — |
| [T02](tasks/T02-progress-core.md) | Parse `PROGRESS.md` (with the `Runs` marker) and fold one row back | auto | T01 |
| [T03](tasks/T03-dispatch-decision.md) | `decideDispatch` — spawn / review / merge / close | auto | T02 |
| [T04](tasks/T04-analyze-parallelism.md) | `analyzeParallelism` — critical path, width, auto/you counts | auto | T02 |

## Phase 2 — A fake platform to rehearse in

At the end of this phase the whole loop drains a fake plan to all-`✅` with no real agent.

| # | Task | Runs | Depends on |
|---|---|---|---|
| [T05](tasks/T05-fake-platform-and-loop.md) | Fake spawn/message/list/close + the coordinator loop | auto | T03 |

## Phase 3 — Real orchestration, small first

Each task here has a hand-verification half; the dangerous capability is built last.

| # | Task | Runs | Depends on |
|---|---|---|---|
| [T06](tasks/T06-worktree-lifecycle.md) | Feature branch + task worktree: create / integrate / merge / promote | auto | T05 |
| [T07](tasks/T07-worker-contract.md) | `pir-worker` contract skill + cross-session wiring | auto | T00 |
| [T08](tasks/T08-real-spawn-one-worker.md) | One real worker, one trivial task, seatbelted | auto | T06, T07 |
| [T09](tasks/T09-pir-coordinate-skill.md) | The `pir-coordinate` skill: dispatch, surface, supervise | auto | T08 |
| [T12](tasks/T12-coordinator-live-drivable.md) | Make the coordinator drivable live: six drill fixes | auto | T09 |
| [T13](tasks/T13-comms-protocol-proven.md) | Prove the comms protocol: by-name addressing, idle-gated close | auto | T12 |
| [T10](tasks/T10-full-parallel-run.md) | Full multi-worker run + kill-switch drill — **folded into T17** | you | T17 |

T12 was added after the T10 drill (2026-09-10) was stopped: the partial live run proved spawn and
first-message delivery but surfaced six shell-driver gaps that block a full run. It sits on the
critical path between T09 and T10; the drill account is in `FINDINGS.md` and the task doc.

T13 was added the same day (2026-09-10), after comparing the coordinator against the gastown
multi-agent system: the user chose to prove the worker↔coordinator communication protocol in its own
seatbelted task before the full drill. It settles two things T12 deferred — a worker reaching the
coordinator by name (not by return-socket luck), and the coordinator waiting for a worker to be idle
before closing it — and lands the DESIGN §2.2/§2.3/§2.8 changes those need.

T10 was **folded into Phase 5 (T17)** on 2026-09-10, when the user chose the live-scenario harness to
replace the one-off manual drills (DESIGN §4.1, §7). Its full multi-worker + kill-switch drill is now
T17's parallel scenario, run with captured data rather than by eye; T10 no longer runs standalone and
closes `✅` when T17's parallel scenario passes (hence its dependency is now T17). T13's live half is
the same fold — it becomes T17's single-task scenario — while T13's automated half stays reviewed and
`✅`.

## Phase 4 — Teach the planner to plan for parallelism

| # | Task | Runs | Depends on |
|---|---|---|---|
| [T11](tasks/T11-teach-planner-parallelism.md) | `/pir-plan` + templates: the `Runs` marker, honest deps, width report | auto | T04, T12 |

T11 now also depends on T12: it teaches `/pir-plan` to emit parallel-ready plans, and that guidance
must reflect the worker/message contract T12 settles — do not teach the planner conventions the
machine is still changing.

## Phase 5 — The live-scenario test harness (data-driven, over real workers)

Turns the one-off manual drills into repeatable, data-driven runs (DESIGN §4.1). Build the capture,
assertion and fixture layers `auto` and unit-tested with no live agent; the runner's live runs are a
`you` task. Folds in T10 and T13's live half.

| # | Task | Runs | Depends on |
|---|---|---|---|
| [T14](tasks/T14-harness-capture-layer.md) | Capture layer: flow log, agent-status timeline, transcript bundle | auto | T09 |
| [T15](tasks/T15-harness-assertions.md) | Assertion library + scenario spec: declared facts over a bundle | auto | T14 |
| [T16](tasks/T16-harness-fixtures.md) | Scenario fixtures: scratch plans that force each path with real workers | auto | T15 |
| [T17](tasks/T17-harness-live-runner.md) | Live runner + first real scenario runs (folds T10, T13 live half) | you | T14, T15, T16 |

The capture rests on three sources confirmed on this machine 2026-09-10 (DESIGN §4.1): the
coordinator's existing flow log, a sampled `claude agents --json` status timeline (status is
live-only, so it is sampled during the run), and the on-disk transcripts under
`~/.claude/projects/…/<sessionId>.jsonl` (which survive a worker's kill and its worktree's removal).
T14 depends only on T09 (the coordinator exists) and is independent of T11, so Phase 4 and Phase 5
can proceed in either order.

---

## Critical path

```
T01 → T02 → T03 → T05 → T06 → T08 → T09 → T12 → T13
                                        └─→ T14 → T15 → T16 → T17  (→ closes T10)
```

T00 is off this line but gates T07 and T08. T04 (the width metric) is a side branch off T02 and can
slot in wherever convenient. T11 (teaching the planner) is off T04 but now also waits on T12, so it
lands after the coordinator contract is fixed. T07 (worker contract) depends only on the spike. T13
proved the comms protocol against the fakes; its live confirmation, and T10's full drill, now land in
the Phase 5 harness (T14→T17), which hangs off T09 and runs after T13. T14–T16 are `auto` and need no
live agent, so the critical live work is concentrated in the single `you` task T17.

## Rough sizing

Not hours — a relative sense of where the weight is.

| Weight | Tasks |
|---|---|
| **Heavy** | T08 (first real spawn + messaging + review), T09 (coordinator skill), T17 (live runner + real scenario runs, folds T10) |
| **Medium** | T00 (spike), T05 (fake platform + loop), T06 (worktree plumbing), T11 (teach the shared planner), T12 (six drill fixes), T13 (prove the comms protocol), T14 (capture layer), T15 (assertion library), T16 (scenario fixtures) |
| **Light** | T01 (scaffold), T02 (progress core), T03 (dispatch), T04 (parallelism metric), T07 (worker contract) |

Where this will overrun: T08, because live CLI and messaging behaviour rarely matches the docs on
the first try, and the T00 spike is what de-risks it; and T17, because a kill-switch drill on real
workers is what surfaces the last unhandled state, and a real model may not hit a fixture's path on
the first run. T16's fixtures are the lever there — the more deterministic they are, the fewer re-runs
T17 needs.

## Decisions still open

Nothing blocks the build. The worker ceiling of 4 is a settled, tunable constant. The platform
primitives are confirmed by the survey (FINDINGS.md) and re-confirmed on this version by T00
before T08 needs them. The exact width metric `analyzeParallelism` reports (widest topological
layer) is settled in its task doc.
