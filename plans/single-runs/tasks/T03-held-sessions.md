# T03 — held-sessions

**Phase:** 1 · **Depends on:** — · **Weight:** heavy

## Goal

Move the machinery that holds one Claude session at a time out of `runPlanning` in `plan-run.mjs` into
`src/shell/held-session.mjs`, so the single program (T04) is built on the same code rather than a copy.
Planning's behaviour does not change: its existing tests pass unmodified, apart from import paths.

## Design sections this implements

DESIGN §3.2 (`held-session.mjs`), §7 (Extend, not rebuild).

## Files

- `src/shell/held-session.mjs` (new), `src/shell/held-session.test.mjs` (new)
- `src/shell/plan-run.mjs` (uses it), `src/shell/plan-run.test.mjs` (imports only, if a helper moved)

## Interface

```js
// Generalised from plan-run.mjs; step names and log prefixes are the caller's.
createSessionHolder({
  controlDir: () => string,            // re-read after a control-folder move (the rename)
  cwd: () => string,                   // the worktree under its current name
  taskLabel,                           // the workers.json `task` field ('plan', 'single')
  roleOf: (step) => string,            // 'planner'|'reviewer'|'builder'
  nameOf: (step) => string,            // the session name
  instructionOf: (step) => string,     // the opening instruction
  remote: boolean, claudePath, log, now, uuid, startWorker, startTimeOf, env: extraEnv = null,
}) → {
  sessions,                            // [{ id, step, n, logPath, worker, live, startTime }]
  load(stateSessions, steps),          // list earlier sessions (resume), with their logs
  spawn(step, resumeSessionId = null) → rec,
  closeCurrent(opts) → Promise,
  current() → rec|null,
  platform,                            // send/interrupt/answer/pending/note/logPathOf for startPersonInbox
  waker, grants,
}
// Moved as they are, still exported from plan-run.mjs for its callers:
sessionAsking, trackStoppedAt, nextPlanLogPath (as nextSessionLogPath(controlDir, step)), findSessionLog, stepWorkedMs
```

`env` lets T06 pass `workerEnv`'s variables to the session without the holder knowing about ntfy.

## Tests

- [ ] `plan-run.test.mjs`, `plan-rig.test.mjs` and `worktree-plan.test.mjs` pass with no assertion changed
- [ ] held-session: spawn writes workers.json with the given task label and role, sends the instruction, turns Remote Control on when `remote`
- [ ] held-session: resume reopens by id, appends to the same log after a `resumed` note, sends no instruction
- [ ] held-session: a grant answers a covered permission request; a question set is never answered by a grant
- [ ] held-session: closeCurrent marks the session not live and rewrites workers.json
- [ ] nextSessionLogPath numbers `{step}-{n}.ndjson` per step prefix

## Done when

- [ ] `runPlanning` holds its sessions through `createSessionHolder` and no session plumbing is left duplicated in `plan-run.mjs`
- [ ] the planning test files above are unchanged in their assertions and green
- [ ] `npm test` green
