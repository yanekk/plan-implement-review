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
- `src/shell/harness/run.mjs` / `scenario.mjs` (+ tests) — as needed for the reworked fixtures.

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

## Done when

- [ ] The harness carries no relay, hands-on, or `you` model; a parked-worker fixture and a
      kill-and-rebuild fixture pass.
- [ ] `npm test` is green.
