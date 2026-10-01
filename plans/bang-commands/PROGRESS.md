# Progress

**Update this whenever a task changes state.** It is the handoff between sessions. What the build
taught lives in [FINDINGS.md](FINDINGS.md); read the rows touching your task and append yours there.

Sixty words to a Notes cell, counted. Flat prose. Whoever writes a cell also fixes the over-budget cell
they walk past.

**Plan reviewed:** 2026-10-01 — 9 fixed, 4 decided with the user

**Status:** Plan written 2026-10-01. Nothing built. The red `notify-wiring.test.mjs` cases on `main` are to
be fixed there before the build starts (DESIGN §4).
**Last updated:** 2026-10-01
**Next `pir-work` will:** review T00.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and done ·
⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | hand-tool-spike | — | 🔍 | Four real sessions measured; answers in FINDINGS. `auto` needs the PreToolUse `ask` hook (DESIGN §2.6 fallback, no contradiction); `pirResult` routes by tool-use id map. Spike folder deleted, nothing committed but the row. No code changed, so the suite was not run. |
| T01 | shell-runner | — | ⬜ | |
| T02 | bang-rules | — | ⬜ | |
| T03 | bang-forwarding | T01, T02 | ⬜ | |
| T04 | hand-rules | T00, T02 | ⬜ | |
| T05 | hand-tool | T00, T03, T04 | ⬜ | |
| T06 | bang-view | T02, T03 | ⬜ | |
| T07 | hand-view | T05, T06 | ⬜ | |
| T08 | bang-drill | T06, T07 | ⬜ | |
| T09 | agent-rules | T05 | ⬜ | |
| T10 | docs-readme | T08, T09 | ⬜ | |

**Review queue:** T00

## Blocked on the user

Nothing.
