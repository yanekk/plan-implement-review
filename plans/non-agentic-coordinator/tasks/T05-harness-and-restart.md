# T05 — harness-and-restart

**Phase:** 3 · **Runs:** auto · **Depends on:** T04 · **Weight:** medium

## Goal

Bring the live-scenario test harness in line with the new model and prove the property the design
rests on: a run is safe to kill and re-run. The old harness encodes the relay round-trip (a worker's
question surfaced up, an answer routed down) and the hands-on/`you` flow; both are gone. What
replaces the question round-trip is a parked worker that holds its slot while every independent task
keeps moving, with no answer routed by the program. And the restart path — Ctrl-C kills the workers,
a re-run reaps whatever is left and rebuilds from committed branch state — gets a fixture that drives
it end to end over the fakes.

## Design sections this implements

DESIGN §2.6 (kill-and-rebuild) and §2.8 (a parked worker holds its slot; the run throttles to human
speed). Also §4 (the harness layer).

## Files

- `src/core/naming.mjs` (+ `naming.test.mjs`) — now that no caller remains, remove the `verify` role
  from `WORKER_ROLES` and delete `coordinatorName`, and drop the T02 transition tolerance so a worker
  name is strictly the 5-field `/` form (deferred here from T02 because the harness was the last caller).
- `src/shell/harness/capture.mjs` (+ `capture.test.mjs`) — stop calling `coordinatorName` (the run has
  no coordinator session/name); identify the run's own log lines without it. This file was in no task's
  scope before; it is picked up here because it is the last `coordinatorName` caller.
- `src/shell/harness/run.mjs` — remove its several `coordinatorName` call sites; the run has no
  coordinator name.
- `src/shell/harness/fixtures/hands-on.mjs` — delete (the `you` flow is gone).
- `src/shell/harness/fixtures/human-decision.mjs` — rework from a surface→answer→route round-trip to
  a parked worker that holds a slot while other tasks proceed and the program routes nothing.
- `src/shell/harness/fixtures/restart.mjs` — cover Ctrl-C (or the harness's crash injection) →
  reap → rebuild from committed state, reaching all-`✅`.
- `src/shell/harness/assertions.mjs` (+ `assertions.test.mjs`) — remove `verifyWorkerSpawned`,
  `youNeverReviewed`, `scribeWroteFinding`, and any `send-failed`/down-channel assertion; add or keep
  a parked-worker-holds-slot assertion and a rebuilt-from-committed-state assertion.
- `src/shell/harness/fixtures/common.mjs` — remove the `needsPerson`/environment-block rendering that
  only served `you` tasks.
- `src/shell/harness/scenario.mjs` (+ tests) — as needed for the reworked fixtures (`run.mjs` is
  covered above). The other fixtures and the fake platform/worktree may keep unused helper methods
  (`promote`, the down-channel `send`, a `verify` shape); leaving an unused double method is fine, but
  nothing may still call the removed vocabulary.

## Interface

No new production interface. The deliverable is fixtures and assertions expressed against the
existing harness (`createFakePlatform`, the scenario runner). Keep the fake platform's interface
unchanged; only the scenarios and assertions change.

## Tests

- [ ] A parked-worker scenario: a worker reports a `question`, the program keeps its slot, every
      independent task still spawns/reviews/merges, and the program routes no answer (no down-send).
- [ ] A kill-and-rebuild scenario: a run is interrupted mid-flight, a re-run reaps the leftover
      sessions and reconciles each task branch by its committed glyph (merge `✅`, review `🔍`,
      rebuild half-built), and reaches all-`✅`.
- [ ] The removed assertions and fixtures are gone and nothing references them.
- [ ] The reworked assertions are non-vacuous (they fail when the behaviour is broken).
- [ ] `naming.mjs`: `WORKER_ROLES` has no `verify`; `coordinatorName` is gone; `parseAgentName`
      requires the 5-field `/` form. `capture.mjs` and `run.mjs` no longer import or call
      `coordinatorName`.

## Done when

- [ ] The harness carries no relay, hands-on, or `you` model; a parked-worker fixture and a
      kill-and-rebuild fixture pass.
- [ ] The `verify` role and `coordinatorName` are removed from `naming.mjs`, and `capture.mjs`/`run.mjs`
      no longer call `coordinatorName`. A global grep over `src/` finds no still-in-use
      `verify`-role / `coordinatorName` / down-channel / relay / `you`-model reference; an unused helper
      method left on a fake double is allowed, but nothing calls it.
- [ ] `npm test` is green.
