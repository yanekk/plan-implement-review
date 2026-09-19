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

**Status:** Reviewed, not started. Base is clean at the last commit (abandoned `coordinator-trust`
debris swept into a labeled `git stash`, 2026-09-19) and green. The live display shape was confirmed
with the person against `prototype/cli-display.html`.
**Last updated:** 2026-09-19
**Next `pir-work` will:** review T01 (`stop-promoting`, now `🔍`), by a session that did not build it.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and done ·
⛔ blocked, needs a human. **Runs:** `auto` a background worker builds it · `you` a person runs it.
This plan removes the `Runs` distinction (T04); the column stays here because the current machinery
still reads it while the plan is being built.

| # | Task | Runs | Depends on | State | Notes |
|---|---|---|---|---|---|
| T01 | stop-promoting | auto | — | 🔍 | Replaced `promoteToMain` with `complete`; loop runs feature-branch tests on complete, carries `readyToMerge`/`testsPassed`; removed the promote step and `worktree.promote()` (fake keeps its unused one). Added pure `renderHandoff` + live `runFeatureTests`; `main()` prints the `git merge` hand-off or red failure. 384 green. Deviation: added `runFeatureTests` to run real tests on the live bin (DESIGN §2.4); the live hand-off itself is not test-covered (T09). |
| T02 | slugs-and-names | auto | — | ⬜ | `/` separator, worker name gains a slug field. Additive and backward-tolerant; keeps `coordinatorName` and the `verify` role, which T05 removes. |
| T03 | live-display | auto | T01, T02 | ⬜ | Strip the agent bridge; the docker-compose-style live display. |
| T04 | remove-you-auto | auto | T03 | ⬜ | Remove the auto/you distinction and the verify path (code). |
| T05 | harness-and-restart | auto | T04 | ⬜ | Rework harness to the new model; prove kill-and-rebuild. Also deletes the `verify` role and `coordinatorName` from naming and fixes `capture.mjs` (re-slotted from T02). |
| T06 | worker-permissions | auto | — | ⬜ | Ship worker `permissions.allow`; `install.sh` also applies the per-user `autoMode` rule, with the manual step as a printed fallback. |
| T07 | skills | auto | T04 | ⬜ | Delete dead skills; de-agent worker skills; slug-as-name templates. |
| T08 | docs | auto | T05, T07 | ⬜ | Rewrite /docs and the CLAUDE.md carve-out. |
| T09 | capstone | you | T06, T08 | ⬜ | Live end-to-end hand-verification with the person. |

A Notes cell holds what was built or what the review found, the test count, and one line per
deviation from the task doc. A ✅ task's cell may be cut to one line once the next task is reviewed.

**Review queue:** T01.

## Blocked on the user

Nothing blocked. T09 needs the person's hands (a live drill) but only after T06 and T08 are done; it
is not blocked yet.
