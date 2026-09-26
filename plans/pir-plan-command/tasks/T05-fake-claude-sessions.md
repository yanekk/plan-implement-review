# T05 — fake-claude-sessions

**Phase:** 1 · **Depends on:** — · **Weight:** medium

## Goal

Let one fake stand in for every Claude session of a whole run: the planner, the reviewer and the build
workers, each scripted, each able to make real commits and drop real report files, reached by a
detached program through `PATH`. This is the free backend every end-to-end test of this plan runs
against.

## Design sections this implements

DESIGN §4, §5 End to end, §5.2 (fake on `PATH`).

## Files

- `src/shell/fake/claude-stream.mjs`, `src/shell/fake/claude-stream.test.mjs` (or the existing test file for it)
- `src/shell/fake/claude-shim.mjs` (new): writes the `claude` shim
- `src/shell/fake/sessions.mjs` (new): canned scripts for planner, reviewer, implement and review workers

`plans/resume-dead-worker` T02 also teaches the fake to accept `--resume`. If that has landed, extend it
rather than adding a second resume path.

## Interface

```js
// claude-stream.mjs, new script features:
//   PIR_FAKE_CLAUDE_SCRIPTS=<json file> → [{ match: <regex source>, script: [...] }]; the first user
//     message selects the first entry whose regex matches it (PIR_FAKE_CLAUDE_SCRIPT still works alone)
//   step { sh: '<command>' } → runs /bin/sh -c in the session's cwd, env includes FAKE_CWD and the
//     text of the first user message as FAKE_OPENING; a non-zero exit is emitted as an error result
//   {{reportsDir}} in a step is substituted from 'Reports folder: <path>' in the opening message
//   a resumed start (--resume <id>) continues from the step after the last one it completed, persisted
//     in <dir>/fake-progress-<session>.json
// claude-shim.mjs
export function writeClaudeShim(dir, { scriptsFile, received }) → shimPath   // dir/claude, chmod 755
// sessions.mjs
export function plannerScript({ slug, question }) → steps   // asks one AskUserQuestion, then writes a
//   minimal reviewed-ready plan (PROGRESS/PLAN/DESIGN with a valid test block, one task), commits, drops planned
export function reviewerScript({ slug }) → steps            // marks Plan reviewed, commits, drops reviewed
export function workerScripts() → [{ match, script }]       // pir-implement / pir-review: mark row, commit, report
export function noPlanScript() → steps
```

## Tests

- [ ] Two sessions from one scripts file get different scripts by their opening message.
- [ ] `sh` runs in the session's cwd and a commit it makes is visible in git.
- [ ] `{{reportsDir}}` is substituted from the opening message.
- [ ] A resumed start continues after the last completed step.
- [ ] The shim on `PATH` is what `resolveClaudePath` returns, and a worker started through `startWorker`
      with it completes one scripted turn.
- [ ] `plannerScript`'s plan passes `parsePlanReviewed` after `reviewerScript` and `parseTestBlock` before.

## Done when

- [ ] Every row passes in `npm test`; existing fake tests pass unchanged.
- [ ] No real `claude` is started by any test (the shim is always first on `PATH`).
