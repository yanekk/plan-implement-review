# Progress

**Update this whenever a task changes state.** It is the handoff between sessions. What the build
taught lives in [FINDINGS.md](FINDINGS.md); read the rows touching your task and append yours there.

Sixty words to a Notes cell, counted. Flat prose. Whoever writes a cell also fixes the over-budget cell
they walk past.

**Plan reviewed:** 2026-10-01 — 9 fixed, 4 decided with the user

**Status:** Plan written 2026-10-01. Nothing built. The red `notify-wiring.test.mjs` cases on `main` are to
be fixed there before the build starts (DESIGN §4).
**Last updated:** 2026-10-01
**Next `pir-work` will:** T06, T09 (T05 reviewed).

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
| T05 | hand-tool | T00, T03, T04 | ✅ | Review clean, no fix commit. Walked every test and done-when; reran `npm ci`, porcelain empty, zod 4.6.5 installed with peers omitted. Probed: allow/allow-always of a hand request refused before any grant, stale and session-closed runs, model-written `pirResult`, hook merge order. Grant on an empty-command call left to T07. Suite red only on notify-wiring. |
| T06 | bang-view | T02, T03 | ⬜ | |
| T07 | hand-view | T05, T06 | ⬜ | |
| T08 | bang-drill | T06, T07 | ⬜ | |
| T09 | agent-rules | T05 | ⬜ | |
| T10 | docs-readme | T08, T09 | ⬜ | |

**Review queue:** empty

## Blocked on the user

Nothing.
