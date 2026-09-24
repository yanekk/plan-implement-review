# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**. Read the rows touching the
task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The account is the commit message. Whoever
writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** not yet — run `/pir-review-plan live-workers` before the first `/pir-work`

**Status:** Planned 2026-09-24. Nothing built.
**Last updated:** 2026-09-24
**Next `pir-work` will:** T00, the only task with no dependency.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and done ·
⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | prove-live-worker | — | ⬜ | |
| T01 | stream-protocol | T00 | ⬜ | |
| T02 | conversation-model | T01 | ⬜ | |
| T03 | person-input | T01 | ⬜ | |
| T04 | worker-process | T01 | ⬜ | |
| T05 | live-platform | T04 | ⬜ | |
| T06 | reap-workers | T04 | ⬜ | |
| T07 | person-inbox | T03, T05 | ⬜ | |
| T08 | conflict-to-worker | T05 | ⬜ | |
| T09 | asking-kinds | T05 | ⬜ | |
| T10 | pi-tui-install | T00 | ⬜ | |
| T11 | screen-on-pi-tui | T10 | ⬜ | |
| T12 | task-selection | T09, T11 | ⬜ | |
| T13 | conversation-view | T02, T07, T12 | ⬜ | |
| T14 | worker-contract | T05 | ⬜ | |
| T15 | sunset-pir-coordinate | T10 | ⬜ | |
| T16 | harness-conversations | T05, T06 | ⬜ | |
| T17 | docs | T06, T07, T08, T13, T14, T15 | ⬜ | |
| T18 | live-run | T08, T13, T14, T16, T17 | ⬜ | |

**Review queue:** empty

## Blocked on the user

Nothing.
