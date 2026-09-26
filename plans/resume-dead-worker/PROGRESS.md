# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**. Read the rows touching the
task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The account is the commit message. Whoever
writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** not yet — re-planned onto live workers 2026-09-26; run `/pir-review-plan` before the first
`/pir-work`. The 2026-09-24 review (5 fixed, 6 decided) covered the superseded `claude --bg` plan.

**Status:** Planned 2026-09-24, re-planned onto live workers 2026-09-26. Nothing built.
**Last updated:** 2026-09-26
**Build route:** parallel (`pir resume-dead-worker`), user decision at plan review.
**Next:** `/pir-review-plan resume-dead-worker`; then T01 and T02, which have no dependency.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and done ·
⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | decide-dead-worker | — | ⬜ | |
| T02 | platform-revive | — | ⬜ | |
| T03 | dead-worker-keeps-branch | T01, T02 | ⬜ | |
| T04 | revive-mid-run | T02, T03 | ⬜ | |
| T05 | narrate-deaths | T04 | ⬜ | |
| T06 | revive-on-restart | T04 | ⬜ | |
| T07 | docs | T05, T06 | ⬜ | |
| T08 | harness-worker-death | T04, T06 | ⬜ | |
| T09 | live-worker-death-drill | T05, T08 | ⬜ | |

**Review queue:** empty

## Blocked on the user

Nothing.
