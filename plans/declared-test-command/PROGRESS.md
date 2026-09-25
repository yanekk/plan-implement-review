# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**. Read the rows touching the
task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The account is the commit message. Whoever
writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-24 — 8 fixed, 4 decided with the user

**Status:** All tasks ✅ 2026-09-25. Install pending the merge to main.
**Last updated:** 2026-09-25
**Next `pir-work` will:** nothing; the plan is done.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and done ·
⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | parse-test-block | — | ✅ | |
| T02 | command-runner | — | ✅ | |
| T03 | start-refusal | T01 | ✅ | |
| T04 | end-gate-from-block | T01, T02 | ✅ | |
| T05 | red-reason-visible | — | ✅ | |
| T06 | spawn-note | — | ✅ | |
| T07 | worker-setup | T01, T02, T06 | ✅ | |
| T08 | planner-writes-block | T01 | ✅ | |
| T09 | review-verifies-block | T01 | ✅ | |
| T10 | harness-fixture-block | T01 | ✅ | |
| T11 | docs | T03, T04, T05, T07, T08, T09 | ✅ | |
| T12 | prove-and-install | T03, T04, T05, T07, T08, T09, T10, T11 | ✅ | Review clean, no fix commit. Live checks and user verdict in FINDINGS 2026-09-25. Re-ran blockless refusal in a fresh fixture: exit 1, T03 message, no `.parallel`, no branch; `npm test` green; scratches gone. Install not run: plan defers it until after merge to main, see Blocked on the user. |

**Review queue:** *(empty)*

## Blocked on the user

After the user merges `pir/declared-test-command` to main: run `./install.sh`, then
`grep -n parseTestBlock ~/.claude/pir-engine/src/shell/coordinate.mjs` and check
`~/.claude/skills/pir-work/SKILL.md` has the block gate (T12 done-when, last item).
