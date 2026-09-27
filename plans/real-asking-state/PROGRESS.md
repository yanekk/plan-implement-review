# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**. Read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose, no bold-per-clause, no aphorism. The
cell is an index for the next session; the account is the commit message. Whoever writes a
cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-26 — 3 fixed, 4 decided with the user

**Status:** T00–T05 done; plan complete.
**Last updated:** 2026-09-27
**Next `pir-work` will:** nothing; the plan is done.

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
| T05 | live-asking-check | T04 | ✅ | Review clean, no fix commit. Re-derived every transition from bundle-2's status.jsonl and conversation logs: T01 building while parked until turn end, Remote Control after; T02 asking through its wake-up snapshot, off 2 s after the harness answer. Probed: `statusSnapshots` PIR_HOME stays scratch; a wake-up inside the asking turn never triggers `afterWake` (fails by timeout). |

**Review queue:** empty

## Blocked on the user

Nothing. T00 and T05 phone answers are recorded in FINDINGS.
