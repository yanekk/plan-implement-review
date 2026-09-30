# Progress

**Update this whenever a task changes state.** It is the handoff between sessions. What the build taught
lives in [FINDINGS.md](FINDINGS.md). Sixty words to a Notes cell, counted.

**Plan reviewed:** 2026-09-30 — 10 fixed, 8 decided with the user

**Status:** Planned, not started.
**Last updated:** 2026-09-30
**Next `pir-work` will:** T01 usage-core, the first task with no dependencies on the critical path.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | usage-core | — | ✅ | |
| T02 | api-core | — | ✅ | |
| T03 | service-core | — | ✅ | |
| T04 | usage-report | T01, T02 | ⬜ | |
| T05 | api-service | T01, T02 | ⬜ | |
| T06 | service-ctl | T02, T03 | ✅ | Reviewed: one fix. `scratchItem` with the default label or `plistPath` registered the real item; reproduced with a fake launchctl, now refused, test locks it. Recorded deviations accepted; `off` prints the one line §2.7 gives. Probed: real `launchctl print` lines, `httpGet` on oversized and trickled bodies, three mutations. `npm test` green; real label absent after. |
| T07 | service-command | T06 | ⬜ | |
| T08 | usage-e2e | T04, T05 | ⬜ | |
| T09 | launchd-check | T05, T06 | ⬜ | |
| T10 | live-usage-check | T08 | ⬜ | |
| T11 | docs-and-readme | T07, T09, T10 | ⬜ | |

**Review queue:** *(empty)*

## Blocked on the user

Nothing. The real install and the log-out check come after the merge (PLAN § After the merge).
