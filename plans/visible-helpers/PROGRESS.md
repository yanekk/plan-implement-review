# Progress

Update this whenever a task changes state. What the build taught lives in [FINDINGS.md](FINDINGS.md).
Sixty words to a Notes cell, counted; the account is the commit message.

**Plan reviewed:** 2026-09-29 — 6 fixed, 4 decided with the user

**Status:** Building. T02 ✅.
**Last updated:** 2026-09-29
**Next `pir-work` will:** implement T01 (helper-fold), the lowest-numbered task with no dependencies.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and done ·
⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | helper-fold | — | ⬜ | |
| T02 | helper-rig-scenario | — | ✅ | Reviewed clean, no fix commit. Wire shapes checked against plan-0339's log (start and kill order, helper frame fields, `agent_id`); three tests pass and assert what they claim; CLI started and tore down; tour/long/coordinator green. Deviations (`repeat … until interrupt`, `resultFor.parent`, `canUseTool` `extra.agentId`) accepted. Idle progress ends after ~140 s: FINDINGS. |
| T03 | helper-lines | T01, T02 | ⬜ | |
| T04 | interrupt-gate | T01 | ⬜ | |
| T05 | interrupt-gate-view | T02, T03, T04 | ⬜ | |
| T06 | helpers-drill | T03, T05 | ⬜ | |
| T07 | docs | T06 | ⬜ | |

**Review queue:** —

## Blocked on the user

Nothing.
