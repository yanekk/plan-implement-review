# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)** — read the rows touching
the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The cell is an index for the next session;
the account is the commit message. Whoever writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-22 — 4 fixed, 3 decided with the user

**Status:** Plan just written. Prototype approved by the user (2026-09-22) and parked in
`prototype/`. Detached-spawn and process-identity mechanisms verified on the machine (FINDINGS).
Nothing implemented yet.
**Last updated:** 2026-09-22
**Next `pir-work` will:** in this parallel run the coordinator dispatches by dependency —
with T10 ✅ the next buildable is T11 (pir-command, deps T08 ✅). Review queue empty.

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
| T10 | coordinator-reporting | T07 | ✅ | Reviewed clean, no fix. 10 tests read the snapshot/index back off disk, not vacuous; all 6 doc cases covered. Verified classic path fully gated (selfReport off → no writes, SIGTERM → classic teardown), abnormal exits write nothing → crashed, stop keeps worktrees. Probed signal races, stop-before-first-pass seed, best-effort index update. Lazy-T06-import deviation sound; PM dep question stands in FINDINGS. |
| T11 | pir-command | T08 | ⬜ | |
| T12 | dashboard-tui | T04, T07, T09, T10, T11 | ⬜ | hands-on: the live feel |
| T13 | docs-and-install | T12 | ⬜ | updates /docs |

**Review queue:** empty

## Blocked on the user

Nothing right now. Two tasks will need a person when they are built: T08 (confirm a run survives
closing WezTerm) and T12 (confirm the live dashboard reads right). The worker raises each through
the normal question path when it reaches that point — not homework left for the end.
