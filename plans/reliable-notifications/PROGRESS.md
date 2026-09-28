# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**. Read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose, no bold-per-clause, no aphorism. The
cell is an index for the next session; the account is the commit message. Whoever writes a
cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-28 — 8 fixed, 4 decided with the user (re-review after the redesign)

**Status:** Planned 2026-09-27, redesigned 2026-09-28 for the coordinator agent, re-reviewed 2026-09-28.
Nothing built.
**Last updated:** 2026-09-28
**Next `pir-work` will:** implement T02.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | alert-core | — | ✅ | `src/core/notify.mjs`, 45 tests. Implementer's choices (`(+N more)` kept whole, oldest question set, title fixed at start, reminder uses current url) accepted. Review fixed escape-only question text giving a bare `asks:`, reproduced and test-locked. Probed ids as UUIDs in the seq path, NaN and backward clocks, 190 cap. |
| T02 | ntfy-sender | — | ⬜ | |
| T03 | notify-icon | — | ✅ | |
| T04 | worker-link-and-silence | — | ✅ | |
| T05 | why-yours | — | ⬜ | |
| T06 | notify-command | T02 | ⬜ | |
| T07 | coordinator-alerts | T01, T02, T04, T05 | ⬜ | |
| T08 | notify-live | T03, T06, T07 | ⬜ | |
| T09 | docs | T08 | ⬜ | |

**Review queue:** empty

## Blocked on the user

Nothing yet. T08 needs the user's iPhone with ntfy installed and a yes to push the feature branch
(DESIGN §5.3).
