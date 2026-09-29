# Progress

Update this whenever a task changes state. What the build taught lives in [FINDINGS.md](FINDINGS.md).
Sixty words to a Notes cell, counted; the account is the commit message.

**Plan reviewed:** 2026-09-29 — 6 fixed, 4 decided with the user

**Status:** Planned 2026-09-29. Nothing built.
**Last updated:** 2026-09-29
**Next `pir-work` will:** implement T01 (helper-fold), the lowest-numbered task with no dependencies.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and done ·
⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | helper-fold | — | ✅ | |
| T02 | helper-rig-scenario | — | ⬜ | |
| T03 | helper-lines | T01, T02 | ⬜ | |
| T04 | interrupt-gate | T01 | 🔍 | `interruptGate`, `gateWarning`, `stoppedByInterrupt`, `helpersNote` in helpers.mjs; 9 tests. Deviations: `gateWarning(null)` returns ''; a nameless helper is named by its id; `helpersStopped` read off the raw `out message` entry since `sent` drops it; descriptions quoted verbatim, no escaping. |
| T05 | interrupt-gate-view | T02, T03, T04 | ⬜ | |
| T06 | helpers-drill | T03, T05 | ⬜ | |
| T07 | docs | T06 | ⬜ | |

**Review queue:** T04

## Blocked on the user

Nothing.
