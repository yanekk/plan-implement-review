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
| T04 | single-program | T02, T03 | ⬜ | |
| T05 | single-launch | T01, T02 | ✅ | Reviewed; one fix: a `bad-settings` refusal now carries `file` and `why` (from `planPreflight` too), needed by DESIGN §2.1's box text; test seen red first. Probed refusal order, id redraw, record shape, resume by kind. `resumeRun` does not refuse a finished single record; `canResume` (T10) does. `npm test` green at load 8; pty tests flake above 30, on pre-T05 code too. |
| T06 | single-alerts | T04 | ⬜ | |
| T07 | single-skill | T02 | ✅ | |
| T08 | single-rig | T04, T05 | ⬜ | |
| T09 | box-single | T05, T08 | ⬜ | |
| T10 | single-row | T04, T08 | ⬜ | |
| T11 | single-drill | T06, T09, T10 | ⬜ | |
| T12 | single-live | T07, T11 | ⬜ | |
| T13 | docs-and-readme | T12 | ⬜ | |

**Review queue:** *(empty)*

## Blocked on the user

Nothing.
