# Progress

**Update this whenever a task changes state.** It is the handoff between sessions. What the build taught
lives in [FINDINGS.md](FINDINGS.md). Sixty words to a Notes cell, counted.

**Plan reviewed:** 2026-09-29 — 9 fixed, 3 decided with the user

**Status:** Planned, not started.
**Last updated:** 2026-09-29
**Next `pir-work` will:** T01 base-core, the first task with no dependencies on the critical path.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | base-core | — | ✅ | |
| T02 | base-git | T01 | ✅ | |
| T03 | branch-cuts | — | ✅ | |
| T04 | base-text | — | ✅ | |
| T05 | plan-start | T01, T02, T03 | ✅ | |
| T06 | build-start | T01, T02, T03 | ✅ | |
| T07 | end-sync | T04, T06 | ✅ | |
| T08 | skills-and-rules | — | ✅ | |
| T09 | dev-base-drill | T05, T07 | 🔍 | Dev-only scenario (fixtures/dev-base.mjs, run-dev-base.test.mjs); rig options base, remoteAhead, settings, holdReportMs with 4 tests; real-fetch-check.mjs and 3 tests. Deviations: coordinate.mjs gains `PARALLEL_BASE_WATCH_MS`, a test lever; `mainCommit` renamed `baseCommit`; handedOffGreenBranch accepts the agent's ready footer; new facts cut-from-remote, handed-off-on-base, finished-on-remote-merge. |
| T10 | docs-and-readme | T08, T09 | ⬜ | |

**Review queue:** T09

## Blocked on the user

Nothing.
