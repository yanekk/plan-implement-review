# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**. Read the rows touching the
task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The account is the commit message. Whoever
writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-24 — 8 fixed, 4 decided with the user

**Status:** Planned 2026-09-24. Nothing built.
**Last updated:** 2026-09-24
**Next `pir-work` will:** any of T02, T03, T05, T09, T10; their dependencies are ✅.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and done ·
⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | parse-test-block | — | ✅ | |
| T02 | command-runner | — | ✅ | |
| T03 | start-refusal | T01 | ⬜ | |
| T04 | end-gate-from-block | T01, T02 | ⬜ | |
| T05 | red-reason-visible | — | ⬜ | |
| T06 | spawn-note | — | ✅ | |
| T07 | worker-setup | T01, T02, T06 | ⬜ | |
| T08 | planner-writes-block | T01 | ✅ | Template opens with the block; skills and CLAUDE.md name its test lines. Review clean, no fix commit: suite green, test fails if the block is gutted, grep finds no fenced-block or § Environment-only wording outside pir-review-plan (T09). Probed the template's comment line and setup cd semantics. |
| T09 | review-verifies-block | T01 | ⬜ | |
| T10 | harness-fixture-block | T01 | ⬜ | |
| T11 | docs | T03, T04, T05, T07, T08, T09 | ⬜ | |
| T12 | prove-and-install | T03, T04, T05, T07, T08, T09, T10, T11 | ⬜ | |

**Review queue:** none

## Blocked on the user

Nothing.
