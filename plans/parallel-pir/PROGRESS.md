# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)** — read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose, no bold-per-clause, no aphorism. The
cell is an index for the next session; the account is the commit message. **Whoever writes a
cell also fixes the over-budget cell they walk past.**

**Plan reviewed:** 2026-09-07 — 4 fixed, 3 decided with the user

**Status:** T00–T37 ✅. Phase 9 capstone done: the blog (T36 reviewed clean, T37 PASSed live 2026-09-16,
attended, 8 facts). **Phase 10 added 2026-09-16 (PM request):** T38 ⬜, a full retrospective on the T37
run — did the tasks deliver, did the e2e really run, plus eight more angles (PLAN §Phase 10). Analysis
only, `auto`, fresh-reviewed. Like phases 5–9 it postdates the 2026-09-07 plan review and is validated
through the normal implement→review alternation, not a fresh full plan-review (CLAUDE.md: amending a live
plan is the PM's decision). The T37 evidence is preserved out of git at `~/pir-retro/blog-app-2026-09-16/`
(curated capture + a git bundle of the scratch repo). `Runs` marks each task `auto` or `you`. Operator's
guide: [TEST-HARNESS.md](TEST-HARNESS.md).
**Last updated:** 2026-09-16
**Next `pir-work` will:** implement **T38** — the blog-app retrospective. It reads the preserved bundle
and the restored scratch code and writes `~/pir-retro/blog-app-2026-09-16/RETRO.md`. `auto`, no live
agents needed.
**Open hardening candidates** (each its own future task, none blocking): T31 prose gap
(`pir-verify`/`pir-coordinate` still narrow); three T30-reflection candidates (reviewer run the test once +
capture exit; workers avoid `cat -A`/GNU-only flags on macOS → `xxd`/`Read`; coordinator emit a final
`promote confirmed`/teardown line); a promote-flush capture gap (the coordinator's final completion message
can seal out of the bundle — seen T35 rerun); `role:foreign` capture bloat (~4MB); candidate D (graceful
mid-write drain); a hands-on gate looks hung — at a `you` check-in the coordinator polls `await-idle`
silently until the operator runs `docker compose down` (T37); surface "waiting for worker idle".

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human. **Runs:** `auto` a worker builds it · `you` a person runs the
live steps with a hands-on worker the coordinator spawns, folded back without review (§2.6).

| # | Task | Runs | Depends on | State | Notes |
|---|---|---|---|---|---|
| T00 | Platform primitives spike: spawn, message, fresh review, close | you | — | ✅ | Spike verified by agent 2026-09-07: spawn/message/fresh-review/close confirmed. Corrections in FINDINGS. |
| T01 | Project scaffold, `npm test`, boundary test | auto | — | ✅ | Reviewed clean. Test command verified (exits, boundary bite, no ANSI); scanner matches §3.1's seven tokens, non-recursive. |
| T02 | Parse `PROGRESS.md` (with `Runs` marker) and fold one row back | auto | T01 | ✅ | Reviewed. Fix: empty `**Plan reviewed:**` read as reviewed=true → now not-reviewed, +test. 21 tests. |
| T03 | `decideDispatch` — spawn / review / merge / close | auto | T02 | ✅ | Reviewed clean. Crash-window gaps at review-ready + merge logged for T05/T06. |
| T04 | `analyzeParallelism` — critical path, width, auto/you counts | auto | T02 | ✅ | Reviewed clean. Critical path, width, auto/you counts correct; layer-width proxy honest; `errors` reports unknown deps + cycles. Pure. |
| T05 | Fake spawn/message/list/close + the coordinator loop | auto | T03 | ✅ | Reviewed clean; one fix (method outside T06's interface). 86 tests. |
| T06 | Feature branch + task worktree create / integrate / merge / promote | auto | T05 | ✅ | Reviewed. Fix: `remove` now `--force --force` (git refuses single `--force` on a locked worktree). 100 tests. |
| T07 | `pir-worker` contract skill + cross-session wiring | auto | T00 | ✅ | Reviewed clean. Wire format, same-repo `--cwd` guard, parseAgents, `text` field. 111 tests. |
| T08 | One real worker, one trivial task, seatbelted | auto | T06, T07 | ✅ | Reviewed. LIVE hand-verified ✅ 2026-09-09 (one real worker, ceiling held). 121 tests. |
| T09 | The `pir-coordinate` skill: dispatch, surface, supervise | auto | T08 | ✅ | Reviewed clean. Coordinator skill; fakes make real git commits. 134 tests. |
| T12 | Make the coordinator drivable live: six drill fixes | auto | T09 | ✅ | Reviewed clean. Six drill fixes (`liveAfter`, runaway grace, `canPromoteHere`, `ensureMain`, `teardownRun`, prose `kind:`). 145 tests. |
| T13 | Prove comms protocol: by-name addressing, idle-gated close | auto | T12 | ✅ | Reviewed clean. Idle gate reads `status`, only defers. 150 tests. Live half retired by T18. |
| T11 | `/pir-plan` + templates: `Runs` marker, honest deps, width report | auto | T04, T12 | ✅ | Reviewed clean. Planner Stage 6 + templates: Runs marker, honest deps, width report; golden tests. 153 tests. |
| T14 | Harness capture layer: flow, agent-status timeline, transcript bundle | auto | T09 | ✅ | Reviewed clean; read-only capture; seal reads real control/log + flow. 164 tests. |
| T15 | Harness assertions + scenario spec: declared facts over a bundle | auto | T14 | ✅ | Reviewed clean. 8 facts pure; loadTranscripts the only I/O. 195 tests. |
| T16 | Harness fixtures: scratch plans that force each path with real workers | auto | T15 | ✅ | Reviewed. Six fixtures; merge-conflict forced at ceiling 2; worker-raised surfaces logged. 230 tests. |
| T17 | Harness live runner (install→launch→capture→wait→seal→check) | auto | T14, T15, T16 | ✅ | Reviewed clean; runner build + two live fixes (`startupGrace`, live coordinator). 244 tests. |
| T18 | Live fixture: single (happy path; retires T13 live half) | you | T17 | ✅ | PASS live 2026-09-12: 4 facts green. Bundle `pir-t17-single-IbhBgo/…/2026-09-12T05-45-43-231Z`. |
| T24 | Harden coordinator/worker prompts from the T18 transcripts | auto | T18 | ✅ | Reviewed clean. Prose-only; two fixes (worktree dir `pir-{plan}-T{nn}`; C1 tag list + ISO prefix). |
| T19 | Live fixture: review-queue | you | T17, T24 | ✅ | PASS live 2026-09-13: 3 facts green, ceiling 2. Re-proven by T30. Bundle `pir-t17-review-queue-AqCRsF/…/2026-09-13T05-53-06-393Z`. |
| T25 | Cut the coordinator's relay overhead (worker→bin path) | auto | T19 | ✅ | Reviewed clean. Worker→coordinator up-channel is a file drop into `control/reports/`. Live proof in T20's run. |
| T26 | Harden coordinator/worker prompts from the T19 transcripts | auto | T25 | ✅ | Reviewed clean. C7–C10 + W5 added; S1-drop verified sound. 255 tests. |
| T27 | Harden coordinator from the T21 transcripts | auto | T21 | ✅ | Reviewed clean. `answer()` logs `answer {task}`; additive. 264 tests. |
| T20 | Live fixture: clean-merge | you | T17, T26 | ✅ | PASS live 2026-09-13: 3 facts green. `ceilingHeld` fixed to count slots by task (was counting OS roster). Bundle in FINDINGS. |
| T21 | Live fixture: human-decision | you | T17, T26 | ✅ | PASS live 2026-09-13: 2 facts green (question surfaced+answered). Bundle `…-human-decision-RVQcax/…/2026-09-13T15-24-34-685Z`. |
| T28 | Fix the merge-conflict path (Option 2): worker kept alive, resolves and merges clean | auto | T27 | ✅ | Reviewed clean; proven in loop.test on real git and live by T22. |
| T22 | Live fixture: merge-conflict | you | T17, T26, T28 | ✅ | PASS live 2026-09-14: conflict resolved on the worker's branch, `hello there` reached main. Proves T28. Bundle `pir-t17-merge-conflict-sQzl0k/…/2026-09-14T06-16-26-887Z`. |
| T29 | Fix the kill-switch capture: seal on `halt-close`, make the `hello` flow line honest | auto | T28 | ✅ | Reviewed clean. Seal on `halt-close`+grace (timeout backstop); `helloPerSpawn` flow-half strict. 271 tests. Fact retired by T30. |
| T23 | Live fixture: parallel + kill-switch drill (absorbs T10) | you | T17, T26, T29 | ✅ | PASS live 2026-09-14: 3 facts green. Ceiling 2, HALT→both SIGTERMed ~5s, nothing promoted, main untouched. Bundle `…/2026-09-14T07-45-27-010Z`. |
| T10 | Full multi-worker run + kill-switch drill — absorbed by T23 | you | T23 | ✅ | Closed with T23's PASS (2026-09-14): the full multi-worker + kill-switch drill is green. |
| T30 | Retire the `hello`; notice failed down-sends; pin the send contract | auto | T23 | ✅ | Reviewed clean; review-queue re-run PASS 2026-09-14 (`noHelloEver` green). |
| T31 | Teach the planner the build→verify split | auto | T30 | ✅ | Reviewed clean. Build→verify split taught in DESIGN §2.6/pir-plan/templates/goldens; fold mutation reddens 4/5 goldens. Executor-prose `you`-def gap logged (FINDINGS 2026-09-14, out of scope). |
| T32 | The hands-on fixture: an agent builds a program, a person runs it | auto | T17, T30 | ✅ | Reviewed clean. hands-on fixture; verifyWorkerSpawned/youNeverReviewed/scribeWroteFinding tests bite. 293 tests. Proven live by T33. |
| T33 | Live: drive the hands-on fixture and find its bottlenecks | you | T31, T32 | ✅ | PASS live 2026-09-15 (attended): 5 facts green. Bundle `pir-t17-hands-on-3nyF3G/…/2026-09-15T07-48-23-485Z`. |
| T34 | Coordinator announces the hands-on worker on dispatch | auto | T33 | ✅ | Prose-only `pir-coordinate`: coordinator announces the `{repo}·{plan}·T{nn}·verify` worker off the `hands-on Txx` line. Confirmed live 2026-09-15. |
| T35 | Harness: stop false-stalling in the worker gap while the coordinator is idle | auto | T33 | ✅ | `run.mjs` waitForCompletion counts a present non-`stopped` coordinator active. Regression test. Confirmed live 2026-09-15. |
| T36 | The blog-app fixture: a realistic multi-component app built in parallel | auto | T32, T34, T35 | ✅ | Reviewed clean. `reachedWidth(2)` by-task, implement-role, strict `busy`; tests bite all four ways. 310 tests. Live width + app-works half was T37. |
| T37 | Live: build the blog end-to-end, attended, and prove it runs | you | T36 | ✅ | PASS live 2026-09-16 (attended): 8 facts green, DB-backed blog promoted. Trio T02/T03/T04 overlapped, width hit full 3. Both check-ins folded without review. Reflection in FINDINGS. Bundle `pir-t17-blog-app-1YmLMq/…/2026-09-16T13-12-09-697Z`. |
| T38 | Full retrospective on the blog-app capstone run | auto | T37 | ⬜ | Analysis only. Reads the preserved T37 evidence at `~/pir-retro/blog-app-2026-09-16/` (capture + restorable git bundle of the scratch repo); answers 10 questions (delivery, e2e-really-ran, contract, review, integration, `you`-path, quality, no-fabrication, parallel payoff/cost, coordinator). Writes RETRO.md; surfaces fixes as future tasks. |

A Notes cell holds what was built or what the review found, the test count, and one line per
deviation from the task doc.

**A ✅ task's cell may be cut to one line** once the next task has been reviewed.

**Review queue:** empty. Next work is T38 (⬜, `auto`) — the retrospective.

## Phases 0–9 done; Phase 10 (T38 retrospective) is next

Phases 0–9 are complete. The `you`/hands-on path is proven live (T33) with its follow-on fixes confirmed
(T34, T35). Phase 9 delivered the capstone: a DB-backed blog built by parallel workers with two hands-on
check-ins — T37 PASSed live 2026-09-16 (8 facts, trio overlapped at full width 3, promoted to main).

Phase 10 is the retrospective the PM asked for: a PASS proves only what the harness checks, so T38 reads
the transcripts, flow log and built code to judge whether the method did what it was meant to, writing
RETRO.md beside the preserved evidence (`~/pir-retro/blog-app-2026-09-16/`) and turning each gap into a
proposed task, fixing nothing itself.

To re-run any fixture (needs real paid agents, launched attended), the procedure is in
[TEST-HARNESS.md](TEST-HARNESS.md). Housekeeping: a closed worker can linger as `stopped`
(`claude rm <id>`); scratch repos sit in a temp dir.
