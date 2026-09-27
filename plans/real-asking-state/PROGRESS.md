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
**Next `pir-work` will:** review T00.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | remote-answer-probe | — | 🔍 | Spike done, cases 1–5 run and hand-verified on the user's phone 2026-09-27. Verdict: stream-only (`command_lifecycle`) separates; hook `source` absent; replay works but unneeded. Fixture `remote-answer-sample.ndjson`, 6 cases. Deviations: probe ran haiku; case 4 `permissionMode: default` to force a prompt; case 5 auto-allowed its Bash request; extra case 2 run without replay. |
| T01 | worker-contract | — | ⬜ | |
| T02 | waiting-predicate | — | ⬜ | |
| T03 | answer-only-unpark | T00, T02 | ⬜ | |
| T04 | docs | T01, T03 | ⬜ | |
| T05 | live-asking-check | T04 | ⬜ | |

**Review queue:** T00

## Blocked on the user

Nothing yet. T00 and T05 need the person's phone for Remote Control answers.
