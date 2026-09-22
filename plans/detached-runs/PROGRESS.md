# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)** — read the rows touching
the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The cell is an index for the next session;
the account is the commit message. Whoever writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-22 — 4 fixed, 3 decided with the user

**Status:** Plan just written. Prototype approved by the user (2026-09-22) and parked in
`prototype/`. Detached-spawn and process-identity mechanisms verified on the machine (FINDINGS).
Nothing implemented yet.
**Last updated:** 2026-09-22
**Next `pir-work` will:** finish T12 — after the user hand-verifies the live dashboard feel, mark it
🔍 for review. Then T13 (docs-and-install), which depends on T12.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and done ·
⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | run-state | — | ✅ | |
| T02 | index-record | — | ✅ | |
| T03 | snapshot-model | — | ✅ | |
| T04 | dashboard-model | T01 | ✅ | |
| T05 | process-identity | T01 | ✅ | |
| T06 | index-store | T02 | ✅ | |
| T07 | snapshot-store | T03 | ✅ | |
| T08 | start-detached | T05, T06 | ✅ | |
| T09 | stop-and-remove | T05, T06 | ✅ | |
| T10 | coordinator-reporting | T07 | ✅ | |
| T11 | pir-command | T08 | ✅ | |
| T12 | dashboard-tui | T04, T07, T09, T10, T11 | 🟡 | TUI built in pir-tui.mjs (list frame, watch frame reusing render.mjs styledLines, key decode, raw-mode loop); pir.mjs wired. 12 tests, npm test green. Code half done; live-feel hand-check pending with user before 🔍. |
| T13 | docs-and-install | T12 | ⬜ | updates /docs |

**Review queue:** *(empty)*

## Blocked on the user

T12: the live dashboard's feel (the in-place repaint, moving and opening, the confirm chords) can only
be judged at a real terminal, and seeing it needs a real run — which means spawning paid agents, the
one line a worker cannot cross alone. Handed to the user with the exact `pir` command; their answer
goes in FINDINGS with the date, then T12 → 🔍. T08's survival check was folded into this same live run
(FINDINGS 2026-09-22).
