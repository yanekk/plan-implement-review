# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)** — read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose, no bold-per-clause, no aphorism. The
cell is an index for the next session; the account is the commit message you are about to
write. **Whoever writes a cell also fixes the over-budget cell they walk past.**

**Plan reviewed:** 2026-09-27 — 10 fixed, 4 decided with the user
**Plan re-reviewed (T12–T15):** 2026-09-28 — 9 fixed, 4 decided with the user

**Status:** T00–T11 ✅. Reopened 2026-09-28 for T12, T13, T15, T14 (in that order).
**Last updated:** 2026-09-28
**Next `pir-work` will:** implement T12, coordinator-row.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | coordinator-probe | — | ✅ | |
| T01 | coordinator-rulebook | T00 | ✅ | |
| T02 | coordinator-skill | — | ✅ | |
| T03 | coordinator-session | T01 | ✅ | |
| T04 | answer-first-routing | T03 | ✅ | |
| T05 | end-of-run-handoff | T04 | ✅ | |
| T06 | coordinator-screen | T04, T05 | ✅ | |
| T07 | coordinator-drill | T06 | ✅ | |
| T08 | docs | T02, T04, T05, T06 | ✅ | |
| T09 | live-coordinator-check | T07, T08 | ✅ | |
| T10 | end-tests-fix | T05; blocks T09 | ✅ | |
| T11 | end-helper-row | T06, T10; blocks T09 | ✅ | |
| T12 | coordinator-row | T06, T11 | ✅ | |
| T13 | hold-timeout | T04, T12; blocks T14 | ✅ | |
| T15 | answered-first-facts | T13; blocks T14 | ✅ | |
| T14 | live-concurrent-check | T12, T13, T15 | ✅ | |

**Review queue:** *(empty)*

## Blocked on the user

Nothing.
