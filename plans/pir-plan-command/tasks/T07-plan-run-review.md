# T07 — plan-run-review

**Phase:** 1 · **Depends on:** T06 · **Weight:** heavy

## Goal

The planning program's second half: rename the branch, worktree, control folder and index entry once
the planner is done, run a fresh reviewer, finish on its report, and resume any step by reopening its
session. After this task a planning run goes from brief to a reviewed plan on `pir/{slug}` headless.

## Design sections this implements

DESIGN §2.6, §2.7, §2.14 (the plan side), §2.16.

## Files

- `src/shell/plan-run.mjs`, `src/shell/plan-run.test.mjs`
- `src/shell/worker-proc.mjs`, its test: a `resume` option. `plans/resume-dead-worker` T02 plans the same
  option with the same interface; if it has landed, reuse it and add nothing here

## Interface

```js
// worker-proc.mjs (exactly one of sessionId / resume, as resume-dead-worker T02 defines it)
workerOptions({ ..., resume })   // when resume is set: options.resume = resume and no sessionId
startWorker({ ..., resume })     // the session's id is then read from the init event, logged as today
```

```
plan-run.mjs, rename executor: renamePlanBranch (T04), then fs.renameSync of the control folder to
  <main>/plans/{slug}/.parallel/plan (mkdir -p its parent), then renameRecord (T02); every held path
  (log, reports, inbox, workers.json, snapshot) re-pointed before the reviewer spawns
--resume: reads state.json, finishes a half-done rename, then spawns the current step with
  resumeSessionId = its last session id; the resumed session gets no new opening instruction
```

## Tests

With the T05 shim, in a scratch repo:

- [ ] Planner → `planned` → rename → reviewer spawned in `.claude/worktrees/pir-{slug}` with the exact
      reviewer instruction → `reviewed` → finished `reviewed`; branch `pir/{slug}` holds the reviewed plan;
      `main` unchanged; control folder now under `plans/{slug}/.parallel/plan`; index key `{repo}__{slug}`.
- [ ] `reviewed` while `PROGRESS.md` is not marked: reviewer gets the failure message.
- [ ] `reviewed` with a dirty worktree: reviewer gets the failure message; nothing committed by `pir`.
- [ ] `not-reviewed`: finished `not-reviewed`.
- [ ] Crash after the branch rename only, then `--resume`: rename completes, reviewer starts.
- [ ] SIGKILL mid-planner then `--resume`: the planner session resumes (fake continues its script) with
      the same session id, and no second opening instruction is sent.
- [ ] `--resume` on `not-reviewed` reopens the reviewer's session.
- [ ] `--resume` on a finished `reviewed` run exits 0 doing nothing.

## Done when

- [ ] Every row passes in `npm test` with no real `claude`.
- [ ] A full headless run brief → reviewed plan takes under 30 s in the suite.
- [ ] Existing worker-proc and platform tests pass unchanged.
