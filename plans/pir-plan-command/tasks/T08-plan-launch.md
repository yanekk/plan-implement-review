# T08 — plan-launch

**Phase:** 1 · **Depends on:** T01, T02, T03, T04 · **Weight:** medium

## Goal

Start a planning run detached from the terminal, and resume a stopped or crashed run of either type.
This is the one entry every surface calls: the commands (T09), the brief box (T13) and the resume chord
(T11). `startRun` itself gains nothing but T03's plan home and the not-reviewed wording.

## Design sections this implements

DESIGN §2.2, §2.14 (dispatch by type), §2.16 (`pir start` on an unreviewed branch plan).

## Files

- `src/shell/launch.mjs`, `src/shell/launch.test.mjs`

## Interface

```js
export function startPlanRun(brief, { cwd, spawn, exec, fs, now, env, random }) →
    { started: true, runId, pid, record, controlDir }
  | { started: false, reason: 'not-a-repo'|'no-main'|'canonical-repo'|'empty-brief' }
//   pre-flight exactly DESIGN §2.2, then openPlanBranch, control folder <main>/plans/{runId}/.parallel/plan,
//   brief.md, initial state.json (planflow.initialPlanState), detached spawn of plan-run.mjs --control,
//   index record kind 'plan' with label, caffeinate -i -w
export function planPreflight({ cwd, exec, env }) → { ok: true, root, repo } | { ok: false, reason }
//   the pre-flight alone, so the brief box can refuse before the person types (DESIGN §2.13)
export function resumeRun(record, { spawn, exec, fs, env }) →
    { resumed: true, pid } | { resumed: false, reason }
//   kind 'plan': detached spawn of plan-run.mjs --control <record.controlDir> --resume, index pid/startTime updated
//   kind 'work': startRun(record.slug, { cwd: record.repoPath })
```

The not-reviewed refusal for a branch-home plan carries `where: 'branch'`, so `pir` can print the
resume wording of DESIGN §2.16.

## Tests

- [ ] Each pre-flight refusal, with nothing created (no branch, no folder, no index entry).
- [ ] A clean start: branch, worktree, control folder with `brief.md` and `state.json`, index record
      `kind 'plan'` with label, spawn argv and env (`PIR_RUN=1`), caffeinate argv.
- [ ] Run from a subfolder and from a linked worktree: root is the main worktree.
- [ ] Id collision: the injected random first returns a taken id (branch, index entry or `plans/{runId}/`), then a free one.
- [ ] `resumeRun` on a plan record spawns `--resume` with its control folder; on a work record calls `startRun`.
- [ ] `resumeRun` on a running record refuses `already-running`.
- [ ] `startRun` on a branch-home unreviewed plan returns `not-reviewed` with `where: 'branch'`.

## Done when

- [ ] Every row passes in `npm test` with spawn injected (no process started).
- [ ] Existing launch tests pass unchanged.
