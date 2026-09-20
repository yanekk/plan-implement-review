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

**Status:** T09 live capstone in progress, rewritten (PM decision) to reuse the existing harness + its
fixtures. First live run done (`single`, PM-authorized): the coordinator behaved CORRECTLY — real worker
spawned with the `/`-slug name (launch took the `/`), built T01, a fresh session reviewed clean,
idle-gated close, merged task→feature, `main` untouched, ended green for hand-off, clean teardown. But
the harness FAILED it on the stale `oneMergeToMain` fact, which still asserts the removed promotion
(§2.4). That stale fact is in single/review-queue/clean-merge (+merge-conflict) — T05's fixture rework
was incomplete. parallel/human-decision/restart don't check promotion and should pass. PM chose Option A:
fix the stale facts — added T10 (harness-handoff-facts) to convert `oneMergeToMain` to the §2.4 hand-off
model. T09 now depends on T10 and is back to ⬜ until T10 is ✅.
**Last updated:** 2026-09-20
**Next `pir-work` will:** IMPLEMENT T10 (harness-handoff-facts, ⬜, dep T05 ✅) — convert the stale
promotion assertion to the hand-off model. T09 resumes once T10 is reviewed ✅.

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
| T08 | docs | auto | T05, T07 | ✅ | Reviewed clean, no fix commit. Checked every /docs + CLAUDE.md claim against shipped code: named symbols/files exist, buildDisplay shape + row kinds, full log-tag set, clearTransientFeeds clears reports/ only, report kinds, 5-min timeout, ceiling 4, name format/roles, gpgsign per-call, decideResume table. Forbidden vocab appears only as "now gone". HALT-vs-Ctrl-C deviation logged; docs match code. 382 green. |
| T09 | capstone | you | T06, T08, T10 | ⬜ | Rewritten to reuse the harness + fixtures. Live `single` run (2026-09-20) proved the coordinator correct — main untouched, green branch handed off, fresh review, `/`-slug name — but the harness FAILED it on the stale `oneMergeToMain` fact. Now blocked on T10 (which converts that fact). Resume the fixture runs + the by-eye run once T10 is ✅. |
| T10 | harness-handoff-facts | auto | T05 | ⬜ | Convert the stale `oneMergeToMain` promotion assertion to the §2.4 hand-off model; update single/review-queue/clean-merge + assertions.test. Unblocks T09's fixtures. merge-conflict is a separate decision (FINDINGS). |

A Notes cell holds what was built or what the review found, the test count, and one line per
deviation from the task doc. A ✅ task's cell may be cut to one line once the next task is reviewed.

**Review queue:** empty. Next work is implementing T10 (⬜); T09 (⬜) waits on it, then on the person.

## Blocked on the user

T09 waits first on T10 (a code task — convert the stale harness promotion fact), then on the person.
Once T10 is ✅, T09 is verified by the existing harness (`node src/shell/harness/run.mjs <fixture>`)
over its fixtures — single, parallel, review-queue, clean-merge, human-decision, restart (NOT
merge-conflict, which is stale — FINDINGS) — plus one direct `coordinate.mjs` run in a real terminal
for the display + attach-answer + hand Ctrl-C the harness can't show (recipe in `tasks/T09-capstone.md`).
Every run spawns real paid workers that only a person may watch (§5.2). The person runs them and reports
the four judgements; the session then records the machine PASS reports and the person's judgement in
FINDINGS and marks T09 ✅.

The `single` live run already gave strong positive evidence (the coordinator is correct); T10 makes the
fixture reports green so that evidence is not masked by a stale assertion.
