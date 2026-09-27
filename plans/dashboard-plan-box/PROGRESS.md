# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**. Read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The cell is an index for the next session;
the account is the commit message. Whoever writes a cell also fixes the over-budget cell they walk
past.

**Plan reviewed:** 2026-09-27 — 4 fixed, 5 decided with the user

**Status:** T02 implemented, awaiting review.
**Last updated:** 2026-09-27
**Next `pir-work` will:** review T02 plan-box-rules.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | drop-canonical-guard | — | ⬜ | |
| T02 | plan-box-rules | — | 🔍 | `src/core/planbox.mjs`, 51 tests. Adds `NOTES` export (§2.5 note builders). Bare box ignores `completing` (§2.3: no pop-up when bare). Typed box with pop-up open sends every key, chords included, to the box. `newLine` wins before any other rule. `←` on bare routes to the list. |
| T03 | repo-scan | T02 | ⬜ | |
| T04 | list-view-box | T02 | ⬜ | |
| T05 | box-starts-plan | T03, T04 | ⬜ | |
| T06 | plan-box-drill | T01, T05 | ⬜ | |

**Review queue:** T02

## Blocked on the user

Nothing.
