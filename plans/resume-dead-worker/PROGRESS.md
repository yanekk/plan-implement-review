# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**. Read the rows touching the
task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The account is the commit message. Whoever
writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** not yet — run `/pir-review-plan` before the first `/pir-work`

**Status:** Planned 2026-09-24. Nothing built.
**Last updated:** 2026-09-24
**Next `pir-work` will:** T00, the spike, once the plan is reviewed; T01 and T02 have no dependency
and may follow in any order.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and done ·
⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | spike-death-shapes | — | ⬜ | |
| T01 | decide-dead-worker | — | ⬜ | |
| T02 | platform-revive | — | ⬜ | |
| T03 | dead-worker-keeps-branch | T00, T01, T02 | ⬜ | |
| T04 | revive-mid-run | T02, T03 | ⬜ | |
| T05 | narrate-deaths | T04 | ⬜ | |
| T06 | revive-on-restart | T04 | ⬜ | |
| T07 | docs | T05, T06 | ⬜ | |
| T08 | harness-worker-death | T04, T06 | ⬜ | |
| T09 | live-worker-death-drill | T05, T08 | ⬜ | |

**Review queue:** empty

## Blocked on the user

Nothing.
