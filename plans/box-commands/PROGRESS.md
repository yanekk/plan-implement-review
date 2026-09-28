# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**. Read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The cell is an index for the next session;
the account is the commit message. Whoever writes a cell also fixes the over-budget cell they walk
past.

**Plan reviewed:** 2026-09-28 — 3 fixed, 2 decided with the user

**Status:** Planned 2026-09-28. Nothing built.
**Last updated:** 2026-09-28
**Next `pir-work` will:** T01 box-grammar: it heads the critical path.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | box-grammar | — | ✅ | |
| T02 | plan-scan | — | ✅ | |
| T03 | box-completion | T01 | 🔍 | boxCompletion replaces repoCompletion; re-open rule in toBox; `new` label, START_HINT, new suffix. 13 new tests, 29 in file. Deviations: label change also edits `new plan` assertions in plan-rig.test and pir-tui.test; view exposes cached `plansOf` for T04's submit; command and slug filters case-insensitive. |
| T04 | box-starts-build | T01, T02, T03 | ⬜ | |
| T05 | box-commands-drill | T04 | ⬜ | |

**Review queue:** T03

## Blocked on the user

Nothing.
