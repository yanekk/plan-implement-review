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
**Last updated:** 2026-09-22 (T08 reviewed ✅)
**Next `pir-work` will:** implement T09 (⬜; deps T05, T06 ✅). T10 and T11 are also unblocked now
that T08 is ✅.

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
| T08 | start-detached | T05, T06 | ✅ | Reviewed clean, no fix. Pre-flight order, resume semantics, detached spawn shape, index entry, keep-awake -i -w all match DESIGN §2.5/§2.9; clock and process ops injected so the shell stays testable; coordinator path from engine URL not cwd. 7 tests defend each. Survival hand-check still UNVERIFIED, deferred to T12 live run (user). |
| T09 | stop-and-remove | T05, T06 | ⬜ | |
| T10 | coordinator-reporting | T07 | ⬜ | edits coordinate.mjs behind PIR_RUN |
| T11 | pir-command | T08 | ⬜ | |
| T12 | dashboard-tui | T04, T07, T09, T10, T11 | ⬜ | hands-on: the live feel |
| T13 | docs-and-install | T12 | ⬜ | updates /docs |

**Review queue:** empty

## Blocked on the user

Nothing blocking. T08's survival check (a run survives closing WezTerm) was deferred to the T12
live run (user, 2026-09-22): `pir` (T11) does not exist at T08's point in the sequence, and only a
seatbelted real run can exercise it. So the T12 session's one live run confirms both the survival
check and the live-dashboard feel.
