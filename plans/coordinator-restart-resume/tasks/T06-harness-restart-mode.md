# T06 — Harness restart mode + restart fixture + facts

**Phase:** 3 · **Runs:** auto · **Depends on:** T03, T04 · **Weight:** medium

## Goal

Give the live harness the ability to drive a coordinator through a crash and a restart on the same
scratch repo, so the resume can be checked over real agents in T07. The runner today installs a fresh
fixture and launches one coordinator that runs to promote/halt/stall; a restart needs to launch, kill
the coordinator once a task has reached a built state, relaunch it **without reinstalling** the
fixture, and capture across both. This task builds that mechanism and the restart fixture and its
facts. The mechanism and the fact predicates are provable against the fakes; the live paid run itself
is T07.

## Design sections this implements

DESIGN §4 (the live drill is the one thing tests cannot prove), §5.2 (seatbelts), and the resume
behaviour of §2 that the drill exercises.

## Files

- `src/shell/harness/run.mjs` — a restart-capable run mode (install once, launch, wait-for-target,
  kill the coordinator, relaunch on the same scratch, capture across the restart).
- `src/shell/harness/fixtures/restart.mjs` (new) — the restart scenario/fixture.
- `src/shell/harness/fixtures.mjs` — register the new fixture.
- `src/shell/harness/assertions.mjs` — the restart facts (resumed-not-rebuilt, feeds-cleared).
- `src/shell/harness/run.test.mjs`, `assertions.test.mjs` — tests for the new orchestration and facts
  against the fakes (no live agent).

## Interface

```
// run.mjs restart mode — driven by the fixture's seatbelts/spec, not a new public API the person types
runScenario(restart):
  1. installFixture once → scratch repo with the plan.
  2. launch the coordinator (claude --bg -n <name> "/pir-coordinate {slug}"), seatbelted as today.
  3. wait until the target state is reached — a task branch has committed 🔍 (detectable from the
     flow log / a task-branch state read), the deterministic "mid-review" crash point.
  4. kill the coordinator session (SIGTERM its pid), leaving branches/worktrees on disk — a real crash.
  5. relaunch the coordinator on the SAME scratch (no installFixture), so it reconciles from git.
  6. capture spans both launches; seal the bundle; checkScenario.

// restart.mjs fixture: a plan with (at least) one auto task that reaches 🔍 before the kill, so
// the restart must adopt it. A two-task shape (T01 reaches ✅+merged, T02 is 🔍 at the kill) also
// exercises "do not rebuild the already-done task".

// facts (assertions.mjs), each a predicate over the captured bundle:
resumedNotRebuilt : after restart, the 🔍 task's original implement commit is preserved (same SHA)
                    and there is no second implement spawn / re-implement of it — it is reviewed/merged,
                    not rebuilt from the task doc.
feedsCleared      : the restart cleared the transient control feeds (no stale answer/outbox/surface
                    from before the kill is acted on after it).
noRebuildFromT01  : a task already ✅+merged before the kill is not rebuilt after it.
```

Non-obvious points, each with its reason:

- **Relaunch must not reinstall.** The whole point is that git on the scratch already holds the
  in-flight branches; reinstalling would wipe them and there would be nothing to resume. So the
  restart mode installs exactly once.
- **The kill point is deterministic — a committed `🔍`.** Killing before a build is committed would
  test rebuild-clean, not adoption; waiting for `🔍` on a task branch is the state the resume must
  adopt. Detect it from the flow log or a `taskBranchState` read (T02), not a timer.
- **Kill the coordinator, not the workers.** A crash is the coordinator dying; leaving worker
  branches/worktrees on disk is exactly the state reconciliation must handle.
- **The orchestration is what's tested here, headless.** The wait/kill/relaunch sequencing and the
  fact predicates are exercised against the fake platform/worktree so the mechanism is proven without
  spending a live agent; the live run is T07.

## Tests

- [ ] against the fakes: the restart mode installs once, reaches the `🔍` target, kills, relaunches on
      the same scratch, and produces a bundle spanning both launches.
- [ ] `resumedNotRebuilt` is true when the resumed run reviews/merges the existing `🔍` branch, and
      false when a run re-implements it (the fact actually distinguishes resume from rebuild).
- [ ] `noRebuildFromT01` is true when a pre-kill `✅`+merged task is left alone and false if it is
      rebuilt.
- [ ] `feedsCleared` is true when the transient feeds were empty of pre-kill entries after restart.
- [ ] the restart fixture is registered and loads through the normal fixture registry.
- [ ] `npm test` is green.

## Done when

- [ ] the harness can install once, launch, kill at a committed `🔍`, and relaunch on the same scratch,
      with capture spanning the restart.
- [ ] the `restart.mjs` fixture and its facts (`resumedNotRebuilt`, `noRebuildFromT01`, `feedsCleared`)
      exist and are exercised against the fakes.
- [ ] `npm test` is green; no live agent is spawned by this task (that is T07).
</content>
