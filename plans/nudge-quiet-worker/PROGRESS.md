# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**. Read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose, no bold-per-clause, no aphorism. The
cell is an index for the next session; the account is the commit message. Whoever writes a
cell also fixes the over-budget cell they walk past.

**Plan reviewed:** not yet — run `/pir-review-plan` before the first `/pir-work`

**Status:** Planned 2026-09-24, reviewed 2026-09-24; re-planned 2026-09-26 on `live-workers` (nudge
over `platform.send`, activity from pir's conversation log; old T00 probe and T04 note sender dropped,
tasks renumbered). The re-plan needs its own review. Nothing built.
**Last updated:** 2026-09-26
**Next `pir-work` will:** stop until the plan is reviewed; then T01, T02, T03 and T05 have no dependency.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | activity-signals | — | ⬜ | |
| T02 | nudge-decision | — | ⬜ | |
| T03 | worker-observer | — | ⬜ | |
| T04 | loop-wiring | T01, T02, T03 | ⬜ | |
| T05 | dashboard-label | — | ⬜ | |
| T06 | worker-skill | T02 | ⬜ | |
| T07 | docs | T04, T05, T06 | ⬜ | |
| T08 | quiet-worker-scenario | T04, T05, T06 | ⬜ | |
| T09 | live-nudge-drill | T08 | ⬜ | |

**Review queue:** *(empty)*

## Blocked on the user

Nothing yet. T09 runs the `ask`-bin drill (DESIGN §5.3); its rule is in `.claude/settings.json`.
