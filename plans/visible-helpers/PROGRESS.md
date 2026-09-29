# Progress

Update this whenever a task changes state. What the build taught lives in [FINDINGS.md](FINDINGS.md).
Sixty words to a Notes cell, counted; the account is the commit message.

**Plan reviewed:** 2026-09-29 — 6 fixed, 4 decided with the user

**Status:** Planned 2026-09-29. Nothing built.
**Last updated:** 2026-09-29
**Next `pir-work` will:** implement T07 (docs).

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and done ·
⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | helper-fold | — | ✅ | |
| T02 | helper-rig-scenario | — | ✅ | |
| T03 | helper-lines | T01, T02 | ✅ | |
| T04 | interrupt-gate | T01 | ✅ | |
| T05 | interrupt-gate-view | T02, T03, T04 | ✅ | |
| T06 | helpers-drill | T03, T05 | ✅ | Drill at 80×24, 120×40, 60×20 plus tour; one fix: running helper's step text shortens so count and time stay visible (person's choice over DESIGN §2.2 clip). Review clean, no fix commit; npm test green; probed widths 1–200, emoji, escapes, tabs, long description, empty step. |
| T07 | docs | T06 | ⬜ | |

**Review queue:** empty

## Blocked on the user

Nothing.
