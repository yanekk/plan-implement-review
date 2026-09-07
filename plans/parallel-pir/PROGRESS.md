# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)** — read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose, no bold-per-clause, no aphorism. The
cell is an index for the next session; the account is the commit message. **Whoever writes a
cell also fixes the over-budget cell they walk past.**

**Plan reviewed:** not yet — run `/pir-review-plan` before the first `/pir-work`

**Status:** Plan written by `/pir-plan`, not yet reviewed. Requirements were confirmed with
the user and three decisions settled: Node `node --test` as the test stack, caps at 5/min · 6
hops · 4 workers, a hard-stop-only kill switch, worker-resolves-then-escalates on merge
conflicts, and close as a first-class worker operation.
**Last updated:** 2026-09-07
**Next `pir-work` will:** nothing yet — `/pir-review-plan parallel-pir` must run first. Once
reviewed, the first work is T00 (the CLI driver spike) or T01 (scaffold), which have no
dependencies.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | CLI driver spike: create, drive, close a worker | — | ⬜ | Throwaway. Hand-verified with the user; gates T10, T11. |
| T01 | Project scaffold, `npm test`, boundary test | — | ⬜ | |
| T02 | Parse `PROGRESS.md` into tasks and the gate line | T01 | ⬜ | |
| T03 | `decideDispatch` — spawn / merge / close | T02 | ⬜ | |
| T04 | Caps, hop depth, the halted check | T01 | ⬜ | |
| T05 | Mailbox message format, parse, provenance | T01 | ⬜ | |
| T06 | Fold one finished task row into `PROGRESS.md` | T02 | ⬜ | |
| T07 | Fake agent registry + scratch-repo simulation | T03, T04, T05, T06 | ⬜ | |
| T08 | The coordinator loop over the fake world | T07 | ⬜ | |
| T09 | Real worktree create / integrate / merge / close | T08 | ⬜ | Hand-verified half. |
| T10 | `pir-worker` contract skill + mailbox-post command | T05, T00 | ⬜ | |
| T11 | One real worker, one trivial task, seatbelted | T09, T10 | ⬜ | Hand-verified. Dangerous: small first. |
| T12 | The `pir-coordinate` skill the user talks to | T11 | ⬜ | |
| T13 | Full multi-worker run + kill-switch drill | T12 | ⬜ | Hand-verified. Dangerous: full size, last. |

A Notes cell holds what was built or what the review found, the test count, and one line per
deviation from the task doc.

**A ✅ task's cell may be cut to one line** once the next task has been reviewed.

**Review queue:** *(empty)*

## Blocked on the user

Nothing right now. Several Phase 3 tasks (T09, T11, T13) have a half that only the user can
verify — a real agent spawning, a real merge, the kill-switch drill — and each names its exact
seatbelted command in its task doc. That is a good state; it is where those tasks pause for an
answer, not a backlog.
