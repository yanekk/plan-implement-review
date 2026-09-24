# T11 — docs

**Phase:** 4 · **Depends on:** T03, T04, T05, T07, T08, T09 · **Weight:** light

## Goal

`/docs` is canonical for how parallel mode behaves (CLAUDE.md), so it describes the block, the start
refusal, worker setup, the end gate and the red reason as built.

## Design sections this implements

DESIGN §2.2–§2.5, §2.8.

## Files

- `docs/run-lifecycle.md` — Start (refusal), each pass (setup before spawn, `preparing`), Complete
  (the gate: block, setup then test, `tests.log`, reasons), the display's phase and colour lists, End
- `docs/detached-runs.md` — snapshot `runState.testsReason`, the viewer's red frame, the start
  pre-flight's `no-test-block`
- `docs/control-folder.md` — `setup/T{nn}.log`, `tests.log` now holds setup too
- `docs/task-state.md` — the review gate includes the block
- `docs/human-flow.md` — the test command is the block; the red hand-off
- `docs/restart-recovery.md` — a restart re-runs setup for a worktree with no worker

`docs/run-lifecycle.md`, `detached-runs.md` and `restart-recovery.md` had uncommitted edits from
another session when this plan was written. Build on whatever is committed; never overwrite another
session's uncommitted change.

## Tests

None: prose. The review reads each changed section against the code as built.

## Done when

- [ ] Every doc listed describes the built behaviour and no doc mentions the fenced-block reader or
      `testCommandFrom`.
