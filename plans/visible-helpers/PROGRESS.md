# Progress

Update this whenever a task changes state. What the build taught lives in [FINDINGS.md](FINDINGS.md).
Sixty words to a Notes cell, counted; the account is the commit message.

**Plan reviewed:** 2026-09-29 — 6 fixed, 4 decided with the user

**Status:** T01 done; T02 and T04 ready.
**Last updated:** 2026-09-29
**Next `pir-work` will:** implement T02 (helper-rig-scenario).

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and done ·
⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | helper-fold | — | ✅ | helpers.mjs fold, `helper`/`agentId` tags, helper frames open no turn; 45-line fixture. Review: one fix, nested helpers were listed as separate helpers (reproduced by script, test locks it). Probed end-event order, resumed note, request after result, fixture turn states. Recorded deviations accepted. npm test green. |
| T02 | helper-rig-scenario | — | ⬜ | |
| T03 | helper-lines | T01, T02 | ⬜ | |
| T04 | interrupt-gate | T01 | ⬜ | |
| T05 | interrupt-gate-view | T02, T03, T04 | ⬜ | |
| T06 | helpers-drill | T03, T05 | ⬜ | |
| T07 | docs | T06 | ⬜ | |

**Review queue:** empty

## Blocked on the user

Nothing.
