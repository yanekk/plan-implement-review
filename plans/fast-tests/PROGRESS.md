# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**. Read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose, no bold-per-clause, no aphorism. The
cell is an index for the next session; the account is the commit message. Whoever writes a
cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-29 — 3 fixed, 2 decided with the user

**Status:** T01–T05 ✅, T06 🔍.
**Last updated:** 2026-09-29
**Next `pir-work` will:** review T06.

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
| T06 | suite-timing-proof | T01, T02, T03, T04, T05 | 🔍 | Ten quiet `npm test` runs green, 68.7–70.4 s. Test names vs plan base 375bf1d: none lost, 17 added by T01/T02. Drills green at `PARALLEL_POLL_MS=60000`. No concurrency flag. README updated. Deviation: the four `pause()` calls kept; each guards a pop-up staying closed, which no screen condition can wait on. |

**Review queue:** T06

## Blocked on the user

After the person merges `pir/fast-tests` into `main`, run `./install.sh` so the installed engine gets the wake-up change (DESIGN §5).
