# T06 — plan-run-planner

**Phase:** 1 · **Depends on:** T01, T02, T04, T05 · **Weight:** heavy

## Goal

The detached planning program, first half: it holds the planner session, relays the person's input to
it, reads its reports, writes the run's state, snapshot and index updates, and ends cleanly on stop.
It executes `decidePlanStep`'s actions and decides nothing itself. T07 adds the rename, the reviewer
and resume.

## Design sections this implements

DESIGN §2.2 (control folder contents), §2.3 (including Remote Control), §2.4, §2.5, §2.16 (stop, crash), §3.4, §3.5.

## Files

- `src/shell/plan-run.mjs` (new), `src/shell/plan-run.test.mjs` (new)

## Interface

```
node src/shell/plan-run.mjs --control <dir> [--resume]
  <dir>/brief.md and <dir>/state.json exist (written by startPlanRun, T08)
  env: PIR_RUN=1 enables the snapshot and index updates, as for the coordinator
```

```js
export async function runPlanning({ controlDir, resume, deps }) → exitCode
//   deps injectable: startWorker, git checks, readRecord/updateRecord, writeSnapshot, now, watch
export function planRunState(state, session) → runState   // DESIGN §3.5 status.json runState (pure helper
//   may live in planflow.mjs instead; either way T12 paints it)
```

The session is held through `startWorker` with `workerOptions` unchanged, its log path
`conversations/plan-{n}.ndjson`, its id in `workers.json`; input arrives through `startPersonInbox`
with a small platform object exposing `send`, `interrupt`, `answer`, `pending`, `note`, `logPathOf`
for the one live session. Reports arrive through `drainDropFolder`/`waitForDrop` on `<dir>/reports`.
The §2.5 checks run in the shell (`git ls-tree`, `git status --porcelain`, `slugTaken` from T04) and
enter `decidePlanStep` as `facts.checks`.

## Tests

With the T05 shim first on `PATH`, in a scratch repo, the plan branch opened with `openPlanBranch`:

- [ ] The planner receives the exact planner instruction and its question reaches the log as a pending request.
- [ ] An inbox drop answering it is forwarded and the planner continues.
- [ ] `planned` with a valid plan: planner closed after idle; `state.json` step `rename`; the program then
      stops (T07 carries on from here) with no final status written yet.
- [ ] `planned` with the plan missing `DESIGN.md`: the planner receives the failure message and the step continues.
- [ ] `planned` with a taken slug (branch `pir/{slug}` exists): failure message names choosing another.
- [ ] `no-plan`: finished, outcome `no-plan`, final status `finished`, snapshot says so.
- [ ] The planner process exiting with no report: program exits without a final status (crashed).
- [ ] SIGTERM: session closed, `stopped` recorded in snapshot and index, exit.
- [ ] Remote Control: switched on when the planner goes idle or asks, off when it is busy again and before the
      close; never switched under `PARALLEL_REMOTE=0` (the fake answers `remote_control`).
- [ ] Under `PIR_RUN=1` a snapshot is written each transition; without it none is.

## Done when

- [ ] Every row passes in `npm test` with no real `claude`.
- [ ] `plan-run.mjs` contains no decision a `planflow` test does not cover (each branch maps to an action).
- [ ] `workers.json` holds the live session and is emptied on a clean end.
