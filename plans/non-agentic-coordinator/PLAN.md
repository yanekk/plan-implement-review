# Implementation plan

10 tasks in 4 phases (T10 added mid-build — see Phase 3). Each has a file in [tasks/](tasks/) with its goal, the files it touches, the
interfaces it defines, and what "done" means. Track state in [PROGRESS.md](PROGRESS.md). Read
[DESIGN.md](DESIGN.md) first.

**Build this plan in classic single-stream flow, one `/pir-work` at a time — not parallel mode.**
It rebuilds the parallel coordinator, and running it under the coordinator would have the
coordinator rewrite its own decision function mid-run (DESIGN §2.7).

**Task names are slugs** (DESIGN §2.9): each task's `PROGRESS.md` Task cell, its `tasks/T{nn}-*.md`
filename, its display row, and its worker's agent name share one kebab name.

There is no spike. The one load-bearing unknown — how the person reaches a blocked worker — the
person settled from their own practice (they spot it in the `claude agents` view). The remaining
unknowns are all things only a person can see, gathered into the capstone (T09) rather than a spike.

---

## Shape of the build

- **The plain command and its identity come first.** T01–T03 turn the existing bin into the plain
  foreground command: it stops promoting, workers get `/`-separated slug names, and the message
  bridge is replaced by the `docker compose up`-style live display.
- **Everything testable is proven headless before the one thing that needs eyes.** By the end of
  T05 the pure model, the loop over the fakes, and kill-and-rebuild are all green; the live painting
  and the real attach-and-resume are left for the capstone.
- **The dangerous thing is built small, last, with a seatbelt, and verified with the person.** The
  first real multi-worker live run is T09, on a scratch plan in a scratch repo, ceiling 1.
- **Docs describe shipped behaviour, so they come after the code they describe.**

```
Phase 1  ▸  T01 T02 T03      the plain command, slug names, live display    the core change
Phase 2  ▸  T04              remove the you/auto machinery
Phase 3  ▸  T05 T06 T07 T08  prove it, tidy, document
Phase 4  ▸  T09              live end-to-end, with the person                throwaway scratch run
```

---

## Phase 1 — The plain command, slug names, and the live display

| # | Task | Runs | Depends on |
|---|---|---|---|
| [T01](tasks/T01-stop-promoting.md) | stop-promoting | auto | — |
| [T02](tasks/T02-slugs-and-names.md) | slugs-and-names | auto | — |
| [T03](tasks/T03-live-display.md) | live-display | auto | T01, T02 |

At the end of Phase 1 the run is a plain foreground command: workers carry `/`-separated slug names,
there is no down-channel and no `pir-coordinate` session, the output is the live status display, and
the run ends by handing the person a green branch to merge. T01 (promotion) and T02 (naming) are
independent and could run together; T03 refactors the same shell files both touch and depends on both.

## Phase 2 — Remove the you/auto machinery

| # | Task | Runs | Depends on |
|---|---|---|---|
| [T04](tasks/T04-remove-you-auto.md) | remove-you-auto | auto | T03 |

At the end of Phase 2 there is no `Runs` marker and no hands-on/`verify` code path in the loop and
platform; a task needing the person is an ordinary worker that prepares and asks. (The `verify` role's
removal from `naming.mjs` itself happens in T05, alongside the harness that still references it — see
the re-slot note in DESIGN §3.2; T04 removes only the code path.)

## Phase 3 — Prove it, tidy, document

| # | Task | Runs | Depends on |
|---|---|---|---|
| [T05](tasks/T05-harness-and-restart.md) | harness-and-restart | auto | T04 |
| [T06](tasks/T06-worker-permissions.md) | worker-permissions | auto | — |
| [T07](tasks/T07-skills.md) | skills | auto | T04 |
| [T08](tasks/T08-docs.md) | docs | auto | T05, T07 |
| [T10](tasks/T10-harness-handoff-facts.md) | harness-handoff-facts | auto | T05 |

At the end of Phase 3 the suite is green on the new model, a worker's own git/test clears the
classifier, the dead commands are gone, the surviving worker skills no longer assume an agentic
coordinator, the templates carry the slug-as-name convention, and the reference docs match the code.

T10 was added after the T09 live `single` run (PM decision, 2026-09-20): it finishes T05's fixture
rework by converting the stale `oneMergeToMain` promotion assertion to the §2.4 hand-off model, so the
`single`/`review-queue`/`clean-merge` fixtures pass under the shipped coordinator. T09 depends on it.

## Phase 4 — See it for real

| # | Task | Runs | Depends on |
|---|---|---|---|
| [T09](tasks/T09-capstone.md) | capstone | you | T06, T08, T10 |

T09 is the hand-verification the tests cannot reach (DESIGN §5.1): on a scratch plan in a scratch
repo, the person runs the real command, answers a blocked worker directly, Ctrl-C's mid-run and
re-runs to see it resume, checks a worker's slug name and its committing without a prompt, and merges
the green branch by hand. It is marked `you`; the classic flow ignores the marker, and this plan runs
classic.

---

## Critical path

```
T01 ┐
    ├→ T03 → T04 → T05 ┬→ T08 ┐
T02 ┘            │  └ T07 ┘     ├→ T09
                 └→ T10 ────────┤
T06 ──────────────────────────↗
```

Longest chain: T01/T02 → T03 → T04 → T05 → T08 → T09 (length 6). Off the path: T06
(worker-permissions) depends on nothing; T10 (harness-handoff-facts, added 2026-09-20) hangs off T05
and feeds T09. Both can be done any time before T09.

## Parallel width

10 tasks · longest dependency chain 6 · up to 3 could run at once · 1 needs a person (`you`). This is
a narrow, mostly-serial plan: the core work is a focused refactor of the two central shell files
(`coordinate.mjs`, `loop.mjs`) that several tasks touch in turn, so the chain is long by nature. That
is honest, not padding — and it is why the plan is built in classic flow anyway (DESIGN §2.7). The
width numbers come from `analyzeParallelism` over the task table.

## Rough sizing

| Weight | Tasks |
|---|---|
| **Heavy** | T03 (the display model plus a TTY renderer with a non-TTY fallback), T08 (seven `/docs` files plus `CLAUDE.md`) |
| **Medium** | T01, T02, T04, T05, T07 |
| **Light** | T06, T09 (T09 is short but gated on the person) |

Where it will overrun: T03, if the in-place renderer's TTY handling and the pure/shell split are
fought rather than kept clean; and T05, if the harness fixtures encode more of the old relay model
than expected. T08 is large but mechanical.

## Decisions still open

Nothing blocks. Two small things the building sessions settle in place, neither changing the plan:
the exact status glyphs and labels in the display model (T03, against the prototype), and whether
`parallelism.mjs` keeps a width report at all once the `you` count is gone (T04 — it stays for the
planner, minus the human count). Both are `how`.
