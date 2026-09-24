# T05 — loop-wiring

**Phase:** 2 · **Depends on:** T01, T02, T03, T04 · **Weight:** heavy

## Goal

Wire observation, decision and sending into the coordinator so a real run nudges quiet workers. Each
pass, for each eligible task, the loop observes the worker (T03), folds the observation (T01), asks
`decideNudge` (T02), sends `nudgeMessage` (T04) and records the outcome. `coordinate.mjs` reads
`PARALLEL_NUDGE_MS`, injects the clock, prints the run.log line, and carries the nudge fields into the
run state the dashboard reads. This is the task that makes the feature live.

## Design sections this implements

DESIGN §2.3, §2.4, §2.6 (log lines and run.log), §2.7, §3.4, §3.5.

## Files

- `src/shell/loop.mjs`: a nudge step in `runPass`, after `applyMessages` and `buildAssignments`,
  skipped entirely when halted. `runPass` gains `nudgeMs` (default `DEFAULT_NUDGE_MS`).
- `src/shell/loop.test.mjs`: tests below, against the fake platform with an injected clock.
- `src/shell/coordinate.mjs`: read `PARALLEL_NUDGE_MS` beside `PARALLEL_POLL_MS`; thread it and `now`
  through `startCoordinator` into `passOpts`; `renderer.line` per nudge/stuck/unstuck/nudge-failed
  action; `buildRunState` copies `nudges` and `stuck` from `stateTasks` onto each run-state task.
- `src/shell/coordinate.test.mjs`: the env read and the `buildRunState` fields.

## Interface

```
state.tasks[num] gains:
  activity: { fingerprint, lastActivityAt, recent, transcriptPath, offset } | undefined
  nudges: number, lastNudgeAt: number|null, stuck: boolean, degradedLogged: boolean

per pass, per task t with a live worker w:
  eligible = !halted && (t.phase === IMPLEMENTING || t.phase === REVIEWING) && w past grace
  a phase change since last pass (new worker, back from AWAITING) → fresh activity, nudges 0
  obs = platform.activity({ worktreePath: t.worktree.path, sessionId: w.sessionId, … })
  { state, output, varied } = observeActivity(t.activity, { …obs, actions: parseOwnActions(obs.text),
                                                           reported }, { now, windowMs: nudgeMs })
  output → if (t.nudges > 0 || t.stuck) record('unstuck'); t.nudges = 0; t.stuck = false
  !obs.transcriptFound && !t.degradedLogged → record('activity-degraded'); t.degradedLogged = true
  d = decideNudge({ now, eligible, lastActivityAt, lastNudgeAt, nudges, stuck, quietMs: nudgeMs, maxNudges: MAX_NUDGES })
  nudge → platform.nudge({ pid: w.pid }, nudgeMessage({ n: d.n, max: MAX_NUDGES, quietMs: nudgeMs }))
          t.nudges = d.n; t.lastNudgeAt = now; record(ok ? 'nudge' : 'nudge-failed', { task, n, reason })
  stuck → t.stuck = true; record('stuck', { task })
```

`platform.nudge` is async (T04) and `runPass` is not. Settle it one way and say why in a comment:
either await the send inside an async step the bin already awaits, or fire it and record the result
from a promise the next pass collects. Either way the count and `lastNudgeAt` move on the pass the
send is made, so a slow socket cannot cause a double nudge.

`nudge`, `nudge-failed`, `stuck`, `unstuck` and `activity-degraded` must not be added to the
productive-action lists (`['spawn','review','merge','close']` in coordinate.mjs and loop.mjs). A nudge
is not progress and must not hide a stall.

## Tests

- [ ] A worker with no activity: no nudge before `nudgeMs`, nudge 1 at it, nudge 2 one period later,
      stuck one period after that, and no further nudges; the fake's `nudged` array holds two
      `nudgeMessage` texts.
- [ ] Varied work between nudges postpones nudge 2 but does not reset the count.
- [ ] A worktree change after nudge 1 logs `unstuck`, resets to 0, and clears `stuck`.
- [ ] A worker that drops a `question` report is never nudged while `AWAITING`; on return its clock
      restarts from that pass.
- [ ] `review-ready` and `done` workers are never nudged.
- [ ] HALT present: no `platform.activity` and no `platform.nudge` call at all.
- [ ] A new reviewer on the same worktree starts a fresh stretch.
- [ ] A failed send logs `nudge-failed` and still counts.
- [ ] Missing transcript logs `activity-degraded` once, and folder changes still count.
- [ ] Within the appear grace, no nudge.
- [ ] Stall detection is not reset by a pass whose only actions are nudges.
- [ ] `PARALLEL_NUDGE_MS` is read (default 900000) and reaches `runPass`.
- [ ] `buildRunState` carries `nudges` and `stuck`.

## Done when

- [ ] A fake-platform run in `loop.test.mjs` goes nudge, nudge, stuck, unstuck with an injected clock.
- [ ] The narrowed `no-down-channel` guard (T04) passes with the real call in place.
- [ ] `npm test` is green and `./install.sh` has refreshed the installed engine (grep `decideNudge` in
      `~/.claude/pir-engine/src/shell/loop.mjs`).

## Outside actions

- refresh-install — `worker`
