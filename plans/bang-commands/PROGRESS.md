# Progress

**Update this whenever a task changes state.** It is the handoff between sessions. What the build
taught lives in [FINDINGS.md](FINDINGS.md); read the rows touching your task and append yours there.

Sixty words to a Notes cell, counted. Flat prose. Whoever writes a cell also fixes the over-budget cell
they walk past.

**Plan reviewed:** 2026-10-01 — 9 fixed, 4 decided with the user

**Status:** Plan written 2026-10-01. Nothing built. The red `notify-wiring.test.mjs` cases on `main` are to
be fixed there before the build starts (DESIGN §4).
**Last updated:** 2026-10-01
**Next `pir-work` will:** T00, the spike its later tasks depend on.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and done ·
⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | hand-tool-spike | — | ✅ | |
| T01 | shell-runner | — | ✅ | |
| T02 | bang-rules | — | ✅ | |
| T03 | bang-forwarding | T01, T02 | ✅ | |
| T04 | hand-rules | T00, T02 | ✅ | |
| T05 | hand-tool | T00, T03, T04 | ⬜ | |
| T06 | bang-view | T02, T03 | 🔍 | Block, status line, `!` mode, Esc stop, refusals; 22 unit tests, e2e at 3 sizes. Block drawn whole at its start. Hint reads `esc stops it` while a command runs; running line also under a pinned prompt. Unspecified wordings (session-closed end, 1 MB clip, `shell-refused` note, `stop sent`) approved by the person 2026-10-01. |
| T07 | hand-view | T05, T06 | ⬜ | |
| T08 | bang-drill | T06, T07 | ⬜ | |
| T09 | agent-rules | T05 | ⬜ | |
| T10 | docs-readme | T08, T09 | ⬜ | |

**Review queue:** T06

## Blocked on the user

Nothing.
