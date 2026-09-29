# T05 — single-launch

**Phase:** 2 · **Depends on:** T01, T02 · **Weight:** medium

## Goal

Start a single run and resume one: the preflight (repo, base branch, commands, prompt), the run id, the
branch and worktree, the control folder, the detached program and the index entry, and `resumeRun` for
`kind: 'single'`. This is the one call the dashboard box makes.

## Design sections this implements

DESIGN §2.3, §2.11 (resume spawn), §3.5 (record fields).

## Files

- `src/shell/launch.mjs`, `src/shell/launch.test.mjs`

## Interface

```js
startSingleRun(prompt, { cwd, spawn, exec, fs, now, env, random }) →
  { started: true, runId, pid, record, controlDir }
  | { started: false, reason: 'not-a-repo'|<base-branch reasons>|'bad-settings'|'no-commands'|'empty-prompt', message }
// message: refusalText / commandsRefusalText, for callers that show a full line
singleRunPath() → absolute path of src/shell/single-run.mjs
resumeRun(record, …)   // kind 'single' → spawnDetached([singleRunPath(), '--control', dir, '--resume']); clears finalState
```

Reuse `spawnDetached`, `keepAwake`, `runIdTaken` (generalised to any id), `writeFileAtomic`,
`writeJsonAtomic`, `labelFromBrief` and `openPlanBranch`. `state.json` is `initialSingleState` from T02,
with the commands from `effectiveCommands` and the base and commit from `planPreflight`.

## Tests

- [ ] refusal order: not a repo; base refusal; bad settings; no commands (message names both files); empty prompt; nothing created in any case
- [ ] started: branch `pir/single-{hex4}` at the base commit, worktree, control folder with prompt.md and state.json holding the commands, index entry kind single with label and baseBranch
- [ ] id redrawn when branch, index entry or `plans/single-{hex4}` exists
- [ ] the spawn is detached with `PIR_RUN=1` and `run.log`, and caffeinate is started
- [ ] resumeRun on a stopped single record spawns `--resume`; on a running one → already-running; a plan and a work record behave as before

## Done when

- [ ] `startSingleRun` and `resumeRun` behave as above with a fake spawn and real git
- [ ] no planning or build launch test changed
- [ ] `npm test` green
