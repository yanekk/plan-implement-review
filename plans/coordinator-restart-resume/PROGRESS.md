# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)** — read the rows touching the
task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The cell is an index for the next session; the
account is the commit message. Whoever writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-17 — 2 fixed, 2 decided with the user

**Status:** T01–T06 done. T07's live restart drill was RUN and FAILED — the simulated crash did not kill
the real coordinator, so no genuine crash→resume happened. Blocked on a fix decision.
**Last updated:** 2026-09-18
**Next `pir-work` will:** stop on T07 — it is blocked. The live drill exposed a real defect in T06's crash
mechanism (SIGKILL misses the working `claude --bg` process). Needs the user to decide the fix.

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
| T07 | Live restart drill, judged by a person | you | T06 | ⛔ | Drill RAN live 2026-09-18, FAILED 4/5 facts. SIGKILL missed the real coordinator (alive ~1min past crash); 2nd coordinator ran concurrently — no true crash→resume. One `restart` marker, stale `outbox`/`surfaced`. Defect is in T06's crash mechanism. Blocked on fix decision. |

A Notes cell holds what was built or what the review found, the test count, and one line per deviation
from the task doc. A ✅ task's cell may be cut to one line once the next task has been reviewed.

**Review queue:** empty. All `auto` tasks are ✅. T07 is the live drill, a `you` task with no review step.

## Blocked on the user

**T07 — live restart drill RAN and FAILED (2026-09-18).** Driven live over real paid agents at the
user's direction (`node src/shell/harness/run.mjs restart --into <scratch>`); teardown clean, no orphaned
agents. Fact report FAILED 4/5. Root cause: the `SIGKILL` of the pid from `claude agents --json` did not
kill the working coordinator (it lived ~1 min past the crash point), and the relaunch ran a second
coordinator concurrently — so no real crash→resume was exercised. `resumedNotRebuilt`, `noRebuildFromT01`,
`feedsCleared`, `leftoverSessionsReaped` all red on "fewer than two `restart` markers"; only
`one-merge-to-main` passed. **Blocked on the user:** decide the fix (it lives in T06's crash mechanism —
kill the real process, not the reported pid — or in how the drill detects/forces the crash). Not a T07
edit; T07 is the drill, and it cannot pass until the crash is real.
</content>
