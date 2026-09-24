# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**. Read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose, no bold-per-clause, no aphorism. The
cell is an index for the next session; the account is the commit message. Whoever writes a
cell also fixes the over-budget cell they walk past.

**Plan reviewed:** not yet — run `/pir-review-plan nudge-quiet-worker` before the first `/pir-work`

**Status:** Planned 2026-09-24. Nothing built. T00 (live inbox probe) gates everything.
**Last updated:** 2026-09-24
**Next `pir-work` will:** implement T00, the only task with no dependencies, once the plan is reviewed.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | prove-the-inbox | — | ⬜ | |
| T01 | activity-signals | T00 | ⬜ | |
| T02 | nudge-decision | T00 | ⬜ | |
| T03 | activity-reader | T00 | ⬜ | |
| T04 | nudge-sender | T00 | ⬜ | |
| T05 | loop-wiring | T01, T02, T03, T04 | ⬜ | |
| T06 | dashboard-label | T00 | ⬜ | |
| T07 | worker-skill | T02 | ⬜ | |
| T08 | docs | T05, T06, T07 | ⬜ | |
| T09 | quiet-worker-scenario | T05, T06, T07 | ⬜ | |
| T10 | live-nudge-drill | T09 | ⬜ | |

**Review queue:** *(empty)*

## Blocked on the user

Nothing yet. T00 and T10 run `ask`-bin actions (DESIGN §5.3); their permission rules are written at
plan review.
