# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)** — read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose, no bold-per-clause, no aphorism. The
cell is an index for the next session; the account is the commit message. **Whoever writes a
cell also fixes the over-budget cell they walk past.**

**Plan reviewed:** 2026-09-07 — 4 fixed, 3 decided with the user

**Status:** ALL 33 TASKS ✅. Phases 0–8 complete; every live fixture PASSed, including the `you`/hands-on
path (T33, attended, 2026-09-15). The build→verify split is taught (T31) and both the fixture (T32) and its
live run (T33) are green. `Runs` marks each task `auto` (a worker builds) or `you` (a person runs the live
steps). Phases 5–8 postdate the 2026-09-07 plan review, so each was validated per task. Operator's guide:
[TEST-HARNESS.md](TEST-HARNESS.md).
**Last updated:** 2026-09-15
**Next `pir-work` will:** nothing — the plan is complete, no ⬜/🟡/🔍 tasks remain. Open hardening
candidates for the PM (each its own future task, none blocking): **T33** — coordinator must announce the
hands-on worker on dispatch (it never pointed the PM at it; FINDINGS 2026-09-15). Standing: the T31 finding
(`pir-verify`/`pir-coordinate` prose still narrow; FINDINGS 2026-09-14); three T30-reflection candidates
(reviewer run the test once + capture exit; workers avoid `cat -A`/GNU-only flags on macOS → `xxd`/`Read`;
coordinator emit a final `promote confirmed`/teardown line); capture copies `role:foreign` transcripts
(~4MB); candidate D (graceful mid-write drain) left out by the PM.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human. **Runs:** `auto` a worker builds it · `you` a person runs the
live steps with a hands-on worker the coordinator spawns, folded back without review (§2.6).

| # | Task | Runs | Depends on | State | Notes |
|---|---|---|---|---|---|
| T00 | Platform primitives spike: spawn, message, fresh review, close | you | — | ✅ | Spike verified by agent 2026-09-07: spawn/message/fresh-review/close confirmed. Corrections in FINDINGS (`--bg` positional; slash-free names). |
| T01 | Project scaffold, `npm test`, boundary test | auto | — | ✅ | Reviewed clean. Test command verified (exits, boundary bite, no ANSI under FORCE_COLOR); scanner matches §3.1's seven tokens, non-recursive. |
| T02 | Parse `PROGRESS.md` (with `Runs` marker) and fold one row back | auto | T01 | ✅ | Reviewed. Fixed: empty `**Plan reviewed:**` note read as reviewed=true → now not-reviewed, with a test. Parser probed on real PROGRESS.md; reconcile round-trips one line. 21 tests. |
| T03 | `decideDispatch` — spawn / review / merge / close | auto | T02 | ✅ | Reviewed clean, no fix. Crash-window gaps at review-ready and merge logged to FINDINGS for T05/T06. |
| T04 | `analyzeParallelism` — critical path, width, auto/you counts | auto | T02 | ✅ | Reviewed clean. Critical path, width and auto/you counts correct; layer-width proxy honest (a dep edge strictly raises depth); `errors` reports unknown deps and cycles. Purity proven. |
| T05 | Fake spawn/message/list/close + the coordinator loop | auto | T03 | ✅ | Reviewed clean after one fix (loop called a method outside T06's interface). Findings logged for T06/parser. 86 tests. |
| T06 | Feature branch + task worktree create / integrate / merge / promote | auto | T05 | ✅ | Reviewed clean after one fix: `remove` now `--force --force` (git refuses single `--force` on a locked worktree), confirmed on real git. 100 tests. |
| T07 | `pir-worker` contract skill + cross-session wiring | auto | T00 | ✅ | Reviewed clean. Wire format, same-repo `--cwd` guard, parseAgents, `text` field. resolveSameRepo also keeps the coordinator (inert; T09 drops self). 111 tests. |
| T08 | One real worker, one trivial task, seatbelted | auto | T06, T07 | ✅ | Reviewed clean. LIVE hand-verified ✅ 2026-09-09 (one real worker, ceiling held). Feature-worktree teardown deferred to T09/T10. 121 tests. |
| T09 | The `pir-coordinate` skill: dispatch, surface, supervise | auto | T08 | ✅ | Reviewed clean. Coordinator skill (dispatch/surface/supervise); fakes make real git commits. 134 tests. |
| T12 | Make the coordinator drivable live: six drill fixes | auto | T09 | ✅ | Reviewed clean. Six drill fixes (`liveAfter` self-filter, runaway grace, `canPromoteHere`, `ensureMain`, `teardownRun`, prose `kind:`). 145 tests. |
| T13 | Prove comms protocol: by-name addressing, idle-gated close | auto | T12 | ✅ | Reviewed clean. Hello via the real bridge; idle gate reads `status`, only defers. 150 tests. Live half retired by T18. |
| T11 | `/pir-plan` + templates: `Runs` marker, honest deps, width report | auto | T04, T12 | ✅ | Reviewed clean. Planner Stage 6 + templates carry the Runs marker, honest deps, width report; golden tests. 153 tests. |
| T14 | Harness capture layer: flow, agent-status timeline, transcript bundle | auto | T09 | ✅ | Reviewed clean; read-only capture, seal reads the real control/log and flow format. 164 tests. |
| T15 | Harness assertions + scenario spec: declared facts over a bundle | auto | T14 | ✅ | Reviewed clean. 8 facts pure; loadTranscripts the only I/O. 195 tests. |
| T16 | Harness fixtures: scratch plans that force each path with real workers | auto | T15 | ✅ | Reviewed. Six fixtures; merge-conflict forced at ceiling 2; loop records worker-raised surfaces to the flow log. 230 tests. |
| T17 | Harness live runner (install→launch→capture→wait→seal→check) | auto | T14, T15, T16 | ✅ | Reviewed clean; runner build half + two live fixes (`startupGrace`, live coordinator active). 244 tests. |
| T18 | Live fixture: single (happy path; retires T13 live half) | you | T17 | ✅ | PASS live 2026-09-12: all 4 facts green (hello, by-name, idle-gated close, one promote). Retires T13's live half. Bundle `pir-t17-single-IbhBgo/…/2026-09-12T05-45-43-231Z`. |
| T24 | Harden coordinator/worker prompts from the T18 transcripts | auto | T18 | ✅ | Reviewed clean. Prose-only; two prompt fixes (dashed worktree dir `pir-{plan}-T{nn}`; C1 tag list + ISO prefix). |
| T19 | Live fixture: review-queue | you | T17, T24 | ✅ | PASS live 2026-09-13: 3 facts green, ceiling 2, flow textbook. Re-proven by T30. Bundle `pir-t17-review-queue-AqCRsF/…/2026-09-13T05-53-06-393Z`. |
| T25 | Cut the coordinator's relay overhead (worker→bin path) | auto | T19 | ✅ | Reviewed clean. Worker→coordinator up-channel is a file drop into `control/reports/` (drained temp-then-rename). Live proof folded into T20's run. |
| T26 | Harden coordinator/worker prompts from the T19 transcripts | auto | T25 | ✅ | Reviewed clean, no fix. C7–C10 (pir-coordinate) + W5 (pir-worker) added; S1-drop verified sound (address-free file drop). 255 tests. |
| T27 | Harden coordinator from the T21 transcripts | auto | T21 | ✅ | Reviewed clean. `answer()` logs `answer {task}`; additive tag. 264 tests. |
| T20 | Live fixture: clean-merge | you | T17, T26 | ✅ | PASS live 2026-09-13: 3 facts green. First run false-FAILed `ceilingHeld` (counted OS roster); fixed to count slots by task. Bundle in FINDINGS. |
| T21 | Live fixture: human-decision | you | T17, T26 | ✅ | PASS live 2026-09-13 (re-run): 2 facts green (question surfaced+answered, one promote). Bundle `pir-t17-human-decision-RVQcax/…/2026-09-13T15-24-34-685Z`. |
| T28 | Fix the merge-conflict path (Option 2): worker kept alive, decision delivered, worker resolves and merges clean | auto | T27 | ✅ | Reviewed clean; proven in loop.test on real git and live by T22. |
| T22 | Live fixture: merge-conflict | you | T17, T26, T28 | ✅ | PASS live 2026-09-14: conflict surfaced, decision delivered to the live worker, resolved on its branch, decided `hello there` reached main, one promote. Proves T28 (Option 2) + coordinator wake-up fix. Bundle `pir-t17-merge-conflict-sQzl0k/…/2026-09-14T06-16-26-887Z`. |
| T29 | Fix the kill-switch capture: seal on `halt-close`, make the `hello` flow line honest | auto | T28 | ✅ | Reviewed clean. Seal on `halt-close`+grace (timeout backstop); `helloPerSpawn` flow-half strict, transcript-half exempt only under halt-close. 271 tests. (Fact retired by T30.) |
| T23 | Live fixture: parallel + kill-switch drill (absorbs T10) | you | T17, T26, T29 | ✅ | PASS live 2026-09-14 (re-run): 3 facts green. Ceiling held 2/2 (T03 waited), HALT→both workers SIGTERMed ~5s later, nothing promoted, main untouched. Bundle `…/2026-09-14T07-45-27-010Z`. |
| T10 | Full multi-worker run + kill-switch drill — absorbed by T23 | you | T23 | ✅ | Closed with T23's PASS (2026-09-14): the full multi-worker + kill-switch drill is green. |
| T30 | Retire the `hello`; notice failed down-sends; pin the send contract | auto | T23 | ✅ | Reviewed clean; live review-queue re-run PASS 2026-09-14 (`noHelloEver` green, one promote). Bundle `…/2026-09-14T09-07-45-091Z`. |
| T31 | Teach the planner the build→verify split | auto | T30 | ✅ | Reviewed clean. Build→verify split taught in DESIGN §2.6/pir-plan/templates/goldens; fold mutation reddens 4/5 goldens. Executor-prose `you`-def gap logged (FINDINGS 2026-09-14, out of scope). |
| T32 | The hands-on fixture: an agent builds a program, a person runs it | auto | T17, T30 | ✅ | Reviewed clean, no fix. New tests bite (verifyWorkerSpawned/youNeverReviewed/scribeWroteFinding, pass+fail). Probed the cross-module wiring: runner reads `seatbelts.timeoutMs` (25-min live), flow line ISO-prefixed so `parseHandsOnTask` fires, `merge T02` recorded so youNeverReviewed sees it, `finalContent` captured, scratch `node --test` finds greet.test.mjs. End-to-end is T33. 293 tests. |
| T33 | Live: drive the hands-on fixture and find its bottlenecks | you | T31, T32 | ✅ | PASS live 2026-09-15 (attended): 5 facts green, one promote, T02 verify-not-implement folded to merge with no review, scribe's ✅ row on main. Person drove the T02 worker directly (ran `node greet.mjs`, worker waited, did not self-run). Reflection finding: coordinator never pointed the PM at the hands-on worker (no `surface` for a `you` task) → candidate hardening task with the PM. Bundle `pir-t17-hands-on-3nyF3G/…/2026-09-15T07-48-23-485Z`. Folds back without review. |

A Notes cell holds what was built or what the review found, the test count, and one line per
deviation from the task doc.

**A ✅ task's cell may be cut to one line** once the next task has been reviewed.

**Review queue:** empty.

## The plan is complete — all 33 tasks ✅

Phases 0–8 are done. The last task, T33, PASSed live attended on 2026-09-15: the `you`/hands-on path is
proven end-to-end (a person ran the program in the worker's terminal, the scribe recorded a ✅ row, T02
folded to merge with no review, one promote). No ⬜/🟡/🔍 tasks remain, so `/pir-work` has nothing to
dispatch.

**Open hardening candidates** (each becomes its own future task, none blocking, all with the PM):
the T33 finding — the coordinator never pointed the PM at the hands-on worker (a `you` task emits no
`surface`, so the coordinator waited blind while the runner's stdout was the only cue); the T31 prose gap;
three T30-reflection candidates; the `role:foreign` capture bloat. See the `Next pir-work will` note above
and FINDINGS.md.

To re-run any fixture (needs real paid agents, launched attended), the procedure is in
[TEST-HARNESS.md](TEST-HARNESS.md). Housekeeping: a closed worker can linger as `stopped`
(`claude rm <id>`); scratch repos sit in a temp dir.
