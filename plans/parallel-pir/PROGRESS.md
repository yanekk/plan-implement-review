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
The `Runs` column marks each task `auto` (a worker builds it) or `you` (a person runs it). 25 tasks,
7 phases (0–6). T12/T13 added 2026-09-10. Phase 5 (T14–T17, the harness) added 2026-09-10. Phase 6
(T18–T23, one live-run task per fixture) added 2026-09-12 by PM decision: T17 stays the `auto` runner,
each fixture is its own `you` task, done when its fact report is all-green. T10 is absorbed by T23,
T13's live half by T18. T24 (`auto`, added 2026-09-12) hardens the coordinator/worker prompts from the
T18 transcripts and gates T19–T23. The operator's guide is [TEST-HARNESS.md](TEST-HARNESS.md). Phases
5–6 postdate the 2026-09-07 plan review; they are validated per task during build, since
`/pir-review-plan` does not re-run on a building plan.
**Last updated:** 2026-09-12
**Next `pir-work` will:** find no `auto` work left — T24 is ✅ and every remaining task (T19–T23, T10) is
a `you` live run gated on the user. First live `single` re-run (2026-09-12, after T24) stalled with no
promote: the runaway breaker miscounted a just-closed implementer still listed alongside its fresh reviewer.
Fixed in loop.mjs (`closedIds`). Then (PM decision 2026-09-12) worker names were given a role suffix
`… · T{nn} · {role}` (implement/review/verify) so the coordinator addresses implementer vs reviewer
directly, not by age — DESIGN §2.8 and pir-coordinate updated. 249 tests green; live re-run owed to
confirm the promote. Then the fixture queue T19 (review-queue) → clean-merge → human-decision →
merge-conflict → T23 (parallel) resumes. Procedure in [TEST-HARNESS.md](TEST-HARNESS.md).

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
| T13 | Prove comms protocol: by-name addressing, idle-gated close | auto | T12 | ✅ | Reviewed clean, no fix. Hello wired through the real bridge (encodeMessage→outbox); idle gate reads `status` and only defers; kill switch and dead worker bypass it. 150 tests. Live half retired by T18 (PASS live 2026-09-12) — no longer a manual check. |
| T11 | `/pir-plan` + templates: `Runs` marker, honest deps, width report | auto | T04, T12 | ✅ | Reviewed clean. Planner Stage 6, three templates and both CLAUDE.md spots carry the Runs marker, honest deps and width report; golden tests read real templates through the parser. 153 tests. |
| T14 | Harness capture layer: flow, agent-status timeline, transcript bundle | auto | T09 | ✅ | Reviewed clean; read-only capture, seal reads the real control/log and flow format. 164 tests. |
| T15 | Harness assertions + scenario spec: declared facts over a bundle | auto | T14 | ✅ | Reviewed clean. 8 facts pure; loadTranscripts the only I/O (src/shell, outside the core boundary scan). Git-log needles verified against worktree.mjs. 195 tests. |
| T16 | Harness fixtures: scratch plans that force each path with real workers | auto | T15 | ✅ | Reviewed. Six fixtures; merge-conflict forced at ceiling 2; loop records worker-raised surfaces to the flow log. 230 tests. |
| T17 | Harness live runner (install→launch→capture→wait→seal→check) | auto | T14, T15, T16 | ✅ | Reviewed clean; runner build half, two live-run fixes folded in (`startupGrace`, live coordinator treated as active). 244 tests. See FINDINGS 2026-09-11/12. |
| T18 | Live fixture: single (happy path; retires T13 live half) | you | T17 | ✅ | PASS live 2026-09-12: all 4 facts green (hello, by-name, idle-gated close, one promote to main); build→review→merge→promote on real agents. Retires T13's live half. Bundle `pir-t17-single-IbhBgo/…/2026-09-12T05-45-43-231Z`. |
| T24 | Harden coordinator/worker prompts from the T18 transcripts | auto | T18 | ✅ | Reviewed. Prose-only, no src/; npm test green (244, not the 248 noted). Two fixes vs the code: W1 gave the worktree dir as the slashed `{branch}`, actual is dashed `pir-{plan}-T{nn}` (worktree.mjs:134); C1's tag list omitted `await-idle`/`halt-close`/`ceiling full` and the ISO-timestamp prefix. Verified C4 append-only, C2 promote-cue, log path. Live `single` re-run still owed. |
| T19 | Live fixture: review-queue | you | T17, T24 | ⬜ | Run `run.mjs review-queue`; hands-off; done when its 3 facts pass. See TEST-HARNESS.md. |
| T20 | Live fixture: clean-merge | you | T17, T24 | ⬜ | Run `run.mjs clean-merge`; hands-off; done when its 3 facts pass. See TEST-HARNESS.md. |
| T21 | Live fixture: human-decision | you | T17, T24 | ⬜ | Run `run.mjs human-decision`; answer the surfaced question via the control `answers` file; done when the 2 facts pass. See TEST-HARNESS.md. |
| T22 | Live fixture: merge-conflict | you | T17, T24 | ⬜ | Run `run.mjs merge-conflict`; hands-off; done when the conflict-parked fact passes. See TEST-HARNESS.md. |
| T23 | Live fixture: parallel + kill-switch drill (absorbs T10) | you | T17, T24 | ⬜ | Run `run.mjs parallel --into <dir>`; `touch <dir>/plans/parallel/.parallel/control/HALT` mid-run; done when its 3 facts pass. Closes T10. See TEST-HARNESS.md. |
| T10 | Full multi-worker run + kill-switch drill — absorbed by T23 | you | T23 | ⬜ | Absorbed by T23 (2026-09-12). Do not run standalone; closes ✅ when T23's parallel + kill-switch fact report is all-green. Partial drill 2026-09-10 proved spawn + first message. |

A Notes cell holds what was built or what the review found, the test count, and one line per
deviation from the task doc.

**A ✅ task's cell may be cut to one line** once the next task has been reviewed.

**Review queue:** empty. T24 reviewed ✅ 2026-09-12; the `you` fixture runs resume once the live
`single` iteration is done.

## Next up: the live `single` iteration, then the gated fixtures

**T24 is reviewed ✅** — the coordinator/worker prompt hardening (edits C1–C6, W1–W4), plus two review
fixes (worktree-path shape in W1, flow-log tag list in C1). Now the user and implementer run `single`
together and iterate on the prompts live (T24 § *After this task*) before the fixtures resume.

**The remaining Phase 6 fixture runs (T19–T23) are gated on T24** and stay blocked on the user after
it: real paid agents, launched attended, one at a time, never unattended. The full procedure (run
command per fixture, seatbelts, where the logs are, the two runs that need a mid-run action, recording,
cleanup) is in [TEST-HARNESS.md](TEST-HARNESS.md). Order once unblocked, small first:

```
node src/shell/harness/run.mjs review-queue   # T19, then clean-merge, human-decision, merge-conflict, then:
node src/shell/harness/run.mjs parallel --into <dir>   # T23, kill-switch drill, last
```

Each prints a fact-by-fact report and exits non-zero on any failed fact; record each run's verdict and
bundle path in FINDINGS with the date. A failed fact is a real finding — diagnose from the bundle, fix,
re-run. Housekeeping: a closed worker can linger as `stopped` (`claude rm <id>`); scratch repos sit in
a temp dir.
