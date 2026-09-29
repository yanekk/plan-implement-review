# T04 — single-program

**Phase:** 2 · **Depends on:** T02, T03 · **Weight:** heavy

## Goal

The detached program that runs a single run: it reads `state.json` and `prompt.md`, holds the builder
and then the reviewer through the shared holder, runs setup, tests and the baseline as background
command runs, checks reports against git, renames the run, writes the snapshot and the final status,
and executes `decideSingleStep`'s actions in order. It decides nothing itself.

## Design sections this implements

DESIGN §2.4, §2.5 (execution), §2.7 (`singleChecks`), §2.9, §2.11 (stop, resume), §3.4, §3.5.

## Files

- `src/shell/single-run.mjs` (new), `src/shell/single-run.test.mjs` (new)
- `src/shell/worktree.mjs`, `src/shell/worktree.test.mjs` (`openBaseline`, `removeBaseline`)
- `src/core/plandisplay.mjs` only if a shared step-entry helper is needed for the snapshot's `steps`

## Interface

```js
// node src/shell/single-run.mjs --control <dir> [--resume]
runSingle({ controlDir, resume = false, deps = {} }) → Promise<exitCode>
  // deps as runPlanning's, plus startLines (commands.mjs), openBaseline, removeBaseline, slugTaken
singleChecks({ kind, name, run, worktree, root, repo, indexDir, startSha, git, slugTaken }) →
  { ok: true } | { ok: false, failures: [string] }        // DESIGN §2.7, one plain line per failure
singleRunState(state, { label, sessions, since, stoppedAt, took, running }) → runState   // DESIGN §3.5 snapshot

// worktree.mjs
openBaseline(runId, { root, from }) → { path }            // detached at `from`, `.claude/worktrees/pir-{runId}-base`
removeBaseline(runId, { root }) → void                    // idempotent
```

The program uses the tested head and `git status --porcelain` at the end of each test run to fill
`commandDone.head`/`clean`. Under `PIR_RUN=1` it writes `status.json` on every change and the final
status to the snapshot and the index entry, as `plan-run.mjs` does. On SIGTERM it kills a running
command handle, closes the session and records `stopped`.

## Tests

With real git in temp repos, the fake Claude through the holder, and real `sh` test lines:

- [ ] happy path: setup runs, builder reports built, checks pass, tests green, rename to the name, reviewer reports reviewed, tests green, outcome ready
- [ ] a test line that fails once then passes (a marker file the fake session removes): red round 1 message reaches the builder with the baseline line; the retry goes green
- [ ] baseline: a test failing on the base commit too → the "also fail" line; passing on base → the "broke them" line; the baseline worktree is gone afterwards
- [ ] four reds in build → round 4 message carries the past-limit line; the step reads asking once the session stops
- [ ] built with nothing committed, with a dirty tree, with a taken name → one message each, run continues
- [ ] dropped → outcome dropped, branch kept
- [ ] setup failing at the start → builder instruction carries the setup note
- [ ] session edits after reporting (head moves) → tests run again
- [ ] stop during a test run → the command's process is gone, state stopped; resume restarts the tests
- [ ] crash mid-rename → resume finishes it; leftover baseline worktree removed on resume
- [ ] while tests run the step's phase is testing, never asking

## Done when

- [ ] a single run goes from setup to `ready` and to `dropped` in `npm test` with fake sessions and real git
- [ ] stop and resume at each step leave no orphan session, command or worktree
- [ ] `npm test` green
