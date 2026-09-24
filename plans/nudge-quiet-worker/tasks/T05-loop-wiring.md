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
  through `startCoordinator` into `passOpts`; `renderer.line` per nudge/stuck/unstuck/nudge-failed/unpark
  action, worded exactly as DESIGN §2.6; `buildRunState` copies `nudges` and `stuck` from `stateTasks` onto each run-state task.
- `src/shell/coordinate.test.mjs`: the env read and the `buildRunState` fields.

## Interface

```
state.tasks[num] gains:
  activity: { fingerprint, lastActivityAt, recent, transcriptPath, offset } | undefined
  nudges: number, lastNudgeAt: number|null, stuck: boolean, degradedLogged: boolean

per pass, per task t with a live worker w:
  eligible = !halted && (t.phase === IMPLEMENTING || t.phase === REVIEWING) && w past grace
  a phase change since last pass (new worker, back from AWAITING) → fresh activity, nudges 0
  t.phase === AWAITING: keep reading the transcript (never nudge); the first parsePersonReplies entry
    after the park → t.phase = IMPLEMENTING or REVIEWING by t.role, t.decision cleared, fresh stretch,
    record('unpark', { task }) (DESIGN §2.4)
  obs = platform.activity({ worktreePath: t.worktree.path, sessionId: w.sessionId, … })
  { state, output, varied } = observeActivity(t.activity, { …obs, actions: parseOwnActions(obs.text),
                                                           reported }, { now, windowMs: nudgeMs })
  output → if (t.nudges > 0 || t.stuck) record('unstuck'); t.nudges = 0; t.stuck = false
  !obs.transcriptFound && !t.degradedLogged → record('activity-degraded'); t.degradedLogged = true
  d = decideNudge({ now, eligible, lastActivityAt, lastNudgeAt, nudges, stuck, quietMs: nudgeMs, maxNudges: MAX_NUDGES })
  nudge → undelivered = t.nudges > 0 && platform.nudgePending({ sessionId: w.sessionId })
          text = nudgeMessage({ n: d.n, max: MAX_NUDGES, quietMs: nudgeMs })
          fallback idle path (T00 said the wake fails) && undelivered
            ? platform.resumeWith({ id: w.id, sessionId: w.sessionId, cwd: t.worktree.path }, text)
            : platform.nudge({ sessionId: w.sessionId }, text)
          t.nudges = d.n; t.lastNudgeAt = now; record(ok ? 'nudge' : 'nudge-failed', { task, n, reason })
          undelivered → the previous nudge's run.log line reason is `not delivered` (DESIGN §2.7)
  stuck → t.stuck = true; record('stuck', { task })
```

`platform.nudge` is a synchronous file write and `resumeWith` is synchronous like `close`, so `runPass`
stays synchronous. The count and `lastNudgeAt` move on the pass the nudge is made. A resumed worker keeps
its id and must not enter `closedIds` (as for the sibling plan's revive).

`nudge`, `nudge-failed`, `stuck`, `unstuck`, `unpark` and `activity-degraded` must not be added to the
productive-action lists (`['spawn','review','merge','close']` in coordinate.mjs and loop.mjs). A nudge
is not progress and must not hide a stall.

## Tests

- [ ] A worker with no activity: no nudge before `nudgeMs`, nudge 1 at it, nudge 2 one period later,
      stuck one period after that, and no further nudges; the fake's `nudged` array holds two
      `nudgeMessage` texts.
- [ ] Varied work between nudges postpones nudge 2 but does not reset the count.
- [ ] A worktree change after nudge 1 logs `unstuck`, resets to 0, and clears `stuck`.
- [ ] A worker that drops a `question` report is never nudged while `AWAITING`, however long it waits.
- [ ] A person's reply in its transcript un-parks it: phase back by role, `decision` cleared, the
      display phase no longer `asking`, and its quiet clock starts from that pass.
- [ ] The worker's own actions while parked do not un-park it.
- [ ] A coordinator-parked conflict un-parks the same way.
- [ ] `review-ready` and `done` workers are never nudged.
- [ ] HALT present: no `platform.activity` and no `platform.nudge` call at all.
- [ ] A new reviewer on the same worktree starts a fresh stretch.
- [ ] A failed write logs `nudge-failed` and still counts.
- [ ] A note still pending at the next nudge is reported `not delivered`, and still counts.
- [ ] Fallback only: an undelivered note to a worker leads to `resumeWith`, never a spawn.
- [ ] Missing transcript logs `activity-degraded` once, and folder changes still count.
- [ ] Within the appear grace, no nudge.
- [ ] Stall detection is not reset by a pass whose only actions are nudges.
- [ ] `PARALLEL_NUDGE_MS` is read (default 900000) and reaches `runPass`.
- [ ] `buildRunState` carries `nudges` and `stuck`.
- [ ] Each run.log line matches DESIGN §2.6 character for character.

## Done when

- [ ] A fake-platform run in `loop.test.mjs` goes nudge, nudge, stuck, unstuck with an injected clock.
- [ ] The narrowed `no-down-channel` guard (T04) passes with the real call in place.
- [ ] `npm test` is green and `./install.sh` has refreshed the installed engine (grep `decideNudge` in
      `~/.claude/pir-engine/src/shell/loop.mjs`).

## Outside actions

- refresh-install — `worker`
