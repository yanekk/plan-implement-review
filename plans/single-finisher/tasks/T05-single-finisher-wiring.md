# T05 — single-finisher-wiring

**Phase:** 2 · **Depends on:** T01, T02, T03, T04 · **Weight:** heavy

## Goal

Make the single-run program execute the new ending T03 decides: prepare and merge the base, hold the
resolve and fix helpers, run the tests, start (and resume) the finisher for a single run, route the
person's answers to it, watch the base while it waits, and end the run `finished`, `merged` or `closed`.
After this task a single run against the fake Claude goes from prompt to a finisher-made merge.

## Design sections this implements

DESIGN §2.2–§2.10, §2.13, §3.3, §3.4.

## Files

- `src/shell/single-run.mjs`, `src/shell/single-run.test.mjs`
- `src/core/singleflow.mjs` (remove T03's `endSequence` option; the ending is always on)
- `src/shell/launch.mjs` (`resumeRun` for a run in `sync` or `wait`, if it needs anything)
- `src/core/dashboard.mjs` (`canResume`: a running-then-stopped run in `sync`/`wait` is resumable; finished stays final)
- `src/shell/fake/sessions.mjs` (+ its test): `singleResolveScript`, `singleFixScript`, `singleFinisherScript`

## Interface

Executing T03's actions in `runSingle`'s loop:

| Action | Shell |
|---|---|
| `prepareBase` | `prepareBase(root, state.base, { mode })` from `base-branch.mjs`; also reads the local tip (`baseTip`) → `facts.base` |
| `syncBase` | `syncBase(worktree, { baseSha, base })`; a throw → `{ state: 'error', error }` |
| `abortSync` | `abortSync(worktree)` |
| `spawn resolve/fix` | the holder, with `helperInstruction(...)` and names `{repo} / {name} / single / resolve` (`/ fix`) |
| `startFinisher` | `startFinisher({ kind: 'single', controlDir, featurePath: worktree, repoRoot: root, slug: name, base, rules: chooseRules(...), reportPath: null, promptPath, askRules, startWorker, claudePath, remote, env })`; a throw → `facts.finisher.failed` next pass, logged `finisher failed to start: …` |
| `finisherResyncing` / `finisherResynced` / `closeFinisher` | the Finisher's methods |
| `finish` | as today; `recordFinal('finished')`; the program exits |

Each pass in `wait` the shell computes `facts.watch` with `watchDue` and `baseWatchVerdict` (T01),
`facts.finisher` from `finisher.drain()`, `phase()`, `goGiven()`, `givenUp()`, and `facts.syncPending`
from `syncPending(worktree)`.

The person inbox is started with `withAgent(holder.platform, () => finisher)` and restarted with the same
wrap at the rename (DESIGN §2.7).

`singleChecks` gains `resolved` and `fixed` (DESIGN §2.3). `singleRunState` carries `end` and the
finisher's `view()` in the snapshot (`runState.finisher`), so T06 and T07 read them; the rows themselves
are T07's.

A stop (`SIGTERM`) closes the finisher as it closes the held session. The program no longer exits at a
green review; it exits on `finish`, a stop, or a crash.

Fake scripts: `singleResolveScript` resolves a conflict by taking both sides and commits; `singleFixScript`
commits a given fix; `singleFinisherScript({ goAnswer })` writes a `ready` status, asks the `Go` question,
and on `Go` runs `git -C <main> merge pir/{name}` and writes `done` (matched on the single opening's first
line, T02).

## Tests

`single-run.test.mjs`, in-process `runSingle` against a scratch repo with the fake shim:

- [ ] base unmoved: review green → finisher starts → `ready` → person `Go` through the inbox (as the conversation view drops it) → merged into the base → outcome `finished`.
- [ ] base moved with no conflict: a sync merge commit on `pir/{name}`, tests run, finisher starts.
- [ ] base moved with a conflict: resolve helper spawned with the files; after `resolved`, tests, finisher.
- [ ] tests red after the sync: one fix helper; green after → finisher; red after → no finisher, the run keeps running in `wait`, and a hand merge ends it `merged`.
- [ ] person merges by hand while the finisher waits → `merged`, finisher closed.
- [ ] base moves before the go → finisher told resyncing then resynced; no go counts in between.
- [ ] finisher `close` → `closed`.
- [ ] finisher fails to start (injected throw) → fallback; a hand merge ends the run `merged`.
- [ ] stop during the wait, then `--resume` → the finisher resumed by id; a `Go` after it still finishes.
- [ ] stop with a merge in progress (crash between `syncBase` conflict and the helper) → resume aborts it and syncs again.
- [ ] a `Go` typed as a chat message to the finisher does not merge.
- [ ] `singleChecks`: `resolved` refused while a merge is in progress or the tree is dirty; `fixed` refused on a dirty tree.
- [ ] `canResume` true for a stopped run in `sync`/`wait`, false for any finished outcome.
- [ ] The fake scripts have their own tests in `fake/sessions` tests.

## Done when

- [ ] Every test above passes; the old single-run tests pass with the ending on (updated where they asserted `ready`).
- [ ] `./install.sh` run; the installed `single-run.mjs` matches `src/`.
- [ ] `npm test` green.

## Outside actions

- Refresh the installed engine and skills — `worker` (DESIGN §5.3)
