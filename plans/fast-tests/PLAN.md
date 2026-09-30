# Implementation plan

6 tasks in 2 phases. Each has a file in [tasks/](tasks/) with its goal, the files it touches, the
interfaces it defines, and what "done" means.

Track state in [PROGRESS.md](PROGRESS.md). Read [DESIGN.md](DESIGN.md) first.

---

## Shape of the build

- The wake-up fix and the file splits are independent, so they run side by side: the splits touch only
  test files and new helper modules, and the wake-up touches only product modules and their unit tests.
- The end-of-run fix (T02) comes after the waker exists (T01), because it is a wake call on that waker.
- The timing proof (T06) comes last and runs through all of it: the 1:30 target depends on both the
  shorter drills and the wider split.

```
Phase 1  ▸  T01 → T02            the coordinator reacts instead of polling
            T03, T04, T05        the slow files become several files (side by side with T01)
Phase 2  ▸  T06                  harden and measure: 10 quiet runs, each under 1:30
```

## Phase 1 — Wake-up and split

| # | Task | Depends on |
|---|---|---|
| [T01](tasks/T01-wake-on-activity.md) | wake-on-activity | — |
| [T02](tasks/T02-end-sequence-no-wait.md) | end-sequence-no-wait | T01 |
| [T03](tasks/T03-split-coordinator-drill.md) | split-coordinator-drill | — |
| [T04](tasks/T04-split-plan-rig.md) | split-plan-rig | — |
| [T05](tasks/T05-split-conversation-rig.md) | split-conversation-rig | — |

At the end of it the coordinator drills pass with `PARALLEL_POLL_MS=60000`, and no test file takes more
than about 50 s alone.

## Phase 2 — Proof

| # | Task | Depends on |
|---|---|---|
| [T06](tasks/T06-suite-timing-proof.md) | suite-timing-proof | T01, T02, T03, T04, T05 |

At the end of it 10 back-to-back quiet runs of `npm test` are green and each under 1:30, and the README's
testing section says how the suite is laid out.

The Task cell is the task's kebab slug, matching its `tasks/T{nn}-{slug}.md` filename. Nothing here
builds a surface, so there is no drill task: the existing rigs are the tests being reorganised.

---

## Critical path

```
T01 → T02 → T06
```

T03, T04 and T05 are off it and can run at any time before T06.

Leaves: T06 only.

## Parallel width

6 tasks · longest dependency chain 3 · up to 4 could run at once (T01, T03, T04, T05).

## Rough sizing

| Weight | Tasks |
|---|---|
| **Heavy** | T01 |
| **Medium** | T04, T06 |
| **Light** | T02, T03, T05 |

T06 is where this can overrun: flakiness under nine concurrent pty files only shows under load, and each
full measurement takes minutes. T01 can overrun if a wake source turns out to live somewhere the survey
did not trace (setup settling is untraced because the drills use `setup: none`).

## Decisions still open

None blocks. If T06 misses 1:30 after hardening, whether to trim the per-step waits is the user's
decision (DESIGN §6), raised then.
