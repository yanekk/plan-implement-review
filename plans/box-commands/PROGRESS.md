# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**. Read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The cell is an index for the next session;
the account is the commit message. Whoever writes a cell also fixes the over-budget cell they walk
past.

**Plan reviewed:** 2026-09-28 — 3 fixed, 2 decided with the user

**Status:** All five tasks ✅ on `pir/box-commands`; install follows the merge to main.
**Last updated:** 2026-09-29
**Next `pir-work` will:** nothing; the plan is built. `./install.sh` after the merge (Blocked).

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | box-grammar | — | ✅ | |
| T02 | plan-scan | — | ✅ | |
| T03 | box-completion | T01 | ✅ | |
| T04 | box-starts-build | T01, T02, T03 | ✅ | |
| T05 | box-commands-drill | T04 | ✅ | Drill at 80×24 and 120×40, 8 plan-rig tests; user decided empty-list line `plan or build`. Review clean, no fix commit: npm test green; probed by breaking the slug-pick and Esc no-reopen guards in list-view, both caught by the new Esc test. Install follows the merge, see Blocked. |

**Review queue:** *(empty)*

## Blocked on the user

- `./install.sh` follows the person's merge of `pir/box-commands` into `main`, with no run live (DESIGN §5); then check `~/.claude/pir-engine/src/shell/plan-scan.mjs` exists.
