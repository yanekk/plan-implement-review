# Progress

**Update this whenever a task changes state.** It is the handoff between sessions. What the build taught
lives in [FINDINGS.md](FINDINGS.md). Sixty words to a Notes cell, counted.

**Plan reviewed:** 2026-10-01 — 20 fixed, 2 decided with the user

**Status:** Planned, not started.
**Last updated:** 2026-10-02
**Next `pir-work` will:** T03 single-end-flow, the first task on the critical path.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | base-watch | — | ⬜ | |
| T02 | finisher-for-single | — | 🔍 | `finisherOpening`/`startFinisher` take `kind: 'single'` + `promptPath`; build text snapshot-pinned. Skill covers both kinds; installed, skill diffed equal. 6 new tests, `npm test` green. Deviation: skill's slug bullet says "for a single run, the run's name" and the opening's "command running the build" adds "or the single run"; both read wrong for a single run otherwise. |
| T03 | single-end-flow | — | ⬜ | |
| T04 | single-helpers-skill | — | ⬜ | |
| T05 | single-finisher-wiring | T01, T02, T03, T04 | ⬜ | |
| T06 | single-finisher-alerts | T05 | ⬜ | |
| T07 | single-finisher-screen | T05 | ⬜ | |
| T08 | single-finisher-drill | T06, T07 | ⬜ | |
| T09 | single-finisher-docs | T05, T06, T07 | ⬜ | |
| T10 | single-finisher-live | T08, T09 | ⬜ | |

**Review queue:** T02

## Blocked on the user

Nothing.
