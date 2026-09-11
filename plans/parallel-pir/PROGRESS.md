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
The `Runs` column marks each task `auto` (a worker builds it) or `you` (a person runs it). 18 tasks,
6 phases (0–5). T12/T13 added 2026-09-10 from the stopped T10 drill and the gastown comparison. Phase
5 (T14–T17, the live-scenario test harness) added 2026-09-10 by PM decision: real workers, data-driven
capture, folding in T10 and T13's live half. Phase 5 was not in the 2026-09-07 plan review (it postdates
it); it is validated per task during build, since `/pir-review-plan` does not re-run on a building plan.
**Last updated:** 2026-09-11
**Next `pir-work` will:** implement T17 (harness live runner), the last task. Its build half is `auto`
and tested against fakes; the live scenario runs spawn real paid agents, so they need the user,
seatbelted (scratch plan, low ceiling, kill switch, timeout auto-HALT).

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
| T09 | The `pir-coordinate` skill: dispatch, surface, supervise | auto | T08 | ✅ | Reviewed clean. The coordinator skill (dispatch, surface, supervise); fakes make real git commits so merge/dispatch are genuinely exercised; live drive over real agents deferred to T10. 134 tests. |
| T12 | Make the coordinator drivable live: six drill fixes | auto | T09 | ✅ | Reviewed clean. Six drill fixes (self-filter through `liveAfter`, runaway grace, `canPromoteHere`, `ensureMain`, `teardownRun`, `decision` parked + prose `kind:` fallback), all tested. 145 tests. Live drive is T10's. |
| T13 | Prove comms protocol: by-name addressing, idle-gated close | auto | T12 | ✅ | Reviewed clean, no fix. Hello wired through the real bridge (encodeMessage→outbox); idle gate reads `status` and only defers; kill switch and dead worker bypass it. 150 tests. LIVE half (by-name delivery, idle timing) folded into T17's single-task scenario 2026-09-10 — no longer a manual check. |
| T11 | `/pir-plan` + templates: `Runs` marker, honest deps, width report | auto | T04, T12 | ✅ | Reviewed clean. Planner Stage 6, three templates and both CLAUDE.md spots carry the Runs marker, honest deps and width report; golden tests read real templates through the parser. 153 tests. |
| T14 | Harness capture layer: flow, agent-status timeline, transcript bundle | auto | T09 | ✅ | Reviewed clean; read-only capture, seal reads the real control/log and flow format. 164 tests. |
| T15 | Harness assertions + scenario spec: declared facts over a bundle | auto | T14 | ✅ | Reviewed clean. 8 facts pure; loadTranscripts the only I/O (src/shell, outside the core boundary scan). Git-log needles verified against worktree.mjs. 195 tests. |
| T16 | Harness fixtures: scratch plans that force each path with real workers | auto | T15 | ✅ | Reviewed. merge-conflict could not force a conflict at ceiling 1 (2nd task cut after the 1st merges → clean; proved on real git); fixed with PM to ceiling 2 + task-agnostic conflictSurfacedAndParked. Also fixed the loop so worker-raised surfaces reach the flow log, else questionRoundTrip and the conflict fact were blind. Probed all six fixtures' declared facts. 230 tests. |
| T17 | Harness live runner + first real scenario runs | you | T14, T15, T16 | ⬜ | Phase 5. Build half `auto`/tested against fakes; live runs spawn real paid agents, so `you`, seatbelted (scratch, low ceiling, kill switch, timeout auto-HALT). Folds in T10 (parallel scenario) and T13's live half (single scenario). |
| T10 | Full multi-worker run + kill-switch drill — folded into T17 | you | T17 | ⬜ | Folded into T17 (2026-09-10): the full drill is now T17's parallel + kill-switch scenario, run with captured data. Do not run standalone. Closes ✅ when T17's parallel scenario passes. Partial drill 2026-09-10 proved spawn + first message. Scratch: `src/pir-t10`. |

A Notes cell holds what was built or what the review found, the test count, and one line per
deviation from the task doc.

**A ✅ task's cell may be cut to one line** once the next task has been reviewed.

**Review queue:** empty. T16 reviewed ✅. T17 is the last task (its live half is user-driven).

## Blocked on the user

**Nothing blocked.** The next live work is the Phase 5 harness, and its live half is T17 — after the
`auto` build of T14–T16. The T13 manual command that stood here 2026-09-10 is **withdrawn**: the
comms proof is now T17's single-task scenario, run with captured data instead of by eye. T13's
automated half stays reviewed and ✅.

**Carry into the harness (T16/T17), from the stopped drill.** The parallel skills are NOT installed in
`~/.claude/skills/` (only the classic set is), so a spawned worker needs them local — a fixture must
carry them (`src/pir-t10` has all skills in its `.claude/skills/`). After close a worker lingers as
`stopped` (needs `claude rm`). The feature worktree is not removed after promote. When T17 runs live,
its scenarios are seatbelted: scratch plan, per-scenario low ceiling, kill switch
(`touch plans/{scratch}/.parallel/control/HALT`), and a wall-clock timeout that auto-touches HALT.
