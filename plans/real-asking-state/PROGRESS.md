# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**. Read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose, no bold-per-clause, no aphorism. The
cell is an index for the next session; the account is the commit message. Whoever writes a
cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-26 — 3 fixed, 4 decided with the user

**Status:** T00–T04 done; T05 built and live-checked with the user, awaiting review.
**Last updated:** 2026-09-27
**Next `pir-work` will:** review T05.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | remote-answer-probe | — | ✅ | |
| T01 | worker-contract | — | ✅ | |
| T02 | waiting-predicate | — | ✅ | |
| T03 | answer-only-unpark | T00, T02 | ✅ | |
| T04 | docs | T01, T03 | ✅ | |
| T05 | live-asking-check | T04 | 🔍 | Fixture `real-asking`, `answerPending.afterWake`, capture `status.jsonl`; 6 new tests. Live run passed with the user's phone (FINDINGS). Deviation: added scenario flag `statusSnapshots` and `seatbeltEnv` `pirHome` (PIR_RUN=1), touching `scenario.mjs`, because the harness coordinator otherwise writes no status.json. |

**Review queue:** T05

## Blocked on the user

Nothing. T00 and T05 phone answers are recorded in FINDINGS.
