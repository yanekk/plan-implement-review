# Progress

**Update this whenever a task changes state.** It is the handoff between sessions. What the build taught
lives in [FINDINGS.md](FINDINGS.md). Sixty words to a Notes cell, counted.

**Plan reviewed:** 2026-09-30 — 10 fixed, 8 decided with the user

**Status:** Planned, not started.
**Last updated:** 2026-09-30
**Next `pir-work` will:** review T10 live-usage-check.

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
| T10 | live-usage-check | T08 | 🔍 | Fixture `usage-live`, `usage-live-check.mjs`, 19 tests. Live check passed once, worker-driven (FINDINGS). Deviations: refuses an existing `--into`; stops a still-running harness by HALT before any kill; same-millisecond newest events either match; expected numbers computed without `core/usage.mjs`; options beyond the interface injected for tests. |
| T11 | docs-and-readme | T07, T09, T10 | ⬜ | |

**Review queue:** T10

## Blocked on the user

Nothing. The real install and the log-out check come after the merge (PLAN § After the merge).
