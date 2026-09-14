# Progress

**Update this whenever a task changes state.** It is the handoff between sessions; a stale
tracker costs the next session more than keeping it current ever saves.

**What the build taught lives next door in [FINDINGS.md](FINDINGS.md)** — read the rows
touching the task you pick up, and append yours there.

**Sixty words to a Notes cell, counted.** Flat prose, no bold-per-clause, no aphorism. The
cell is an index for the next session; the account is the commit message. **Whoever writes a
cell also fixes the over-budget cell they walk past.**

**Plan reviewed:** 2026-09-07 — 4 fixed, 3 decided with the user

**Status:** Plan reviewed before build; re-scoped onto Claude Code's own primitives. `Runs` marks each
task `auto` (a worker builds) or `you` (a person runs the live steps). 28 tasks, phases 0–6. Phases 0–5
✅; `auto` hardening T24–T28 ✅. Phase 6 is the live fixtures (`you`, done at all-green). **T18–T22 PASS
live.** T22 (merge-conflict) PASSED 2026-09-14 after two fixes: T28 (Option 2, the wrong-side ship) and a
pir-coordinate wake-up fix (a buffering Monitor left the decision undelivered). Only **T23** (parallel +
kill-switch, absorbs T10) remains — a `you` live fixture a person runs with real paid agents.
Operator's guide: [TEST-HARNESS.md](TEST-HARNESS.md). Phases 5–6 postdate the 2026-09-07 review, so each
is validated per task during build.
**Last updated:** 2026-09-14
**Next `pir-work` will:** blocked on a PM decision. T23 (parallel + kill-switch) was RUN live 2026-09-14 and
FAILed — but on a harness seal race, not on behaviour: the kill switch worked (2 workers at ceiling 2, T03
waited, HALT→all closed, main untouched, nothing promoted). The runner seals the bundle the instant the HALT
flag appears, ~4s before the coordinator's `halt-close`, so the captured flow omits it and two facts fail
(FINDINGS 2026-09-14). A naive re-run FAILs identically; the seal must wait for `halt-close` first. That fix
is a new `auto` hardening task for the PM to add. Open notes: candidate 3 (SendMessage padding) unfixed by PM
choice; capture copies `role:foreign` transcripts (~4MB), not yet a task; the coordinator-name/hello
rationale prune is still owed (FINDINGS 2026-09-13).

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
| T19 | Live fixture: review-queue | you | T17, T24 | ✅ | PASS live 2026-09-13: all 3 facts green (hello-per-spawn, no-close-before-idle, one-merge-to-main). 3 tasks, ceiling 2, ~6 min, flow textbook. Bundle `pir-t17-review-queue-AqCRsF/…/2026-09-13T05-53-06-393Z`. See FINDINGS. |
| T25 | Cut the coordinator's relay overhead (worker→bin path) | auto | T19 | ✅ | Reviewed clean. Worker→coordinator up-channel is a file drop into `control/reports/` (drained temp-then-rename). Live proof folded into T20's run. |
| T26 | Harden coordinator/worker prompts from the T19 transcripts | auto | T25 | ✅ | Reviewed clean, no fix. C7–C10 (pir-coordinate) + W5 (pir-worker) added; S1-drop verified sound (address-free file drop). 255 tests. |
| T27 | Harden coordinator from the T21 transcripts | auto | T21 | ✅ | Reviewed clean. `answer()` logs `answer {task}`; additive tag. 264 tests. |
| T20 | Live fixture: clean-merge | you | T17, T26 | ✅ | PASS live 2026-09-13: 3 facts green. First run false-FAILed `ceilingHeld` (counted OS roster); fixed to count slots by task. Bundle in FINDINGS. |
| T21 | Live fixture: human-decision | you | T17, T26 | ✅ | PASS live 2026-09-13 (re-run): 2 facts green (question surfaced+answered, one promote). Ambiguity-ask path proven. First run false-FAILed on a runaway miscount; fixed `closedIds` no-prune (test), held live. 5 hardening candidates → PM. Bundle `pir-t17-human-decision-RVQcax/…/2026-09-13T15-24-34-685Z`. |
| T28 | Fix the merge-conflict path: keep the worker alive, deliver the decision, worker resolves and merges clean (Option 2) | auto | T27 | ✅ | Reviewed clean; one trivial fix (stale comment → `mergeConflictResolved`). Option 2 proven end-to-end in loop.test on real git: a conflict parks the worker (not closed/removed/deleted), the decision is delivered, the worker resolves, the decided side reaches main, one promote, no respawn. Fact fails on losing-side/respawn/unanswered bundles. 267 tests, boundary green. Live proof owed by T22. |
| T22 | Live fixture: merge-conflict | you | T17, T26, T28 | ✅ | PASS live 2026-09-14: conflict surfaced, decision delivered to the live worker, resolved on its branch, decided `hello there` reached main, one promote. Proves T28 (Option 2) + the coordinator wake-up fix. Two earlier failures fixed en route: wrong-side ship (T28) and a buffering-Monitor hang (pir-coordinate). Bundle `pir-t17-merge-conflict-sQzl0k/…/2026-09-14T06-16-26-887Z`. |
| T23 | Live fixture: parallel + kill-switch drill (absorbs T10) | you | T17, T26 | ⬜ | Ran live 2026-09-14: FAIL on a harness seal race, not behaviour. Kill switch worked — 2 workers at ceiling 2 (T03 waited), HALT→all closed, main untouched, nothing promoted. Runner seals on the HALT flag, ~4s before `halt-close`, so the bundle omits it (see FINDINGS). Needs the seal fixed (own task), then re-run. Bundle `…/2026-09-14T06-31-20-985Z`. |
| T10 | Full multi-worker run + kill-switch drill — absorbed by T23 | you | T23 | ⬜ | Absorbed by T23 (2026-09-12). Do not run standalone; closes ✅ when T23's parallel + kill-switch fact report is all-green. Partial drill 2026-09-10 proved spawn + first message. |

A Notes cell holds what was built or what the review found, the test count, and one line per
deviation from the task doc.

**A ✅ task's cell may be cut to one line** once the next task has been reviewed.

**Review queue:** empty. Every `auto` task is ✅ and T18–T22 PASS live. Only **T23** (parallel +
kill-switch, absorbs T10) remains — a `you` live fixture.

## Next up: the last live fixture (T23)

T22 (merge-conflict) PASSED live 2026-09-14, so the whole conflict path — surface, deliver the decision to
the still-alive worker, worker resolves on its own branch, merge clean, promote the decided side — is now
proven under real agents. T18–T22 are all green. Only T23 (parallel + kill-switch) is left, and it closes
T10.

Each fixture run needs real paid agents, launched attended, one at a time, never unattended, and ends
with a reflection pass on its bundle (DESIGN §4.1). Full procedure in
[TEST-HARNESS.md](TEST-HARNESS.md):

```
node src/shell/harness/run.mjs parallel --into <dir>   # T23, kill-switch drill, last
touch <dir>/plans/parallel/.parallel/control/HALT      # mid-run; done when its 3 facts pass
```

Each prints a fact-by-fact report and exits non-zero on any failed fact; record each run's verdict and
bundle path in FINDINGS with the date. A failed fact is a real finding — diagnose from the bundle, fix,
re-run. Housekeeping: a closed worker can linger as `stopped` (`claude rm <id>`); scratch repos sit in
a temp dir.
