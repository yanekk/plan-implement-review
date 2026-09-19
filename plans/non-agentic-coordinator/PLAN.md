# Implementation plan

8 tasks in 4 phases. Each has a file in [tasks/](tasks/) with its goal, the files it touches, the
interfaces it defines, and what "done" means. Track state in [PROGRESS.md](PROGRESS.md). Read
[DESIGN.md](DESIGN.md) first.

**Build this plan in classic single-stream flow, one `/pir-work` at a time — not parallel mode.**
It rebuilds the parallel coordinator, and running it under the coordinator would have the
coordinator rewrite its own decision function mid-run (DESIGN §2.7).

There is no spike. The one load-bearing unknown — how the person reaches a blocked worker — the
person settled from their own practice (they spot it in the `claude agents` view), so it needs no
T00. The remaining unknowns are all things only a person can see, and they are gathered into the
capstone (T08) rather than a spike up front.

---

## Shape of the build

- **The plain command comes first, before the removals.** T01–T02 turn the existing bin into the
  plain foreground command with its live display; the coordinator stops promoting and stops relaying.
  This is the core of the change and everything else is subtraction around it.
- **Everything testable is proven headless before the one thing that needs eyes.** By the end of
  T04 the pure model, the loop over the fakes, and kill-and-rebuild are all green; the live display
  and the real attach-and-resume are left for the capstone.
- **The dangerous thing is built small, last, with a seatbelt, and verified with the person.** The
  first real multi-worker live run is T08, on a scratch plan in a scratch repo, ceiling 1.
- **Docs describe shipped behaviour, so they come after the code they describe.**

```
Phase 1  ▸  T01 T02      the plain command + live display     the core change
Phase 2  ▸  T03          remove the you/auto machinery
Phase 3  ▸  T04 T05 T06 T07   prove it, tidy, document
Phase 4  ▸  T08          live end-to-end, with the person      throwaway scratch run
```

---

## Phase 1 — The plain command and its live display

| # | Task | Runs | Depends on |
|---|---|---|---|
| [T01](tasks/T01-stop-promoting.md) | Stop promoting; hand off the green feature branch | auto | — |
| [T02](tasks/T02-live-display.md) | Replace the agent bridge with the live status display | auto | T01 |

At the end of Phase 1 the run is a plain foreground command: no down-channel, no `pir-coordinate`
session, a `docker compose up`-style live display, and a run that ends by handing the person a green
branch to merge. T01 and T02 both refactor `coordinate.mjs`/`loop.mjs`, so they are a serial pair.

## Phase 2 — Remove the you/auto machinery

| # | Task | Runs | Depends on |
|---|---|---|---|
| [T03](tasks/T03-remove-you-auto.md) | Remove the `auto`/`you` distinction and the verify path (code) | auto | T02 |

At the end of Phase 2 there is no `Runs` marker, no `verify` role, no hands-on path anywhere in the
code; a task needing the person is an ordinary worker that prepares and asks.

## Phase 3 — Prove it, tidy, document

| # | Task | Runs | Depends on |
|---|---|---|---|
| [T04](tasks/T04-harness-and-restart.md) | Rework the test harness to the new model; prove kill-and-rebuild | auto | T03 |
| [T05](tasks/T05-worker-permissions.md) | Ship the worker classifier pre-approval + prereq note | auto | — |
| [T06](tasks/T06-skills.md) | Delete dead skills; de-agent the worker skills | auto | T03 |
| [T07](tasks/T07-docs.md) | Rewrite `/docs` and the `CLAUDE.md` carve-out | auto | T04, T06 |

At the end of Phase 3 the suite is green on the new model, a worker's own git/test clears the
machine's classifier, the dead commands are gone, the surviving worker skills no longer assume an
agentic coordinator, and the reference docs match the code.

## Phase 4 — See it for real

| # | Task | Runs | Depends on |
|---|---|---|---|
| [T08](tasks/T08-capstone.md) | Live end-to-end hand-verification with the person | you | T05, T07 |

T08 is the hand-verification the tests cannot reach (DESIGN §5.1): on a scratch plan in a scratch
repo, the person runs the real command, answers a blocked worker directly, Ctrl-C's mid-run and
re-runs to see it resume, and merges the green branch by hand. It is marked `you` because its
completion is a person's judgement; the classic flow ignores the marker, and this plan runs classic.

---

## Critical path

```
T01 → T02 → T03 → T04 → T07 → T08
                   T06 ↗
```

Off the path: T05 (worker permissions) depends on nothing and can be done any time before T08.

## Parallel width

8 tasks · longest dependency chain 6 · up to 2 could run at once · 1 needs a person (`you`).
This is a narrow, mostly-serial plan: the core work is a focused refactor of two central files
(`coordinate.mjs`, `loop.mjs`) that several tasks must touch in turn, so the chain is long by
nature. That is honest, not padding — and it is why the plan is built in classic flow anyway
(DESIGN §2.7). The width numbers come from `analyzeParallelism` over the task table.

## Rough sizing

| Weight | Tasks |
|---|---|
| **Heavy** | T02 (the display model plus a TTY renderer with a non-TTY fallback), T07 (six `/docs` files plus `CLAUDE.md`) |
| **Medium** | T01, T03, T04, T06 |
| **Light** | T05, T08 (T08 is short but gated on the person) |

Where it will overrun: T02, if the in-place renderer's TTY handling and the pure/shell split are
fought rather than kept clean; and T04, if the harness fixtures encode more of the old relay model
than expected. T07 is large but mechanical.

## Decisions still open

Nothing blocks. Two small things the building sessions settle in place, neither changing the plan:
the exact status glyphs and labels in the display model (T02, against the prototype), and whether
`parallelism.mjs` keeps a width report at all once the `you` count is gone (T03 — it stays for the
planner, minus the human count). Both are `how`.
