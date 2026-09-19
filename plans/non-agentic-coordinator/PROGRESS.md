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

**Status:** T09 live capstone in progress. Scratch world built and green at `../pir-scratch` (4 trivial
tasks, T03 parks asking). The live drive spawns real paid workers and only a person may watch it
(DESIGN §5.2), so it is handed to the person; the session holds for their judgement. Prerequisite
found: account `~/.claude/skills/` is pre-T07 stale — a live worker reads it, so it must be refreshed
before the drive (FINDINGS).
**Last updated:** 2026-09-19
**Next `pir-work` will:** nothing new until the person runs the live drive and reports back — then this
same track records the two confirmations (machine + person) and marks T09 ✅. See "Blocked on the user".

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
| T09 | capstone | you | T06, T08 | 🟡 | Scratch world built + green at `../pir-scratch` (4 trivial tasks; T03 parks asking a genuine choice). Drive spawns real paid workers, person-only (§5.2) — handed over, awaiting judgement. Prereq: refresh pre-T07 stale account skills first (FINDINGS). |

A Notes cell holds what was built or what the review found, the test count, and one line per
deviation from the task doc. A ✅ task's cell may be cut to one line once the next task is reviewed.

**Review queue:** empty. All implemented tasks reviewed; T09 is the remaining ⬜ (a `you` hand-verification).

## Blocked on the user

T09 is now waiting on the person. The scratch world is set up and green at `../pir-scratch`; the live
drive spawns real paid `claude` workers and only a person may watch it (DESIGN §5.2), so it cannot be
run from here. The person: (1) refreshes the account skills (`./install.sh`) so live workers read the
current contract, (2) runs the seatbelted drive (ceiling 1, then 4), (3) reports the four judgements.
The session then records the two confirmations and marks T09 ✅.
