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
| T02 | helper-rig-scenario | — | ✅ | |
| T03 | helper-lines | T01, T02 | 🔍 | Helper line under its Agent step, helper frames hidden by default and labelled in `full`, helper's background commands likewise, request head names the helper, `agentId` logged, status line counts helpers. 11 tests incl. rig e2e 80×24, 120×40. Deviations: `1 step` singular (person); `statusParts` exported from the view; e2e uses `settleMs: 100`. |
| T04 | interrupt-gate | T01 | ⬜ | |
| T05 | interrupt-gate-view | T02, T03, T04 | ⬜ | |
| T06 | helpers-drill | T03, T05 | ⬜ | |
| T07 | docs | T06 | ⬜ | |

**Review queue:** T03

## Blocked on the user

Nothing.
