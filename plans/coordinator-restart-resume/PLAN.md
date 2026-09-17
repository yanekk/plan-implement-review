# Implementation plan

7 tasks in 3 phases. Each has a file in [tasks/](tasks/) with its goal, the files it touches, the
interfaces it defines, and what "done" means.

Track state in [PROGRESS.md](PROGRESS.md). Read [DESIGN.md](DESIGN.md) first.

**Build route: classic single-stream (`/pir-work`), not `/pir-coordinate`.** This plan is small, and
the coordinator has the very bug being fixed — building its own fix in parallel is not worth the risk.
The `Runs` column still marks T07 `you` so the classic flow presents it as a hand-verification.

---

## Shape of the build

- **Everything testable automatically is built and proven before the live drill.** The classifier,
  the git read, the reconciliation execution and the control-folder cleanup are all headless and
  proven in `npm test`; the `you` drill (T07) is the last thing, and it only checks what no test can —
  that a real crashed run resumes over real agents.
- **The pure decision is built before the machinery that executes it.** T01 (the classifier) and T02
  (the git read) are the two independent halves; T03 wires them into the loop. Building the decision
  first keeps the four-way classification proven in isolation before it is entangled with spawning and
  merging.
- **Recovery before the drill that stresses it.** The reconciliation (T03) and the cleanup (T04) are
  complete and green before the harness gains a restart mode (T06) and the person runs it (T07).

```
Phase 1  ▸  T01 T02 T04       pure core + shell, headless        no live agent
Phase 2  ▸  T03 T05           wire reconciliation, update docs    no live agent
Phase 3  ▸  T06 T07           harness restart mode, live drill    T07 spawns real agents
```

---

## Phase 1 — The independent headless pieces

| # | Task | Runs | Depends on |
|---|---|---|---|
| [T01](tasks/T01-decide-resume.md) | `decideResume` pure classifier | auto | — |
| [T02](tasks/T02-task-branch-state.md) | Read a task branch's committed state | auto | — |
| [T04](tasks/T04-control-folder-cleanup.md) | Clear transient control feeds; HALT/log policy | auto | — |

At the end of Phase 1: the classifier decides the right action for every case; the worktree can read
any task branch's committed glyph against real git; the control folder clears its transient feeds and
preserves the log and `HALT` on startup. None of it is wired into a run yet.

## Phase 2 — Wire it in, and correct the docs

| # | Task | Runs | Depends on |
|---|---|---|---|
| [T03](tasks/T03-reconcile-in-loop.md) | Reconciliation pass in `runPass` | auto | T01, T02 |
| [T05](tasks/T05-docs.md) | Update `/docs` to the corrected behaviour | auto | T03, T04 |

At the end of Phase 2: a restart reconciles from git — merges `✅` branches, reviews `🔍` branches,
rebuilds half-built ones — all proven against real scratch git; `/docs` describes the corrected
behaviour rather than the old limitation.

## Phase 3 — Prove it live

| # | Task | Runs | Depends on |
|---|---|---|---|
| [T06](tasks/T06-harness-restart-mode.md) | Harness restart mode + restart fixture + facts | auto | T03, T04 |
| [T07](tasks/T07-live-restart-drill.md) | Live restart drill, judged by a person | you | T06 |

T06 and T07 are a build→verify split (DESIGN §2.6): T06 builds the launch→kill→relaunch mechanism and
its fact predicates, provable against the fakes; T07 is the `you` task where a person runs the drill
over real agents and judges that it resumed. At the end of Phase 3: a crashed run has been seen, by a
person, to resume instead of rebuild.

---

## Critical path

```
T02 → T03 → T06 → T07
```

T01 joins at T03 (the classifier and the git read are both inputs to the wiring). T04 is off the
critical path — it feeds T05 and T06 but blocks neither T03 nor the live drill's core mechanism. T05
is a leaf: nothing depends on the docs update.

## Parallel width

7 tasks · longest dependency chain 4 · up to 3 could run at once · 1 needs a person (`you`). The
plan opens 3-wide (T01, T02, T04 share no dependency), then narrows to the T03→T06→T07 spine. This is
built classic single-stream regardless (see the build route above), so the width is informational: it
says the fix is not one long chain, but it is not wide enough to be worth the coordinator's own risk.

## Rough sizing

| Weight | Tasks |
|---|---|
| **Heavy** | T03 (reconciliation execution: merge, review-seed, rebuild, ceiling, first-pass gate), T07 (attended live drill) |
| **Medium** | T02 (git read against real scratch git), T04 (cleanup + HALT refusal), T06 (harness restart mode) |
| **Light** | T01 (pure classifier), T05 (docs) |

Where it may overrun: T03, because the reconciliation must respect the ceiling and must not perturb
the delicate live-worker accounting in `buildAssignments` (DESIGN §2.5) — the risk is a seeded review
task being mistaken for a dead worker and its branch discarded, which the tests must pin down. T06,
because driving a real coordinator through a crash and relaunch on the same scratch is new harness
ground; the fixture must reach a deterministic `🔍` before the kill.

## Decisions still open

Nothing blocks. The one policy the brief flagged — what happens to `HALT` on restart — is settled in
DESIGN §2.7 and §7 (never auto-clear; refuse to start with a message). The half-built → rebuild-clean
choice and the reconcile-from-branch approach are the brief's settled decisions. No spike is needed:
the trustworthiness of the committed task-branch glyph (that `🔍` lands atomically with the build) was
established at plan time from the `pir-implement` contract and the fake platform, and is recorded in
DESIGN §2.2.
</content>
