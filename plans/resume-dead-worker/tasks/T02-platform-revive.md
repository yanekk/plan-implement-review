# T02 — platform-revive

**Phase:** 1 · **Depends on:** — · **Weight:** medium

## Goal

Give the platform the session operations a revive needs: carry each worker's full `sessionId`, revive
a stopped session safely, and list past sessions by name for restart. Plus the fake platform's
matching behaviour, so the loop tasks can be proven without live agents.

## Design sections this implements

DESIGN §2.3, §2.7, §3.2.

## Files

- `src/shell/platform.mjs`, `src/shell/platform.test.mjs`
- `src/shell/fake/platform.mjs`, `src/shell/fake/platform.test.mjs`

## Interface

```js
parseAgents(json) → [{ id, pid, cwd, status, state, name, sessionId }]
platform.list()   → [{ id, pid, name, cwd, status, state, live: true, sessionId }]

reviveArgv({ sessionId, message }) → ['--bg', '--resume', sessionId, message]   // no -n, ever
continuationMessage(plan) → string    // the DESIGN §2.3 text, {plan} filled in

platform.revive({ id, sessionId, cwd, plan })
  → { ok: true, id } | { ok: false, reason: 'failed'|'copy', detail }
// 1. runClaude(closeArgv(id))  — `claude stop`, so the session cannot be running
// 2. runClaude(reviveArgv(...), { cwd })
// 3. output matching /started a copy as (\w+)/ → close + remove that copy id, return reason 'copy'

platform.history() → [{ id, sessionId, name, cwd, startedAt }]   // `claude agents --json --all`, same-repo
```

Fake: list entries carry `sessionId`; `revive` brings a dead worker back under the same id and name
(and can be scripted to fail or to return a copy); `history` returns every worker ever spawned;
behaviour `{ crashAfterCommit: true }` makes an implementer commit once on its branch then vanish.

## Tests

- [ ] `parseAgents` keeps `sessionId`; `list()` passes it through; absent field → null.
- [ ] `reviveArgv` has no `-n`; `revive` calls stop before resume, and resume with `cwd`.
- [ ] Copy output → the copy is closed and removed, result `{ ok:false, reason:'copy' }`.
- [ ] Non-zero exit or empty output → `{ ok:false, reason:'failed' }`, never a throw.
- [ ] `continuationMessage('p')` names `git status --short`, `git log --oneline pir/p..HEAD`, and the PROGRESS row.
- [ ] `history()` uses `--all` and the same-repo filter.
- [ ] Fake: `crashAfterCommit` leaves one commit on the branch and the worker absent from `list()`; `revive` restores it with the same id.

## Done when

- [ ] Every test above passes in `npm test`; existing platform and fake tests unchanged.
- [ ] `revive` never passes a flag besides `--bg --resume`.
