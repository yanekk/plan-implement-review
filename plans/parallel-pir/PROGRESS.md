# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)** — read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose, no bold-per-clause, no aphorism. The
cell is an index for the next session; the account is the commit message. **Whoever writes a
cell also fixes the over-budget cell they walk past.**

**Plan reviewed:** 2026-09-07 — 4 fixed, 3 decided with the user

**Status:** Tasks T00–T33 ✅ (phases 0–8, every live fixture PASSed incl the `you`/hands-on path, T33
attended 2026-09-15). **T34 added 2026-09-15** to fix the bottleneck T33 found — the coordinator never
told the user a `you` task needed a person. **T34 fix is implemented** (prose-only in `pir-coordinate`,
`npm test` green); its live confirmation is the attended `hands-on` rerun, now handed to the PM. `Runs`
marks each task `auto` (a worker builds) or `you` (a person runs the live steps). Phases 5–8 postdate the
2026-09-07 plan review, so each was validated per task. Operator's guide: [TEST-HARNESS.md](TEST-HARNESS.md).
**Last updated:** 2026-09-15
**Next `pir-work` will:** wait on the PM's attended rerun that confirms **T34** (🔍). The rerun replaces
T34's fresh-eyes review (PM direction): on it the coordinator's OWN output must point the operator at the
`hands-on` worker, five T33 facts green, one promote. When the PM reports back, fold T34 → ✅ and log the
result in FINDINGS. Standing candidates, each its own future task, none blocking: T31 prose gap
(`pir-verify`/`pir-coordinate` still narrow; FINDINGS 2026-09-14); three T30-reflection candidates
(reviewer run the test once + capture exit; workers avoid `cat -A`/GNU-only flags on macOS → `xxd`/`Read`;
coordinator emit a final `promote confirmed`/teardown line); `role:foreign` capture bloat (~4MB); candidate
D (graceful mid-write drain) left out by the PM.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human. **Runs:** `auto` a worker builds it · `you` a person runs the
live steps with a hands-on worker the coordinator spawns, folded back without review (§2.6).

| # | Task | Runs | Depends on | State | Notes |
|---|---|---|---|---|---|
| T00 | Platform primitives spike: spawn, message, fresh review, close | you | — | ✅ | Spike verified by agent 2026-09-07: spawn/message/fresh-review/close confirmed. Corrections in FINDINGS (`--bg` positional; slash-free names). |
| T01 | Project scaffold, `npm test`, boundary test | auto | — | ✅ | Reviewed clean. Test command verified (exits, boundary bite, no ANSI under FORCE_COLOR); scanner matches §3.1's seven tokens, non-recursive. |
| T02 | Parse `PROGRESS.md` (with `Runs` marker) and fold one row back | auto | T01 | ✅ | Reviewed. Fixed: empty `**Plan reviewed:**` read as reviewed=true → now not-reviewed, with a test. 21 tests. |
| T03 | `decideDispatch` — spawn / review / merge / close | auto | T02 | ✅ | Reviewed clean, no fix. Crash-window gaps at review-ready and merge logged to FINDINGS for T05/T06. |
| T04 | `analyzeParallelism` — critical path, width, auto/you counts | auto | T02 | ✅ | Reviewed clean. Critical path, width, auto/you counts correct; layer-width proxy honest; `errors` reports unknown deps and cycles. Purity proven. |
| T05 | Fake spawn/message/list/close + the coordinator loop | auto | T03 | ✅ | Reviewed clean; one fix (loop called a method outside T06's interface). 86 tests. |
| T06 | Feature branch + task worktree create / integrate / merge / promote | auto | T05 | ✅ | Reviewed. One fix: `remove` now `--force --force` (git refuses single `--force` on a locked worktree). 100 tests. |
| T07 | `pir-worker` contract skill + cross-session wiring | auto | T00 | ✅ | Reviewed clean. Wire format, same-repo `--cwd` guard, parseAgents, `text` field. 111 tests. |
| T08 | One real worker, one trivial task, seatbelted | auto | T06, T07 | ✅ | Reviewed. LIVE hand-verified ✅ 2026-09-09 (one real worker, ceiling held). 121 tests. |
| T09 | The `pir-coordinate` skill: dispatch, surface, supervise | auto | T08 | ✅ | Reviewed clean. Coordinator skill (dispatch/surface/supervise); fakes make real git commits. 134 tests. |
| T12 | Make the coordinator drivable live: six drill fixes | auto | T09 | ✅ | Reviewed clean. Six drill fixes (`liveAfter`, runaway grace, `canPromoteHere`, `ensureMain`, `teardownRun`, prose `kind:`). 145 tests. |
| T13 | Prove comms protocol: by-name addressing, idle-gated close | auto | T12 | ✅ | Reviewed clean. Idle gate reads `status`, only defers. 150 tests. Live half retired by T18. |
| T11 | `/pir-plan` + templates: `Runs` marker, honest deps, width report | auto | T04, T12 | ✅ | Reviewed clean. Planner Stage 6 + templates carry the Runs marker, honest deps, width report; golden tests. 153 tests. |
| T14 | Harness capture layer: flow, agent-status timeline, transcript bundle | auto | T09 | ✅ | Reviewed clean; read-only capture, seal reads the real control/log and flow format. 164 tests. |
| T15 | Harness assertions + scenario spec: declared facts over a bundle | auto | T14 | ✅ | Reviewed clean. 8 facts pure; loadTranscripts the only I/O. 195 tests. |
| T16 | Harness fixtures: scratch plans that force each path with real workers | auto | T15 | ✅ | Reviewed. Six fixtures; merge-conflict forced at ceiling 2; worker-raised surfaces logged. 230 tests. |
| T17 | Harness live runner (install→launch→capture→wait→seal→check) | auto | T14, T15, T16 | ✅ | Reviewed clean; runner build half + two live fixes (`startupGrace`, live coordinator active). 244 tests. |
| T18 | Live fixture: single (happy path; retires T13 live half) | you | T17 | ✅ | PASS live 2026-09-12: all 4 facts green (hello, by-name, idle-gated close, one promote). Retires T13's live half. Bundle `pir-t17-single-IbhBgo/…/2026-09-12T05-45-43-231Z`. |
| T24 | Harden coordinator/worker prompts from the T18 transcripts | auto | T18 | ✅ | Reviewed clean. Prose-only; two prompt fixes (dashed worktree dir `pir-{plan}-T{nn}`; C1 tag list + ISO prefix). |
| T19 | Live fixture: review-queue | you | T17, T24 | ✅ | PASS live 2026-09-13: 3 facts green, ceiling 2, flow textbook. Re-proven by T30. Bundle `pir-t17-review-queue-AqCRsF/…/2026-09-13T05-53-06-393Z`. |
| T25 | Cut the coordinator's relay overhead (worker→bin path) | auto | T19 | ✅ | Reviewed clean. Worker→coordinator up-channel is a file drop into `control/reports/`. Live proof in T20's run. |
| T26 | Harden coordinator/worker prompts from the T19 transcripts | auto | T25 | ✅ | Reviewed clean. C7–C10 + W5 added; S1-drop verified sound. 255 tests. |
| T27 | Harden coordinator from the T21 transcripts | auto | T21 | ✅ | Reviewed clean. `answer()` logs `answer {task}`; additive tag. 264 tests. |
| T20 | Live fixture: clean-merge | you | T17, T26 | ✅ | PASS live 2026-09-13: 3 facts green. `ceilingHeld` fixed to count slots by task (was counting OS roster). Bundle in FINDINGS. |
| T21 | Live fixture: human-decision | you | T17, T26 | ✅ | PASS live 2026-09-13: 2 facts green (question surfaced+answered, one promote). Bundle `…-human-decision-RVQcax/…/2026-09-13T15-24-34-685Z`. |
| T28 | Fix the merge-conflict path (Option 2): worker kept alive, resolves and merges clean | auto | T27 | ✅ | Reviewed clean; proven in loop.test on real git and live by T22. |
| T22 | Live fixture: merge-conflict | you | T17, T26, T28 | ✅ | PASS live 2026-09-14: conflict resolved on the live worker's branch, `hello there` reached main, one promote. Proves T28. Bundle `pir-t17-merge-conflict-sQzl0k/…/2026-09-14T06-16-26-887Z`. |
| T29 | Fix the kill-switch capture: seal on `halt-close`, make the `hello` flow line honest | auto | T28 | ✅ | Reviewed clean. Seal on `halt-close`+grace (timeout backstop); `helloPerSpawn` flow-half strict, transcript-half exempt only under halt-close. 271 tests. (Fact retired by T30.) |
| T23 | Live fixture: parallel + kill-switch drill (absorbs T10) | you | T17, T26, T29 | ✅ | PASS live 2026-09-14: 3 facts green. Ceiling held 2/2, HALT→both SIGTERMed ~5s later, nothing promoted, main untouched. Bundle `…/2026-09-14T07-45-27-010Z`. |
| T10 | Full multi-worker run + kill-switch drill — absorbed by T23 | you | T23 | ✅ | Closed with T23's PASS (2026-09-14): the full multi-worker + kill-switch drill is green. |
| T30 | Retire the `hello`; notice failed down-sends; pin the send contract | auto | T23 | ✅ | Reviewed clean; review-queue re-run PASS 2026-09-14 (`noHelloEver` green). Bundle `…/2026-09-14T09-07-45-091Z`. |
| T31 | Teach the planner the build→verify split | auto | T30 | ✅ | Reviewed clean. Build→verify split taught in DESIGN §2.6/pir-plan/templates/goldens; fold mutation reddens 4/5 goldens. Executor-prose `you`-def gap logged (FINDINGS 2026-09-14, out of scope). |
| T32 | The hands-on fixture: an agent builds a program, a person runs it | auto | T17, T30 | ✅ | Reviewed clean. hands-on fixture (auto-build T01 + you-verify T02); verifyWorkerSpawned/youNeverReviewed/scribeWroteFinding tests bite; runner reads `seatbelts.timeoutMs`. 293 tests. Proven live by T33. |
| T33 | Live: drive the hands-on fixture and find its bottlenecks | you | T31, T32 | ✅ | PASS live 2026-09-15 (attended): 5 facts green, one promote, T02 verify-not-implement folded to merge with no review, scribe's ✅ row on main. Person drove the T02 worker directly (ran `node greet.mjs`, worker waited, did not self-run). Reflection finding: coordinator never pointed the PM at the hands-on worker (no `surface` for a `you` task) → fixed by T34. Bundle `pir-t17-hands-on-3nyF3G/…/2026-09-15T07-48-23-485Z`. Folds back without review. |
| T34 | Coordinator announces the hands-on worker on dispatch | auto | T33 | 🔍 | Fix implemented (prose-only, `pir-coordinate`): coordinator acts on the `hands-on Txx` flow line, announces the derived worker name `{repo}·{plan}·T{nn}·verify`, stops relying on the bin's stdout, and knows a `you` task never `surface`s; `hands-on` added to tag list + Monitor wake set. `npm test` green (297). No `src/` change — `loop.mjs:247` already emits `hands-on Txx`. Confirmation = attended `hands-on` rerun (handed to PM), in lieu of a code review: coordinator's own output must point the operator at the worker. Not yet run. |

A Notes cell holds what was built or what the review found, the test count, and one line per
deviation from the task doc.

**A ✅ task's cell may be cut to one line** once the next task has been reviewed.

**Review queue:** T34 (🔍) — its review is the attended `hands-on` rerun below, not a code-read (PM direction).

## Next up: confirm T34 with the attended rerun

Tasks T00–T33 are ✅ (phases 0–8, the `you`/hands-on path proven live 2026-09-15). T33's reflection found
one real bottleneck — the coordinator never pointed the PM at the hands-on worker — and the PM chose to fix
it as **T34**. That fix is implemented (prose-only in `pir-coordinate`, `npm test` green) and awaits its
live confirmation.

**T34 confirmation is an attended `hands-on` rerun** (it replaces T34's fresh-eyes review, PM direction):
`node src/shell/harness/run.mjs hands-on --into <dir>`, drive the T02 verify worker as in T33 — but this
time the **coordinator's own output** must tell you which worker to open, *before* you go looking, rather
than the runner's stdout cue being the only signal. Five T33 facts green + one promote. When it passes and
the coordinator's announcement is confirmed, fold T34 → ✅ and record it in FINDINGS.

**Other open hardening candidates** (each its own future task, none blocking, all with the PM): the T31
prose gap; three T30-reflection candidates; the `role:foreign` capture bloat. See the `Next pir-work will`
note above and FINDINGS.md.

To re-run any fixture (needs real paid agents, launched attended), the procedure is in
[TEST-HARNESS.md](TEST-HARNESS.md). Housekeeping: a closed worker can linger as `stopped`
(`claude rm <id>`); scratch repos sit in a temp dir.
