# Progress

**Update this whenever a task changes state.** It is the handoff between sessions.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)** — read the rows touching the
task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The cell is an index for the next session; the
account is the commit message. Whoever writes a cell also fixes the over-budget cell they walk past.

**Build this plan in classic flow, one `/pir-work` at a time — not parallel mode** (DESIGN §2.7): it
rebuilds the parallel coordinator, so the coordinator must not drive it.

**The Task column is each task's slug** (DESIGN §2.9) — the same kebab name as its `tasks/T{nn}-*.md`
file and its worker's agent name.

**Plan reviewed:** 2026-09-19 — 1 fixed, 2 decided with the user (re-slot the shared-name-helper
removals so every task stays green + cover `capture.mjs`; `install.sh` applies the per-user `autoMode`
rule). Account in the `plan-review` commit.

**Status:** 2026-09-20: T14 reviewed ✅ (one fix: a stale "routed down" comment the implementer missed).
On a coordinator-side merge conflict the run composes a pure copy-paste resolution prompt
(`buildConflictPrompt`) and scrolls it once on the normal screen. Every code task is now ✅. What remains
is person-only: T09's by-eye display re-check and T13's attended merge-conflict run. 407 green.
**Last updated:** 2026-09-20
**Next `pir-work` will:** pick **T09** (⬜, lowest with deps ✅) — its one remaining half is the person's
by-eye display re-check, unblocked now T15 is ✅. T13 (⬜, attended merge-conflict run) is also ready,
deps T05/T10/T11/T14 all ✅. Both need the person at a real terminal; neither is a machine assertion.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and done ·
⛔ blocked, needs a human. **Runs:** `auto` a background worker builds it · `you` a person runs it.
This plan removes the `Runs` distinction (T04 done). The column stays in this table but is no longer
read — the parser tolerates and ignores it; T05 finishes the surrounding cleanup.

| # | Task | Runs | Depends on | State | Notes |
|---|---|---|---|---|---|
| T01 | stop-promoting | auto | — | ✅ | Reviewed clean. promote→complete rename faithful; `worktree.promote` gone; a ⛔ task blocks complete. Stray `r.promoted` reads → FINDINGS (T05). 384 green. |
| T02 | slugs-and-names | auto | — | ✅ | Reviewed clean. 5-field worker names round-trip incl slug; match by number+role. `/`-at-launch is a T09 live check. 387 green. |
| T03 | live-display | auto | T01, T02 | ✅ | Reviewed clean. Pure model + renderer faithful to the prototype; loop/display seam checked. In-place paint + a doubled hand-off line stay for T09 (FINDINGS). 401 green. |
| T04 | remove-you-auto | auto | T03 | ✅ | Reviewed clean. auto/you and the verify path gone from dispatch/loop/platform; parseProgress tolerates+ignores a Runs column. 398 green. |
| T05 | harness-and-restart | auto | T04 | ✅ | Reviewed clean. Foreground-process harness; `coordinatorName`/`verify` gone. Live crash/restart is T09. |
| T06 | worker-permissions | auto | — | ✅ | Reviewed clean. Ships worker `permissions.allow`; `install.sh` merges it into a target and the `autoMode` rule into `~/.claude/settings.json`. Merge pure in `core/settings.mjs`. `bgIsolation: none` does not travel to targets (FINDINGS). Live classifier proof T09. |
| T07 | skills | auto | T04 | ✅ | Reviewed clean. Dead skills deleted, survivors de-agented, slug-as-name templates; grep-confirmed no live refs; planner-templates.test parses the on-disk templates. 382 green. |
| T08 | docs | auto | T05, T07 | ✅ | Reviewed clean, no fix commit. Every /docs + CLAUDE.md claim checked against shipped code; forbidden vocab only as "now gone"; HALT-vs-Ctrl-C deviation logged. 382 green. |
| T09 | capstone | you | T06, T08, T10, T11, T15 | ⬜ | Partial. 2026-09-20 live (refreshed skills): word-proof PASS (worker names the person, no `coordinator`); PM answered parked T01 directly; Ctrl-C closed workers, scratch `main` untouched; re-run resumed from committed work; no classifier prompt (T06 live). Only the by-eye DISPLAY remained — streamed, not in place; T15 ✅ now fixes the cause. Close after the person re-checks the display clean. |
| T10 | harness-handoff-facts | auto | T05 | ✅ | Reviewed clean. `handedOffGreenBranch`: zero promotes, no merge to main, ≥1 `merge T{nn}`; regression FAILs on a promote line. 387 green. |
| T11 | harness-drill-wiring | auto | T05, T10 | ✅ | Reviewed clean, no fix commit. Confirmed `spawn`/`halt-close` are real loop.mjs flow tags and `flowHasTag` cannot false-positive on the surface `text` (never in the flow line). Drill touches HALT once on first `spawn`; `parked` scores a timed-out park PASS; no drill → no mid-run HALT. Restart runner default `completed`, unchanged. No down-channel. 392 green. |
| T12 | worker-knows-no-coordinator | auto | T07 | ✅ | Reviewed clean, no fix commit. Grep contract holds: only the `non-agentic-coordinator` example name in the three skill dirs; `openingInstruction` string has no `coordinator`. Swept worker files for residual relay language ("reports up to", "will reply") — only the negations remain. openingInstruction test still asserts skill+task+pir-worker. 392 green. Live word-proof is T09. |
| T15 | display-in-place-render | auto | T03 | ✅ | Reviewed clean. Bounded alt-screen region replaces the wrap-broken cursor-up math; `close()` leaves the alt screen on every exit incl SIGINT. By-eye repaint stays T09. 395 green. |
| T14 | conflict-resolve-prompt | auto | T05 | ✅ | Reviewed. Fixed one stale "routed down" comment the implementer missed (§2.2 down-channel gone) — acceptance crit 3 now met. Probed the reprint risk: a parked worker stays AWAITING, never re-enters `merge` (dispatch.mjs + buildAssignments), so the bulky prompt scrolls exactly once. Reconcile path (no worker) names the branch. 407 green. Live paint by-eye stays T13. |
| T13 | attended-merge-conflict | you | T05, T10, T11, T14 | ⬜ | Added 2026-09-20 (PM). Rework the stale `merge-conflict` fixture (drops the down-channel `scriptedAnswer` + the `answer`-line fact) into an attended run: coordinator parks the conflict and offers T14's prompt, the person copies it keeping `hello there` and pastes it, the worker resolves, the run completes. Independent of T09. |

A Notes cell holds what was built or what the review found, the test count, and one line per
deviation from the task doc. A ✅ task's cell may be cut to one line once the next task is reviewed.

**Review queue:** empty — every code task is ✅. What is left is person-only: T09's by-eye display
re-check and T13's attended merge-conflict run. Both need the person at a real terminal.

## Blocked on the user

T09's remaining half needs the person and cannot be a machine assertion (§5.1): one direct
`coordinate.mjs` run in a real terminal for the live display, finding and answering a parked worker in
`claude agents`, and hand Ctrl-C then re-run to see it resume (recipe in `tasks/T09-capstone.md`). Every
run spawns real paid workers only a person may watch (§5.2).

Sequence: build T11 first (it makes `parallel` and `human-decision` verifiable unattended), then the
person does the by-eye run and re-runs those two, and the session records the machine PASS reports and
the person's judgement in FINDINGS and marks T09 ✅. The four clean fixtures already PASS (2026-09-20,
FINDINGS).
