# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**. Read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose, no bold-per-clause, no aphorism. The
cell is an index for the next session; the account is the commit message. Whoever writes a
cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-29 — 3 fixed, 2 decided with the user

**Status:** T01 implemented, awaiting review.
**Last updated:** 2026-09-29
**Next `pir-work` will:** review T01.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | wake-on-activity | — | 🔍 | Waker moved to drop-folder with 250 ms gap; hooks in platform, agent, inbox, startLines; stall/runaway graces also need grace×POLL_MS. 12 new tests. Deviations: agent watches decisions/ itself; onSettled also on kill; fake agent pauses 1.5 s before passing a question (drills assumed 5 s lag); idle stall now ~15 s. Drill file 205→121 s under load. |
| T02 | end-sequence-no-wait | T01 | ⬜ | |
| T03 | split-coordinator-drill | — | ⬜ | |
| T04 | split-plan-rig | — | ⬜ | |
| T05 | split-conversation-rig | — | ⬜ | |
| T06 | suite-timing-proof | T01, T02, T03, T04, T05 | ⬜ | |

**Review queue:** T01

## Blocked on the user

Nothing yet.
