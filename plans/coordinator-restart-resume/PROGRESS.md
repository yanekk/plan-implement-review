# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)** — read the rows touching the
task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The cell is an index for the next session; the
account is the commit message. Whoever writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-17 — 2 fixed, 2 decided with the user

**Status:** Building. T01–T03 reviewed and done. T04 implemented, awaiting review.
**Last updated:** 2026-09-17
**Next `pir-work` will:** review T04 (transient-feed clearing and the HALT refusal at startup).

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and done ·
⛔ blocked, needs a human. **Runs:** `auto` a background worker builds it · `you` a person runs it.

| # | Task | Runs | Depends on | State | Notes |
|---|---|---|---|---|---|
| T01 | `decideResume` pure classifier | auto | — | ✅ | Clean. Four-way classifier, 13 tests, boundary green. |
| T02 | Read a task branch's committed state | auto | — | ✅ | Clean. Committed-glyph read by ref, null on absence, 9 tests. |
| T03 | Reconciliation pass in `runPass` | auto | T01, T02 | ✅ | Fixed one defect: a restart re-dispatched a conflicted ✅ branch, clobbering reviewed work (§2.6 violated); now flags it ⛔ and leaves it for a person (user decision). Reproduced against scratch git before fixing; test locks it over 6 passes. Happy paths (merge/review/rebuild/cleanup/reap/summary/first-start/mutation-guard) sound. Accepted deviation: a branch whose worktree is gone is skipped (abnormal). 353 green. |
| T04 | Clear transient control feeds; HALT/log policy | auto | — | 🔍 | `clearTransientFeeds` + `startupControlHygiene` (both exported), wired into the live bin after `fileControl`. Refuses a HALTed run naming the flag, never auto-clears it; truncates answers/outbox/surfaced, empties reports/, appends `restart` to log. 6 tests. Deviation: refusal fires on the LIVE path only (dry run makes no control). |
| T05 | Update `/docs` to the corrected behaviour | auto | T03, T04 | ⬜ | |
| T06 | Harness restart mode + fixture + facts | auto | T03, T04 | ⬜ | |
| T07 | Live restart drill, judged by a person | you | T06 | ⬜ | |

A Notes cell holds what was built or what the review found, the test count, and one line per deviation
from the task doc. A ✅ task's cell may be cut to one line once the next task has been reviewed.

**Review queue:** T04

## Blocked on the user

*(Nothing yet. T07 is the one task that needs a person — a live restart drill over real agents — and
it is the last task; it will land here when it is reached.)*
</content>
