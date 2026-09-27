# T05 — box-starts-plan

**Phase:** 2 · **Depends on:** T03, T04 · **Weight:** medium

## Goal

Mount the list view in `runTui`, route its keys, and make Enter start the planning run: `startPlanRun` in
the chosen repo, then the planner landing `pir plan` already has. Prove it end to end in the plan rig and
write it into `/docs` and the README.

## Design sections this implements

DESIGN §2.3, §2.5, §3.3.

## Files

- `src/shell/pir-tui.mjs` (`runTui`: mount the list view in the list view; `onListKey` → the existing
  `decodeKey`/`dashboardReducer` path; `onSubmit` → `parseBoxText`, `startPlanRun`, the landing; a
  `startPlan` and `scanRepos` injection for tests), `pir-tui.test.mjs`
- `src/shell/plan-rig.mjs` (`PIR_REPOS` = the rig root, so its `repo` is listed), `plan-rig.test.mjs`
- `docs/planning-runs.md` (§ Starting one: the box), `docs/detached-runs.md` (the list's keys and box), `README.md`

## Interface

```js
runTui({ …, startPlan = startPlanRun, scan = scanRepos })
// onSubmit(text): r = parseBoxText(text, repos, { roots }) → !r.ok: note = r.note
//   → else s = startPlan(r.brief, { cwd: r.repo.path, env, kill, exec }) → started: reset box,
//     ui = { ...initialUi(), view: 'watch', openSlug: s.runId, openKey: `${s.record.repo}__${s.runId}`, openStep: 'plan' }
//   → refused or threw: note = startFailedNote(r.repo.name, reason)
```

## Tests

- [ ] With a fake `startPlan`: Enter on `@repo a brief` calls it once with `cwd` the repo path and brief `a brief`.
- [ ] Each §2.5 refusal leaves `startPlan` uncalled, the text kept and the note shown.
- [ ] `startPlan` returning `{ started: false, reason: 'no-main' }` and throwing both give the start-failed note.
- [ ] On a bare box every key of today's list table reaches the reducer exactly as before (the existing list tests pass unchanged).
- [ ] Leaving the list for a run and coming back shows `@`.

## Done when

- [ ] Typed in the rig, `@repo a brief` then Enter lands in the fake planner's conversation.
- [ ] `docs/planning-runs.md`, `docs/detached-runs.md` and `README.md` describe the box as built.
- [ ] `npm test` green.

## End to end (the worker drives this)

- suite: `plan-rig.test.mjs` (driveScreen) · sizes: 80×24, 120×40
- [ ] `pir` → bare box → type `@re`, the pop-up lists `@repo`; Tab; type a brief; Enter → `starting the planner…`, then the fake planner's first message.
- [ ] `@nope x` Enter → `no repo @nope in …` note, text kept; Esc → `@`; Esc → `pir` exits 0.
- [ ] ↑↓ and → on a bare box still open a listed run.
