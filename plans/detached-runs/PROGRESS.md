# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)** — read the rows touching
the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The cell is an index for the next session;
the account is the commit message. Whoever writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-22 — 4 fixed, 3 decided with the user

**Status:** T13 (docs + install) implemented, awaiting review — the last task. All others ✅.
`docs/detached-runs.md` written and linked; `install.sh` installs `bin/pir` alongside
`pir-coordinate`. Once T13 is reviewed the plan is done.
**Last updated:** 2026-09-22
**Next `pir-work` will:** review T13 (the review queue's only entry). It is the last task, so a
clean review completes the plan.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and done ·
⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | run-state | — | ✅ | |
| T02 | index-record | — | ✅ | |
| T03 | snapshot-model | — | ✅ | |
| T04 | dashboard-model | T01 | ✅ | |
| T05 | process-identity | T01 | ✅ | |
| T06 | index-store | T02 | ✅ | |
| T07 | snapshot-store | T03 | ✅ | |
| T08 | start-detached | T05, T06 | ✅ | |
| T09 | stop-and-remove | T05, T06 | ✅ | |
| T10 | coordinator-reporting | T07 | ✅ | |
| T11 | pir-command | T08 | ✅ | |
| T12 | dashboard-tui | T04, T07, T09, T10, T11 | ✅ | |
| T13 | docs-and-install | T12 | 🔍 | Wrote docs/detached-runs.md, linked from docs/README.md. install.sh installs bin/pir alongside pir-coordinate via a LAUNCHERS loop. .gitignore already covers status.json — unchanged. Doc carries the as-built keys (← back, esc quit), not DESIGN §2.3/§2.4/§2.11. Deviation: updated launcher.test.mjs to the loop and to cover pir (its literal grep broke). |

**Review queue:** T13

## Blocked on the user

Nothing. T13 (docs + install) needs no hand-check — the doc is verified by reading, the install
wiring by simulating its launcher substitution. T08 (run survives closing WezTerm) and T12 (the
live dashboard reads right) were both hand-verified with the user (FINDINGS).
