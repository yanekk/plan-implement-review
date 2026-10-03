# Progress

**Update this whenever a task changes state.** It is the handoff between sessions. What the build taught
lives in [FINDINGS.md](FINDINGS.md). Sixty words to a Notes cell, counted.

**Plan reviewed:** 2026-10-01 — 20 fixed, 2 decided with the user

**Status:** Planned, not started.
**Last updated:** 2026-10-03
**Next `pir-work` will:** review T10 single-finisher-live.

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
| T08 | single-finisher-drill | T06, T07 | ✅ | |
| T09 | single-finisher-docs | T05, T06, T07 | ✅ | |
| T10 | single-finisher-live | T08, T09 | 🔍 | Fixture, runner, 4 facts, dry pass; live run PASS, Go by person in pir. Deviations: dry pass replaces the skipped single-run-live one; no `./install.sh`, the person ran this checkout's `pir.mjs` (installed skills identical, live build engine untouched); no phone link on Bedrock. |

**Review queue:** T10

## Blocked on the user

Nothing.
