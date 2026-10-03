# Progress

**Update this whenever a task changes state.** It is the handoff between sessions. What the build taught
lives in [FINDINGS.md](FINDINGS.md). Sixty words to a Notes cell, counted.

**Plan reviewed:** 2026-10-01 — 20 fixed, 2 decided with the user

**Status:** Planned, not started.
**Last updated:** 2026-10-03
**Next `pir-work` will:** T03 single-end-flow, the first task on the critical path.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | base-watch | — | ✅ | |
| T02 | finisher-for-single | — | ✅ | |
| T03 | single-end-flow | — | ✅ | |
| T04 | single-helpers-skill | — | ✅ | |
| T05 | single-finisher-wiring | T01, T02, T03, T04 | ✅ | |
| T06 | single-finisher-alerts | T05 | ✅ | |
| T07 | single-finisher-screen | T05 | ✅ | |
| T08 | single-finisher-drill | T06, T07 | 🔍 | Drill in 3 size files, 4 chained runs each (12 tests); fake resolve-asks, finisher-resync, finisher-exits. Deviations: scenarios chained; up-to-date happy path left to defineSingleDrill; stop/resume on an up-to-date sync (FINDINGS). Fixed: resumed finisher read only; user-decided `…` on wide step rows. |
| T09 | single-finisher-docs | T05, T06, T07 | ⬜ | |
| T10 | single-finisher-live | T08, T09 | ⬜ | |

**Review queue:** T08

## Blocked on the user

Nothing.
