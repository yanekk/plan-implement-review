# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**. Read the rows touching the
task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The account is the commit message. Whoever
writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-24 — 8 fixed, 4 decided with the user

**Status:** T01 built, awaiting review.
**Last updated:** 2026-09-24
**Next `pir-work` will:** review T01; T02, T05 and T06 have no dependency and may
follow in any order.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and done ·
⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | parse-test-block | — | 🔍 | `parseTestBlock` in `src/core/testblock.mjs`, 16 tests. Beyond the doc: indented lines under an unknown key are skipped (nested maps too); items accept any indent and spacing after `-`; a repeated key replaces the earlier one. `testcommand.mjs` left for T04. |
| T02 | command-runner | — | ⬜ | |
| T03 | start-refusal | T01 | ⬜ | |
| T04 | end-gate-from-block | T01, T02 | ⬜ | |
| T05 | red-reason-visible | — | ⬜ | |
| T06 | spawn-note | — | ⬜ | |
| T07 | worker-setup | T01, T02, T06 | ⬜ | |
| T08 | planner-writes-block | T01 | ⬜ | |
| T09 | review-verifies-block | T01 | ⬜ | |
| T10 | harness-fixture-block | T01 | ⬜ | |
| T11 | docs | T03, T04, T05, T07, T08, T09 | ⬜ | |
| T12 | prove-and-install | T03, T04, T05, T07, T08, T09, T10, T11 | ⬜ | |

**Review queue:** T01

## Blocked on the user

Nothing.
