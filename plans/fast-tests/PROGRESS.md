# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)**. Read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose, no bold-per-clause, no aphorism. The
cell is an index for the next session; the account is the commit message. Whoever writes a
cell also fixes the over-budget cell they walk past.

**Plan reviewed:** 2026-09-29 — 3 fixed, 2 decided with the user

**Status:** T01 done.
**Last updated:** 2026-09-29
**Next `pir-work` will:** implement T02 (T03–T05 have no dependencies).

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | wake-on-activity | — | ✅ | Review clean, no fix commit. npm test green (4:18, quiet). Probed waker gap/abort/coalescing, onSettled once on kill vs exit, decisions watcher ignoring unlink and temp names, graces now ~15 s idle as specified, self-wake from pass sends bounded by the gap, no PARALLEL_OVER_GRACE user. Drill-under-60 s backstop left to T02/T06. |
| T02 | end-sequence-no-wait | T01 | ⬜ | |
| T03 | split-coordinator-drill | — | ⬜ | |
| T04 | split-plan-rig | — | ⬜ | |
| T05 | split-conversation-rig | — | ⬜ | |
| T06 | suite-timing-proof | T01, T02, T03, T04, T05 | ⬜ | |

**Review queue:** empty

## Blocked on the user

Nothing yet.
