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
**Next `pir-work` will:** review T05.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | background-fold | — | ✅ | |
| T02 | stopped-predicate | — | ✅ | |
| T03 | planning-steps-asking | T02 | ✅ | |
| T04 | worker-reports-every-ask | — | ✅ | |
| T05 | docs | T03, T04, T06 | 🔍 | human-flow.md: stopped clause, background exception, mistaken stops, interrupt, planning pointer. planning-runs.md: step asking rule. README: one sentence. No automated tests; npm test green. Deviation: task-state.md untouched, it never states when a task reads asking. |
| T06 | stopped-asking-live | T01, T02 | ✅ | |

**Review queue:** T05

## Blocked on the user

Nothing. No task needs the person's hands (DESIGN §5.3).
