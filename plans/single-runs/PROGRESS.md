# Progress

**Update this whenever a task changes state.** It is the handoff between sessions. What the build taught
lives in [FINDINGS.md](FINDINGS.md). Sixty words to a Notes cell, counted.

**Plan reviewed:** 2026-09-29 — 3 fixed, 4 decided with the user

**Status:** Building. T01 implemented, awaiting review.
**Last updated:** 2026-09-30
**Next `pir-work` will:** review T01 settings-commands.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | settings-commands | — | 🔍 | `parseSettings` takes `setup`/`test`; `effectiveCommands`, `commandsRefusalText`, `resolveSettings` added, `resolveBaseSetting` built on it. 16 new tests. Deviations: a whitespace-only command line is rejected too. Three tests outside the file list pin the helpers' settings text and were updated. `no-commands` text is one line, naming only missing keys (user, 2026-09-30). |
| T02 | single-flow | — | ⬜ | |
| T03 | held-sessions | — | ⬜ | |
| T04 | single-program | T02, T03 | ⬜ | |
| T05 | single-launch | T01, T02 | ⬜ | |
| T06 | single-alerts | T04 | ⬜ | |
| T07 | single-skill | T02 | ⬜ | |
| T08 | single-rig | T04, T05 | ⬜ | |
| T09 | box-single | T05, T08 | ⬜ | |
| T10 | single-row | T04, T08 | ⬜ | |
| T11 | single-drill | T06, T09, T10 | ⬜ | |
| T12 | single-live | T07, T11 | ⬜ | |
| T13 | docs-and-readme | T12 | ⬜ | |

**Review queue:** T01

## Blocked on the user

Nothing.
