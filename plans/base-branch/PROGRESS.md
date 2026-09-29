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
| T05 | plan-start | T01, T02, T03 | ⬜ | |
| T06 | build-start | T01, T02, T03 | ✅ | |
| T07 | end-sync | T04, T06 | 🔍 | End sync prepares the base, holds with retry, 5-min watch, hold alert; 14 tests incl. 80×24 drill. Deviations: `worktree.prepareBase(base, opts)` on both worktrees; a move is judged by the local tip at last sync (`localSeen`), not the merged sha, else a behind local re-syncs forever; hold alert title `{slug} · waiting`, message the reason. |
| T08 | skills-and-rules | — | ✅ | |
| T09 | dev-base-drill | T05, T07 | ⬜ | |
| T10 | docs-and-readme | T08, T09 | ⬜ | |

**Review queue:** T07

## Blocked on the user

Nothing.
