# Progress

Update this whenever a task changes state. What the build taught lives in [FINDINGS.md](FINDINGS.md).
Sixty words to a Notes cell, counted; the account is the commit message.

**Plan reviewed:** 2026-09-29 — 6 fixed, 4 decided with the user

**Status:** Planned 2026-09-29. Nothing built.
**Last updated:** 2026-09-29
**Next `pir-work` will:** implement T05 (interrupt-gate-view); T01–T04 are ✅.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and done ·
⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | helper-fold | — | ✅ | |
| T02 | helper-rig-scenario | — | ✅ | |
| T03 | helper-lines | T01, T02 | ✅ | Review: one fix. Rig e2e read the step count as `N steps` and failed when A sat at `1 step`; reproduced by a full-suite run, regex now `steps?`, passed 5 reruns. Probed: reducers keep the helper name, nested helper hidden, line placement in either event order. Deviations accepted: `1 step`, `statusParts` export, `settleMs: 100`. |
| T04 | interrupt-gate | T01 | ✅ | |
| T05 | interrupt-gate-view | T02, T03, T04 | ⬜ | |
| T06 | helpers-drill | T03, T05 | ⬜ | |
| T07 | docs | T06 | ⬜ | |

**Review queue:** empty

## Blocked on the user

Nothing.
