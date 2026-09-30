# Progress

**Update this whenever a task changes state.** It is the handoff between sessions. What the build taught
lives in [FINDINGS.md](FINDINGS.md). Sixty words to a Notes cell, counted.

**Plan reviewed:** 2026-09-29 — 3 fixed, 4 decided with the user

**Status:** Building. T01 reviewed and done.
**Last updated:** 2026-09-30
**Next `pir-work` will:** implement T02 single-flow.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | settings-commands | — | ✅ | Reviewed: no defect. One test added: a malformed `setup`/`test` now also refuses a plan or build start, which nothing pinned. Probed odd shapes, duplicate and `__proto__` keys, multi-line entries, and the other settings writers. Deviations stand: whitespace-only lines rejected; one-line `no-commands` text (user, 2026-09-30). `npm test` green on the third run; two pty timing flakes under load. |
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

**Review queue:** empty

## Blocked on the user

Nothing.
