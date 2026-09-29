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
| T01 | base-core | — | ⬜ | |
| T02 | base-git | T01 | ⬜ | |
| T03 | branch-cuts | — | ⬜ | |
| T04 | base-text | — | ⬜ | |
| T05 | plan-start | T01, T02, T03 | ⬜ | |
| T06 | build-start | T01, T02, T03 | ⬜ | |
| T07 | end-sync | T04, T06 | ⬜ | |
| T08 | skills-and-rules | — | ✅ | Review: one fix. Slug check read `ls-tree` on an unset `pirBase` as a free slug (exit 128, empty stdout, reproduced in worktree); now requires exit 0. Hand-off deviation matches DESIGN §2.9, accepted. Probed: recursive grep of skills, CLAUDE.md install copy, `.pir/settings.json` owned by T02. |
| T09 | dev-base-drill | T05, T07 | ⬜ | |
| T10 | docs-and-readme | T08, T09 | ⬜ | |

**Review queue:** empty

## Blocked on the user

Nothing.
