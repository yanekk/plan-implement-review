# Implementation plan

9 tasks in 4 phases. Each has a file in [tasks/](tasks/) with its goal, the files it touches,
the interfaces it defines, and what "done" means.

Track state in [PROGRESS.md](PROGRESS.md). Read [DESIGN.md](DESIGN.md) first.

---

## Shape of the build

- **The live unknown goes first, as a spike.** The exact `claude` flag that makes a worker
  auto-accept a cross-session message is not in the CLI's help text and changes both the spawn
  argv and the coordinator's receipt wording, so it is settled against real sessions (T00) before
  anything is built on it.
- **Everything the test command can prove is built and proven before the live drill.** The three
  engine/skill changes (T01–T03) and the two skill/doc changes (T04–T06) are all done and green
  before the capstone. The capstone only confirms the live behaviour the tests cannot reach.
- **The signal is built before the reader.** The engine's completion signal (T02) is in place
  before the coordinator is taught to read it (T05) and before the worker is taught to feed it
  (T04), so each half is written against a fixed contract.
- **The delivery heartbeat (T08) is the floor under the receipt loop.** T05 hardens a down-send
  once the coordinator makes it; T08 guarantees the coordinator wakes to make it at all. T08 builds
  on T05's receipt-loop wording and T02's flow-log machinery, so it comes after both.

```
Phase 0  ▸  T00              prove the messaging mode        throwaway, you
Phase 1  ▸  T01 T02 T03      engine: spawn flag, signal, name validator   headless, auto
Phase 2  ▸  T04 T05 T06 T08  skills + docs + delivery heartbeat            auto
Phase 3  ▸  T07              live drill with the user        you
```

---

## Phase 0 — Prove the messaging mode

Nothing about the down-channel is built on an assumption not checked on this machine.

| # | Task | Runs | Depends on |
|---|---|---|---|
| [T00](tasks/T00-messaging-mode-spike.md) | Messaging-mode spike | you | — |

**T00 gates T01 and T05.** It fixes the exact `claude` flag the worker spawn adds (T01) and what
the coordinator's receipt loop keys on (T05, whether a delivery notice is observable). Throwaway;
the scratch sessions are torn down and the finding is written to `FINDINGS.md`.

## Phase 1 — Engine

Everything the test command can prove, headless.

| # | Task | Runs | Depends on |
|---|---|---|---|
| [T01](tasks/T01-spawn-auto-accepts.md) | Worker spawn auto-accepts messages | auto | T00 |
| [T02](tasks/T02-completion-signal.md) | Hands-on completion signal | auto | — |
| [T03](tasks/T03-coordinator-name-guard.md) | Coordinator-name guard | auto | — |

At the end of Phase 1 the engine emits the `verified Txx` signal, spawns workers in the
message-accepting mode, and can tell a valid coordinator name from a slashed one — all under
`npm test`.

## Phase 2 — Skills and docs

The prose that reads and feeds the engine, and the spec that records it.

| # | Task | Runs | Depends on |
|---|---|---|---|
| [T04](tasks/T04-verify-writes-attestation.md) | pir-verify writes the attestation | auto | T02 |
| [T05](tasks/T05-coordinator-guardrails.md) | pir-coordinate guardrails, receipt loop, name check | auto | T00, T02, T03 |
| [T06](tasks/T06-docs-update.md) | Update /docs to the new behaviour | auto | T01, T02, T03 |
| [T08](tasks/T08-delivery-heartbeat.md) | Coordinator delivery heartbeat | auto | T02, T05, T06 |

At the end of Phase 2 the worker feeds the attestation, the coordinator reads the signal and can
no longer halt on suspicion or lose a down-send, delivery of a queued answer no longer depends on
the coordinator staying awake, and `/docs` describes all of it as current behaviour.

## Phase 3 — Prove it live

| # | Task | Runs | Depends on |
|---|---|---|---|
| [T07](tasks/T07-capstone-drill.md) | Capstone live drill | you | T01, T04, T05, T06, T08 |

At the end of Phase 3 a person has seen a hand-driven task complete without the coordinator
halting, a decision reach a worker with no prompt and be confirmed received, a decision reach a
parked worker with no manual ping on the heartbeat, and a slashed coordinator name caught at
startup.

---

## Critical path

```
T00 → T01 → T06 → T08 → T07
```

T02 and T03 are off the critical path and can run as soon as the plan starts (they depend on
nothing). T04 slots in after T02; T05 after T00/T02/T03; T08 after T02/T05/T06, so it joins the
tail just before the capstone.

## Parallel width

9 tasks · longest dependency chain 5 · up to 3 could run at once · 2 need a person (`you`). These
are the numbers `analyzeParallelism` computed from the task table, with no dependency errors. The
plan is modestly wide, not a chain: T02 and T03 run alongside T00 from the start, and T01/T04/T05
open up together once their roots are done — so a coordinator run drains it in noticeably fewer
rounds than one task at a time, though the two `you` tasks (T00, T07) pace the ends. Folding in T08
added one link to the tail (it needs T05 and T06 before it, and the capstone needs it), which is
why the longest chain is now 5; the width is unchanged.

## Rough sizing

| Weight | Tasks |
|---|---|
| **Heavy** | — |
| **Medium** | T02 (parse + emit + tests), T05 (four rule areas), T06 (five docs), T07 (live drill), T08 (pure predicate + bin emission + skill heartbeat) |
| **Light** | T00 (spike), T01 (argv), T03 (validator), T04 (report step) |

Where it may overrun: T02, because the attestation shape has to be finalised jointly with T04 and
the "no attestation still completes" path needs care; and T07, because a live drill waits on the
person and the environment, not the clock.

## Decisions still open

Nothing blocks. The one thing settled only at build time is the exact `claude` flag and receipt
wording, which is precisely what T00 exists to fix before T01 and T05 depend on it. `/pir-review-plan`
should still sanity-check that the flag choice and the attestation contract read consistently across
T00/T01 and T02/T04.

One cross-plan seam to watch: T08 adds a `delivered` feed to the control folder, and the
`coordinator-restart-resume` plan (being built now) clears the transient control feeds on startup.
Its clearing list must include the new feed, or a restart would skip the new run's first answers
(DESIGN §3.6, T08). Whoever runs the two plans coordinates on that one line; it is not a hidden
dependency, it is the shared control folder.
