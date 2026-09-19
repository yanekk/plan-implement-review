# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)** — read the rows touching the
task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The cell is an index for the next session; the
account is the commit message. Whoever writes a cell also fixes the over-budget cell they walk past.

**Build this plan in classic flow, one `/pir-work` at a time — not parallel mode** (DESIGN §2.7): it
rebuilds the parallel coordinator, so the coordinator must not drive it.

**Plan reviewed:** not yet — run `/pir-review-plan non-agentic-coordinator` before the first `/pir-work`

**Status:** Planned, not reviewed, not started. Base is clean at the last commit (abandoned
`coordinator-trust` debris swept into a labeled `git stash`, 2026-09-19) and green. The live display
shape was confirmed with the person against `prototype/cli-display.html`.
**Last updated:** 2026-09-19
**Next `pir-work` will:** nothing yet — `/pir-review-plan` must run first. After that, implement T01
(the first `⬜` whose dependencies are met).

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and done ·
⛔ blocked, needs a human. **Runs:** `auto` a background worker builds it · `you` a person runs it.
This plan removes the `Runs` distinction (T03); the column stays here because the current machinery
still reads it while the plan is being built.

| # | Task | Runs | Depends on | State | Notes |
|---|---|---|---|---|---|
| T01 | Stop promoting; hand off the green feature branch | auto | — | ⬜ | |
| T02 | Replace the agent bridge with the live status display | auto | T01 | ⬜ | |
| T03 | Remove the auto/you distinction and the verify path (code) | auto | T02 | ⬜ | |
| T04 | Rework the harness to the new model; prove kill-and-rebuild | auto | T03 | ⬜ | |
| T05 | Ship the worker classifier pre-approval + prereq note | auto | — | ⬜ | |
| T06 | Delete dead skills; de-agent the worker skills | auto | T03 | ⬜ | |
| T07 | Rewrite /docs and the CLAUDE.md carve-out | auto | T04, T06 | ⬜ | |
| T08 | Live end-to-end hand-verification with the person | you | T05, T07 | ⬜ | |

A Notes cell holds what was built or what the review found, the test count, and one line per
deviation from the task doc. A ✅ task's cell may be cut to one line once the next task is reviewed.

**Review queue:** empty.

## Blocked on the user

Nothing blocked. T08 needs the person's hands (a live drill) but only after T05 and T07 are done; it
is not blocked yet.
