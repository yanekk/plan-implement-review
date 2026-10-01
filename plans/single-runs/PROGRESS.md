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
| T06 | single-alerts | T04 | ✅ | |
| T07 | single-skill | T02 | ✅ | |
| T08 | single-rig | T04, T05 | ✅ | |
| T09 | box-single | T05, T08 | ✅ | |
| T10 | single-row | T04, T08 | ✅ | |
| T11 | single-drill | T06, T09, T10 | ✅ | |
| T12 | single-live | T07, T11 | 🔍 | `single-run-live` fixture, `runSingleScenario`, four single facts; 16 tests incl. a fake-Claude dry pass. Live run PASS in 40 s, recorded in FINDINGS. Beyond the file list: facts in `assertions.mjs`, fixture `settings` in `seedGit`, `scenario.mjs` kind `single`, `parseLogName` reads `build-N`. `install.sh` not run: no installed `pir-single` to shadow. |
| T13 | docs-and-readme | T12 | ⬜ | |

**Review queue:** T12

## Blocked on the user

Nothing.
