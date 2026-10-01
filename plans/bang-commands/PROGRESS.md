# Progress

**Update this whenever a task changes state.** It is the handoff between sessions. What the build
taught lives in [FINDINGS.md](FINDINGS.md); read the rows touching your task and append yours there.

Sixty words to a Notes cell, counted. Flat prose. Whoever writes a cell also fixes the over-budget cell
they walk past.

**Plan reviewed:** 2026-10-01 — 9 fixed, 4 decided with the user

**Status:** T00–T09 ✅; T10 left. The 10 red `notify-wiring.test.mjs` cases are known, from `main` (DESIGN §4).
**Last updated:** 2026-10-01
**Next `pir-work` will:** T10, docs and README.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and done ·
⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | hand-tool-spike | — | ✅ | |
| T01 | shell-runner | — | ✅ | |
| T02 | bang-rules | — | ✅ | |
| T03 | bang-forwarding | T01, T02 | ✅ | |
| T04 | hand-rules | T00, T02 | ✅ | |
| T05 | hand-tool | T00, T03, T04 | ✅ | |
| T06 | bang-view | T02, T03 | ✅ | |
| T07 | hand-view | T05, T06 | ✅ | |
| T08 | bang-drill | T06, T07 | ✅ | Review: one fix, the reopen drill asserted `sleep 3` ends in 3–4s; reproduced 5s twice under full npm test, now holds the ≥3s floor. Probed the hidden hand step (no helper line lost, unit test goes red with the fix gutted), all 12 drill tests alone and in the suite. Drill split per size accepted. |
| T09 | agent-rules | T05 | ✅ | |
| T10 | docs-readme | T08, T09 | ⬜ | |

**Review queue:** *(empty)*

## Blocked on the user

Nothing.
