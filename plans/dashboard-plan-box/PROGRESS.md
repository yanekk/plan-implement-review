# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**. Read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose. The cell is an index for the next session;
the account is the commit message. Whoever writes a cell also fixes the over-budget cell they walk
past.

**Plan reviewed:** 2026-09-27 — 4 fixed, 5 decided with the user

**Status:** All six tasks reviewed ✅; awaiting merge of `pir/dashboard-plan-box` and `./install.sh`.
**Last updated:** 2026-09-27
**Next `pir-work` will:** nothing; the plan is done once merged and installed.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | drop-canonical-guard | — | ✅ | |
| T02 | plan-box-rules | — | ✅ | |
| T03 | repo-scan | T02 | ✅ | |
| T04 | list-view-box | T02 | ✅ | |
| T05 | box-starts-plan | T03, T04 | ✅ | |
| T06 | plan-box-drill | T01, T05 | ✅ | Built: drill kept as 8 `plan-rig.test.mjs` cases; fixed box keys not disarming a chord and ambiguous-note paths now `~`; user decided `⚠` over typed hint, refusal codes in words. Review clean, no fix commit: both fix tests fail on the old code, plan-rig suite green twice, `~` matches the pop-up. `./install.sh` follows the merge. |

**Review queue:** empty

## Blocked on the user

- `./install.sh` follows the person's merge of `pir/dashboard-plan-box` into `main`, with no run live; then confirm `~/.claude/pir-engine/src/shell/list-view.mjs` exists (DESIGN §5).
