# T03 — single-end-flow

**Phase:** 1 · **Depends on:** — · **Weight:** heavy

## Goal

Teach the single run's pure rulebook its new ending: after a green review, sync the base in, resolve a
clash with a helper, test, give red one fix helper, then wait — handing a green branch to the finisher,
reacting to its statuses, to a hand merge, to the base moving, and to the finisher giving up — and resume
from any of it (DESIGN §2.2–§2.10). Everything is decided in `decideSingleStep`, so every path is a
millisecond test before any shell code exists.

## Design sections this implements

DESIGN §2.2, §2.3 (decisions and wording; the skill is T04), §2.4, §2.5, §2.6, §2.8, §2.10, §3.3.

## Files

- `src/core/singleflow.mjs`, `src/core/singleflow.test.mjs`

## Interface

State (`initialSingleState` gains, all defaulted so an old `state.json` loads):

```js
sessions: { build: [], review: [], resolve: [], fix: [] }
step: 'setup' | 'build' | 'rename' | 'review' | 'sync' | 'wait'
end: {
  seq: 0,                         // sync sequences started; a new one on every `moved`
  phase: null | 'prepare' | 'merge' | 'resolving' | 'testing' | 'fixing',
  sync: null | { state: 'up-to-date'|'merged'|'conflict'|'resolved'|'unresolved', baseSha, files },
  tests: null | 'green' | 'red', testsReason: null | { reason, logPath },
  fixUsed: false, hold: null | { reason, text, since, nextTry },
  localSeen: null, remote: null,
  finisher: null | 'on' | 'fallback', fallback: null | 'failed' | 'gave-up' | 'red',
}
outcome: null | 'finished' | 'merged' | 'closed' | 'dropped'   // 'ready' only on legacy state
```

Actions (new; DESIGN §3.3):

```js
{ type: 'prepareBase', mode: 'start' | 'watch' }
{ type: 'syncBase', baseSha }
{ type: 'abortSync' }
{ type: 'spawn', step: 'resolve' | 'fix' }
{ type: 'resumeSession', step: 'resolve' | 'fix', sessionId }
{ type: 'startFinisher' }
{ type: 'finisherResyncing' }
{ type: 'finisherResynced', baseSha }
{ type: 'closeFinisher' }
{ type: 'finish', outcome: 'finished' | 'merged' | 'closed' | 'dropped' }
```

Facts (new):

```js
base:        { ok, sha, remote, localTip, reason, text }   // prepareBase's result; localTip the local base now
sync:        { state: 'up-to-date'|'merged'|'conflict'|'error', baseSha, files, error }
syncPending: boolean                                        // a merge is in progress in the worktree
watch:       'merged' | 'moved' | null                      // baseWatchVerdict, computed by the shell
finisher:    { started, phase, goGiven, givenUp, failed, accepted: [{ kind }] }
now:         number                                         // for the hold's retry only
```

Report kinds per step: `sync` accepts `resolved` (while `end.phase === 'resolving'`) and `fixed` (while
`fixing`); `wait` accepts none.

```js
// The opening instruction of a helper session (DESIGN §2.3).
export function helperInstruction({ role: 'resolve' | 'fix', name, base, reportsDir, files = [], testsReason = null, logPath = null })
// Names the pir-single skill and the role ("as the resolve helper of pir/{name}"), "You are run by `pir single`.",
// the reports folder, the base; resolve: the conflicted files, one per line; fix: the reason and the log path.

export function singleProgress(runState)   // DESIGN §2.11 PROGRESS cells, legacy 'ready' unchanged
```

## Tests

Each a `decideSingleStep` walk from a state and facts:

- [ ] review accepted head green, idle → closes the reviewer, `step: 'sync'`, `prepareBase('start')`; no `finish`.
- [ ] base not ok → `end.hold` with the text, no merge; a pass before `nextTry` does nothing; at `nextTry` → `prepareBase` again; the same reason keeps `since`.
- [ ] base contains the tip (facts.watch `merged` at the sync) → `finish('merged')`.
- [ ] `up-to-date` → `step: 'wait'`, tests green, `startFinisher`, `end.finisher: 'on'`.
- [ ] `merged` → `runTests`; green → wait and `startFinisher`.
- [ ] `merged` → red → `spawn fix`; `fixed` accepted after its checks → `runTests`; green → `startFinisher`; red → wait red, no `startFinisher`.
- [ ] fix helper exits with no report → tests run anyway.
- [ ] `conflict` → `spawn resolve` with the files; `resolved` accepted → `runTests`.
- [ ] resolve helper exits with `syncPending` → `abortSync`, `sync.state: 'unresolved'`, wait red.
- [ ] `sync` fact `error` → unresolved, wait red, no helper.
- [ ] A helper's `dropped`, and a `built`/`reviewed` sent during sync, are ignored.
- [ ] Wait, finisher on: accepted `done` → `finish('finished')`; `close` → `finish('closed')`.
- [ ] Before go: `watch: 'merged'` → `closeFinisher`, `finish('merged')`; `moved` → `finisherResyncing`, `end.seq + 1`, `fixUsed: false`, `prepareBase('start')`.
- [ ] Re-sync settles green → `finisherResynced(baseSha)`; settles red → `closeFinisher`, `fallback: 'red'`, wait red; a later green never emits `startFinisher` again.
- [ ] After go (`goGiven`): `watch` is ignored; only `done`/`close` end the run.
- [ ] `givenUp` → `closeFinisher`, `fallback: 'gave-up'`; `failed` → `fallback: 'failed'`; then `watch: 'merged'` → `finish('merged')`; `moved` → re-sync, and green stays in fallback.
- [ ] Red wait: `moved` → new sequence; green → `startFinisher` (finisher never started).
- [ ] Resume in `sync` with `syncPending` and no live helper → `abortSync` then `prepareBase('start')`; resume with a live helper step → `resumeSession` for `resolve`/`fix`; tests in flight → started again.
- [ ] Resume in `wait` with `end.finisher: 'on'` → `startFinisher`; with `finisher.phase: 'done'` → `finish('finished')`.
- [ ] A finished run (any outcome, `ready` included) returns no actions.
- [ ] Old `state.json` without `end`, `resolve`, `fix` loads with defaults.
- [ ] `helperInstruction` for both roles: names the skill, the role, `pir single`, the reports folder; resolve lists files; fix has reason and log.
- [ ] `singleProgress` for each DESIGN §2.11 cell, and legacy `ready`.

## Done when

- [ ] Every test above passes in `singleflow.test.mjs`; `boundary.test.mjs` passes.
- [ ] The existing single-run tests (`single-run.test.mjs`, rigs) still pass unchanged: the new ending is behind a third argument, `decideSingleStep(state, facts, { endSequence = false } = {})`, which keeps today's `finish('ready')` when false. The shell does not pass it until T05, which turns it on and removes the option.
- [ ] `npm test` green.
