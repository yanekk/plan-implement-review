# Progress

**Update this whenever a task changes state.** It is the handoff between sessions. What the build taught
lives in [FINDINGS.md](FINDINGS.md). Sixty words to a Notes cell, counted.

**Plan reviewed:** 2026-09-30 — 10 fixed, 8 decided with the user

**Status:** All 11 tasks done. The after-merge checklist remains (PLAN § After the merge).
**Last updated:** 2026-09-30
**Next `pir-work` will:** nothing to pick; every task is ✅.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | usage-core | — | ✅ | |
| T02 | api-core | — | ✅ | |
| T03 | service-core | — | ✅ | |
| T04 | usage-report | T01, T02 | ✅ | |
| T05 | api-service | T01, T02 | ✅ | |
| T06 | service-ctl | T02, T03 | ✅ | |
| T07 | service-command | T06 | ✅ | |
| T08 | usage-e2e | T04, T05 | ✅ | |
| T09 | launchd-check | T05, T06 | ✅ | |
| T10 | live-usage-check | T08 | ✅ | |
| T11 | docs-and-readme | T07, T09, T10 | ✅ | Review: README and docs page said pir shows the numbers nowhere, though `pir service` prints them; fixed, with the scratch-home `pir service` case added. Probed: contract re-run on a scratch home, eight page mutations each failed a doc test, T09 and T10 figures against FINDINGS. Real install and log-out check stay unseen until after the merge. |

**Review queue:** *(empty)*

## Blocked on the user

Nothing. The real install and the log-out check come after the merge (PLAN § After the merge).
