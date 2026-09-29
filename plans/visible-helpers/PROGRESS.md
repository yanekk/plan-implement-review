# Progress

Update this whenever a task changes state. What the build taught lives in [FINDINGS.md](FINDINGS.md).
Sixty words to a Notes cell, counted; the account is the commit message.

**Plan reviewed:** 2026-09-29 — 6 fixed, 4 decided with the user

**Status:** T01 implemented, awaiting review.
**Last updated:** 2026-09-29
**Next `pir-work` will:** review T01 (helper-fold).

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and done ·
⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | helper-fold | — | 🔍 | stream.mjs tags `helper`/`agentId`, helper frames open no turn; helpers.mjs `helpersOf`/`runningHelpers`/`helperOfFrame`; 45-line fixture; 21 new tests. Deviations: an end event with an unknown status is ignored; `helperOfFrame` climbs any tool_use id, not only Agent calls; fixture also keeps the second interrupt. |
| T02 | helper-rig-scenario | — | ⬜ | |
| T03 | helper-lines | T01, T02 | ⬜ | |
| T04 | interrupt-gate | T01 | ⬜ | |
| T05 | interrupt-gate-view | T02, T03, T04 | ⬜ | |
| T06 | helpers-drill | T03, T05 | ⬜ | |
| T07 | docs | T06 | ⬜ | |

**Review queue:** T01

## Blocked on the user

Nothing.
