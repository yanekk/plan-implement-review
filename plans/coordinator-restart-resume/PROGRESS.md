# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)** — read the rows touching the
task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The cell is an index for the next session; the
account is the commit message. Whoever writes a cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-17 — 2 fixed, 2 decided with the user

**Status:** Building. T01–T04 done, T05 implemented and awaiting review. Next is T05 review.
**Last updated:** 2026-09-17
**Next `pir-work` will:** review T05 — the `/docs` rewrite for the corrected restart/reconcile behaviour.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and done ·
⛔ blocked, needs a human. **Runs:** `auto` a background worker builds it · `you` a person runs it.

| # | Task | Runs | Depends on | State | Notes |
|---|---|---|---|---|---|
| T01 | `decideResume` pure classifier | auto | — | ✅ | Clean. Four-way classifier, 13 tests, boundary green. |
| T02 | Read a task branch's committed state | auto | — | ✅ | Clean. Committed-glyph read by ref, null on absence, 9 tests. |
| T03 | Reconciliation pass in `runPass` | auto | T01, T02 | ✅ | Fixed one defect: a restart re-dispatched a conflicted ✅ branch; now flagged ⛔ for a person (§2.6, FINDINGS 🐞). 353 green. |
| T04 | Clear transient control feeds; HALT/log policy | auto | — | ✅ | Clean, no fix. Verified the feed names (reports/answers/outbox/surfaced) match the live bridge's paths exactly — the silent-no-op trap — and hygiene runs before the bridge writes. Probed orphaned-worker races, torn stale lines, non-.json leftovers, dropped un-relayed surface: all safe per §2.7. LIVE-only deviation accepted — a dry preview spawns nothing. 359 green. |
| T05 | Update `/docs` to the corrected behaviour | auto | T03, T04 | 🔍 | Rewrote restart-recovery.md (reconciliation: reap, glyph read, merge/review/rebuild/skip table, conflict→⛔, narration, control hygiene), corrected control-folder.md (startup clear, `restart`/`restart-summary` log tags, HALT refusal), added a reconcile line to run-lifecycle Start. Traced every claim to T03/T04 code, not DESIGN §2.6's superseded "branch untouched" — used the shipped conflict→⛔ fix. Noted a dry preview skips hygiene. Docs only, 359 green. |
| T06 | Harness restart mode + fixture + facts | auto | T03, T04 | ⬜ | |
| T07 | Live restart drill, judged by a person | you | T06 | ⬜ | |

A Notes cell holds what was built or what the review found, the test count, and one line per deviation
from the task doc. A ✅ task's cell may be cut to one line once the next task has been reviewed.

**Review queue:** T05 — the `/docs` rewrite (restart-recovery.md, control-folder.md, run-lifecycle.md)

## Blocked on the user

*(Nothing yet. T07 is the one task that needs a person — a live restart drill over real agents — and
it is the last task; it will land here when it is reached.)*
</content>
