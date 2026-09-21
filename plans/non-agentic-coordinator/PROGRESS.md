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

**Status:** 2026-09-21: T13 code reviewed — clean, no fix commit. The attended-model rework of the
`merge-conflict` fixture and `mergeConflictResolved` holds: the promote-guard, losing-side and respawn
tests all bite (mutation-checked live), `handedOffGreenBranch` composes correctly, `promotionMergeLines`
is case-sensitive so task-branch merges never false-positive as a promotion, and the no-surface-kind
deviation matches loop.mjs. 410 green. T13 now ⛔ — its only remaining half is the PM's live attended
run (§5.2, real paid workers a person must watch), handed over below. Every buildable task is now done.
Also 2026-09-21: driving T13's live run crashed the coordinator (EMFILE in the report-watcher, unhandled
`fs.watch` error → whole run dies ~2.4s in, before any conflict). PM chose to fix it first, so T17
(resilient-report-watch, ⬜) was added: make `waitForReport` fall back to its 5s poll on a watch error,
and make the harness call a crash a crash not `completed`. T13's live run is blocked on T17 (a crashed
coordinator never parks a conflict). FINDINGS 2026-09-21.
**Last updated:** 2026-09-21
**Next `pir-work` will:** IMPLEMENT **T17** (⬜, deps T05 ✅) — the only ⬜, no 🔍/🟡. Make the coordinator
survive a report-watch error and the harness report a crash honestly. Then a fresh session reviews it,
then the PM re-runs T13's live check.

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
| T09 | capstone | you | T06, T08, T10, T11, T15 | ✅ | All six fixtures PASS live; five by-eye items confirmed 2026-09-20 (word-proof, attach-answer, Ctrl-C + main untouched, re-run resume, no classifier prompt). Last item: PM confirmed 2026-09-20 the display repaints in place after T15. PM wants colour + question visibility → new task T16. |
| T10 | harness-handoff-facts | auto | T05 | ✅ | Reviewed clean. `handedOffGreenBranch`: zero promotes, no merge to main, ≥1 `merge T{nn}`; regression FAILs on a promote line. 387 green. |
| T11 | harness-drill-wiring | auto | T05, T10 | ✅ | Reviewed clean, no fix commit. Confirmed `spawn`/`halt-close` are real loop.mjs flow tags and `flowHasTag` cannot false-positive on the surface `text` (never in the flow line). Drill touches HALT once on first `spawn`; `parked` scores a timed-out park PASS; no drill → no mid-run HALT. Restart runner default `completed`, unchanged. No down-channel. 392 green. |
| T12 | worker-knows-no-coordinator | auto | T07 | ✅ | Reviewed clean, no fix commit. Grep contract holds: only the `non-agentic-coordinator` example name in the three skill dirs; `openingInstruction` string has no `coordinator`. Swept worker files for residual relay language ("reports up to", "will reply") — only the negations remain. openingInstruction test still asserts skill+task+pir-worker. 392 green. Live word-proof is T09. |
| T15 | display-in-place-render | auto | T03 | ✅ | Reviewed clean. Bounded alt-screen region replaces the wrap-broken cursor-up math; `close()` leaves the alt screen on every exit incl SIGINT. By-eye repaint stays T09. 395 green. |
| T14 | conflict-resolve-prompt | auto | T05 | ✅ | Reviewed. Fixed a stale "routed down" comment (§2.2); probed reprint risk — a parked worker stays AWAITING, never re-enters `merge`, so the prompt scrolls once. Live paint by-eye stays T13. 407 green. |
| T16 | display-colour-and-question | auto | T15 | ✅ | Reviewed clean, no fix. Colour is a TTY+NO_COLOR-gated paint layer; formatLines escape-free; T15 clip/height held; tests bite (17). Live end-state colours wiped by close(); by-eye focus is RUNNING (FINDINGS). 409 green. |
| T13 | attended-merge-conflict | you | T05, T10, T11, T14 | ⛔ | Code reviewed clean, no fix. Probed by mutation: the promote-guard, losing-side and respawn tests all bite; `handedOffGreenBranch` composition and case-sensitive `promotionMergeLines` hold; no-surface-kind deviation matches loop.mjs. 410 green. Live run blocked on T17 (coordinator crashed on a watch error before reaching the conflict, 2026-09-21) then the PM (§5.2). |
| T17 | resilient-report-watch | auto | T05 | ⬜ | Added 2026-09-21. `waitForReport` must survive an `fs.watch` `error` event (EMFILE from fd pressure) by falling back to its 5s poll, not crashing the run; and run.mjs `runOutcome` must report a crash exit as `crashed`, not `completed`. Two shell edits + tests. Blocks T13's live run. |

A Notes cell holds what was built or what the review found, the test count, and one line per
deviation from the task doc. A ✅ task's cell may be cut to one line once the next task is reviewed.

**Review queue:** empty — no 🔍 task. Next work is to IMPLEMENT T17 (the coordinator-crash fix that
blocks T13's live run). T13's own code review passed clean; its remaining live attended run is the PM's
hand-verification (below), now gated on T17 landing first.

## Blocked on the user

T16 is built and reviewed (✅). Its only remaining part is the PM's by-eye check that the colours read well
on a real terminal — handed over: `node run-t16-colour-check.mjs` (no paid workers). Focus on the RUNNING
state and whether the amber-bold "asking you" row jumps out; the end-of-run colours are painted then wiped
in a real run, so judge them here only as colours (FINDINGS 2026-09-20).

T13's code is reworked, green, and reviewed clean (⛔). Its live attended run is now gated on **T17**:
on 2026-09-21 the run crashed the coordinator (EMFILE in the report-watcher) ~2.4s in, before any
conflict, so it never reached the parked prompt. Once T17 lands and is reviewed, run it in a real
terminal from a scratch dir — ideally with other Claude sessions closed, to keep fd pressure down
(§5.2). It cannot be a machine assertion (§5.1, §5.2 — real paid workers only a person may watch):

  PARALLEL_ALLOW_HERE is NOT needed; run from anywhere but this repo, or pass --into a scratch dir:
  node src/shell/harness/run.mjs merge-conflict --into /tmp/mc-scratch

Expect: two workers edit the same line of greeting.txt; the second conflicts at the coordinator's merge;
the coordinator parks that worker and shows a copy-paste resolution prompt (T14). Copy it, keep the
`hello there` side, attach to that worker in `claude agents` and paste it; the worker resolves and
re-signals done; the run ends `completed` with an all-green report and a bundle path. The fixture's
`needsPerson` block names these steps. On success: record a ✅ FINDINGS row with the date and the bundle
path, and tear down the scratch dir. A 25-min wall-clock auto-HALTs a hung run (§5.2).
