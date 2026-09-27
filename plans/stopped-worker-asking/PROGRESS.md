# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**. Read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose, no bold-per-clause, no aphorism. The
cell is an index for the next session; the account is the commit message. Whoever writes a
cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-27 — 3 fixed, 2 decided with the user

**Status:** Planned 2026-09-27 on main. Nothing built. Needs `pir/real-asking-state` merged to `main`
first (DESIGN, Base); a trial merge conflicts in `coordinate.mjs` and `harness/run.mjs` (FINDINGS).
**Last updated:** 2026-09-27
**Next `pir-work` will:** implement T01 (T01, T02 and T04 have no dependency).

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | background-fold | — | ✅ | |
| T02 | stopped-predicate | — | ✅ | |
| T03 | planning-steps-asking | T02 | ⬜ | |
| T04 | worker-reports-every-ask | — | ✅ | |
| T05 | docs | T03, T04, T06 | ⬜ | |
| T06 | stopped-asking-live | T01, T02 | 🔍 | Fixture `stopped-asking`, `answerPending.taskReplies`; 7 new tests. Live run passed, all Done-when met (FINDINGS). Deviations: replies held 15 s after the turn ends so a pass paints `asking`; `scenario.mjs` normalises `taskReplies`; `loop.test.mjs` injected-answer case now expects `asking` after the turn ends, red since T01+T02 merged. |

**Review queue:** T06

## Blocked on the user

Nothing. No task needs the person's hands (DESIGN §5.3).
