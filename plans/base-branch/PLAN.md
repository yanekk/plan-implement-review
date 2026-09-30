# Implementation plan

10 tasks in 3 phases. Each has a file in [tasks/](tasks/) with its goal, the files it touches, the
interfaces it defines, and what "done" means. Track state in [PROGRESS.md](PROGRESS.md). Read
[DESIGN.md](DESIGN.md) first.

## Shape of the build

- The pure rules come first (T01), so the §2.3 table and every refusal are proven before anything touches
  git or the network.
- The building blocks are made base-agnostic without changing behaviour (T03, T04 default to `main`), so
  they can land in parallel and the suite stays green; the wiring tasks then switch the real base on.
- The riskiest part, moving the person's local branch and fetching with a bound, is isolated in T02 and
  tested against real git with local bare remotes before any start path calls it.
- No spike: the load-bearing git facts (`ls-remote` exit codes, `fetch` refusing a checked-out branch,
  `git branch -m` carrying branch config, a fast failure with `GIT_TERMINAL_PROMPT=0`) were measured during
  planning (FINDINGS 2026-09-29).

```
Phase 1  ▸  T01 T02 T03 T04 T08   building blocks        no behaviour change except T02's settings files
Phase 2  ▸  T05 T06 T07           wiring                 the base goes live
Phase 3  ▸  T09 T10               proof and docs
```

## Phase 1 — Building blocks

| # | Task | Depends on |
|---|---|---|
| [T01](tasks/T01-base-core.md) | base-core | — |
| [T02](tasks/T02-base-git.md) | base-git | T01 |
| [T03](tasks/T03-branch-cuts.md) | branch-cuts | — |
| [T04](tasks/T04-base-text.md) | base-text | — |
| [T08](tasks/T08-skills-and-rules.md) | skills-and-rules | — |

At the end: the rules, the git side and every text exist and are tested; pir still behaves as today.

## Phase 2 — Wiring

| # | Task | Depends on |
|---|---|---|
| [T05](tasks/T05-plan-start.md) | plan-start | T01, T02, T03 |
| [T06](tasks/T06-build-start.md) | build-start | T01, T02, T03 |
| [T07](tasks/T07-end-sync.md) | end-sync | T04, T06 |

At the end: planning, building and the end of a run use the configured base, fetch it, and refuse or hold
as DESIGN §2 says.

## Phase 3 — Proof and docs

| # | Task | Depends on |
|---|---|---|
| [T09](tasks/T09-dev-base-drill.md) | dev-base-drill | T05, T07 |
| [T10](tasks/T10-docs-and-readme.md) | docs-and-readme | T08, T09 |

T09 is the drill for the only surfaces this plan changes (the `pir plan` refusal, the dashboard box, the
live view's preparing and hand-off lines).

## Main path: builder and wirer

| Step | Built by | Wired by |
|---|---|---|
| Read the settings | T01 (parse), T02 (files) | T05 (plan start), T06 (build start) |
| Fetch and choose the commit | T01 (decideBase), T02 (prepareBase) | T05, T06, T07 (end) |
| Cut the branch, record pirBase | T03 | T05 (openPlanBranch), T06 (openFeature) |
| Run record baseBranch | T01 | T05, T06 |
| Repo list, refusal on pick | T05 | T05 (`repo-scan.mjs`, the box's preflight) |
| End-of-run sync, hold, watch | T03 (syncBase, baseContains), T02 | T07 (`coordinate.mjs`) |
| Texts naming the base | T04 | T07 (end), T05/T06 (refusals via `refusalText`) |
| Sessions' rules | T08 | installed by `./install.sh` after merge |

## Critical path

```
T01 → T02 → T06 → T07 → T09 → T10
```

T03 and T04 are off it and can land any time in phase 1; T08 any time before T10; T05 any time before T09.

Leaves: T10 only.

## Parallel width

10 tasks · longest dependency chain 6 · up to 4 could run at once (T01, T03, T04, T08).

## Rough sizing

| Weight | Tasks |
|---|---|
| **Heavy** | T02, T07, T09 |
| **Medium** | T01, T03, T04, T05, T06 |
| **Light** | T08, T10 |

T07 will overrun if the waiting loop's timing is hard to inject; the intervals must come from the loop's
`now`, as the existing re-sync does. T09 will overrun where the harness hardcodes `main` in more places
than the survey found.

## Decisions still open

None. The `@` list question was settled at plan review: listed, refused on pick (DESIGN §2.6).
