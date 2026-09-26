# T02 — waiting-predicate

**Phase:** 1 · **Depends on:** — · **Weight:** medium

## Goal

Make a task read `asking you` only while its worker is actually waiting on the person: a request is
pending, or it is parked on its own report and its turn has ended. One pure predicate drives the row,
the clock and Remote Control, so a worker that drops a report and keeps working (T10) reads `building`
or `reviewing`, keeps its clock running and does not switch Remote Control on.

## Design sections this implements

DESIGN §2.1, §3.1, §3.2.

## Files

- `src/core/asking.mjs` (new), `src/core/asking.test.mjs` (new).
- `src/shell/coordinate.mjs`: `displayPhaseFor`, `buildRunState`/`workerFields`, `requestingTasks`,
  `advanceTiming` callers, `remoteWanted`.
- `src/shell/coordinate.test.mjs`.

## Interface

```js
// src/core/asking.mjs
// waitingOn(task, activity) → null | 'question' | 'permission' | 'questions'
//   task:     { phase, decision } from coordinator.state.tasks, or undefined (decision.askEnd from resumeAnswered)
//   activity: the task's live worker's workerActivity result, or undefined (worker unseen)
// 'permission' / 'questions' when a request is pending (it outranks the report);
// 'question' when phase is 'awaiting-answer', !decision.sent, and the asking turn is not open: activity is
//   undefined, or !activity.open, or decision.askEnd is set and activity.turns >= decision.askEnd
//   (a later non-answer turn, such as a background wake-up, keeps the task asking; DESIGN §2.1);
// null otherwise.
export function waitingOn(task, activity) {}
```

`displayPhaseFor(t, activity)` returns `asking` only when `waitingOn` is non-null for a report park;
for a report park with an open turn it returns the role's phase (`building` / `reviewing`).
`buildRunState` passes each task's live worker activity. `requestingTasks` is replaced by (or computes)
the set of tasks with `waitingOn` non-null, so `advanceTiming` stops the clock on exactly that set.
`remoteWanted` returns the live workers whose task has `waitingOn` non-null.

## Tests

- [ ] `waitingOn`: request pending with phase implementing → `permission`/`questions`.
- [ ] `waitingOn`: parked, `open` true, nothing pending → null.
- [ ] `waitingOn`: parked, `open` false → `question`.
- [ ] `waitingOn`: parked, `askEnd` set, `turns >= askEnd`, `open` true (a wake-up turn) → `question`.
- [ ] `waitingOn`: parked, `askEnd` set, `turns < askEnd`, `open` true (the asking turn) → null.
- [ ] `waitingOn`: parked with `decision.sent` → null.
- [ ] `waitingOn`: parked, activity undefined → `question` (unseen worker keeps today's reading).
- [ ] `buildRunState`: parked implementer with open turn → phase `building`, `asking` null, no question text.
- [ ] `buildRunState`: parked reviewer with open turn → `reviewing`.
- [ ] `buildRunState`: same task after its turn ends → `asking`, `asking: 'question'`.
- [ ] `advanceTiming`: clock runs during the open asking turn, stops when it ends, resumes on un-park.
- [ ] `remoteWanted`: parked worker with open turn not wanted; after the turn ends, wanted.
- [ ] Conflict fix sent still reads `fixing conflict` and is not wanted for Remote Control.

## Done when

- [ ] Row, clock and Remote Control all read from `waitingOn`; no other copy of the rule remains in
      `coordinate.mjs`.
- [ ] The tests above pass and `npm test` is green.
- [ ] `boundary.test.mjs` passes with `asking.mjs` in core.
