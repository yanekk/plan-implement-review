# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**. Read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose, no bold-per-clause, no aphorism. The
cell is an index for the next session; the account is the commit message. Whoever writes a
cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-28 — 8 fixed, 4 decided with the user (re-review after the redesign)

**Status:** Planned 2026-09-27, redesigned 2026-09-28 for the coordinator agent, re-reviewed 2026-09-28.
Nothing built.
**Last updated:** 2026-09-28
**Next `pir-work` will:** implement T01 (T01–T05 have no dependency).

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | alert-core | — | ✅ | |
| T02 | ntfy-sender | — | ✅ | |
| T03 | notify-icon | — | ✅ | |
| T04 | worker-link-and-silence | — | ✅ | |
| T05 | why-yours | — | ✅ | |
| T06 | notify-command | T02 | ⬜ | |
| T07 | coordinator-alerts | T01, T02, T04, T05 | 🔍 | notifyViews, runNotifyActions, notifyPass, endAlertPass wired into main; exit clears on every path; workerEnv to workers and agent; two notes. 18 tests in notify-wiring.test.mjs, 4 end-alert, 2 note. Deviations: notifyPass takes `plan`; runner takes `track`, no `now`; handoffView adds `unresolved` only when true; views skip non-waiting workers. |
| T08 | notify-live | T03, T06, T07 | ⬜ | |
| T09 | docs | T08 | ⬜ | |

**Review queue:** T07

## Blocked on the user

Nothing yet. T08 needs the user's iPhone with ntfy installed and a yes to push the feature branch
(DESIGN §5.3).
