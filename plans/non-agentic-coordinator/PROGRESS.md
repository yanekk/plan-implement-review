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

**Status:** T04 reviewed clean (`✅`). auto/you and the verify path are gone from the core and loop;
parseProgress tolerates a Runs column. 398 tests green. T05 (harness rework, kill-and-rebuild) is next.
The live in-place painting and the Ctrl-C/attach interaction remain for T09 to confirm by eye.
**Last updated:** 2026-09-19
**Next `pir-work` will:** implement T05 (`harness-and-restart`, `⬜`) — its dep T04 is now `✅`.

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
| T04 | remove-you-auto | auto | T03 | ✅ | Reviewed clean, no fix commit. auto/you and the verify path gone from progress/dispatch/parallelism/loop/platform; parseProgress tolerates a Runs column, ignoring even a `you` value end to end (spawns implement, still reviewed, never verify). openingInstruction throws on verify. Folded coordinate/fixtures/planner-templates fixes and the idle/merge-gate rework checked. 398 green. |
| T05 | harness-and-restart | auto | T04 | ⬜ | Rework harness to the new model; prove kill-and-rebuild. Also deletes the `verify` role and `coordinatorName` from naming and fixes `capture.mjs` (re-slotted from T02). |
| T06 | worker-permissions | auto | — | ⬜ | Ship worker `permissions.allow`; `install.sh` also applies the per-user `autoMode` rule, with the manual step as a printed fallback. |
| T07 | skills | auto | T04 | ⬜ | Delete dead skills; de-agent worker skills; slug-as-name templates. |
| T08 | docs | auto | T05, T07 | ⬜ | Rewrite /docs and the CLAUDE.md carve-out. |
| T09 | capstone | you | T06, T08 | ⬜ | Live end-to-end hand-verification with the person. |

A Notes cell holds what was built or what the review found, the test count, and one line per
deviation from the task doc. A ✅ task's cell may be cut to one line once the next task is reviewed.

**Review queue:** empty — T04 reviewed. Next is implementing T05 (`harness-and-restart`).

## Blocked on the user

Nothing blocked. T09 needs the person's hands (a live drill) but only after T06 and T08 are done; it
is not blocked yet.
