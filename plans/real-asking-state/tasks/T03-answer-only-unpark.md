# T03 — answer-only-unpark

**Phase:** 2 · **Depends on:** T00, T02 · **Weight:** medium

> Read T00's FINDINGS rows first. If T00 found no signal that separates a Remote Control answer from a
> background wake-up, stop and ask the person before building: the fallback (DESIGN §2.2) replaces this
> task's body with one skill line.

## Goal

`resumeAnswered` un-parks a report-parked task only on a turn opened by an answer, so a background
job's wake-up leaves the task `asking you`. The person's answer in `pir`, typed on the phone, or given in
a picker or permission on the phone still returns the task to work within one pass.

## Design sections this implements

DESIGN §2.2, §3.2, §3.3.

## Files

- `src/core/stream.mjs`, `src/core/stream.test.mjs`: `workerActivity` records why each turn opened.
- `src/shell/worker-proc.mjs`, `src/shell/worker-proc.test.mjs`: only if T00's signal needs capturing
  (a hook callback or replay option), logged as a conversation-log entry.
- `src/shell/loop.mjs`, `src/shell/loop.test.mjs`: `resumeAnswered`.
- `src/shell/fake/claude-stream.mjs`: script the chosen signal and a `task_notification` wake-up.
- `src/core/fixtures/remote-answer-sample.ndjson` (from T00), read by the tests.

## Interface

```js
// workerActivity(entries) → { …existing, turnCauses }
//   turnCauses: one entry per turn opened, in order: 'person' | 'remote' | 'pir' | 'system' | 'unknown'
//   'person' = opened by an `out` send from 'person'; 'pir' = from 'pir';
//   'system' = opened after a task_notification (or T00's other non-answer markers);
//   'remote' = T00's Remote Control marker; 'unknown' = none of these.
// resumeAnswered: a turn at index ≥ decision.askEnd whose cause is 'person' or 'remote' un-parks;
//   a 'system' / 'pir' / 'unknown' turn advances decision.askEnd past itself and leaves the park.
//   The in-turn answer case (decision.asked, 5b899df) is unchanged.
```

Whether `unknown` counts as an answer is decided by T00's results; the default here is no (DESIGN §2.2).

## Tests

- [ ] Parked, turn opened by a `from: 'person'` send → resumed.
- [ ] Parked, turn opened by the Remote Control marker (fixture entries from T00) → resumed.
- [ ] Parked, `task_notification` then a turn → still parked, `askEnd` advanced.
- [ ] Parked, wake-up turn, then a person turn → resumed on the second.
- [ ] Parked, request answered remotely with the turn open → resumed (existing 5b899df case).
- [ ] Parked with `decision.sent` → untouched.
- [ ] Row stays `asking you` through the wake-up turn once it ends, and Remote Control stays on.

## Done when

- [ ] A background wake-up no longer un-parks; every answer path in DESIGN §2.2 still does.
- [ ] Tests above pass against the T00 fixture; `npm test` green.
- [ ] `./install.sh` run and the change is in `~/.claude/pir-engine/src/shell/loop.mjs`.

## Outside actions

- `./install.sh`, `worker` bin (DESIGN §5.3).
