# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**. Read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose, no bold-per-clause, no aphorism. The
cell is an index for the next session; the account is the commit message. Whoever writes a
cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-28 — 6 fixed, 6 decided with the user

**Status:** Planned 2026-09-28, amended the same day for the coordinator agent's rows (`7c59312`). T01 built. The spike in `prototype/` was run by the user and approved.
**Last updated:** 2026-09-28
**Next `pir-work` will:** review T01.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | mouse-rig | — | 🔍 | `mouseBytes` helpers; screen model and `openScreen` gain `modes()` and `boldAt(row, col)`, 0-based like `rows()`. 4 tests, one on today's pir (1049 on, no mouse mode). Additions: release keeps the button code; unknown button or wheel direction throws; SGR params may hold `:`; CSI with intermediates (`$p`, ` q`) ignored. |
| T02 | row-hits | — | ⬜ | |
| T03 | hover-style | — | ⬜ | |
| T04 | mouse-on | T01 | ⬜ | |
| T05 | list-clicks | T02, T03, T04 | ⬜ | |
| T06 | conversation-wheel | T04 | ⬜ | |
| T07 | mouse-docs | T05, T06 | ⬜ | |
| T08 | mouse-drill | T05, T06, T07 | ⬜ | |

**Review queue:** T01

## Blocked on the user

Nothing yet.
