# T04 — answer-first-routing

**Phase:** 2 · **Depends on:** T03 · **Weight:** heavy

## Goal

Put the agent in front of the person in a live run. The command starts the agent with the run, briefs
it every waiting item each pass, applies what it returns, passes on what it will not or may not decide,
and switches Remote Control so a worker is reachable on the phone only once its item is the person's.
With no live agent, or with `--no-coordinator`, the run behaves exactly as today.

## Design sections this implements

DESIGN §2.1 (on by default, `--no-coordinator`, kept on resume), §2.3, §2.4, §2.5, §2.8 (agent's Remote
Control), §2.11 (agent down → person), §3.6.

## Files

- `src/core/asking.mjs`, test: `waitingOn` also returns `holder: 'coordinator' | 'person'` given the set
  of items the agent holds, and the pure `waitingItems(stateTasks, workers)` list T01's `checkDecision`
  takes.
- `src/shell/coordinate.mjs`, test: start the agent after the feature worktree opens (unless disabled);
  per pass brief new items, `drain`, record `passed`; `remoteWanted` becomes: workers whose item is held
  by the person, plus the agent's own session; the agent closed on teardown and on HALT.
- `src/shell/loop.mjs`, test: `resumeAnswered` counts a `from: 'coordinator'` send as an answer, like
  `from: 'person'`.
- `src/shell/pir.mjs`, `launch.mjs`, `index-store.mjs`, tests: `pir start {slug} [--no-coordinator]`;
  `startRun(slug, { coordinator })` records `coordinator: false` in the index record and sets
  `PARALLEL_COORDINATOR=0` for the child; `resumeRun` passes the recorded choice on.
- `src/shell/harness/run.mjs`, `fixtures.mjs`, tests: fixtures run with `PARALLEL_COORDINATOR=0` unless
  the fixture sets `coordinator: true`, so existing live drills are unchanged.

## Interface

```js
// asking.mjs
export function waitingItems(stateTasks, workers) // → T01 `waiting` entries, one per waiting request or report park
export function waitingOn(task, activity, { heldByAgent = new Set() } = {}) // existing result + holder

// coordinate.mjs
export function remoteWanted(workers, stateTasks, { agentId = null, heldByAgent = new Set() } = {})
// env: PARALLEL_COORDINATOR=0 disables the agent for the run
```

Holder rule: an item is held by the agent from its brief until it is answered or passed; a reserved
item is briefed for a note but is the person's from the start; with no live agent every item is the
person's. `heldByAgent` is keyed `${workerId}:${requestId ?? 'report'}`.

## Tests

- [ ] Fake run: a permission request is briefed once, the scripted agent allows it, the worker proceeds;
      no Remote Control for that worker at any point.
- [ ] A reserved request: briefed as the person's, Remote Control on for its worker at once, row `asking you`.
- [ ] A `pass`: Remote Control on for that worker only after the pass; off after the person's answer.
- [ ] The person answers an item the agent holds: applied, agent told, the agent's late decision dropped.
- [ ] A report park answered by a coordinator `message` un-parks the task (`resumeAnswered`).
- [ ] Agent down: items become the person's, Remote Control as today; agent back: new items briefed.
- [ ] `PARALLEL_COORDINATOR=0`: no agent started, every existing coordinate/loop test unchanged.
- [ ] `pir start x --no-coordinator` → record `coordinator: false`, child env set; resume keeps it;
      unknown flag refused with usage.
- [ ] Harness fixture without `coordinator` runs with the agent off.

## Done when

- [ ] A fake run exercises answer, reserved, pass, person-first and agent-down in `coordinate.test.mjs`.
- [ ] `--no-coordinator` works from `pir start` and survives a resume.
- [ ] Every existing test passes unchanged; `./install.sh` run after the change.
