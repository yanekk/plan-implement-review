# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**. Read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The cell is an index for the next session;
the account is the commit message. Whoever writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** not yet — run `/pir-review-plan` before the first `/pir-work`

**Status:** Planned 2026-10-02. Nothing built. Start only after `pir/single-finisher` is merged to main (PLAN.md).
**Last updated:** 2026-10-02
**Next `pir-work` will:** T01 queue-core, the first task with no dependency (T02 is also free).

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | queue-core | — | ⬜ | |
| T02 | task-gate-rules | — | ⬜ | |
| T03 | rows-and-alert | T01, T02 | ⬜ | |
| T04 | queue-client | T01 | ⬜ | |
| T05 | build-task-gate | T02, T03, T04 | ⬜ | |
| T06 | stop-on-third-red | T03, T05 | ⬜ | |
| T07 | retest-on-resume | T02, T05 | ⬜ | |
| T08 | queued-end-gate | T02, T03, T04 | ⬜ | |
| T09 | single-runs-queue | T01, T02, T04 | ⬜ | |
| T10 | worker-skills | T02 | ⬜ | |
| T11 | queue-screen | T01, T04 | ⬜ | |
| T12 | build-rows-on-screen | T03, T05, T06 | ⬜ | |
| T13 | queue-drill | T08, T09, T11, T12 | ⬜ | |
| T14 | harness-fixture | T05, T06, T07, T10 | ⬜ | |
| T15 | docs-readme | T06, T07, T08, T09, T10, T11, T12 | ⬜ | |
| T16 | live-run | T13, T14, T15 | ⬜ | |

**Review queue:** *(empty)*

## Blocked on the user

Nothing.
