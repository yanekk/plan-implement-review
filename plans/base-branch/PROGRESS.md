# Progress

**Update this whenever a task changes state.** It is the handoff between sessions. What the build taught
lives in [FINDINGS.md](FINDINGS.md). Sixty words to a Notes cell, counted.

**Plan reviewed:** 2026-09-29 — 9 fixed, 3 decided with the user

**Status:** Planned, not started.
**Last updated:** 2026-09-29
**Next `pir-work` will:** T01 base-core, the first task with no dependencies on the critical path.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | base-core | — | ⬜ | |
| T02 | base-git | T01 | ⬜ | |
| T03 | branch-cuts | — | 🔍 | worktree.mjs names no base: cuts from a given sha, records pirBase, slugTaken/syncBase/baseContains/baseTip take the base. 9 new tests. Deviations: createWorktree and the fake take a bound `base` (loop calls openFeature(plan) alone); coordinate still stores `mainSha` in handoff (text modules are T04/T07); launch maps `no-base-branch` to reason `no-main` until T05. |
| T04 | base-text | — | ⬜ | |
| T05 | plan-start | T01, T02, T03 | ⬜ | |
| T06 | build-start | T01, T02, T03 | ⬜ | |
| T07 | end-sync | T04, T06 | ⬜ | |
| T08 | skills-and-rules | — | ⬜ | |
| T09 | dev-base-drill | T05, T07 | ⬜ | |
| T10 | docs-and-readme | T08, T09 | ⬜ | |

**Review queue:** T03

## Blocked on the user

Nothing.
