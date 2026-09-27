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
**Next `pir-work` will:** T04 list-view-box (T05 then waits on it).

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | drop-canonical-guard | — | ⬜ | |
| T02 | plan-box-rules | — | ✅ | |
| T03 | repo-scan | T02 | ✅ | Reviewed: one fix, HOME with a trailing slash made rootsLabel show `/h/src` not `~/src` (failing test first, homeOf resolves HOME). Probed: the worktree test does defend the `.git`-file skip; unreadable fs and git failure skip cleanly. Criteria met; npm test green. |
| T04 | list-view-box | T02 | ⬜ | |
| T05 | box-starts-plan | T03, T04 | ⬜ | |
| T06 | plan-box-drill | T01, T05 | ⬜ | |

**Review queue:** empty

## Blocked on the user

Nothing.
