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
| T01 | helper-fold | — | ⬜ | |
| T02 | helper-rig-scenario | — | 🔍 | `helpers` scenario, helper shape builders in the fake, 3 tests. Deviations: fake gained `repeat … until interrupt` (A must progress while idle) and `resultFor.parent`; `canUseTool` takes `extra.agentId`. Until T01 the worker reads busy while A works. |
| T03 | helper-lines | T01, T02 | ⬜ | |
| T04 | interrupt-gate | T01 | ⬜ | |
| T05 | interrupt-gate-view | T02, T03, T04 | ⬜ | |
| T06 | helpers-drill | T03, T05 | ⬜ | |
| T07 | docs | T06 | ⬜ | |

**Review queue:** T02

## Blocked on the user

Nothing.
