# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**. Read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose, no bold-per-clause, no aphorism. The
cell is an index for the next session; the account is the commit message. Whoever writes a
cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-27 — 10 fixed, 2 decided with the user

**Status:** Planned 2026-09-27. Nothing built.
**Last updated:** 2026-09-27
**Next `pir-work` will:** implement T01 (T01, T02 and T04 have no dependency).

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | alert-core | — | ⬜ | |
| T02 | ntfy-sender | — | ⬜ | |
| T03 | notify-command | T02 | ⬜ | |
| T04 | worker-link-and-silence | — | ⬜ | |
| T05 | coordinator-alerts | T01, T02, T04 | ⬜ | |
| T06 | notify-live | T03, T05 | ⬜ | |
| T07 | docs | T06 | ⬜ | |

**Review queue:** *(empty)*

## Blocked on the user

Nothing yet. T06 needs the user's iPhone with ntfy installed (DESIGN §5.3).
