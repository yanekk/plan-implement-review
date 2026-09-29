# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**. Read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The cell is an index for the next session;
the account is the commit message. Whoever writes a cell also fixes the over-budget cell they walk
past.

**Plan reviewed:** 2026-09-28 — 3 fixed, 2 decided with the user

**Status:** T01–T04 done; T05 drill left.
**Last updated:** 2026-09-29
**Next `pir-work` will:** T05 box-commands-drill.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | box-grammar | — | ✅ | |
| T02 | plan-scan | — | ✅ | |
| T03 | box-completion | T01 | ✅ | |
| T04 | box-starts-build | T01, T02, T03 | ✅ | Review clean, no fix commit. Probed: breaking openKey or the alreadyRunning branch fails the unit tests; a pty drill at 80×24 walked @re to the live view and back with no overflow and no stray process; docs anchors checked. Deviations accepted: async submitBox, exported isBuilding, heading `The dashboard box`. |
| T05 | box-commands-drill | T04 | ⬜ | |

**Review queue:** *(empty)*

## Blocked on the user

Nothing.
