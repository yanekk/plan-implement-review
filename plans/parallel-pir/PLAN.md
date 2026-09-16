# Implementation plan

29 tasks in 7 phases (T12, T13 added 2026-09-10; T14–T17, the live-scenario test harness, added
2026-09-10; T18–T23, one live-run task per fixture, added 2026-09-12 by PM decision; T24, prompt
hardening from the T18 transcripts, added 2026-09-12; T25, the relay-transport redesign, and T26,
prompt hardening from the T19 transcripts, added 2026-09-13 by PM decision; T28, the merge-conflict
path fix, added 2026-09-13 by PM decision after the T22 run failed; T29, the kill-switch capture fix,
added 2026-09-14 by PM decision after the T23 run failed). Each has a file in
[tasks/](tasks/) with its goal, the files it touches, the interfaces it defines, and what "done" means.

**Phase 6 (T18–T23) splits the harness's live runs into one `you` task per fixture (2026-09-12).**
T17 stays the harness *runner* (the build half, reviewed clean); each fixture — single, review-queue,
clean-merge, human-decision, merge-conflict, parallel — is now its own task, done ✅ when its captured
fact report is all-green **and its reflection pass is logged** (DESIGN §4.1: every fixture ends by
analysing its bundle for friction and waste, feeding the next hardening task). The old T10 (full
multi-worker + kill-switch drill) is **absorbed by T23**
(the parallel fixture); T13's live half is **retired by T18** (the single fixture). The operator's
guide to running them is [TEST-HARNESS.md](TEST-HARNESS.md).

Track state in [PROGRESS.md](PROGRESS.md). Read [DESIGN.md](DESIGN.md) first — the architecture
leans on Claude Code's own primitives (background sessions, per-session worktrees, cross-session
messaging, stop/remove) and builds only the PIR-specific glue on top. Two later concerns are
folded in: a human-required (`you`) task runs on a hands-on worker the coordinator spawns and the
user drives, folded back without review (§2.6), and `/pir-plan` is taught to plan for parallelism
(§2.7).

---

## Shape of the build

- **The PIR decision core is built and proven with no live agents before anything real is
  spawned.** By the end of Phase 1 the decisions that are ours — which task is ready, who runs it
  (a worker or the user), how a finished task folds back, and how parallel a plan is — are
  implemented and unit-tested in milliseconds. Phase 3 wires them to real agents and merges.
- **The riskiest unknown goes first, as a spike.** T00 confirms on this machine that the platform
  primitives behave as the survey says. If any differs, the worker contract and the loop change.
- **A fake platform before the real one.** Phase 2 runs the whole loop against fakes and a scratch
  repo, so the wiring is proven before a paid agent or the real `main` is touched.
- **Recovery before the thing that keeps it alive.** The worktree create / merge / **close**
  plumbing (T06) is built before the first real spawn (T08), so a runaway or abandoned worker can
  always be torn down. The kill switch is wired into that first real spawn, not after it.
- **The dangerous thing small before full size.** The first real spawn is one worker on one
  trivial task (T08); the full multi-worker run with the kill-switch drill is last (T23, the
  parallel fixture, which absorbs the old T10).
- **The planner is taught last.** Teaching `/pir-plan` to plan for parallelism (T11) depends only
  on the width metric (T04) and is independent of the coordinator, so it slots in at the end.

```
Phase 0  ▸  T00              prove the platform primitives      throwaway, you-run
Phase 1  ▸  T01 … T04        the PIR decision core, headless     no agents
Phase 2  ▸  T05              a fake platform to rehearse in      no real agents
Phase 3  ▸  T06 … T09,T12,T13 real orchestration, small first    hand-verified
Phase 4  ▸  T11              teach /pir-plan to plan parallel     shared method
Phase 5  ▸  T14 … T17        the live-scenario test harness       data-driven, build half
Phase 6  ▸  T18 … T23        run the live scenarios, one per fixture   you-run, real agents
Phase 7  ▸  T30              post-completion hardening (retire hello)  from the live reflections
```

T10's full drill is absorbed by Phase 6 (T23, the parallel fixture), so Phase 3 now ends at T13.

---

## Phase 0 — Prove the ground

Nothing is designed on top of a platform behaviour that has not been checked on this machine.

| # | Task | Runs | Depends on |
|---|---|---|---|
| [T00](tasks/T00-platform-spike.md) | Platform primitives spike: spawn, message, fresh review, close | you | — |

**T00 gates the real-orchestration tasks (T07, T08) and the lifecycle in DESIGN §2.3.** Throwaway
code, deleted afterwards. It is a `you` task — a person runs it and records what they saw.

## Phase 1 — The PIR decision core (headless, no agents)

At the end of this phase the parts that are genuinely ours are decidable and proven with no
live agent.

| # | Task | Runs | Depends on |
|---|---|---|---|
| [T01](tasks/T01-scaffold-and-test-command.md) | Project scaffold, `npm test`, the boundary test | auto | — |
| [T02](tasks/T02-progress-core.md) | Parse `PROGRESS.md` (with the `Runs` marker) and fold one row back | auto | T01 |
| [T03](tasks/T03-dispatch-decision.md) | `decideDispatch` — spawn / review / merge / close | auto | T02 |
| [T04](tasks/T04-analyze-parallelism.md) | `analyzeParallelism` — critical path, width, auto/you counts | auto | T02 |

## Phase 2 — A fake platform to rehearse in

At the end of this phase the whole loop drains a fake plan to all-`✅` with no real agent.

| # | Task | Runs | Depends on |
|---|---|---|---|
| [T05](tasks/T05-fake-platform-and-loop.md) | Fake spawn/message/list/close + the coordinator loop | auto | T03 |

## Phase 3 — Real orchestration, small first

Each task here has a hand-verification half; the dangerous capability is built last.

| # | Task | Runs | Depends on |
|---|---|---|---|
| [T06](tasks/T06-worktree-lifecycle.md) | Feature branch + task worktree: create / integrate / merge / promote | auto | T05 |
| [T07](tasks/T07-worker-contract.md) | `pir-worker` contract skill + cross-session wiring | auto | T00 |
| [T08](tasks/T08-real-spawn-one-worker.md) | One real worker, one trivial task, seatbelted | auto | T06, T07 |
| [T09](tasks/T09-pir-coordinate-skill.md) | The `pir-coordinate` skill: dispatch, surface, supervise | auto | T08 |
| [T12](tasks/T12-coordinator-live-drivable.md) | Make the coordinator drivable live: six drill fixes | auto | T09 |
| [T13](tasks/T13-comms-protocol-proven.md) | Prove the comms protocol: by-name addressing, idle-gated close | auto | T12 |
| [T10](tasks/T10-full-parallel-run.md) | Full multi-worker run + kill-switch drill — **absorbed by T23** | you | T23 |

T12 was added after the T10 drill (2026-09-10) was stopped: the partial live run proved spawn and
first-message delivery but surfaced six shell-driver gaps that block a full run. It sits on the
critical path between T09 and T10; the drill account is in `FINDINGS.md` and the task doc.

T13 was added the same day (2026-09-10), after comparing the coordinator against the gastown
multi-agent system: the user chose to prove the worker↔coordinator communication protocol in its own
seatbelted task before the full drill. It settles two things T12 deferred — a worker reaching the
coordinator by name (not by return-socket luck), and the coordinator waiting for a worker to be idle
before closing it — and lands the DESIGN §2.2/§2.3/§2.8 changes those need.

T10 was folded into the live-scenario harness on 2026-09-10, when the user chose it to replace the
one-off manual drills (DESIGN §4.1, §7). On 2026-09-12 the harness's live runs were split into one task
per fixture (Phase 6), so T10's full multi-worker + kill-switch drill is now **T23** (the parallel
fixture), run with captured data rather than by eye; T10 no longer runs standalone and closes `✅` when
T23 passes (hence its dependency is now T23). T13's live half is retired by **T18** (the single
fixture), while T13's automated half stays reviewed and `✅`.

## Phase 4 — Teach the planner to plan for parallelism

| # | Task | Runs | Depends on |
|---|---|---|---|
| [T11](tasks/T11-teach-planner-parallelism.md) | `/pir-plan` + templates: the `Runs` marker, honest deps, width report | auto | T04, T12 |

T11 now also depends on T12: it teaches `/pir-plan` to emit parallel-ready plans, and that guidance
must reflect the worker/message contract T12 settles — do not teach the planner conventions the
machine is still changing.

## Phase 5 — The live-scenario test harness (data-driven, over real workers)

Turns the one-off manual drills into repeatable, data-driven runs (DESIGN §4.1). All four tasks are
`auto` and unit-tested with no live agent — the capture, assertion and fixture layers, and the runner
that ties them together. The live runs themselves are Phase 6.

| # | Task | Runs | Depends on |
|---|---|---|---|
| [T14](tasks/T14-harness-capture-layer.md) | Capture layer: flow log, agent-status timeline, transcript bundle | auto | T09 |
| [T15](tasks/T15-harness-assertions.md) | Assertion library + scenario spec: declared facts over a bundle | auto | T14 |
| [T16](tasks/T16-harness-fixtures.md) | Scenario fixtures: scratch plans that force each path with real workers | auto | T15 |
| [T17](tasks/T17-harness-live-runner.md) | Live runner: install → launch coordinator → capture → wait → seal → check | auto | T14, T15, T16 |

The capture rests on three sources confirmed on this machine 2026-09-10 (DESIGN §4.1): the
coordinator's existing flow log, a sampled `claude agents --json` status timeline (status is
live-only, so it is sampled during the run), and the on-disk transcripts under
`~/.claude/projects/…/<sessionId>.jsonl` (which survive a worker's kill and its worktree's removal).
T14 depends only on T09 (the coordinator exists) and is independent of T11, so Phase 4 and Phase 5
can proceed in either order.

## Phase 6 — Run the live scenarios (one `you` task per fixture)

Each fixture is run for real on paid `claude --bg` workers and is **done ✅ when its captured fact
report is all-green and its reflection pass is logged** (DESIGN §4.1, §5.2). All depend only on the
runner (T17); the operator works through them in the order below — small first, the kill-switch drill
last — and records each verdict, bundle path, and the reflection's findings in `FINDINGS.md`. After a
green report the session reflects on the bundle (flow log + transcripts) for friction and waste and
surfaces any hardening to the PM. The operator's guide is [TEST-HARNESS.md](TEST-HARNESS.md).

| # | Task | Runs | Depends on |
|---|---|---|---|
| [T18](tasks/T18-fixture-single.md) | Live fixture: single (happy path; retires T13's live half) | you | T17 |
| [T24](tasks/T24-harden-coordinator-worker-prompts.md) | Harden the coordinator/worker prompts from the T18 transcripts | auto | T18 |
| [T19](tasks/T19-fixture-review-queue.md) | Live fixture: review-queue (implement→review handoff) | you | T17, T24 |
| [T20](tasks/T20-fixture-clean-merge.md) | Live fixture: clean-merge (two files, serialized) | you | T17, T26 |
| [T21](tasks/T21-fixture-human-decision.md) | Live fixture: human-decision (question round-trips) | you | T17, T26 |
| [T22](tasks/T22-fixture-merge-conflict.md) | Live fixture: merge-conflict (surfaced, decided, resolved) | you | T17, T26, T28 |
| [T23](tasks/T23-fixture-parallel-killswitch.md) | Live fixture: parallel + kill-switch drill (absorbs T10) | you | T17, T26, T29 |
| [T25](tasks/T25-relay-transport-redesign.md) | Cut the coordinator's relay overhead in the worker→bin path | auto | T19 |
| [T26](tasks/T26-harden-from-review-queue-transcripts.md) | Harden the coordinator/worker prompts from the T19 transcripts | auto | T25 |
| [T27](tasks/T27-harden-from-human-decision-transcripts.md) | Harden the coordinator from the T21 transcripts (await-idle noise, AskUserQuestion, answer flow event, forward surfaced text) | auto | T21 |
| [T28](tasks/T28-fix-conflict-keep-worker.md) | Fix the merge-conflict path: keep the worker alive, deliver the decision, worker resolves and merges clean (Option 2) | auto | T27 |
| [T29](tasks/T29-fix-killswitch-capture.md) | Fix the kill-switch capture: seal on `halt-close`, make the `hello` flow line honest | auto | T28 |

**Three tasks harden the machinery before the remaining fixtures, and run in order.** T18's transcripts
drove T24 (`auto`, prose) before T19. T19's transcripts drive two more: **T25** cuts the coordinator's
manual relay overhead (~20–25% of the run; a real `src/shell` change, possibly a DESIGN §2.2 transport
rule change decided with the PM), and **T26** then updates `pir-coordinate`/`pir-worker` prose to match
the transport T25 lands. So the order is T19 → T25 → T26 → {T20–T23}: redesign first, prose second,
fixtures last on the final machinery (2026-09-13 PM decision, from the T19 analysis). They are listed
after T23 to keep numbering append-only; the dependencies, not the row order, set the sequence.

**T27 is a fourth hardening task, from the T21 transcripts** (2026-09-13 PM decision, candidates 1/2/4/5
of the T21 reflection): an `await-idle` Monitor filter so internal hand-off waits no longer wake the
coordinator into no-op turns; `AskUserQuestion` for a surfaced decision instead of a free-text turn;
an `answer {task}` flow-log event so the coordinator wakes to deliver a queued answer rather than
hand-polling; and forwarding the surfaced text rather than re-paraphrasing it. Prose in `pir-coordinate`
plus one `src/shell/coordinate.mjs` change (the flow event). It gates the remaining fixtures T22–T23.

**T28 is a fifth hardening task, and the first from a *failed* fixture** (2026-09-13 PM decision, after
the T22 merge-conflict run failed). The T22 run showed the coordinator-hit conflict path broken
end-to-end: it discarded the waiting worker, respawned a fresh one that ignored the human decision,
merged the wrong content, promoted it, and reported unverified success. The PM chose Option 2 — on a
conflict the coordinator **keeps the worker alive, delivers the decision, and the worker resolves on its
own branch and merges clean**, so the run still finishes hands-off. T28 is a real `src/` change
(dispatch.mjs, loop.mjs, coordinate.mjs), a new worker conflict-resolution path (`pir-worker`), the
no-unverified-success rule, and the redefined merge-conflict fact + scripted-decision fixture (the fact
now proves the decided side won, not that nothing merged). It **gates the T22 re-run**; T23 follows.

**T29 is a sixth hardening task, and the second from a *failed* fixture** (2026-09-14 PM decision, after
the T23 parallel + kill-switch run failed). The T23 run showed the kill switch itself working — two
workers concurrent at ceiling 2 with T03 waiting, HALT, every worker and the coordinator torn down,
`main` untouched, nothing promoted — but two facts went red on capture timing, not behaviour. The runner
seals the bundle on the bare presence of the HALT flag, ~4s before the coordinator writes its own
`halt-close`, so the captured flow omits it (`killSwitchStoppedAll` fails); and the `hello` flow line is
written when the bin queues the hello, before the coordinator session actually sends it, so an early HALT
leaves the flow-half and transcript-half of `helloPerSpawn` disagreeing. The PM chose to fix both (Option
B): seal on `halt-close` (timeout still the backstop), and close the hello queue-vs-send gap (approach a
sub-decision for the builder). It is a harness change (`run.mjs`, the assertion/fixture, possibly the
down-channel), and it **gates the T23 re-run**, which is the last live fixture.

They are launched attended, one at a time, never unattended — real paid agents (§5.2). A real model
may occasionally not hit a fixture's path on a given run, so a scenario may need a re-run; a failed
fact is a real finding (a framework bug or a fixture that does not force its path).

## Phase 7 — Post-completion hardening (from the live reflections)

Added after the plan's build was complete (all 29 tasks ✅), from the T23 reflection and the PM's
decision (2026-09-14). Not on the original critical path; it reopens the plan for one hardening task.

| # | Task | Runs | Depends on |
|---|---|---|---|
| [T30](tasks/T30-retire-hello-harden-down-channel.md) | Retire the `hello`; notice failed down-sends; pin the send contract | auto (+ a `you` live confirmation) | T23 |

**T30 bundles three T23-reflection findings the PM chose to fix together** (candidates A, C, E). It
retires the spawn `hello` — proven non-load-bearing by T23 (both hellos failed to send, yet the workers
built the right thing from the spawn prompt) and already stripped of its T13 return-channel rationale by
T25; makes the remaining answer down-send notice and surface a failed send instead of dropping it; and
pins the coordinator's SendMessage contract to `{to, message}`. It is a real `src/shell` + skills +
DESIGN change, fresh-reviewed as an `auto` task, then closed by an attended live re-run of the
review-queue fixture (`noHelloEver` green, still promotes, clean two-field sends). Candidate D (graceful
mid-write drain) was left out by the PM; candidate C's failed-send half is proven by a deterministic test,
since a live send failure cannot be forced on demand.

## Phase 8 — Coverage: hands-on verification (the `you` path)

Added after Phase 7 closed the plan, from a PM request (2026-09-14): no live fixture had ever exercised
a `you` task — the hands-on path where the coordinator spawns a `pir-verify` scribe worker the person
drives, which skips review and folds back (§2.6). It also surfaced a planning gap: the method folds
hand-verification into an `auto` task (the §2.5 question path) and never teaches the planner to **split**
a build and its hand-verification into a paired `auto`+`you` task. The PM chose to close both, attended.

| # | Task | Runs | Depends on |
|---|---|---|---|
| [T31](tasks/T31-teach-build-verify-split.md) | Teach the planner the build→verify split | auto | T30 |
| [T32](tasks/T32-hands-on-fixture.md) | The hands-on fixture: an agent builds a program, a person runs it | auto | T17, T30 |
| [T33](tasks/T33-hands-on-fixture-live.md) | Live: drive the hands-on fixture and find its bottlenecks | you | T31, T32 |
| [T34](tasks/T34-coordinator-announces-hands-on-worker.md) | Coordinator announces the hands-on worker on dispatch | auto | T33 |
| [T35](tasks/T35-runner-stall-idle-coordinator.md) | Harness: stop false-stalling in the worker gap while the coordinator is idle | auto | T33 |

**T31 teaches the pattern; T32 builds the rehearsal; T33 proves it live and finds the bottlenecks.** T31
adds the split to DESIGN §2.6 and `pir-plan` (an `auto` builder plus a dependent `you` verify task with a
"Needs a person" block, when a deliverable's check can only be a person running it), widens the `you`
definition, and locks it with golden planner tests. T32 adds the `hands-on` fixture (auto-build T01 + you-
verify T02) plus two new facts (`verifyWorkerSpawned`, `youNeverReviewed`), reuses `oneMergeToMain`/
`ceilingHeld`, and adds the attended runner support the `you` path needs (a durable "drive worker X"
signal and a roomier timeout) — because today the runner cannot drive a `you` task and would time out.
The unattended auto-drive channel is deliberately out of scope (attended-only, PM decision). T31 and T32
are siblings off T30 and can run at once; T33 (a `you` task itself) is the attended capstone.

**T34 fixes the bottleneck T33 found** (PM chose to fix it, 2026-09-15): the coordinator never told the
user a `you` task needed a person — it waited for a `surface` a `you` task never sends and ignored the
`hands-on Txx` flow line the bin already writes. T34 is a prose-only fix to `pir-coordinate` (act on
`hands-on Txx`, announce the derived worker name, stop relying on stdout). Confirmed by re-running T33's
attended fixture with the fix in place, in lieu of a fresh-eyes review (PM direction).

**T35 fixes a harness stall the T34 rerun exposed** (PM chose to fix it, 2026-09-15): the live runner's
stall detector counted the coordinator active only while `state !== 'done'`, but an idle coordinator
watching the flow log reports `state:'done'` for the whole run — so it false-stalled in the gap between a
worker closing and the next (slow cold-start) worker spawning, HALTing the hands-on rerun before T02. Fix
in `run.mjs`: treat a present, non-`stopped` coordinator as active; the wall-clock timeout still backstops a
true hang. Unit-proven; end-to-end confirmed by the same T34 rerun reaching the handoff. Product unaffected.

---

## Phase 9 — Coverage: a realistic multi-component fixture (the capstone)

Added after Phase 8 closed the plan, from a PM request (2026-09-15): every fixture so far forces one
narrow coordinator path with a trivial deliverable, so nothing yet proves the thing the plan exists to do
— build a real, multi-component program by fanning several workers out at once and folding a person's
verification in at the right moments. This phase is that end-to-end proof. The PM settled its shape:
a lean-but-real database-backed blog (a single seeded author, CRUD over posts), built as a walking
skeleton so three workers run concurrently, with two hands-on check-ins. Throwaway, like every fixture.

| # | Task | Runs | Depends on |
|---|---|---|---|
| [T36](tasks/T36-blog-app-fixture.md) | The blog-app fixture: a realistic multi-component app built in parallel | auto | T32, T34, T35 |
| [T37](tasks/T37-blog-app-fixture-live.md) | Live: build the blog end-to-end, attended, and prove it runs | you | T36 |

**T36 builds the fixture; T37 runs it live.** T36's scratch plan is seven units: T01 pins a shared
contract plus the pure core, schema/seed and runnable stubs; then T02 (docker glue), T03 (real backend)
and T04 (real frontend) build **concurrently** off T01, cleanly partitioned so their branches merge
without conflict; a `you` check-in confirms the app works; T06 adds the browser e2e; a second `you`
check-in is the final click-through. T36 also adds one new fact, `reachedWidth(n)`, because the existing
`ceilingHeld` only proves an upper bound on concurrency and nothing proved work actually ran in parallel
— the whole point of the plan. T36 is `auto` and fresh-reviewed; the app-actually-works half needs a
person and paid workers, so it is confirmed by T37. It depends on T32/T34/T35 because it reuses and
leans on the hands-on machinery (the verify scribe, the coordinator's hands-on announce, and the
runner that no longer stalls in the worker gap), and it needs both check-ins announced in one run.

**T37 is the attended capstone.** Docker Desktop up as a precondition, the two check-ins driven by hand,
the fact report green, and the mandatory reflection pass logged. `npm test` stays install-free throughout
(only the stdlib pure core is tested; the `pg` shell, the browser and the running stack are hand-verified),
so the app can carry runtime deps without breaking a green baseline — this is not a §5 violation, since §5
governs the coordinator's own portability, not the throwaway apps a fixture builds.

## Phase 10 — Retrospective on the capstone run (from the PM, 2026-09-16)

Added after T37 passed, from a PM request: the capstone proved the method reaches a green fact report,
but a PASS only proves the checks the harness knows to make. This phase reads the run's own record — the
transcripts, the flow log, and the actual code the workers built — and asks whether the method did what
it was supposed to, beyond the facts. The evidence was preserved out of git at
`~/pir-retro/blog-app-2026-09-16/` (curated capture + a git bundle of the whole scratch repo); the plan
carries only the pointer, not the bytes.

| # | Task | Runs | Depends on |
|---|---|---|---|
| [T38](tasks/T38-blog-app-retrospective.md) | Full retrospective on the blog-app capstone run | auto | T37 |

**T38 is analysis, not building.** It restores the preserved scratch repo from the git bundle and reads
the stored transcripts to answer, per task: did each unit deliver what its task doc asked; did the e2e
unit write a test that genuinely drives the running app and did the check-in actually execute it; did the
three parallel workers hold to T01's shared contract; did each review inspect rather than rubber-stamp;
did the branches integrate without hidden fixups and does the app cohere; are the `you` check-ins' scribe
rows a true record of what the operator did; is the blog itself correct or does it carry bugs the e2e
missed; did any worker assert evidence it did not produce; did running three-wide actually beat the serial
path and at what token cost; and where the coordinator wasted turns. It writes the verdict to
`~/pir-retro/blog-app-2026-09-16/RETRO.md` and surfaces each concrete improvement to the PM as its own
future task — it fixes nothing itself (scope). It is `auto` and fresh-reviewed like any analysis task;
independently re-running the blog to test it by hand, if wanted, is a separate `you` follow-up.

## Phase 11 — Narrow the hands-on check to judgement (from the PM, 2026-09-16)

Added from a PM request after reading the T38 retrospective. The capstone worked, but the retro found the
hands-on check asks the person to do mechanical chores that are not theirs — stand the stack up, install a
browser driver, run an automated test, tear the stack down — and that mislabelling produced both the run's
wasted ~4.5-minute wait (teardown was the person's job and went undone) and its one integrity blemish (an
automated test the person was asked to run, then an ambiguous "full pass" recorded as a manual click-
through). The PM's rule: the worker prepares and cleans up the environment and runs everything a machine
can decide; the person is there only to judge. This phase encodes that.

| # | Task | Runs | Depends on |
|---|---|---|---|
| [T39](tasks/T39-worker-owns-hands-on-environment.md) | The worker owns the hands-on environment: bring it up, hand off, tear it down | auto | T38 |
| [T40](tasks/T40-worker-runs-automated-checks-person-judges.md) | The worker runs the automated checks; the person only judges | auto | T39 |

**T39 moves setup/teardown onto the worker;** the person is handed a running thing to look at, and the
worker tears it down and confirms it is down before finishing — that guaranteed cleanup is the seatbelt
that lets a worker stand a live stack up, and it removes the T37 idle-gate stall at the root. **T40 moves
the automated test onto the worker** and reserves the person for the subjective click-through, recording
the machine result and the person's judgement as two separate confirmations and never rounding an
ambiguous reply up to the bigger claim. Both **revise DESIGN §2.6**, which today calls the hands-on worker
a pure scribe and has the person run the live commands; the sanction for that change lives in these task
docs. Both are `auto` (prose, fixture task docs, templates/goldens, and T39's coordinator waiting-signal /
idle-gate) and fresh-reviewed. That a real worker can actually stand up Docker, install the browser driver
and run the e2e, then tear it all down, is a live-only fact these tasks do not assert — one attended
re-run of the blog-app fixture under the new split proves both, and is a separate `you` follow-up the PM
can schedule when ready.

---

## Critical path

```
T01 → T02 → T03 → T05 → T06 → T08 → T09 → T12 → T13
                                        └─→ T14 → T15 → T16 → T17 → T18 → T24 → T19 → T25 → T26 → T27 → T28 → {T22 re-run} → T29 → {T23 re-run}  (T20/T21 done off T26; T18 retires T13 live, T23 closes T10; T24/T26/T27 harden prompts, T25 relay redesign, T28 fixes the conflict path and gates the T22 re-run, T29 fixes the kill-switch capture and gates the T23 re-run)
```

T00 is off this line but gates T07 and T08. T04 (the width metric) is a side branch off T02 and can
slot in wherever convenient. T11 (teaching the planner) is off T04 but now also waits on T12, so it
lands after the coordinator contract is fixed. T07 (worker contract) depends only on the spike. T13
proved the comms protocol against the fakes; its live confirmation, and T10's full drill, now land in
the Phase 6 fixture runs (T18, T23). T14–T17 are `auto` and need no live agent — they build and prove
the harness itself — so the critical live work is concentrated in the Phase 6 `you` tasks (T18–T23),
each one fixture run for real.

## Rough sizing

Not hours — a relative sense of where the weight is.

| Weight | Tasks |
|---|---|
| **Heavy** | T08 (first real spawn + messaging + review), T09 (coordinator skill), T23 (parallel + kill-switch drill, absorbs T10), T25 (relay transport redesign), T28 (conflict path fix: loop + dispatch + worker resolution + fixture) |
| **Medium** | T00 (spike), T05 (fake platform + loop), T06 (worktree plumbing), T11 (teach the shared planner), T12 (six drill fixes), T13 (prove the comms protocol), T14 (capture layer), T15 (assertion library), T16 (scenario fixtures), T17 (live runner), T21 (human-decision run), T24 (prompt hardening from the T18 transcripts), T26 (prompt hardening from the T19 transcripts), T29 (kill-switch capture fix from the T23 run) |
| **Light** | T01 (scaffold), T02 (progress core), T03 (dispatch), T04 (parallelism metric), T07 (worker contract), T18–T20, T22 (single, review-queue, clean-merge, merge-conflict runs) |

Where this will overrun: T08, because live CLI and messaging behaviour rarely matches the docs on
the first try, and the T00 spike is what de-risks it; and the Phase 6 runs (especially T23's
kill-switch drill on real workers), because a live run is what surfaces the last unhandled state, and
a real model may not hit a fixture's path on the first run. T16's fixtures are the lever there — the
more deterministic they are, the fewer re-runs Phase 6 needs. The first two Phase 6 runs already paid
this: they surfaced a missing `src/` in the scratch and a promote-before-stall race in the runner.

## Decisions still open

Nothing blocks the build. The worker ceiling of 4 is a settled, tunable constant. The platform
primitives are confirmed by the survey (FINDINGS.md) and re-confirmed on this version by T00
before T08 needs them. The exact width metric `analyzeParallelism` reports (widest topological
layer) is settled in its task doc.
