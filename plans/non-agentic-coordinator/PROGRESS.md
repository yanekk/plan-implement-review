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

**Status:** 2026-09-21: T01–T17 all ✅ (T13's live attended run PASSed, verified on disk; FINDINGS ✅).
Then the PM added two Phase-5 tasks (see PLAN.md), so the plan is no longer complete: T18
(coordinator-launcher) ships a global `pir-coordinate` command via `install.sh` and removes the stale
orphan skills; T19 (docs-colour-and-launch) fills the two remaining `/docs` gaps — the display colours
(T16) and the new launch command. Both `auto`, T19 depends on T18. They extend this plan's install (T06)
and docs (T08) work and update `/docs`, not the sealed DESIGN; added post-review, so they skip
`/pir-review-plan` but each still gets a build→review pass. (T13's scratch dir `/tmp/mc-scratch` was torn
down 2026-09-21.)
**Last updated:** 2026-09-21
**Next `pir-work` will:** IMPLEMENT **T19** (⬜, docs gap-fill) — its dep T18 is now ✅ (code reviewed
clean). T18's one remaining half, the PM's dry `pir-coordinate` hand-check, is outstanding (Blocked on
the user); it does not gate T19's docs.

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
| T13 | attended-merge-conflict | you | T05, T10, T11, T14 | ✅ | Code reviewed clean. Live attended run PASS 2026-09-21 (bundle `2026-09-21T06-20-15-434Z`): T02 merged first, T01 parked, resolved on the live worker keeping `hello there`; feature branch handed off that side, main untouched, ceiling 2. Verified on disk. Coordinator reached `completed` not `crashed` — T17's live proof. FINDINGS ✅. |
| T17 | resilient-report-watch | auto | T05 | ✅ | Reviewed clean, no fix. Report-watch degrades to the 5s poll on an FSWatcher error; a crash scores `crashed` and is rejected as a terminal. Live EMFILE proof is T13's. 417 green. |
| T18 | coordinator-launcher | auto | — | ✅ | Reviewed clean, no fix. Reproduced out-of-band on a fake HOME: install removes the three orphans, writes the launcher executable with `__PIR_ENGINE__` substituted, prints the off-PATH fallback+export; the installed launcher drives a dry run and forwards `"$@"`. Tests bite (6). Real-PATH resolve after a real install is the PM's dry hand-check (Blocked). 423 green. |
| T19 | docs-colour-and-launch | auto | T18 | ⬜ | Added 2026-09-21 (PM). Fill the two `/docs` gaps: the live-display colours (T16) in run-lifecycle.md, and the `pir-coordinate` launch command (T18) in README/human-flow. Docs otherwise current (checked 2026-09-21) — targeted gap-fill, not a re-audit. T17 crash-scoring deliberately out of scope. |

A Notes cell holds what was built or what the review found, the test count, and one line per
deviation from the task doc. A ✅ task's cell may be cut to one line once the next task is reviewed.

**Review queue:** empty — T01–T18 all ✅. T19 (⬜, dep T18 ✅) is next to implement. T18's dry
hand-check is with the PM (Blocked on the user).

## Blocked on the user

T18: code reviewed clean and every mechanical part reproduced here, but the last half needs a real shell.
Run `install.sh` for your account, then from a set-up repo run `pir-coordinate {slug}` with `PARALLEL_LIVE`
unset (dry — no paid workers) and confirm the bare command resolves on your PATH and prints the coordinator
banner. Reversible: re-running `install.sh` from this repo restores anything. When seen, it goes in FINDINGS
with the date.

T16 is built and reviewed (✅). Remaining part is the PM's by-eye check that the colours read well:
`node run-t16-colour-check.mjs` (no paid workers). Focus on RUNNING and whether the amber-bold "asking you"
row jumps out; end-of-run colours are painted then wiped in a real run (FINDINGS 2026-09-20).

T13's live attended run is DONE — PASS 2026-09-21, verified on disk (FINDINGS ✅); scratch torn down.
