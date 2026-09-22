# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)** — read the rows touching
the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The cell is an index for the next session;
the account is the commit message. Whoever writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-22 — 4 fixed, 3 decided with the user

**Status:** Plan reviewed and building in parallel mode. T01, T02, T03 reviewed clean.
Prototype approved and parked in `prototype/`. Detached-spawn and process-identity mechanisms
verified on the machine (FINDINGS).
**Last updated:** 2026-09-22
**Next `pir-work` will:** in parallel mode the coordinator dispatches by dependency, not
`pir-work`. T05 (needs T01) and T06 (needs T02) are now unblocked; T04 and T07 follow.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and done ·
⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | run-state | — | ✅ | |
| T02 | index-record | — | ✅ | Clean, no fix commit. Walked all 7 test cases and Done-when; 18 tests real, suite+boundary green. Probed past doc by running parseRecord on junk: __proto__ (no pollution), float/huge/whitespace pid+slug, canonical order, never-throws on lone surrogate — all hold. Deviations (pid positive int; optional timestamps must be strings) reviewed, sound per §3.3. |
| T03 | snapshot-model | — | ✅ | |
| T04 | dashboard-model | T01 | ⬜ | |
| T05 | process-identity | T01 | ⬜ | |
| T06 | index-store | T02 | ⬜ | |
| T07 | snapshot-store | T03 | ⬜ | |
| T08 | start-detached | T05, T06 | ⬜ | hands-on: survives terminal restart |
| T09 | stop-and-remove | T05, T06 | ⬜ | |
| T10 | coordinator-reporting | T07 | ⬜ | edits coordinate.mjs behind PIR_RUN |
| T11 | pir-command | T08 | ⬜ | |
| T12 | dashboard-tui | T04, T07, T09, T10, T11 | ⬜ | hands-on: the live feel |
| T13 | docs-and-install | T12 | ⬜ | updates /docs |

**Review queue:** *(empty)*

## Blocked on the user

Nothing right now. Two tasks will need a person when they are built: T08 (confirm a run survives
closing WezTerm) and T12 (confirm the live dashboard reads right). The worker raises each through
the normal question path when it reaches that point — not homework left for the end.
