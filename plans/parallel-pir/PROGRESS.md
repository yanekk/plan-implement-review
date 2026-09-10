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
The `Runs` column marks each task `auto` (a worker builds it) or `you` (a person runs it). 14
tasks, 5 phases (T12 added 2026-09-10 from the stopped T10 drill; T13 added 2026-09-10 from the gastown comparison to prove the comms protocol before T10). Review fixed the colourless test command, a signature and a param name, and
gitignored the control dir; decided the main-branch carve-out (coordinator in its own worktree),
closing the implement session at review, and how a `you` task is marked done.
After review the user revised the `you`-task model (2026-09-07): the coordinator now spawns a
hands-on worker (`pir-verify Txx`) the user drives, folded back without review, instead of surfacing
the task bare. Touched DESIGN, T03, T05, T07, T09, T10, T11.
**Last updated:** 2026-09-10
**Next `pir-work` will:** review T13 (🔍) — the comms-protocol build: hello-on-spawn, coordinator
launched under `{repo} · {plan}`, and idle-gated close. Its LIVE half (by-name delivery + idle timing
on the scratch harness, ceiling 1) is still unverified and folds into FINDINGS when the user runs it.
After T13 is reviewed, T10 (the full live drill) unblocks (deps T09, T12, T13).

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
| T12 | Make the coordinator drivable live: six drill fixes | auto | T09 | ✅ | Reviewed clean, no fix. All six fixes provable against fakes and tested: `isWorkerOf` self-filter flows through `liveAfter` so ceiling and breaker count workers only, `runawayVerdict` grace, `canPromoteHere`, `ensureMain`, `teardownRun` on every non-clean exit, `decision` kind now parked, prose `kind:` fallback. Probed stall-vs-parked, productive-action-type match, signal teardown. 145 tests. Live drive is T10's. |
| T13 | Prove comms protocol: by-name addressing, idle-gated close | auto | T12 | 🔍 | Built: hello to every freshly-spawned worker (implement+review) carrying the coordinator name; finished-worker close gated on idle (dead worker and kill switch exempt); fake `lingerBusy` drives the gate. 150 tests. DESIGN §2.2/§2.3/§2.8/§7 and both skills updated; coordinator launched under `{repo} · {plan}` via `claude -n`. LIVE half (by-name delivery, idle timing) UNVERIFIED — scratch drive below. |
| T10 | Full multi-worker run + kill-switch drill | you | T09, T12, T13 | ⬜ | Hand-verified. Dangerous: full size, last. Partial drill 2026-09-10 proved spawn + first message; stopped, gaps split to T12, comms protocol to T13. Scratch harness: `src/pir-t10`. |
| T11 | `/pir-plan` + templates: `Runs` marker, honest deps, width report | auto | T04, T12 | ⬜ | Changes the shared method. Now waits on T12: do not teach the planner parallel-plan conventions before the worker/message contract T12 settles. |

A Notes cell holds what was built or what the review found, the test count, and one line per
deviation from the task doc.

**A ✅ task's cell may be cut to one line** once the next task has been reviewed.

**Review queue:** T13 (🔍), implemented 2026-09-10. Next `pir-work` reviews it.

## Blocked on the user

**Nothing blocked.** The T10 live drill ran 2026-09-10 (ceiling 1, user-driven) and was stopped
deliberately after the first worker round-trip: spawn and the first worker→coordinator message both
worked. Six shell-driver gaps were split to T12; the comms-protocol proof (by-name addressing,
idle-gated close) was split to T13. Order: review T12, build/review T13, then the full T10 drill.

**T13 LIVE half (person-run, not blocking the review).** The build and its fakes are green; the by-name
delivery and the idle-close timing need real agents. On the scratch harness `src/pir-t10`, launch the
coordinator SESSION under its name so a worker can address it, ceiling 1, kill switch wired:

```
cd /Users/jan.krolikowski/src/pir-t10
claude -n "pir-t10 · scratch"          # the coordinator session must carry this exact name (§2.8)
  # then inside it:  /pir-coordinate scratch
  # the skill runs:  PARALLEL_LIVE=1 PARALLEL_MAX_WORKERS=1 PARALLEL_ALLOW_HERE=1 node src/shell/coordinate.mjs scratch
```

Expect: a real worker's message reaches the coordinator addressed as `pir-t10 · scratch`; the
coordinator's hello reaches the worker; a worker reporting done is closed only after the agent list
shows it idle. Tell me: did the by-name message arrive, and was any worker SIGTERMed mid-turn. Record in
FINDINGS with the date. Kill switch: `touch plans/scratch/.parallel/control/HALT`.

Carry (not blocking): the parallel skills are NOT installed in `~/.claude/skills/` (only the classic set
is), so a fresh coordinator session needs them local — `src/pir-t10` has all skills in its
`.claude/skills/`; after close a worker lingers as `stopped` (needs `claude rm`); the feature worktree
is not removed after promote. Person-run live halves: T13 (comms proof) and T10 (full drill).
