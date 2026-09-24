# T07 — worker-setup

**Phase:** 2 · **Depends on:** T01, T02, T06 · **Weight:** heavy

## Goal

Before an implementer is spawned into a task worktree, the engine runs the plan's setup lines there in
the background; the row shows `preparing`; when setup ends the worker starts, and if setup failed its
opening instruction says so. The pass loop never blocks on setup.

## Design sections this implements

DESIGN §2.4, §2.9.

## Files

- `src/shell/loop.mjs` — `PREPARING` phase; step 3b; `buildAssignments` and liveness skip preparing
  tasks; a preparing task counts against the ceiling and in `liveAfter`; HALT kills setup handles
- `src/shell/coordinate.mjs` — builds `prepare` from the block and `startLines`, log at
  `control/setup/T{nn}.log`; `displayPhaseFor` → `preparing`; the stop chord kills setup handles;
  `main`'s stall detector and `startCoordinator().drive()` treat a pass with a preparing task as not
  idle (today `idle` counts a pass with no productive action and `r.live === 0` as quiet, so a run
  whose only work is a 60 s `npm ci` is declared "nothing left to do" and torn down after 3 passes)
- `src/core/display.mjs` — `preparing` in `ACTIVE_PHASES`, `PHASE_LABEL`, the phase doc comment
- `src/shell/render.mjs` — `GLYPH` (spinner) and `ROW_STYLE` (active) for it
- matching tests

## Interface

```js
// runPass({ ..., prepare = NO_PREPARE })
//   prepare(num, worktreePath) → null (nothing to run: spawn this pass) | handle from startLines
//   state.tasks[num] = { worktree, role: 'implement', slug, phase: PREPARING, setup: handle }
//   each pass: handle.poll() === null → leave it; a result → spawn, with
//              note = result.ok ? null : formatSetupNote(result, { slug })
// displayPhaseFor({ phase: 'preparing' }) → 'preparing'
```

Only the fresh-implementer path in 3b prepares. The review hand-off and restart's reviewer on an
adopted worktree do not.

## Tests

- [ ] `setup: none` (prepare → null) spawns in the same pass as today.
- [ ] A running handle keeps the task PREPARING across passes, holding a ceiling slot: with ceiling 1
      no second task is dispatched.
- [ ] A PREPARING task is never declared dead, respawned or given a second setup.
- [ ] Setup ok → spawn with no note; setup failed → spawn with the formatted note (fake platform).
- [ ] HALT and the stop path call `kill()` on every live handle.
- [ ] A run whose only task is preparing for more passes than `STALL_GRACE` (and than `drive()`'s idle
      limit) is not declared stalled; `liveAfter` counts the preparing task.
- [ ] The review hand-off spawns no setup.
- [ ] Restart with a worktree and no worker (coordinator died mid-setup) prepares again.
- [ ] Display: a preparing task renders a spinner row labelled `preparing`, counted in `running`.

## Done when

- [ ] Every new implementer worktree has setup run in it first, asynchronously, tested on the fake.
- [ ] A setup failure reaches the worker as the note; a stop or HALT leaves no setup process behind.
- [ ] `npm test` green.
