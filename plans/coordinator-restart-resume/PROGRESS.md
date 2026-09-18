# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)** — read the rows touching the
task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The cell is an index for the next session; the
account is the commit message. Whoever writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-17 — 2 fixed, 2 decided with the user

**Status:** Building. T01–T05 done. T06 implemented, awaiting review. T07 is the live drill (a person).
**Last updated:** 2026-09-18
**Next `pir-work` will:** review T06 — the harness restart mode, its fixture, and the restart facts.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and done ·
⛔ blocked, needs a human. **Runs:** `auto` a background worker builds it · `you` a person runs it.

| # | Task | Runs | Depends on | State | Notes |
|---|---|---|---|---|---|
| T01 | `decideResume` pure classifier | auto | — | ✅ | Clean. Four-way classifier, 13 tests, boundary green. |
| T02 | Read a task branch's committed state | auto | — | ✅ | Clean. Committed-glyph read by ref, null on absence, 9 tests. |
| T03 | Reconciliation pass in `runPass` | auto | T01, T02 | ✅ | Fixed one defect: a restart re-dispatched a conflicted ✅ branch; now flagged ⛔ for a person (§2.6, FINDINGS 🐞). 353 green. |
| T04 | Clear transient control feeds; HALT/log policy | auto | — | ✅ | Clean. Feed names (reports/answers/outbox/surfaced) match the live bridge; hygiene runs before the bridge writes; HALT refusal + clear are LIVE-only. 359 green. |
| T05 | Update `/docs` to the corrected behaviour | auto | T03, T04 | ✅ | Clean, no fix. Traced every claim to shipped code: reconcile in loop.mjs, decideResume, startupControlHygiene, taskBranchState's exact `git show pir/{slug}-T{nn}:…PROGRESS.md`. Conflict→⛔-and-branch-kept, session-only reap, restart/restart-summary log tags, HALT refusal all match. Docs predict the code. 359 green, docs-only diff. |
| T06 | Harness restart mode + fixture + facts | auto | T03, T04 | 🔍 | runRestartScenario: install-once, launch, wait-🔍, SIGKILL coord only, seed stale feeds, relaunch (no reinstall), resume. New `restart` fixture (T01 ✅+merged, T02 🔍 at kill) + facts resumedNotRebuilt/noRebuildFrom/feedsCleared/leftoverSessionsReaped. 386 green. Deviations in commit: separate fn not a runScenario mode; seeded-sentinel feedsCleared; EXPECT updated. |
| T07 | Live restart drill, judged by a person | you | T06 | ⬜ | |

A Notes cell holds what was built or what the review found, the test count, and one line per deviation
from the task doc. A ✅ task's cell may be cut to one line once the next task has been reviewed.

**Review queue:** T06 — implemented, awaiting a fresh-eyes review.

## Blocked on the user

*(Nothing yet. T07 is the one task that needs a person — a live restart drill over real agents — and
it is the last task; it will land here when it is reached.)*
</content>
