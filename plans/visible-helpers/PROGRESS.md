# Progress

Update this whenever a task changes state. What the build taught lives in [FINDINGS.md](FINDINGS.md).
Sixty words to a Notes cell, counted; the account is the commit message.

**Plan reviewed:** 2026-09-29 — 6 fixed, 4 decided with the user

**Status:** Planned 2026-09-29. Nothing built.
**Last updated:** 2026-09-29
**Next `pir-work` will:** implement T06 (helpers-drill).

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and done ·
⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | helper-fold | — | ✅ | |
| T02 | helper-rig-scenario | — | ✅ | |
| T03 | helper-lines | T01, T02 | ✅ | |
| T04 | interrupt-gate | T01 | ✅ | |
| T05 | interrupt-gate-view | T02, T03, T04 | ✅ | Review: one fix, the Esc warning clipped the second helper's name at 80 columns; now wraps (person's choice), test locks it. Probed Ctrl+C/autocomplete disarm paths, coordinator-agent and plan-run pass-through, undelivered sends; PgUp not disarming logged. Rig e2e green at 80×24, 120×40. |
| T06 | helpers-drill | T03, T05 | ⬜ | |
| T07 | docs | T06 | ⬜ | |

**Review queue:** empty

## Blocked on the user

Nothing.
