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

**Status:** T06 implemented, awaiting review. Ships the worker `permissions.allow` in a committed
`.claude/settings.json` and has `install.sh` merge it into a target plus merge the per-user
`autoMode.allow` rule into `~/.claude/settings.json`, with the manual `/permissions` step printed on
failure. Merge logic is a pure `src/core/settings.mjs` driven by a thin `src/shell/settings-merge.mjs`
CLI. Verified end-to-end by running the real installer in a sandbox HOME/target: no-clobber, idempotent,
`$defaults` restored to the front, and the fallback prints without overwriting an unparseable file.
384 tests green. Whether `permissions.allow` alone clears a live worker's git — making the `autoMode`
rule belt-and-suspenders — is confirmed live in T09.
**Last updated:** 2026-09-19
**Next `pir-work` will:** review T06 (`worker-permissions`, `🔍`).

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
| T05 | harness-and-restart | auto | T04 | ✅ | Reviewed clean, no fix commit. Foreground-process model verified: run.mjs spawns `node coordinate.mjs`, seals on exit, SIGKILLs to crash; naming strict 5-field, `coordinatorName`/`verify` gone; capture `isCoordinator` always false. Facts non-vacuous (parkedWorkerHoldsSlot, restart set); 361 green. Probed the grep item: production dispatch is verify-free; leftover verify/you refs are out-of-scope test framing + the permitted fake shape (FINDINGS, T07). Live crash/restart is T09. |
| T06 | worker-permissions | auto | — | 🔍 | Ships worker `permissions.allow` (no SendMessage/git merge) in committed `.claude/settings.json`; `install.sh` merges it into a target and the user `autoMode.allow` rule into `~/.claude/settings.json`, printing the manual `/permissions` step on failure. Merge logic pure in `core/settings.mjs`, driven by `shell/settings-merge.mjs` CLI — deviation: 2 files past the list, for boundary+tests. README note not /docs. 384 green. Live proof T09. |
| T07 | skills | auto | T04 | ⬜ | Delete dead skills; de-agent worker skills; slug-as-name templates. |
| T08 | docs | auto | T05, T07 | ⬜ | Rewrite /docs and the CLAUDE.md carve-out. |
| T09 | capstone | you | T06, T08 | ⬜ | Live end-to-end hand-verification with the person. |

A Notes cell holds what was built or what the review found, the test count, and one line per
deviation from the task doc. A ✅ task's cell may be cut to one line once the next task is reviewed.

**Review queue:** T06 (`worker-permissions`) — implemented, awaiting a fresh-eyes review.

## Blocked on the user

Nothing blocked. T09 needs the person's hands (a live drill) but only after T06 and T08 are done; it
is not blocked yet.
