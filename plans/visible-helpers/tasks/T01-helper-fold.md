# T01 — helper-fold

**Phase:** 1 · **Depends on:** — · **Weight:** medium

## Goal

Give pir one pure reading of an agent's helpers from its conversation log, which T03's line, T04's
rules and T05's gate all read, and stop a helper's frames from being taken for its parent's turns. Lock
in, on the real plan-0339 log, that a running helper never makes its parent read `asking`.

## Design sections this implements

DESIGN §2.1, §2.7, the first rows of §2.8, §3.2.

## Files

- `src/core/stream.mjs`: `readMessage` adds `helper` to every event from a frame with a non-null
  `parent_tool_use_id`; `readRequest` adds `agentId` from the entry when it is a string;
  `workerActivity` skips `TURN_OPENERS` handling for events with `helper`.
- `src/core/helpers.mjs` (new), `src/core/helpers.test.mjs` (new).
- `src/core/fixtures/helper-sample.ndjson` (new): cut from
  `plans/visible-helpers/evidence/plan-0339-helper.ndjson`, keeping the Agent call, `task_started`, a few
  `task_progress`, several helper frames, the parent's AskUserQuestion request, the interrupt, the
  `killed`/`stopped` end, the `result`, and the later "I'm waiting" turn. Keep it small (tens of lines).
- `src/core/stream.test.mjs`, `src/core/asking.test.mjs`: new cases.

## Interface

```js
// stream.mjs: WorkerEvent gains, when the frame's parent_tool_use_id is a non-empty string:
//   { ...event, helper: '<parent tool_use id>' }
// and a 'permission' | 'questions' event gains `agentId` when the request entry has one.

// helpers.mjs
// helpersOf(entries) → Helper[] in start order, one per local_agent task_started seen:
//   { id,               // task_id
//     toolUseId,        // the parent's Agent call id
//     description,      // task_started.description
//     subagentType,     // task_started.subagent_type ?? ''
//     background,       // task_started.is_backgrounded === true
//     state,            // 'running' | 'finished' | 'stopped' | 'failed'
//                       //   completed → finished; killed | stopped → stopped; failed → failed
//     step,             // latest task_progress.description, '' before any
//     steps,            // latest usage.tool_uses, 0 before any
//     durationMs,       // latest usage.duration_ms, null before any
//     endedAt,          // index in entries of the first end event, null while running
//   }
// A `resumed` note ends every helper still running at that point as 'stopped'.
export function helpersOf(entries) {}

// runningHelpers(entries) → Helper[] with state 'running'.
export function runningHelpers(entries) {}

// helperOfFrame(helpers, parentToolUseId, entries) → the outermost Helper a frame belongs to, or null.
// Nested helpers roll up: a parent_tool_use_id that is an Agent call made inside a helper resolves to
// that helper (DESIGN §2.1).
export function helperOfFrame(helpers, parentToolUseId, entries) {}
```

`entries` is a log as `buildConversation` takes it: parsed entries or raw lines.

## Tests

- [ ] `readEntry` on a helper assistant frame and a helper user frame from the fixture: every event has
      `helper` equal to the Agent call id; the parent's frames have no `helper`.
- [ ] A request entry with `agentId` yields an event with it; without, no field.
- [ ] `workerActivity`: helper frames after the parent's `result` leave `open` false, add no
      `turnCauses` entry, and leave `state` `idle` (or `busy` only if the parent's own frames opened it).
- [ ] `workerActivity` on the fixture before the interrupt: `background` holds the helper id; after the
      interrupt's `result`: `[]`, `state` `idle`.
- [ ] `helpersOf` on the fixture: one helper, `description` "Survey end-of-run machinery", `background`
      true, steps and duration from the last progress, state `running` before the end and `stopped`
      after it.
- [ ] Foreground helper (hand-built, `is_backgrounded: false`, shapes as DESIGN §2.1): `background`
      false, same fields.
- [ ] End mapping: `completed`, `failed`, `killed`, `stopped`; `task_notification` alone ends it;
      `task_updated` alone ends it; the first status wins.
- [ ] No `task_started` for a helper id seen only in frames: not in `helpersOf`.
- [ ] A `resumed` note mid-helper: that helper reads `stopped`, not running.
- [ ] Two helpers: both, in start order; nested helper frames resolve to the outer helper via
      `helperOfFrame`.
- [ ] `asking.test.mjs`: `waitingOn({ phase: 'implementing' }, activityWhileHelperRuns)` is null;
      `stoppedOnPerson` false while the helper runs and true once it has ended and the parent stopped.
- [ ] `helpers.mjs` passes `boundary.test.mjs` (no import outside `src/core`).

## Done when

- [ ] Every test above passes in `npm test`.
- [ ] `helpersOf` and `runningHelpers` exist with the shape above, and helper frames never open a parent
      turn in `workerActivity`.
- [ ] The fixture is committed under `src/core/fixtures/` and is under 60 lines.
