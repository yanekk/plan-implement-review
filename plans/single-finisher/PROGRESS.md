# Progress

**Update this whenever a task changes state.** It is the handoff between sessions. What the build taught
lives in [FINDINGS.md](FINDINGS.md). Sixty words to a Notes cell, counted.

**Plan reviewed:** 2026-10-01 — 20 fixed, 2 decided with the user

**Status:** Planned, not started.
**Last updated:** 2026-10-02
**Next `pir-work` will:** review T07 single-finisher-screen.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | base-watch | — | ✅ | |
| T02 | finisher-for-single | — | ✅ | |
| T03 | single-end-flow | — | ✅ | |
| T04 | single-helpers-skill | — | ✅ | |
| T05 | single-finisher-wiring | T01, T02, T03, T04 | ✅ | |
| T06 | single-finisher-alerts | T05 | ⬜ | |
| T07 | single-finisher-screen | T05 | 🔍 | Sync and finisher merge rows, list states, `c`/→ to the finisher, 17 rig tests re-enabled, ~12 new tests. Deviations: hold text drops holdText's `, retrying`; red merge row `not ready · tests red` (user); openWorker `stepId`; REPO narrows to 9 at 60 cols; merged check covers `closed`; singleNotifyViews skips sync (T06). |
| T08 | single-finisher-drill | T06, T07 | ⬜ | |
| T09 | single-finisher-docs | T05, T06, T07 | ⬜ | |
| T10 | single-finisher-live | T08, T09 | ⬜ | |

**Review queue:** T07

## Blocked on the user

Nothing.
