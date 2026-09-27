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
**Last updated:** 2026-09-26
**Next `pir-work` will:** implement T05 (live asking check, needs the person's phone).

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | remote-answer-probe | — | ✅ | |
| T01 | worker-contract | — | ✅ | |
| T02 | waiting-predicate | — | ✅ | |
| T03 | answer-only-unpark | T00, T02 | ✅ | |
| T04 | docs | T01, T03 | ✅ | Review clean, no fix commit. Checked every doc claim against asking.mjs, stream.mjs workerActivity, loop.mjs resumeAnswered and coordinate.mjs (field names, command_lifecycle, fixing conflict, unseen worker); README anchors resolve; no report-first instruction left in docs or skills. control-folder.md correctly untouched. |
| T05 | live-asking-check | T04 | ⬜ | |

**Review queue:** empty

## Blocked on the user

Nothing yet. T00 and T05 need the person's phone for Remote Control answers.
