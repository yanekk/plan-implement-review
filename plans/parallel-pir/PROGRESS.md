# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)** — read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose, no bold-per-clause, no aphorism. The
cell is an index for the next session; the account is the commit message. **Whoever writes a
cell also fixes the over-budget cell they walk past.**

**Plan reviewed:** not yet — run `/pir-review-plan` before the first `/pir-work`

**Status:** Plan written and then re-scoped after the user asked whether it reinvented the
wheel. A platform survey found Claude Code already provides the orchestration (background
workers, per-session worktrees, cross-session messaging, stop/remove), all working headless.
The plan now builds only the PIR glue on top: 10 tasks, down from 14. Not yet reviewed.
**Last updated:** 2026-09-07
**Next `pir-work` will:** nothing yet — `/pir-review-plan parallel-pir` must run first. Once
reviewed, the first work is T00 (the platform spike) or T01 (scaffold), which have no
dependencies.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | Platform primitives spike: spawn, message, fresh review, close | — | ⬜ | Throwaway. Hand-verified with the user; gates T06, T07. |
| T01 | Project scaffold, `npm test`, boundary test | — | ⬜ | |
| T02 | Parse `PROGRESS.md` and fold one finished task row back | T01 | ⬜ | |
| T03 | `decideDispatch` — spawn / review / merge / close | T02 | ⬜ | |
| T04 | Fake spawn/message/list/close + the coordinator loop | T03 | ⬜ | |
| T05 | Real worktree create / integrate / merge / close | T04 | ⬜ | Hand-verified half. |
| T06 | `pir-worker` contract skill + cross-session wiring | T00 | ⬜ | |
| T07 | One real worker, one trivial task, seatbelted | T05, T06 | ⬜ | Hand-verified. Dangerous: small first. |
| T08 | The `pir-coordinate` skill the user talks to | T07 | ⬜ | |
| T09 | Full multi-worker run + kill-switch drill | T08 | ⬜ | Hand-verified. Dangerous: full size, last. |

A Notes cell holds what was built or what the review found, the test count, and one line per
deviation from the task doc.

**A ✅ task's cell may be cut to one line** once the next task has been reviewed.

**Review queue:** *(empty)*

## Blocked on the user

Nothing right now. Three Phase 3 tasks (T05, T07, T09) have a half that only the user can
verify — a real agent spawning and messaging, a real merge, the kill-switch drill — and each
names its exact seatbelted command in its task doc. That is a good state; it is where those
tasks pause for an answer, not a backlog.
