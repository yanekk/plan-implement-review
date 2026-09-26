# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**. Read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The cell is an index for the next session;
the account is the commit message. Whoever writes a cell also fixes the over-budget cell they walk
past.

**Plan reviewed:** 2026-09-26 — 8 fixed, 7 decided with the user

**Status:** Planned 2026-09-26. Nothing built.
**Last updated:** 2026-09-26
**Next `pir-work` will:** T01 plan-flow-core: it heads the critical path.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | plan-flow-core | — | ✅ | |
| T02 | run-record-type | — | ✅ | |
| T03 | plan-home | — | ✅ | |
| T04 | plan-branch | — | ✅ | |
| T05 | fake-claude-sessions | — | ✅ | |
| T06 | plan-run-planner | T01, T02, T04, T05 | ✅ | |
| T07 | plan-run-review | T06 | ✅ | |
| T08 | plan-launch | T01, T02, T03, T04 | ✅ | |
| T09 | pir-commands | T08 | ✅ | |
| T10 | plan-rig | T05 | ✅ | |
| T11 | dashboard-type | T02, T07, T08, T10 | ✅ | |
| T12 | plan-watch-view | T07, T08, T10, T11 | ⬜ | |
| T13 | brief-box | T09, T12 | ⬜ | |
| T14 | plan-screen-drill | T11, T12, T13 | ⬜ | |
| T15 | planning-skills | T01 | ✅ | |
| T16 | docs-readme | T14, T15 | ⬜ | |
| T17 | harness-plan-fixture | T07, T08, T15 | ✅ | |
| T18 | live-plan-run | T14, T16, T17 | ⬜ | |

**Review queue:** *(empty)*

## Blocked on the user

Nothing yet. T18's skill copy and live run are `ask` actions (DESIGN §5.3): the permission prompt is the user's yes.
