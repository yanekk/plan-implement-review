# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**. Read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose, no bold-per-clause, no aphorism. The
cell is an index for the next session; the account is the commit message. Whoever writes a
cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-27 — 3 fixed, 2 decided with the user

**Status:** All six tasks ✅ 2026-09-27.
**Last updated:** 2026-09-27
**Next `pir-work` will:** nothing; all tasks ✅, plan complete.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | background-fold | — | ✅ | |
| T02 | stopped-predicate | — | ✅ | |
| T03 | planning-steps-asking | T02 | ✅ | |
| T04 | worker-reports-every-ask | — | ✅ | |
| T05 | docs | T03, T04, T06 | ✅ | Review: one fix, README said any stopped worker reads asking; now only before its task is done (waitingOn holds in implementing/reviewing only). Every doc claim checked against asking.mjs, plan-run.mjs sessionAsking, stream.mjs interrupt and background fold, remoteWanted, pir-worker skill. task-state.md deviation accepted. npm test green. |
| T06 | stopped-asking-live | T01, T02 | ✅ | |

**Review queue:** *(empty)*

## Blocked on the user

Nothing. No task needs the person's hands (DESIGN §5.3).
