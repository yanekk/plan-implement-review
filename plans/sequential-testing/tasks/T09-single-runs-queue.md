# T09 — single-runs-queue

**Phase:** 2 · **Depends on:** T01, T02, T04 · **Weight:** medium

## Goal

Put every suite a single run starts (its test runs, its baseline, and any added by the
`single-finisher` plan) into the machine-wide queue, with the time limit and the kill, and show the
queued state on its row and steps view. The single run's own round rules stay as they are.

## Design sections this implements

DESIGN §2.6, §2.7, §2.11, §2.8 (single rows).

## Files

- `src/shell/single-run.mjs`, `src/shell/single-run.test.mjs`
- `src/core/plandisplay.mjs`, `src/core/plandisplay.test.mjs` (the steps view's step text)
- `src/core/dashboard.mjs` or `src/shell/pir-tui.mjs` where the single row's `● testing` is chosen, and its test

## Interface

- `startRun` (and the baseline start) use T04's `startQueuedLines` with `meta.kind 'single'` or
  `'baseline'` and `limitMs` from T01's `effectiveTimeout`, read at the run's start and stored in
  `state.json` beside the commands. `command.json` keeps recording the running command for resume.
- A timed-out or killed result reaches `decideSingleStep` as a red with T02's `failureReason` text as its
  reason, so it is a red round under the single run's rules.
- The snapshot's step gains `queued: { position } | null`; while queued the phase is `testing` with
  `queued` set. The steps view reads `waiting for tests · {nth} in queue`; the dashboard row reads
  `● waiting for tests`; running stays `testing…` / `● testing`.
- Stop, resume and teardown cancel the run's queue entries.

## Tests

- [ ] a single run's tests wait behind a build's running suite in the same scratch `PIR_HOME`, then run
- [ ] the baseline also queues
- [ ] timeout → red round with 'timed out after {n} min'; kill → red round with the kill reason; round 4 still asks the person
- [ ] steps view and row text while queued; unchanged while running
- [ ] stop during a queued run removes its entry; resume enqueues again

## Done when

- [ ] No single-run path runs a suite outside the queue.
- [ ] The listed tests and the existing single-run tests are green in `npm test`.
- [ ] The row and step texts match DESIGN §2.8.
