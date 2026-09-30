# Progress

**Update this whenever a task changes state.** It is the handoff between sessions. What the build taught
lives in [FINDINGS.md](FINDINGS.md). Sixty words to a Notes cell, counted.

**Plan reviewed:** 2026-09-30 — 10 fixed, 8 decided with the user

**Status:** In progress.
**Last updated:** 2026-09-30
**Next `pir-work` will:** review T01 usage-core.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | usage-core | — | 🔍 | `src/core/usage.mjs`, 75 tests. Deviations: `readingFromEvent` also returns null when `observedAt` is not a finite number > 0 (doc names only type and windows). `parseReading` rejects a missing window key, reading §2.5 as null or valid. Full suite failed four times on rig timeouts under machine load, green once load fell (FINDINGS). |
| T02 | api-core | — | ⬜ | |
| T03 | service-core | — | ⬜ | |
| T04 | usage-report | T01, T02 | ⬜ | |
| T05 | api-service | T01, T02 | ⬜ | |
| T06 | service-ctl | T02, T03 | ⬜ | |
| T07 | service-command | T06 | ⬜ | |
| T08 | usage-e2e | T04, T05 | ⬜ | |
| T09 | launchd-check | T05, T06 | ⬜ | |
| T10 | live-usage-check | T08 | ⬜ | |
| T11 | docs-and-readme | T07, T09, T10 | ⬜ | |

**Review queue:** T01

## Blocked on the user

Nothing. The real install and the log-out check come after the merge (PLAN § After the merge).
