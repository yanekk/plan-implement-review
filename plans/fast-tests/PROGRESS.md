# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**. Read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose, no bold-per-clause, no aphorism. The
cell is an index for the next session; the account is the commit message. Whoever writes a
cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-29 — 3 fixed, 2 decided with the user

**Status:** T01–T06 ✅. Plan built; awaiting the person's merge and `./install.sh`.
**Last updated:** 2026-09-29
**Next `pir-work` will:** nothing; every task is ✅.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | wake-on-activity | — | ✅ | |
| T02 | end-sequence-no-wait | T01 | ✅ | |
| T03 | split-coordinator-drill | — | ✅ | |
| T04 | split-plan-rig | — | ✅ | |
| T05 | split-conversation-rig | — | ✅ | |
| T06 | suite-timing-proof | T01, T02, T03, T04, T05 | ✅ | Ten quiet runs 68.7–70.4 s; no concurrency flag. Four `pause()` calls kept, each guarding a pop-up staying closed. Review clean, no fix commit: quiet rerun 68 s, drills green at `PARALLEL_POLL_MS=60000`, own name diff vs 375bf1d 0 removed, 17 added by T01/T02. |

**Review queue:** *(empty)*

## Blocked on the user

After the person merges `pir/fast-tests` into `main`, run `./install.sh` so the installed engine gets the wake-up change (DESIGN §5).
