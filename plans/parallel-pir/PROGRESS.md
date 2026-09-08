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
After review the user revised the `you`-task model (2026-09-07): the coordinator now spawns a
hands-on worker (`pir-verify Txx`) the user drives, folded back without review, instead of surfacing
the task bare. Touched DESIGN, T03, T05, T07, T09, T10, T11.
**Last updated:** 2026-09-08
**Next `pir-work` will:** review T05 (implemented, awaiting review). Note the branch-model change
decided while building it: task branches are `pir/{plan}-T{nn}` (dash), because git rejects
`pir/{plan}` and `pir/{plan}/T{nn}` together (FINDINGS, DESIGN §2.9). T06 builds the real worktree
against T05's fake interface; T07 (§2.8 naming) and T11 (planner templates) still fold in T00.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human. **Runs:** `auto` a worker builds it · `you` a person runs the
live steps with a hands-on worker the coordinator spawns, folded back without review (§2.6).

| # | Task | Runs | Depends on | State | Notes |
|---|---|---|---|---|---|
| T00 | Platform primitives spike: spawn, message, fresh review, close | you | — | ✅ | Spike verified by agent 2026-09-07 (user away, delegated): spawn/message/fresh-review/close all confirmed, artifacts deleted. Corrections: `--bg` task positional not `-p`; worker names slash-free. See FINDINGS. Gates T07/T08. |
| T01 | Project scaffold, `npm test`, boundary test | auto | — | ✅ | Reviewed clean. Test command verified (exits, boundary bite, no ANSI under FORCE_COLOR); scanner matches §3.1's seven tokens, non-recursive. |
| T02 | Parse `PROGRESS.md` (with `Runs` marker) and fold one row back | auto | T01 | ✅ | Reviewed. Fixed: empty `**Plan reviewed:**` note read as reviewed=true → now not-reviewed, with a test. Parser probed on real PROGRESS.md; reconcile round-trips one line. 21 tests. |
| T03 | `decideDispatch` — spawn / review / merge / close | auto | T02 | ✅ | Reviewed clean, no fix. Crash-window gaps at review-ready and merge logged to FINDINGS for T05/T06. |
| T04 | `analyzeParallelism` — critical path, width, auto/you counts | auto | T02 | ✅ | Reviewed clean, no fix. Five numbers correct for chain, fan-out, diamond; layer-width proxy is honest — a dependency edge strictly raises depth, so same-depth tasks are provably independent. `errors` deviation (unknown deps, cycles) approved: the doc's own tests require reporting them. Boundary test auto-scans the module; purity proven. Probed cycles, partial-unknown deps, empty. |
| T05 | Fake spawn/message/list/close + the coordinator loop | auto | T03 | 🔍 | Built: fake platform (in-memory agents, real commits in cwd), fake worktree (real scratch git repo), loop.mjs runPass/drain. 26 tests. Found git rejects `pir/{plan}/T{nn}`; user chose `pir/{plan}-T{nn}`. Contracts for T06/T08 in FINDINGS: close = session only, worktree.remove owns git teardown, conflicts as worker messages, list() = tick. |
| T06 | Feature branch + task worktree create / integrate / merge / promote | auto | T05 | ⬜ | Hand-verified half. |
| T07 | `pir-worker` contract skill + cross-session wiring | auto | T00 | ⬜ | |
| T08 | One real worker, one trivial task, seatbelted | auto | T06, T07 | ⬜ | Hand-verified. Dangerous: small first. |
| T09 | The `pir-coordinate` skill: dispatch, surface, supervise | auto | T08 | ⬜ | |
| T10 | Full multi-worker run + kill-switch drill | you | T09 | ⬜ | Hand-verified. Dangerous: full size, last. |
| T11 | `/pir-plan` + templates: `Runs` marker, honest deps, width report | auto | T04 | ⬜ | Changes the shared method. |

A Notes cell holds what was built or what the review found, the test count, and one line per
deviation from the task doc.

**A ✅ task's cell may be cut to one line** once the next task has been reviewed.

**Review queue:** T05

## Blocked on the user

Nothing right now. T00 (spike) is done. The remaining person-run work is T10 (full run) and the
hand-verified halves of T06 and T08; each names its exact seatbelted command in its task doc. That
is a good state; it is where those tasks pause for an answer, not a backlog.
