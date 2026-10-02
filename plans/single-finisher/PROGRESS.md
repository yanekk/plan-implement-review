# Progress

**Update this whenever a task changes state.** It is the handoff between sessions. What the build taught
lives in [FINDINGS.md](FINDINGS.md). Sixty words to a Notes cell, counted.

**Plan reviewed:** 2026-10-01 — 20 fixed, 2 decided with the user

**Status:** In progress, T01–T05 done.
**Last updated:** 2026-10-02
**Next `pir-work` will:** implement T06 single-finisher-alerts or T07 single-finisher-screen.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | base-watch | — | ✅ | |
| T02 | finisher-for-single | — | ✅ | |
| T03 | single-end-flow | — | ✅ | |
| T04 | single-helpers-skill | — | ✅ | |
| T05 | single-finisher-wiring | T01, T02, T03, T04 | ✅ | Reviewed: one fix. The loop's wait was unref'd while a finisher was held, so a finisher given up mid-wait let the program exit silently (crashed); reproduced out of process, fixed, test locks it. Probed resolved/fixed checks, inbox wrap, log numbering. Deviations accepted. 18 skips stand (T07, T10). |
| T06 | single-finisher-alerts | T05 | ⬜ | |
| T07 | single-finisher-screen | T05 | ⬜ | |
| T08 | single-finisher-drill | T06, T07 | ⬜ | |
| T09 | single-finisher-docs | T05, T06, T07 | ⬜ | |
| T10 | single-finisher-live | T08, T09 | ⬜ | |

**Review queue:** empty

## Blocked on the user

Nothing.
