# Progress

**Update this whenever a task changes state.** It is the handoff between sessions. What the build taught
lives in [FINDINGS.md](FINDINGS.md). Sixty words to a Notes cell, counted.

**Plan reviewed:** 2026-10-01 — 20 fixed, 2 decided with the user

**Status:** In progress, T01–T07 and T09 done.
**Last updated:** 2026-10-03
**Next `pir-work` will:** T08 single-finisher-drill.

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
| T08 | single-finisher-drill | T06, T07 | ⬜ | |
| T09 | single-finisher-docs | T05, T06, T07 | ✅ | Reviewed: one fix, finisher.md said the single opening begins "You are the finisher"; it begins "Invoke the pir-finisher skill"; the doc test stripped that prefix, now asserts the whole line (red on old text). Probed rows, resume, watch, alerts, dashboard states and merged check against the code. |
| T10 | single-finisher-live | T08, T09 | ⬜ | |

**Review queue:** *(empty)*

## Blocked on the user

Nothing.
