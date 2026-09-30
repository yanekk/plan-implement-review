# Progress

**Update this whenever a task changes state.** It is the handoff between sessions. What the build taught
lives in [FINDINGS.md](FINDINGS.md). Sixty words to a Notes cell, counted.

**Plan reviewed:** 2026-09-29 — 3 fixed, 4 decided with the user

**Status:** Planned, not started. The build waits for `pir/base-branch` to be merged into `main` and
`main` into `pir/single-runs`.
**Last updated:** 2026-09-29
**Next `pir-work` will:** T02 single-flow, the first task on the critical path.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | settings-commands | — | ✅ | |
| T02 | single-flow | — | ✅ | |
| T03 | held-sessions | — | ✅ | |
| T04 | single-program | T02, T03 | ✅ | |
| T05 | single-launch | T01, T02 | ✅ | |
| T06 | single-alerts | T04 | ⬜ | |
| T07 | single-skill | T02 | ✅ | |
| T08 | single-rig | T04, T05 | ✅ | |
| T09 | box-single | T05, T08 | 🔍 | `/single` in the box: parse, notes, head, hint, `startSingleFailedNote`, `openBuilder`, landing and follow; 16 unit tests, 4 rig tests. Deviations: a wide note wraps, up to 3 lines (user); rig tests in `plan-rig-box-single.test.mjs`; `startSingleFailedNote` takes the refusal for `why`; pir-tui reads single steps itself until T10; the landing header reads `building`. |
| T10 | single-row | T04, T08 | ⬜ | |
| T11 | single-drill | T06, T09, T10 | ⬜ | |
| T12 | single-live | T07, T11 | ⬜ | |
| T13 | docs-and-readme | T12 | ⬜ | |

**Review queue:** T09

## Blocked on the user

Nothing.
