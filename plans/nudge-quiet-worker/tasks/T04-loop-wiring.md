# T04 — loop-wiring

**Phase:** 2 · **Depends on:** T01, T02, T03 · **Weight:** heavy

## Goal

Wire observation, decision and sending into the coordinator so a real run nudges quiet workers and
un-parks a worker the person has answered. Each pass, for each task with a live worker, the loop
observes it (T03), folds the observation (T01), asks `decideNudge` (T02), sends `nudgeMessage` over
`platform.send` and records the outcome. `coordinate.mjs` reads `PARALLEL_NUDGE_MS`, injects the clock,
prints the run.log line, and carries the nudge fields into the run state the dashboard reads. The
`no-down-channel` guard learns that the loop may send only the conflict prompt or a nudge. This is the
task that makes the feature live.

## Design sections this implements

DESIGN §2.1, §2.3, §2.4, §2.6 (log lines and run.log), §2.7, §3.1 (the guard), §3.4, §3.5.

## Files

- `src/shell/loop.mjs`: an observe/unpark/nudge step in `runPass`, after `applyMessages` and the live
  listing, skipped entirely when halted. `runPass` gains `nudgeMs` (default `DEFAULT_NUDGE_MS`).
- `src/shell/loop.test.mjs`: tests below, against the fake platform with an injected clock.
- `src/shell/coordinate.mjs`: read `PARALLEL_NUDGE_MS` beside `PARALLEL_POLL_MS`; pass it and `now` into
  `passOpts` (today `startCoordinator` passes no `now`, so `runPass` uses its `Date.now` default);
  `renderer.line` per nudge / nudge-failed / stuck / unstuck / unpark action, worded exactly as DESIGN
  §2.6; `buildRunState` copies `nudges` and `stuck` from `stateTasks` onto each run-state task.
- `src/shell/coordinate.test.mjs`: the env read, the `now` pass-through and the `buildRunState` fields.
- `src/shell/no-down-channel.test.mjs`: the send-text check (DESIGN §3.1).

## Interface

```
state.tasks[num] gains:
  activity: { fingerprint, lastActivityAt, recent, cursor, questionIds } | undefined
  nudges: number, lastNudgeAt: number|null, stuck: boolean, parkedAt: number|undefined

per pass, unless halted, per task t with a live worker w (from platform.list()):
  obs = platform.observe(w.id, { worktreePath: t.worktree.path, cursor: t.activity?.cursor ?? 0 })
  parked = t.phase === AWAITING && !t.decision?.sent
  parked:
    t.parkedAt ??= now
    { replies } = personReplies(obs.entries, { questionIds })
    a reply with at >= t.parkedAt → t.phase = t.role === 'review' ? REVIEWING : IMPLEMENTING,
      t.decision = undefined, t.parkedAt = undefined, fresh stretch (activity from this pass,
      nudges 0, stuck false), record('unpark', { task })
    advance the cursor; nothing else this pass
  eligible = (t.phase === IMPLEMENTING || t.phase === REVIEWING || (t.phase === AWAITING && t.decision?.sent))
             && w.state !== 'permission' && w.state !== 'questions'
  a phase change or a new worker id since last pass → fresh activity, nudges 0
  w.state was permission/questions last pass and is not now → lastActivityAt = now (clock restart, count kept)
  { state, output, varied } = observeActivity(t.activity, { fingerprint, entries, reported }, { now, windowMs: nudgeMs })
  output → if (t.nudges > 0 || t.stuck) record('unstuck'); t.nudges = 0; t.stuck = false
  d = decideNudge({ now, eligible, lastActivityAt, lastNudgeAt, nudges, stuck, quietMs: nudgeMs, maxNudges: MAX_NUDGES })
  nudge → ok = platform.send(w.id, nudgeMessage({ n: d.n, max: MAX_NUDGES, quietMs: nudgeMs }), { from: 'pir' })?.ok
          t.nudges = d.n; t.lastNudgeAt = now; record(ok ? 'nudge' : 'nudge-failed', { task, n })
  stuck → t.stuck = true; record('stuck', { task })
```

`reported` is true when this pass's `applyMessages` moved the task on a report. `platform.send` and
`observe` are synchronous, so `runPass` stays synchronous. The count and `lastNudgeAt` move on the pass
the nudge is made.

`nudge`, `nudge-failed`, `stuck`, `unstuck` and `unpark` must not be added to the productive-action
lists (`['spawn','review','merge','close']` in coordinate.mjs and loop.mjs `drain`). A nudge is not
progress and must not hide a stall.

Guard: a source scan of `loop.mjs` finds every `platform.send(` call and requires its second argument
to be `workerText` (the conflict prompt) or to start with `nudgeMessage(`. The relay-token checks stay.
Its self-test proves `platform.send(id, 'free text', …)` fails and both allowed forms pass.

## Tests

- [ ] A worker with no activity: no nudge before `nudgeMs`, nudge 1 at it, nudge 2 one period later,
      stuck one period after that, and no further nudges; the fake's `sent` holds the opening
      instruction plus two `nudgeMessage` texts, `from: 'pir'`.
- [ ] A tool-call poll loop (the same `tool-use` every pass) is nudged on schedule.
- [ ] Varied work between nudges postpones nudge 2 but does not reset the count.
- [ ] A worktree change after nudge 1 logs `unstuck`, resets to 0, and clears `stuck`.
- [ ] A worker whose `list()` state is `permission` or `questions` is never nudged, however long; once
      answered, its next nudge is a full quiet period later, and its count is what it was.
- [ ] A worker that drops a `question` report is never nudged while parked, however long it waits.
- [ ] A person's message after the park un-parks it: phase back by role, `decision` cleared, the display
      phase no longer `asking`, `unpark` logged, and its quiet clock starts from that pass.
- [ ] A person's answer to a question set un-parks it the same way.
- [ ] pir's own message, a person's interrupt, a person's permission answer, and the worker's own
      actions while parked do not un-park it.
- [ ] A conflict-sent worker (`decision.sent`) is not un-parked by anything here, and is nudged on
      schedule like a building worker.
- [ ] `review-ready` and `done` workers are never nudged.
- [ ] HALT present: no `platform.observe` and no nudge send at all.
- [ ] A new reviewer on the same worktree starts a fresh stretch.
- [ ] A failed send logs `nudge-failed` and still counts.
- [ ] Stall detection is not reset by a pass whose only actions are nudges.
- [ ] `PARALLEL_NUDGE_MS` is read (default 900000) and reaches `runPass`, with `now`.
- [ ] `buildRunState` carries `nudges` and `stuck`.
- [ ] Each run.log line matches DESIGN §2.6 character for character.
- [ ] The guard passes on the real `loop.mjs` and fails on a fixture with free text.

## Done when

- [ ] A fake-platform run in `loop.test.mjs` goes nudge, nudge, stuck, unstuck with an injected clock,
      and a parked worker un-parks on a person's reply.
- [ ] The `no-down-channel` guard passes with the real nudge call in place.
- [ ] `npm test` is green and `./install.sh` has refreshed the installed engine (grep `decideNudge` in
      `~/.claude/pir-engine/src/shell/loop.mjs`), with no parallel run live.

## Outside actions

- refresh-install — `worker`
