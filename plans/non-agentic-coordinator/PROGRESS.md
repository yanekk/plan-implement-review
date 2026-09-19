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

**Status:** T06 reviewed clean, no fix commit. Re-ran the merges in a sandbox HOME/target: target keeps
its own `allow`+`deny` and gains the 11 worker rules (no `SendMessage`, no `git merge`); user settings
restores `$defaults` to the front, keeps a pre-existing rule and other keys, appends the pir rule,
second run idempotent; a corrupt file exits non-zero untouched so the manual step prints. Boundary held
(`core/settings.mjs` pure, zero imports). 384 green. Found `worktree.bgIsolation: none` ships here but
`install.sh` does not carry it to a target (FINDINGS) — out of scope, a T08/T09 call. Live classifier
proof is T09.
**Last updated:** 2026-09-19
**Next `pir-work` will:** implement T07 (`skills`, `⬜`, deps T04 ✅) — or T09 is still blocked on T08.

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
| T05 | harness-and-restart | auto | T04 | ✅ | Reviewed clean. Foreground-process harness: run.mjs spawns `node coordinate.mjs`, seals on exit, SIGKILLs to crash; naming strict 5-field; `coordinatorName`/`verify` gone. Live crash/restart is T09. |
| T06 | worker-permissions | auto | — | ✅ | Reviewed clean, no fix commit. Ships worker `permissions.allow` (no SendMessage/git merge) + `install.sh` merges it into a target and the `autoMode` rule into `~/.claude/settings.json`, manual step on failure. Merge pure in `core/settings.mjs`. Probed by re-running the real merges in a sandbox: no-clobber, idempotent, `$defaults` front, corrupt file untouched. `bgIsolation: none` ships but does not travel to targets (FINDINGS, T08/T09). 384 green. Live classifier proof T09. |
| T07 | skills | auto | T04 | ⬜ | Delete dead skills; de-agent worker skills; slug-as-name templates. |
| T08 | docs | auto | T05, T07 | ⬜ | Rewrite /docs and the CLAUDE.md carve-out. |
| T09 | capstone | you | T06, T08 | ⬜ | Live end-to-end hand-verification with the person. |

A Notes cell holds what was built or what the review found, the test count, and one line per
deviation from the task doc. A ✅ task's cell may be cut to one line once the next task is reviewed.

**Review queue:** empty — nothing awaiting review.

## Blocked on the user

Nothing blocked. T09 needs the person's hands (a live drill) but only after T06 and T08 are done; it
is not blocked yet.
