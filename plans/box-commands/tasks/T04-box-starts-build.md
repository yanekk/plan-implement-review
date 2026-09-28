# T04 — box-starts-build

**Phase:** 2 · **Depends on:** T01, T02, T03 · **Weight:** medium

## Goal

Wire it into `pir`: `runTui` hands the list view the plan scan and the running test, and Enter on a
`/start` text starts, or opens, the build through `startRun` and lands in its live view, while `/plan` keeps
today's planning path. Prove both end to end in the plan rig and write the box's new grammar into `/docs`
and the README.

## Design sections this implements

DESIGN §2.4, §2.5, §3.4.

## Files

- `src/shell/pir-tui.mjs` (`runTui`: `scanPlans` injection passed to the list view as `plansOf` (the view caches it, T03), `building`
  from the latest dashboard rows, `submitBox` dispatching on `command`), `src/shell/pir-tui.test.mjs`
- `src/shell/plan-rig.test.mjs` (the end-to-end cases below)
- `docs/planning-runs.md` (§ The new-plan box), `docs/detached-runs.md` (the list's box), `README.md`
  (the dashboard box paragraph and the keys table)

## Interface

```js
runTui({ …, start = startRun, startPlan = startPlanRun, scan = scanRepos, scanBuildable = scanPlans })
// submitBox(text): r = parseBoxText(text, repos, { roots, plansOf })
//   !r.ok → note (ambiguous paths tildified, as today)
//   plan  → today's path, unchanged
//   start → s = start(r.slug, { cwd: r.repo.path, env, kill, exec })
//           started | alreadyRunning → box reset, ui = { ...initialUi(), view: 'watch', openSlug: r.slug, openKey: <the run's list key> }
//           refused or threw → note = startBuildFailedNote(r.repo.name, r.slug, reason)
```

`openKey` must be the key `findOpen` matches for a build run of that repo and slug (`runKey` on its dashboard
row); read `dashboard.mjs` for its shape rather than assuming the planning run's `{repo}__{runId}` form.

## Tests

- [ ] With a fake `start`: Enter on `@repo/start foo` calls it once with `cwd` the repo path and slug `foo`; `startPlan` not called.
- [ ] `alreadyRunning` lands in the live view the same as `started`; each refusal and a throw give the §2.4 note, text kept.
- [ ] Enter on `@repo/plan a brief` calls `startPlan` exactly as before; `@repo a brief` calls neither and gives the no-command note.
- [ ] `building` is true for a row running that slug in that repo and false for the same slug in another repo.
- [ ] Two repos with the same slug: the landing opens the one in the chosen repo.

## Done when

- [ ] In the rig, the keys below start the fake build and show its live view, and `/plan` still lands in the planner.
- [ ] `docs/planning-runs.md`, `docs/detached-runs.md` and `README.md` describe `@repo/plan` and `@repo/start` as built, and no longer the old form.
- [ ] `npm test` green.

## End to end (the worker drives this)

- suite: `plan-rig.test.mjs` (`startPlanRig` + `driveScreen`), the `coordinator-drill` set so the rig repo holds the reviewed `DRILL_SLUG` · sizes: 80×24, 120×40
- [ ] `pir` → type `@re`, Enter → `@repo/` with `plan` and `start` listed; Enter on `start` → the slug list shows `DRILL_SLUG` with `0/3 done`; Enter; Enter → the build's live view.
- [ ] Back on the list with the build running, `@repo/start ` shows `· building`; Enter on it opens the same live view, no second run.
- [ ] `@repo/plan a brief` Enter (happy set) → the fake planner's conversation.
- [ ] `@repo a brief` Enter → the no-command note, text kept; `@repo/start nope` Enter → the unknown-slug note.
