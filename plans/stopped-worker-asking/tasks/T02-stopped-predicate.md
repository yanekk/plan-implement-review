# T02 — stopped-predicate

**Phase:** 1 · **Depends on:** — · **Weight:** medium

## Goal

Make a build task read `asking you` when its worker has stopped: phase `implementing` or `reviewing`,
the worker idle with nothing pending, and no background job running. Extending the one predicate the
row, the clock and Remote Control already share means all three follow with no second copy of the rule.

## Design sections this implements

DESIGN §2.1, §2.6, §3.1, §3.2.

## Files

- `src/core/asking.mjs`: `stoppedOnPerson`, and the third clause of `waitingOn`.
- `src/core/asking.test.mjs`.
- `src/shell/coordinate.mjs`: `displayPhaseFor` returns `asking` for an `implementing`/`reviewing` task
  whose `waitingOn` is non-null; its comment updated.
- `src/shell/coordinate.test.mjs`.

## Interface

```js
// src/core/asking.mjs
// stoppedOnPerson(activity) → boolean
//   true when activity.state === 'idle' and Array.isArray(activity.background) and background is empty.
//   false for undefined activity, a listing without `background`, any other state.
export function stoppedOnPerson(activity) {}

// waitingOn(task, activity) → null | 'question' | 'permission' | 'questions'
//   as today, plus: 'question' when task.phase is 'implementing' or 'reviewing' and stoppedOnPerson(activity).
export function waitingOn(task, activity) {}
```

`displayPhaseFor(t, activity)`: for `implementing`/`reviewing`, `asking` when `waitingOn(t, activity)` is
non-null, else the role's phase as today. `clockPhase`, `workerFields` and `remoteWanted` already call
`waitingOn` and need no change beyond what their tests show.

## Tests

- [ ] `stoppedOnPerson`: idle + `background: []` → true; idle + `['x']` → false; idle without the field →
      false; `busy` / `permission` / `starting` → false; undefined → false.
- [ ] `waitingOn`: `implementing` + stopped → `question`; `reviewing` + stopped → `question`.
- [ ] `waitingOn`: `implementing` + idle with a job running → null.
- [ ] `waitingOn`: `review-ready`, `done`, `preparing` + stopped → null.
- [ ] `waitingOn`: `awaiting-answer` with `decision.sent` + stopped → null (conflict fix in flight).
- [ ] `waitingOn`: every existing real-asking-state case unchanged.
- [ ] `buildRunState`: stopped implementer → phase `asking`, `asking: 'question'`, question text null.
- [ ] `buildRunState`: the same worker's next turn open → `building`, `asking` null.
- [ ] `advanceTiming`: clock stops when the implementer stops, resumes when its next turn opens.
- [ ] `remoteWanted`: stopped implementer wanted; busy one not; idle one with a job running not.
- [ ] A fake listing whose activity has no `background` (`src/shell/fake/platform.mjs`) keeps reading
      `building` for an idle implementer; existing `coordinate.test.mjs` and `loop.test.mjs` cases pass
      unchanged.

## Done when

- [ ] Row, clock and Remote Control read a stopped implementer or reviewer as waiting, through `waitingOn`
      alone; no other copy of the rule exists in `coordinate.mjs`.
- [ ] The tests above pass, `boundary.test.mjs` passes, and `npm test` is green.
