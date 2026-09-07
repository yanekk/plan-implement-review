# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)** — read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose, no bold-per-clause, no aphorism. The
cell is an index for the next session; the account is the commit message. **Whoever writes a
cell also fixes the over-budget cell they walk past.**

**Plan reviewed:** 2026-09-07 — 4 fixed, 3 decided with the user

**Status:** Plan written, re-scoped onto Claude Code's own primitives, and reviewed before build.
The `Runs` column marks each task `auto` (a worker builds it) or `you` (a person runs it). 12
tasks, 5 phases. Review fixed the colourless test command, a signature and a param name, and
gitignored the control dir; decided the main-branch carve-out (coordinator in its own worktree),
closing the implement session at review, and how a `you` task is marked done.
**Last updated:** 2026-09-07
**Next `pir-work` will:** implement T00 — the lowest ⬜ with no dependencies. T00 is a `you` task
(the platform spike), so `pir-implement` hands you its seatbelted commands rather than building it.
T01 (scaffold) also has no dependencies if you would rather start the code there.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human. **Runs:** `auto` a worker builds it · `you` a person runs it,
surfaced by the coordinator, never dispatched (§2.6).

| # | Task | Runs | Depends on | State | Notes |
|---|---|---|---|---|---|
| T00 | Platform primitives spike: spawn, message, fresh review, close | you | — | ⬜ | Throwaway. Hand-verified with the user; gates T07, T08. |
| T01 | Project scaffold, `npm test`, boundary test | auto | — | ⬜ | |
| T02 | Parse `PROGRESS.md` (with `Runs` marker) and fold one row back | auto | T01 | ⬜ | |
| T03 | `decideDispatch` — spawn / review / merge / close / surface | auto | T02 | ⬜ | |
| T04 | `analyzeParallelism` — critical path, width, auto/you counts | auto | T02 | ⬜ | |
| T05 | Fake spawn/message/list/close + the coordinator loop | auto | T03 | ⬜ | |
| T06 | Feature branch + task worktree create / integrate / merge / promote | auto | T05 | ⬜ | Hand-verified half. |
| T07 | `pir-worker` contract skill + cross-session wiring | auto | T00 | ⬜ | |
| T08 | One real worker, one trivial task, seatbelted | auto | T06, T07 | ⬜ | Hand-verified. Dangerous: small first. |
| T09 | The `pir-coordinate` skill: dispatch, surface, supervise | auto | T08 | ⬜ | |
| T10 | Full multi-worker run + kill-switch drill | you | T09 | ⬜ | Hand-verified. Dangerous: full size, last. |
| T11 | `/pir-plan` + templates: `Runs` marker, honest deps, width report | auto | T04 | ⬜ | Changes the shared method. |

A Notes cell holds what was built or what the review found, the test count, and one line per
deviation from the task doc.

**A ✅ task's cell may be cut to one line** once the next task has been reviewed.

**Review queue:** *(empty)*

## Blocked on the user

Nothing right now. The two `you` tasks (T00 spike, T10 full run) and the hand-verified halves of
T06 and T08 need a person; each names its exact seatbelted command in its task doc. That is a good
state; it is where those tasks pause for an answer, not a backlog.
