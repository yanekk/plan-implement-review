# T02 — platform-revive

**Phase:** 1 · **Depends on:** — · **Weight:** medium

## Goal

Give the platform the one operation a revive needs: start a dead worker's session again, under its
own id, in its own worktree, appending to its own conversation log. Plus the fake platform's matching
behaviour, and the restart lookup of a task's last session, so the loop tasks can be proven without
live agents.

## Design sections this implements

DESIGN §2.1, §2.3, §2.7, §2.8 (failed revive), §3.2.

## Files

- `src/shell/worker-proc.mjs`, `src/shell/worker-proc.test.mjs`
- `src/shell/platform.mjs`, `src/shell/platform.test.mjs`
- `src/shell/fake/platform.mjs`, `src/shell/fake/platform.test.mjs`
- `src/shell/fake/claude-stream.mjs` if the fake `claude` needs to accept `--resume`

## Interface

```js
// worker-proc: exactly one of sessionId / resume. resume → SDK option `resume: id`, no `sessionId`
// (the SDK rejects both without forkSession). The log is opened for append, so a revive continues it.
workerOptions({ cwd, sessionId, resume, name, claudePath, canUseTool, spawnProcess })
startWorker({ cwd, sessionId, resume, name, logPath, claudePath, ... }) → Worker
worker.exitInfo() → { code, signal, beforeInit: bool } | null   // beforeInit: no `init` since this start

continuationMessage(plan) → string    // the DESIGN §2.3 text, {plan} filled in

platform.revive(id) → { ok: true } | { ok: false, reason: 'live' | 'unknown' | 'failed', detail }
// 'live': id is still a live child (never two processes on one session); 'unknown': never spawned here.
// Otherwise startWorker({ resume: id, cwd, name, logPath }) from the gone record, a `revived` note,
// then send(continuationMessage) from 'pir'; the record moves back to live under the same id and
// workers.json is rewritten. A throw from startWorker → 'failed'.

platform.reviveSession({ id, cwd, name, task, role, logPath }) → same result
// restart: revive a session this platform never spawned (the dead coordinator's), same steps.

platform.exitOf(id) → worker.exitInfo() of a gone worker, else null

lastConversation(controlDir, task, role) → { id, logPath } | null
// the highest-n conversations/{task}-{role}-{n}.ndjson whose log has an init entry; id = its sessionId
```

Fake: `revive(id)` brings a dead worker back under the same id, role and stage (scriptable to fail at
start, or to exit before init); `exitOf`; behaviour `{ crashAfterCommit: true }` makes an implementer
commit once on its branch, then vanish from `list()`.

## Tests

- [ ] `workerOptions({ resume })` has `resume` and no `sessionId`; with `sessionId` it is unchanged.
- [ ] Against the fake `claude` through the real SDK: a revived worker takes the continuation message and appends to the same log after a `revived` note.
- [ ] A worker that exits before its first `init` reports `beforeInit: true`; one that exits later reports false.
- [ ] `revive` of a live id → `'live'` and no child started; of an unknown id → `'unknown'`; a throwing start → `'failed'`, never a throw out of `revive`.
- [ ] After a successful `revive` the id is in `list()` and in `workers.json`.
- [ ] `continuationMessage('p')` names `git status --short`, `git log --oneline pir/p..HEAD`, and the PROGRESS row.
- [ ] `lastConversation` picks the highest `n` for the task and role, reads the id from `init`, and returns null for no file or no `init`.
- [ ] Fake: `crashAfterCommit` leaves one commit on the branch and the worker absent from `list()`; `revive` restores it with the same id.

## Done when

- [ ] Every test above passes in `npm test`; existing worker-proc, platform and fake tests unchanged.
- [ ] Nothing in `src/core/` changed.
