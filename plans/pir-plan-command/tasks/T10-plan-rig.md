# T10 — plan-rig

**Phase:** 2 · **Depends on:** T05 · **Weight:** medium

## Goal

A rig that runs the real `pir` screen in a scratch repo against fake sessions, so every screen task of
this plan proves itself end to end in `npm test` through a real pseudo-terminal. It extends the
existing conversation rig's screen driver; it does not add a second one.

## Design sections this implements

DESIGN §4, §5 End to end, §5.2.

## Files

- `src/shell/plan-rig.mjs` (new), `src/shell/plan-rig.test.mjs` (new)
- `src/shell/conversation-rig.mjs` only if `openScreen`/`driveScreen` need an extra option (env passthrough
  is already there)

## Interface

```js
export function startPlanRig({ into = null, scripts = 'happy', keep = false }) →
    { repoDir, home, env, shimDir, cleanup() }
//   scratch git repo on main with one committed file and package.json whose test is `node -e 0`;
//   a scratch PIR_HOME (index) and HOME-independent paths; the T05 shim first on PATH with the chosen
//   script set: 'happy' (planner asks one question, plans; reviewer reviews; workers build),
//   'no-plan', 'taken-slug', 'crash-planner'
// plus re-exports of openScreen / driveScreen bound to { cwd: repoDir, env }
```

## Tests

- [ ] `startPlanRig` builds the scratch repo and `cleanup()` removes it and any worktrees.
- [ ] One end-to-end test: under the rig, `pir` (bare) opens and the screen shows the empty-runs line;
      this proves the pty, the env and the shim reach the real `pir.mjs`.

## Done when

- [ ] Both pass in `npm test` within the existing 90 s rig budget.
- [ ] No real `claude` or real `~/.pir` is touched (asserted by the test via the env it passes).

## End to end (the worker drives this)

- suite: `src/shell/plan-rig.test.mjs` · sizes: 80×24
- [ ] `pir` with no runs → `No runs yet` line visible
