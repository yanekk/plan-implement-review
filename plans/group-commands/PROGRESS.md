# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**. Read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose, no bold-per-clause, no aphorism. The
cell is an index for the next session; the account is the commit message. Whoever writes a
cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-29 — 1 fixed, 3 decided with the user

**Status:** Planned 2026-09-29. Nothing built. The prototype in `prototype/` was approved by the user.
**Last updated:** 2026-09-29
**Next `pir-work` will:** review T02.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | group-steps-core | — | ✅ | |
| T02 | group-steps-view | T01 | 🔍 | Open set, click toggle with §2.5 placement, hover, signed §2.7 offset in conversation-view; `startRig` gets a `pbcopy` shim (`shimDir`, `clipboard`), the rig command prints PATH-prefixed open commands. 11 unit tests, 2 pty tests (80×24, 120×40). Deviation: shim sits in `control/bin` of the rig repo; `tour` sufficed, no new scenario. |
| T03 | group-steps-drill | T01, T02 | ⬜ | |

**Review queue:** T02

## Blocked on the user

Nothing yet.
