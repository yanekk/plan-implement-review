# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)** — read the rows touching
the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The cell is an index for the next session;
the account is the commit message. Whoever writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-22 — 4 fixed, 3 decided with the user

**Status:** T01–T12 all ✅. T12 (the dashboard TUI) hand-verified live and reviewed clean. Only
T13 (docs-and-install) remains. Prototype parked in `prototype/`.
**Last updated:** 2026-09-22
**Next `pir-work` will:** implement T13 (docs-and-install), the last task. Its dep T12 is ✅. T13
must carry the ← back / Esc quit key change (FINDINGS 🔄) into /docs — DESIGN §2.4/§2.11 still
describe the old Esc-back-then-quit model.

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
| T12 | dashboard-tui | T04, T07, T09, T10, T11 | ✅ | Reviewed clean, no fix commit. 18 tests green (616 total). Watch frame is render.mjs's own styledLines byte-for-byte; pure builders take now as an argument. Probed re-entrancy, error teardown (raw mode restored on throw), no-snapshot/crashed edges, slug-pinned selection. ← back / Esc quit is a user change (FINDINGS 🔄); T13 carries it to /docs. |
| T13 | docs-and-install | T12 | ⬜ | updates /docs |

**Review queue:** (empty)

## Blocked on the user

Nothing right now. T12's live feel was hand-verified with the user 2026-09-22 (FINDINGS ✅). T08's
run-survives-terminal-restart check is still unverified — fold it into a future live run.
