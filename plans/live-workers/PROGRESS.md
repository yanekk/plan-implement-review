# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**. Read the rows touching the
task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The account is the commit message. Whoever
writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-25 — re-review after the Agent SDK amendment: 21 fixed, 4 decided with the user

**Status:** T00 done 2026-09-25.
**Last updated:** 2026-09-25
**Starts after:** `declared-test-command` is merged to main (user 2026-09-24, plan review): done,
d1f95ac, 2026-09-25. `nudge-quiet-worker` and `resume-dead-worker` wait for this plan.
**Next `pir-work` will:** T01 or T10, both unblocked by T00.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and done ·
⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | prove-live-worker | — | ✅ | Spike measured all 8 items; item 8 hand-verified. Review: FINDINGS and DESIGN notes checked against the doc, no scratch or probe left, tests green. Fix: cross-referenced the contradicting auto-mode force-push rows. User chose to keep pir's grant list though Claude honours session grants; DESIGN §2.6 rationale rewritten, allows never return `updatedPermissions`. |
| T01 | stream-protocol | T00 | ⬜ | |
| T02 | conversation-model | T01 | ⬜ | |
| T03 | person-input | T01 | ⬜ | |
| T04 | worker-process | T01, T10 | ⬜ | |
| T05 | live-platform | T04 | ⬜ | |
| T06 | reap-workers | T04, T05 | ⬜ | |
| T07 | person-inbox | T03, T05 | ⬜ | |
| T08 | conflict-to-worker | T05 | ⬜ | |
| T09 | asking-kinds | T05, T08 | ⬜ | |
| T10 | runtime-deps | T00 | ⬜ | |
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
