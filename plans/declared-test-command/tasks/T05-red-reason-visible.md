# T05 — red-reason-visible

**Phase:** 1 · **Depends on:** — · **Weight:** medium

## Goal

A red finish shows its reason and log path wherever the run is watched, including the `pir` viewer
of a detached run, and the viewer stops telling the person to merge a red branch. Today the reason
reaches only the coordinator's stdout.

## Design sections this implements

DESIGN §2.8.

## Files

- `src/shell/loop.mjs` — `runPass` returns `testsReason`
- `src/shell/coordinate.mjs` — `startCoordinator().pass()` carries it; `buildRunState` gains it; `main`
  passes it
- `src/core/display.mjs` — `footerFor` red footer carries `reason` and `logPath`
- `src/shell/render.mjs` — a second red line
- `src/shell/pir-tui.mjs` — the finished-frame note (~lines 356 and 381) branches on red
- matching tests

## Interface

```js
// runPass(...) → { ..., testsPassed, testsReason }
//   testsReason: { reason: string|null, logPath: string|null } when testsPassed === false, else null
// buildRunState({ ..., testsReason }) → { ..., testsReason }        // lands in status.json runState
// footerFor → { kind: 'red', branch, reason, logPath }
```

Rendered red footer:

```
✗ 9 task(s) built on pir/remote-e2e, but its tests fail — not ready to merge.
  test `make server-test` exited 127 · output: plans/remote-e2e/.parallel/control/tests.log
```

A finished red frame in the viewer ends `Not ready to merge — fix pir/<slug>, see the output above.`
in place of `Hand-off: git merge …`. A green one is unchanged. Red is `runState.complete &&
!runState.readyToMerge`. The no-snapshot `finished` note (~line 356) has no runState to tell red from
green, so it drops the merge offer and points at run.log instead of guessing green.

## Tests

- [ ] runPass on red carries `testsReason` from the injected runTests; green carries null.
- [ ] buildRunState passes it through; a snapshot written and read back keeps it.
- [ ] The red footer model carries reason and logPath; render prints the second line, and none when
      both are null (an old snapshot).
- [ ] The viewer's finished red frame has no `git merge`; the green frame still has it.

## Done when

- [ ] A red run's reason reaches status.json and both renderers, tested.
- [ ] No finished red frame anywhere prints `git merge`.
