# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**. Read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose, no bold-per-clause, no aphorism. The
cell is an index for the next session; the account is the commit message. Whoever writes a
cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-29 — 1 fixed, 3 decided with the user

**Status:** T01 built, awaiting review. The prototype in `prototype/` was approved by the user.
**Last updated:** 2026-09-29
**Next `pir-work` will:** review T01.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | group-steps-core | — | 🔍 | Grouping, labels, refused, `open`, `hit` in conversation.mjs; `toolUseId` on requests. 17 new tests. Deviations: new fixture `stream-sample.full-lines.json` snapshots pre-change full mode; rig wheel test presses Tab (300 steps now fold); refused needs reply `behavior: 'deny'`. |
| T02 | group-steps-view | T01 | ⬜ | |
| T03 | group-steps-drill | T01, T02 | ⬜ | |

**Review queue:** T01

## Blocked on the user

Nothing yet.
