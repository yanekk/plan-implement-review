# Progress

**Update this whenever a task changes state.** It is the handoff between sessions. What the build taught
lives in [FINDINGS.md](FINDINGS.md). Sixty words to a Notes cell, counted.

**Plan reviewed:** 2026-09-29 — 9 fixed, 3 decided with the user

**Status:** In progress.
**Last updated:** 2026-09-29
**Next `pir-work` will:** T02 base-git, now unblocked by T01.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | base-core | — | ✅ | Review clean, no fix commit. Every §2.3 row, §2.2 rule and §2.9 text tested; `npm test` green. Probed: `validBranchName` against real `git check-ref-format --branch` on 61 names, differing only on `@` and NBSP (stricter, safe); fetch error after reach, missing checkout, runrecord bad values. Deviations (`@`, `HEAD`, bare `holdText`) accepted. |
| T02 | base-git | T01 | ⬜ | |
| T03 | branch-cuts | — | ✅ | |
| T04 | base-text | — | ✅ | |
| T05 | plan-start | T01, T02, T03 | ⬜ | |
| T06 | build-start | T01, T02, T03 | ⬜ | |
| T07 | end-sync | T04, T06 | ⬜ | |
| T08 | skills-and-rules | — | ✅ | |
| T09 | dev-base-drill | T05, T07 | ⬜ | |
| T10 | docs-and-readme | T08, T09 | ⬜ | |

**Review queue:** *(empty)*

## Blocked on the user

Nothing.
