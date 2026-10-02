# Progress

**Update this whenever a task changes state.** It is the handoff between sessions. What the build taught
lives in [FINDINGS.md](FINDINGS.md). Sixty words to a Notes cell, counted.

**Plan reviewed:** 2026-10-01 — 20 fixed, 2 decided with the user

**Status:** In progress.
**Last updated:** 2026-10-02
**Next `pir-work` will:** implement T01, T02 or T04 (no dependencies); T05 waits on them.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | base-watch | — | ⬜ | |
| T02 | finisher-for-single | — | ⬜ | |
| T03 | single-end-flow | — | ✅ | Sync/wait end sequence in `decideSingleStep` behind `endSequence`. Implementer deviations accepted (`runTests` head null; resume from `merge`/`resolving` retests; `closed` cell per user). Review fix, reproduced by script: red re-sync after resume closed a finisher not held; test locks it. Six mutations all caught; full suite green. |
| T04 | single-helpers-skill | — | ⬜ | |
| T05 | single-finisher-wiring | T01, T02, T03, T04 | ⬜ | |
| T06 | single-finisher-alerts | T05 | ⬜ | |
| T07 | single-finisher-screen | T05 | ⬜ | |
| T08 | single-finisher-drill | T06, T07 | ⬜ | |
| T09 | single-finisher-docs | T05, T06, T07 | ⬜ | |
| T10 | single-finisher-live | T08, T09 | ⬜ | |

**Review queue:** *(empty)*

## Blocked on the user

Nothing.
