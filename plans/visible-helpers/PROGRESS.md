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
| T03 | helper-lines | T01, T02 | ✅ | |
| T04 | interrupt-gate | T01 | ✅ | |
| T05 | interrupt-gate-view | T02, T03, T04 | 🔍 | Esc/Ctrl+C gate and warning in the view; note carried drop→inbox→platform→worker, drawn as `pir ▸`. 14 tests plus rig e2e at 80×24, 120×40. Deviations: plan-run.mjs unchanged, it already passed opts; the warning replaces the status line, and sits below a pinned prompt; withAgent test lives in person-inbox.test. |
| T06 | helpers-drill | T03, T05 | ⬜ | |
| T07 | docs | T06 | ⬜ | |

**Review queue:** T05

## Blocked on the user

Nothing.
