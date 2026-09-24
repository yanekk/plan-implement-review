# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**. Read the rows touching the
task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The account is the commit message. Whoever
writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-24 — 8 fixed, 4 decided with the user

**Status:** T01 done.
**Last updated:** 2026-09-24
**Next `pir-work` will:** implement any of T02, T03, T05, T06, T08, T09, T10; their dependencies are met.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and done ·
⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | parse-test-block | — | ✅ | Review clean, no fix commit. All listed cases asserted; 31 tests green with boundary. Probed beyond the doc: BOM, `--- ` with trailing space, `setup:none`, repeated key, mixed line endings; all spec-literal. Implementer choices (unknown-key bodies skipped, any item indent, last repeated key wins) accepted. |
| T02 | command-runner | — | ⬜ | |
| T03 | start-refusal | T01 | ⬜ | |
| T04 | end-gate-from-block | T01, T02 | ⬜ | |
| T05 | red-reason-visible | — | ⬜ | |
| T06 | spawn-note | — | ✅ | |
| T07 | worker-setup | T01, T02, T06 | ⬜ | |
| T08 | planner-writes-block | T01 | ⬜ | |
| T09 | review-verifies-block | T01 | ⬜ | |
| T10 | harness-fixture-block | T01 | ⬜ | |
| T11 | docs | T03, T04, T05, T07, T08, T09 | ⬜ | |
| T12 | prove-and-install | T03, T04, T05, T07, T08, T09, T10, T11 | ⬜ | |

**Review queue:** empty

## Blocked on the user

Nothing.
