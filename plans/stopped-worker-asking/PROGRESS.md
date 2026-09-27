# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**. Read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose, no bold-per-clause, no aphorism. The
cell is an index for the next session; the account is the commit message. Whoever writes a
cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-27 — 3 fixed, 2 decided with the user

**Status:** Planned 2026-09-27 on main. T04 done. Needs `pir/real-asking-state` merged to `main`
first (DESIGN, Base); a trial merge conflicts in `coordinate.mjs` and `harness/run.mjs` (FINDINGS).
**Last updated:** 2026-09-27
**Next `pir-work` will:** implement T01 (T01 and T02 have no dependency).

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | background-fold | — | ⬜ | |
| T02 | stopped-predicate | — | ⬜ | |
| T03 | planning-steps-asking | T02 | ⬜ | |
| T04 | worker-reports-every-ask | — | ✅ | Review clean, no fix commit. Sentence sits in pir-worker step 1 as §2.4 says, only change to the skill; npm test green. Probed: no other copy of the section text in the repo, no clash with the ask-bin rule against pre-dropping a report for a permission prompt. |
| T05 | docs | T03, T04, T06 | ⬜ | |
| T06 | stopped-asking-live | T01, T02 | ⬜ | |

**Review queue:** empty

## Blocked on the user

Nothing. No task needs the person's hands (DESIGN §5.3).
