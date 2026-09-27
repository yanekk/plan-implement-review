# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**. Read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose, no bold-per-clause, no aphorism. The
cell is an index for the next session; the account is the commit message. Whoever writes a
cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-26 — 3 fixed, 4 decided with the user

**Status:** Planned 2026-09-26 on main after `live-workers` and the Remote Control un-park (bda34a5,
5b899df). Nothing built.
**Last updated:** 2026-09-27
**Next `pir-work` will:** implement T04.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | remote-answer-probe | — | ✅ | |
| T01 | worker-contract | — | ✅ | |
| T02 | waiting-predicate | — | ✅ | |
| T03 | answer-only-unpark | T00, T02 | ✅ | Review clean, no fix commit. Un-park only on a person/remote turn or person/Remote Control input since the park; wake-up, pir and unannounced turns advance `answerFrom`, `askEnd` fixed. Probed real-fixture shapes, mid-turn notifications, pir auto-grants, old decisions without counts. Deviations accepted. `./install.sh` deferred until the run ends (§5.3). |
| T04 | docs | T01, T03 | ⬜ | |
| T05 | live-asking-check | T04 | ⬜ | |

**Review queue:** empty

## Blocked on the user

Nothing yet. T00 and T05 need the person's phone for Remote Control answers.
