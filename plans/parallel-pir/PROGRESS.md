# Progress

**Update this whenever a task changes state — it is the handoff between sessions.** What the
build taught lives next door in [FINDINGS.md](FINDINGS.md); read the rows touching the task you
pick up, append yours there.

**Sixty words to a Notes cell, counted.** Flat prose, no bold-per-clause. The cell is an index;
the account is the commit message. Whoever writes a cell also fixes the over-budget cell they
walk past.

**Plan reviewed:** 2026-09-07 — 4 fixed, 3 decided with the user

**Status:** T00–T41 ✅ — every planned task built and reviewed. Phase 10: T38 retrospective — method works, one
blemish (T07 scribe over-claim), 9 candidates (RETRO out of git at `~/pir-retro/blog-app-2026-09-16/`).
Phase 11: T39 + T40 narrowed the hands-on check to judgement — worker owns setup/teardown AND runs the
automated checks, person only judges. Phase 12 (PM, 2026-09-16): T41 — the coordinator runs `claude rm` on a
worker as soon as it finishes, so its `stopped` record leaves the "Claude agents" view; HALT is the exception
(record kept for forensics). Phases 5–12 postdate the 2026-09-07 plan review, validated through
implement→review alternation. `Runs` marks `auto`/`you`. Operator's guide: [TEST-HARNESS.md](TEST-HARNESS.md).
**Last updated:** 2026-09-16
**Next `pir-work` will:** nothing — no auto task remains, T00–T41 are all ✅. The only outstanding work is an
attended `you` re-run (real paid agents, §5.2, [TEST-HARNESS.md](TEST-HARNESS.md)) proving T39/T40/T41 live:
the `claude rm` spike (does it delete the `.jsonl`, so is T41's eager-copy even needed?), the finished-worker
view-clearing, and that a HALT-killed worker's record stays. Record all three in FINDINGS.md with the date.
**Open hardening candidates** (each its own future task, none blocking): T31 prose gap
(`pir-verify`/`pir-coordinate` narrow); three T30-reflection candidates (reviewer run the test once + capture
exit; workers avoid `cat -A`/GNU-only flags on macOS → `xxd`/`Read`; coordinator emit a final `promote
confirmed`/teardown line); promote-flush capture gap (final message seals out of the bundle, RETRO cand. 8);
`role:foreign` capture bloat (~4MB); candidate D (graceful mid-write drain).

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human. **Runs:** `auto` a worker builds it · `you` a person runs the
live steps with a hands-on worker the coordinator spawns, folded back without review (§2.6).

| # | Task | Runs | Depends on | State | Notes |
|---|---|---|---|---|---|
| T00 | Platform primitives spike: spawn, message, fresh review, close | you | — | ✅ | Spike verified 2026-09-07: spawn/message/fresh-review/close confirmed (corrections in FINDINGS). |
| T01 | Project scaffold, `npm test`, boundary test | auto | — | ✅ | Reviewed clean. Test command verified (exits, boundary bite, no ANSI); scanner matches §3.1's seven tokens, non-recursive. |
| T02 | Parse `PROGRESS.md` (with `Runs` marker) and fold one row back | auto | T01 | ✅ | Reviewed. Fix: empty `**Plan reviewed:**` no longer read as reviewed=true, +test. 21 tests. |
| T03 | `decideDispatch` — spawn / review / merge / close | auto | T02 | ✅ | Reviewed clean. Crash-window gaps at review-ready + merge logged for T05/T06. |
| T04 | `analyzeParallelism` — critical path, width, auto/you counts | auto | T02 | ✅ | Reviewed clean. Critical path/width/auto-you counts; `errors` on unknown deps + cycles. Pure. |
| T05 | Fake spawn/message/list/close + the coordinator loop | auto | T03 | ✅ | Reviewed clean; one fix (method outside T06's interface). |
| T06 | Feature branch + task worktree create / integrate / merge / promote | auto | T05 | ✅ | Reviewed. Fix: `remove` now `--force --force` (locked worktree needs double `--force`). 100 tests. |
| T07 | `pir-worker` contract skill + cross-session wiring | auto | T00 | ✅ | Reviewed clean. Wire format, same-repo `--cwd` guard, parseAgents, `text` field. |
| T08 | One real worker, one trivial task, seatbelted | auto | T06, T07 | ✅ | Reviewed. LIVE hand-verified ✅ 2026-09-09 (one real worker, ceiling held). |
| T09 | The `pir-coordinate` skill: dispatch, surface, supervise | auto | T08 | ✅ | Reviewed clean. Coordinator skill; fakes make real git commits. |
| T12 | Make the coordinator drivable live: six drill fixes | auto | T09 | ✅ | Reviewed clean. Six drill fixes (`liveAfter`, runaway grace, `canPromoteHere`, `ensureMain`, `teardownRun`, prose `kind:`). |
| T13 | Prove comms protocol: by-name addressing, idle-gated close | auto | T12 | ✅ | Reviewed clean. Idle gate reads `status`, only defers. Live half retired by T18. |
| T11 | `/pir-plan` + templates: `Runs` marker, honest deps, width report | auto | T04, T12 | ✅ | Reviewed clean. Planner Stage 6 + templates deliver the three; golden tests bite. |
| T14 | Harness capture layer: flow, agent-status timeline, transcript bundle | auto | T09 | ✅ | Reviewed clean; read-only capture; seal reads real control/log. |
| T15 | Harness assertions + scenario spec: declared facts over a bundle | auto | T14 | ✅ | Reviewed clean. 8 facts pure; loadTranscripts the only I/O. |
| T16 | Harness fixtures: scratch plans that force each path with real workers | auto | T15 | ✅ | Reviewed. Six fixtures; merge-conflict forced at ceiling 2. |
| T17 | Harness live runner (install→launch→capture→wait→seal→check) | auto | T14, T15, T16 | ✅ | Reviewed clean; runner build + two live fixes (`startupGrace`, live coordinator). |
| T18 | Live fixture: single (happy path; retires T13 live half) | you | T17 | ✅ | PASS live 2026-09-12: 4 facts green. Bundle `pir-t17-single-IbhBgo/…/2026-09-12T05-45-43-231Z`. |
| T24 | Harden coordinator/worker prompts from the T18 transcripts | auto | T18 | ✅ | Reviewed clean. Fixes: worktree dir `pir-{plan}-T{nn}`; C1 tag list + ISO prefix. |
| T19 | Live fixture: review-queue | you | T17, T24 | ✅ | PASS live 2026-09-13: 3 facts green, ceiling 2. Bundle `pir-t17-review-queue-AqCRsF/…/2026-09-13T05-53-06-393Z`. |
| T25 | Cut the coordinator's relay overhead (worker→bin path) | auto | T19 | ✅ | Reviewed clean. Worker→coordinator up-channel is a file drop into `control/reports/`. Live proof in T20. |
| T26 | Harden coordinator/worker prompts from the T19 transcripts | auto | T25 | ✅ | Reviewed clean. C7–C10 + W5 added; S1-drop verified sound. |
| T27 | Harden coordinator from the T21 transcripts | auto | T21 | ✅ | Reviewed clean. `answer()` logs `answer {task}`; additive. |
| T20 | Live fixture: clean-merge | you | T17, T26 | ✅ | PASS live 2026-09-13: 3 facts green. `ceilingHeld` fixed to count slots by task, not OS roster. Bundle in FINDINGS. |
| T21 | Live fixture: human-decision | you | T17, T26 | ✅ | PASS live 2026-09-13: 2 facts green (question surfaced+answered). Bundle `…-human-decision-RVQcax/…/2026-09-13T15-24-34-685Z`. |
| T28 | Fix the merge-conflict path (Option 2): worker kept alive, resolves and merges clean | auto | T27 | ✅ | Reviewed clean; proven in loop.test on real git and live by T22. |
| T22 | Live fixture: merge-conflict | you | T17, T26, T28 | ✅ | PASS live 2026-09-14: conflict resolved on the worker's branch, `hello there` reached main. Bundle `pir-t17-merge-conflict-sQzl0k/…/2026-09-14T06-16-26-887Z`. |
| T29 | Fix the kill-switch capture: seal on `halt-close`, make the `hello` flow line honest | auto | T28 | ✅ | Reviewed clean. Seal on `halt-close`+grace; `helloPerSpawn` flow-half strict. Fact retired by T30. |
| T23 | Live fixture: parallel + kill-switch drill (absorbs T10) | you | T17, T26, T29 | ✅ | PASS live 2026-09-14: 3 facts green. Ceiling 2, HALT→both SIGTERMed ~5s, nothing promoted, main untouched. Bundle `…/2026-09-14T07-45-27-010Z`. |
| T10 | Full multi-worker run + kill-switch drill — absorbed by T23 | you | T23 | ✅ | Closed with T23's PASS (2026-09-14): the full multi-worker + kill-switch drill is green. |
| T30 | Retire the `hello`; notice failed down-sends; pin the send contract | auto | T23 | ✅ | Reviewed clean; review-queue re-run PASS 2026-09-14 (`noHelloEver` green). |
| T31 | Teach the planner the build→verify split | auto | T30 | ✅ | Reviewed clean. Build→verify split taught in DESIGN §2.6/pir-plan/templates/goldens; fold mutation reddens goldens. |
| T32 | The hands-on fixture: an agent builds a program, a person runs it | auto | T17, T30 | ✅ | Reviewed clean. hands-on fixture; verifyWorkerSpawned/youNeverReviewed/scribeWroteFinding tests bite. |
| T33 | Live: drive the hands-on fixture and find its bottlenecks | you | T31, T32 | ✅ | PASS live 2026-09-15 (attended): 5 facts green. Bundle `pir-t17-hands-on-3nyF3G/…/2026-09-15T07-48-23-485Z`. |
| T34 | Coordinator announces the hands-on worker on dispatch | auto | T33 | ✅ | Prose-only: coordinator announces the `{repo}·{plan}·T{nn}·verify` worker off the `hands-on Txx` line. Confirmed live 2026-09-15. |
| T35 | Harness: stop false-stalling in the worker gap while the coordinator is idle | auto | T33 | ✅ | `run.mjs` waitForCompletion counts a present non-`stopped` coordinator active. Confirmed live 2026-09-15. |
| T36 | The blog-app fixture: a realistic multi-component app built in parallel | auto | T32, T34, T35 | ✅ | Reviewed clean. `reachedWidth(2)` by-task, implement-role, strict `busy`; tests bite all four ways. 310 tests. |
| T37 | Live: build the blog end-to-end, attended, and prove it runs | you | T36 | ✅ | PASS live 2026-09-16 (attended): 8 facts, DB-backed blog promoted, width hit 3. Bundle `pir-t17-blog-app-1YmLMq/…/2026-09-16T13-12-09-697Z`. |
| T38 | Full retrospective on the blog-app capstone run | auto | T37 | ✅ | Reviewed clean, no fix. RETRO's load-bearing claims spot-checked against the bundle and hold; T07 scribe over-claim confirmed. 9 candidates not fixed. |
| T39 | The worker owns the hands-on environment: bring it up, hand off, tear it down | auto | T38 | ✅ | Reviewed, one fix (stale step reference in pir-verify). Worker owns bring-up/teardown, person judges; tests bite. Idle-gate clearing deferred to a `you` re-run. |
| T40 | The worker runs the automated checks; the person only judges | auto | T39 | ✅ | Reviewed clean. Worker runs the automated checks, person only judges; both new goldens bite. Live proof deferred to a `you` re-run. |
| T41 | Clear a finished worker from the "Claude agents" view (`claude rm`) | auto | T14, T29 | ✅ | Reviewed clean, no fix. All four Done-when hold: remove rides close on every normal finish (merged/dead/review-handoff/teardownRun) on the same id close uses, never on halt-close; eager-copy fallback keeps a mid-run-removed transcript. Probed the busy path (not removed until idle); mutation-confirmed the HALT test bites. Live spike/view-clearing stay a `you` re-run. |

A Notes cell holds what was built or what the review found, the test count, and one line per deviation.
**A ✅ task's cell may be cut to one line** once the next task has been reviewed.

**Review queue:** empty — every task reviewed.

## Phases 0–12 done

Phases 0–9 complete; the `you`/hands-on path is proven live (T33–T35). Phase 9 capstone: T37 PASSed live
2026-09-16 (DB-backed blog, parallel workers, 8 facts, width 3). Phase 10 (T38): retrospective, method
working, one blemish (T07 scribe over-claim), 9 candidates; RETRO.md at `~/pir-retro/blog-app-2026-09-16/`.
Phase 11 (T39, T40): the worker owns the hands-on environment and runs the automated checks, person judges.
Phase 12 (T41): the coordinator clears a finished worker from the "Claude agents" view with `claude rm`,
reviewed clean 2026-09-16. Outstanding: an attended `you` re-run proves T39/T40/T41 live.

Re-running a fixture (real paid agents, attended) is in [TEST-HARNESS.md](TEST-HARNESS.md). Housekeeping: the
coordinator now clears a finished worker's `stopped` record itself (T41); only a HALT-killed worker or a
killed coordinator leaves one to `claude rm <id>` by hand. Scratch repos sit in a temp dir.
