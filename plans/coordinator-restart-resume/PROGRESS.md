# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)** — read the rows touching the
task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The cell is an index for the next session; the
account is the commit message. Whoever writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-17 — 2 fixed, 2 decided with the user

**Status:** Plan reviewed, ready to build. No product code exists yet. The fix reconciles each task
from its own task branch on restart (merge `✅`, review `🔍`, rebuild half-built), first reaping the
dead run's leftover sessions, then narrating the resume, and clears the stale transient control feeds.
**Last updated:** 2026-09-17
**Next `pir-work` will:** implement T01 (the pure classifier) or T02 (the git read); both are ready
and independent.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and done ·
⛔ blocked, needs a human. **Runs:** `auto` a background worker builds it · `you` a person runs it.

| # | Task | Runs | Depends on | State | Notes |
|---|---|---|---|---|---|
| T01 | `decideResume` pure classifier | auto | — | ⬜ | |
| T02 | Read a task branch's committed state | auto | — | ⬜ | |
| T03 | Reconciliation pass in `runPass` | auto | T01, T02 | ⬜ | |
| T04 | Clear transient control feeds; HALT/log policy | auto | — | ⬜ | |
| T05 | Update `/docs` to the corrected behaviour | auto | T03, T04 | ⬜ | |
| T06 | Harness restart mode + fixture + facts | auto | T03, T04 | ⬜ | |
| T07 | Live restart drill, judged by a person | you | T06 | ⬜ | |

A Notes cell holds what was built or what the review found, the test count, and one line per deviation
from the task doc. A ✅ task's cell may be cut to one line once the next task has been reviewed.

**Review queue:** *(empty)*

## Blocked on the user

*(Nothing yet. T07 is the one task that needs a person — a live restart drill over real agents — and
it is the last task; it will land here when it is reached.)*
</content>
