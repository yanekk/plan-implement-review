# Progress

**Update this whenever a task changes state.** It is the handoff between sessions. What the build taught
lives in [FINDINGS.md](FINDINGS.md). Sixty words to a Notes cell, counted.

**Plan reviewed:** 2026-09-30 — 10 fixed, 8 decided with the user

**Status:** Planned, not started.
**Last updated:** 2026-09-30
**Next `pir-work` will:** T01 usage-core, the first task with no dependencies on the critical path.

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
| T08 | usage-e2e | T04, T05 | 🔍 | `api-usage-e2e.test.mjs`, 7 tests; `usageEvent`, `withUsageEvent` and script set `usage` in `plan-rig.mjs`. Deviations: the build run is `runScenario` on fixture `real-asking` with fake workers, its facts not read; the real-home test refuses only a fake reading instead of comparing mtime (FINDINGS). Null-default check done by hand, both run tests failed. |
| T09 | launchd-check | T05, T06 | ⬜ | |
| T10 | live-usage-check | T08 | ⬜ | |
| T11 | docs-and-readme | T07, T09, T10 | ⬜ | |

**Review queue:** T08

## Blocked on the user

Nothing. The real install and the log-out check come after the merge (PLAN § After the merge).
