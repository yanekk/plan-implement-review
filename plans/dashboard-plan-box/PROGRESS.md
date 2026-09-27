# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**. Read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The cell is an index for the next session;
the account is the commit message. Whoever writes a cell also fixes the over-budget cell they walk
past.

**Plan reviewed:** 2026-09-27 — 4 fixed, 5 decided with the user

**Status:** Planned 2026-09-26. Nothing built.
**Last updated:** 2026-09-27
**Next `pir-work` will:** T03 repo-scan; T05 waits on it.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | drop-canonical-guard | — | ✅ | |
| T02 | plan-box-rules | — | ✅ | |
| T03 | repo-scan | T02 | ⬜ | |
| T04 | list-view-box | T02 | ✅ | Review clean, no fix commit. Accepted the seven recorded deviations as readings of §2.6/§2.7. Probed: stale pop-up after backspace to bare (closes; Enter goes to list), tall pasted brief at 8/10/12 rows (fits from 10; 8 rows overflows by one, chrome alone exceeds it), unwindowed frame unchanged. |
| T05 | box-starts-plan | T03, T04 | ⬜ | |
| T06 | plan-box-drill | T01, T05 | ⬜ | |

**Review queue:** —

## Blocked on the user

Nothing.
