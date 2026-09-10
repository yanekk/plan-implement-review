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
**Last updated:** 2026-09-10
**Next `pir-work` will:** T09 is ✅. Two ⬜ tasks are now ready: T10 (you — full multi-worker run +
kill-switch drill, deps T09 ✅) and T11 (auto — teach the planner parallelism, deps T04 ✅). T10 is
lowest by number but is person-run and needs the user; T11 is the one a worker can build unattended.

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
| T04 | `analyzeParallelism` — critical path, width, auto/you counts | auto | T02 | ✅ | Reviewed clean. Critical path, width and auto/you counts correct; layer-width proxy honest (a dep edge strictly raises depth); `errors` reports unknown deps and cycles. Purity proven. |
| T05 | Fake spawn/message/list/close + the coordinator loop | auto | T03 | ✅ | Reviewed clean after one fix (loop called a method outside T06's interface). Findings logged for T06/parser. 86 tests. |
| T06 | Feature branch + task worktree create / integrate / merge / promote | auto | T05 | ✅ | Reviewed clean after one fix: `remove` now `--force --force` (git refuses single `--force` on a locked worktree), confirmed on real git. 100 tests. |
| T07 | `pir-worker` contract skill + cross-session wiring | auto | T00 | ✅ | Reviewed clean. Wire format, same-repo `--cwd` guard, parseAgents, `text` field. resolveSameRepo also keeps the coordinator (inert; T09 drops self). 111 tests. |
| T08 | One real worker, one trivial task, seatbelted | auto | T06, T07 | ✅ | Reviewed clean. LIVE hand-verified ✅ 2026-09-09 (one real worker, ceiling held). Feature-worktree teardown deferred to T09/T10. 121 tests. |
| T09 | The `pir-coordinate` skill: dispatch, surface, supervise | auto | T08 | ✅ | Reviewed clean, no fix commit. 134 tests green; fakes make real git commits, so merge/reconcile/dispatch are genuinely exercised, not stubbed. Bin refusal fired live. Probed answer/defer state between passes, ceiling accounting, you-task fold-back, and the platform/worktree/bridge seams the tests miss (bridge round-trips to the loop's message shape). Live drive over real agents deferred to T10 (unverified half). |
| T10 | Full multi-worker run + kill-switch drill | you | T09 | ⬜ | Hand-verified. Dangerous: full size, last. |
| T11 | `/pir-plan` + templates: `Runs` marker, honest deps, width report | auto | T04 | ⬜ | Changes the shared method. |

A Notes cell holds what was built or what the review found, the test count, and one line per
deviation from the task doc.

**A ✅ task's cell may be cut to one line** once the next task has been reviewed.

**Review queue:** empty — T09 reviewed clean 2026-09-10. No task awaiting review.

## Blocked on the user

**Nothing blocked.** T08 is reviewed clean (2026-09-09); its live one-worker run stays
hand-verified ✅ (FINDINGS). The `claude stop` / SIGTERM contradiction is resolved — DESIGN §2.3,
§2.4, §3.2 and §5 were amended to the stop-interrupts-only reality (commit b5a1a38).

Carry into T10 (not blocking): install/sync the parallel skills (`pir-coordinate`, `pir-worker`,
`pir-verify`) into `~/.claude/skills/` so live sessions run the contract, not classic `pir-implement`;
after close a worker lingers in `claude agents` as `stopped` (needs `claude rm` to clear); the feature
worktree is not removed after promote. T09 bin live drive needs `PARALLEL_LIVE=1` (seatbelt, §5.2).
Remaining person-run work: T10 (full multi-worker run + kill-switch drill).
