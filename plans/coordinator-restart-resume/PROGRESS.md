# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)** — read the rows touching the
task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The cell is an index for the next session; the
account is the commit message. Whoever writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-17 — 2 fixed, 2 decided with the user

**Status:** COMPLETE. T01–T06 done. T07 (live restart drill) closed by PM decision 2026-09-18 as
shipped-unproven: a live crash of a running coordinator is infeasible on this platform (bg sessions rotate
pool members per turn), so the resume is verified only by the fast reconcile tests, not over live agents.
**Last updated:** 2026-09-18
**Next `pir-work` will:** find nothing to do — the plan is complete. T07 is closed unproven by PM decision;
every other task is ✅.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and done ·
⛔ blocked, needs a human. **Runs:** `auto` a background worker builds it · `you` a person runs it.

| # | Task | Runs | Depends on | State | Notes |
|---|---|---|---|---|---|
| T01 | `decideResume` pure classifier | auto | — | ✅ | Clean. Four-way classifier, 13 tests, boundary green. |
| T02 | Read a task branch's committed state | auto | — | ✅ | Clean. Committed-glyph read by ref, null on absence, 9 tests. |
| T03 | Reconciliation pass in `runPass` | auto | T01, T02 | ✅ | Fixed one defect: a restart re-dispatched a conflicted ✅ branch; now flagged ⛔ for a person (§2.6, FINDINGS 🐞). 353 green. |
| T04 | Clear transient control feeds; HALT/log policy | auto | — | ✅ | Clean. Feed names (reports/answers/outbox/surfaced) match the live bridge; hygiene runs before the bridge writes; HALT refusal + clear are LIVE-only. 359 green. |
| T05 | Update `/docs` to the corrected behaviour | auto | T03, T04 | ✅ | Clean, no fix. Docs-only diff; every claim traced to shipped code (reconcile, decideResume, startupControlHygiene, taskBranchState). 359 green. |
| T06 | Harness restart mode + fixture + facts | auto | T03, T04 | ✅ | Clean, no fix. Checked install-once, SIGKILL-coord-only at 🔍, no-reinstall relaunch, two-launch bundle; all 4 facts non-vacuous (pass/fail/never-restarted). Probed the live-drill hinge: capture keeps agent `pid` so the SIGKILL fires; flow fallback catches the 🔍→merged race; boundary is the 2nd restart marker. slotsInTick refactor behaviour-preserving. 386 green. |
| T07 | Live restart drill, judged by a person | you | T06 | ✅ | CLOSED BY PM DECISION 2026-09-18: shipped, live resume UNPROVEN. Ran live twice, FAILED both — a live crash is infeasible (bg sessions rotate pool members per turn, no stable process to SIGKILL). Resume covered only by the fast reconcile tests, never seen over real agents. See FINDINGS. |

A Notes cell holds what was built or what the review found, the test count, and one line per deviation
from the task doc. A ✅ task's cell may be cut to one line once the next task has been reviewed.

**Review queue:** empty. All tasks are ✅. T07 needed no review (a `you` task) and is closed unproven.

## Blocked on the user

Nothing blocked. T07 was closed by PM decision on 2026-09-18: shipped with the live resume UNPROVEN,
because a live crash of a running coordinator is infeasible on this platform (bg sessions rotate pool
members per turn — no stable process to SIGKILL). The full account is in the T07 row, FINDINGS, and the
commit log; the pty-host-kill attempt was reverted. The plan is complete.
</content>
