# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**. Read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose, no bold-per-clause, no aphorism. The
cell is an index for the next session; the account is the commit message. Whoever writes a
cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-28 — 6 fixed, 6 decided with the user

**Status:** Planned 2026-09-28, amended the same day for the coordinator agent's rows (`7c59312`). T01–T07 done; T08 awaiting review. The spike in `prototype/` was run by the user and approved.
**Last updated:** 2026-09-28
**Next `pir-work` will:** review T08.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | mouse-rig | — | ✅ | |
| T02 | row-hits | — | ✅ | |
| T03 | hover-style | — | ✅ | |
| T04 | mouse-on | T01 | ✅ | |
| T05 | list-clicks | T02, T03, T04 | ✅ | |
| T06 | conversation-wheel | T04 | ✅ | |
| T07 | mouse-docs | T05, T06 | ✅ | |
| T08 | mouse-drill | T05, T06, T07 | 🔍 | Drill at three sizes, worker-driven. Fixed: SIGTERM restore adds `?2004l`; a double click on an unchanged row no longer copies (`rowClick` resets pi-tui `lastClick`); rig `pbcopy` shim. User chose brighter amber hover on asking rows. Rig `fgAt`. Eight new tests. Deviation: `./install.sh` not run (parallel), see Blocked. |

**Review queue:** T08

## Blocked on the user

- Run `./install.sh` once `pir/mouse-navigation` is merged to `main` and no run is live (T08, DESIGN §5).
