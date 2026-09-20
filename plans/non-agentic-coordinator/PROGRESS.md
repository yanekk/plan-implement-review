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

**Status:** 2026-09-20 (PM watching): all six harness fixtures PASS over real workers. T12 reviewed
clean — the worker's world no longer names a coordinator (grep contract holds, 392 green); the live
re-proof that a parked worker's own words name the person rides on T09. Only T09, the person's
hands-on capstone, is left.
**Last updated:** 2026-09-20
**Next `pir-work` will:** dispatch **T09** (⬜, capstone) — the last task and the only one open. It is
the person's hands-on run (§5.1): one direct `coordinate.mjs` run for the by-eye display, attach-and-
answer a parked worker, Ctrl-C then re-run, plus a re-run of `human-decision` to prove the worker's own
words name the person — all recorded in FINDINGS. Needs the person (see Blocked on the user).

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
| T09 | capstone | you | T06, T08, T10, T11, T15 | ⬜ | Partial. 2026-09-20 live (refreshed skills): word-proof PASS (worker names the person, no `coordinator`); PM answered parked T01 directly; Ctrl-C closed workers, scratch `main` untouched; re-run resumed from committed work; no classifier prompt (T06 live). Only the by-eye DISPLAY fails — streams, not in place — blocked on T15. Close after T15 lands and the display re-checks clean. |
| T10 | harness-handoff-facts | auto | T05 | ✅ | Reviewed clean. `handedOffGreenBranch`: zero promotes, no merge to main, ≥1 `merge T{nn}`; regression FAILs on a promote line. 387 green. |
| T11 | harness-drill-wiring | auto | T05, T10 | ✅ | Reviewed clean, no fix commit. Confirmed `spawn`/`halt-close` are real loop.mjs flow tags and `flowHasTag` cannot false-positive on the surface `text` (never in the flow line). Drill touches HALT once on first `spawn`; `parked` scores a timed-out park PASS; no drill → no mid-run HALT. Restart runner default `completed`, unchanged. No down-channel. 392 green. |
| T12 | worker-knows-no-coordinator | auto | T07 | ✅ | Reviewed clean, no fix commit. Grep contract holds: only the `non-agentic-coordinator` example name in the three skill dirs; `openingInstruction` string has no `coordinator`. Swept worker files for residual relay language ("reports up to", "will reply") — only the negations remain. openingInstruction test still asserts skill+task+pir-worker. 392 green. Live word-proof is T09. |
| T15 | display-in-place-render | auto | T03 | ⬜ | Added 2026-09-20 (PM by-eye finding). Live display streams instead of repainting in place: `render.mjs:119` moves up `lines.length` but wrapped lines (the summary line wraps) span more rows. Rewrite the renderer to own a bounded region (alt-screen, per-frame clear, clip to terminal size), compact parked row, fake-stream tests. No TUI dep. Blocks T09's display item. |
| T14 | conflict-resolve-prompt | auto | T05 | ⬜ | Added 2026-09-20 (PM). On a coordinator merge conflict, compose a copy-paste resolution prompt for the parked worker (branch to merge in, conflicting files, commit/test/re-signal done; keep-which-side left blank for the person). Pure `buildConflictPrompt`, shown on the conflicted row. Sends nothing to the worker (§2.2). Fixes stale loop.mjs `answer()` comments; updates DESIGN §2.8 + human-flow. |
| T13 | attended-merge-conflict | you | T05, T10, T11, T14 | ⬜ | Added 2026-09-20 (PM). Rework the stale `merge-conflict` fixture (drops the down-channel `scriptedAnswer` + the `answer`-line fact) into an attended run: coordinator parks the conflict and offers T14's prompt, the person copies it keeping `hello there` and pastes it, the worker resolves, the run completes. Independent of T09. |

A Notes cell holds what was built or what the review found, the test count, and one line per
deviation from the task doc. A ✅ task's cell may be cut to one line once the next task is reviewed.

**Review queue:** empty. T09 is open but its remaining item (the by-eye display) is blocked on T15, so
the next buildable code task is **T15** (⬜, fix the in-place display), then T14 (⬜, coordinator
copy-paste conflict prompt) and T13 (⬜, attended merge-conflict rework, depends on T14). T09 closes
after T15 lands and the person re-checks the display.

## Blocked on the user

T09's remaining half needs the person and cannot be a machine assertion (§5.1): one direct
`coordinate.mjs` run in a real terminal for the live display, finding and answering a parked worker in
`claude agents`, and hand Ctrl-C then re-run to see it resume (recipe in `tasks/T09-capstone.md`). Every
run spawns real paid workers only a person may watch (§5.2).

Sequence: build T11 first (it makes `parallel` and `human-decision` verifiable unattended), then the
person does the by-eye run and re-runs those two, and the session records the machine PASS reports and
the person's judgement in FINDINGS and marks T09 ✅. The four clean fixtures already PASS (2026-09-20,
FINDINGS).
