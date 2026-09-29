# T09 — dev-base-drill

**Phase:** 3 · **Depends on:** T05, T07 · **Weight:** heavy

## Goal

Prove the whole feature end to end in a repo that has no `main`: plan, build and hand off in a repo with
only `dev`, a `.pir/settings.json` and a local bare remote whose `dev` has moved ahead, through the real
`pir` screen and the harness with fake sessions. Make the harness base-agnostic so it can. Narrow the one
thing tests cannot reach with a single public read-only fetch.

## Design sections this implements

DESIGN §1 success criteria, §2.6–§2.9, §4, §5.1.

## Files

- `src/shell/harness/run.mjs`, `assertions.mjs` (`main-untouched` → `base-untouched`, promotion checks, the finished-line match), `fixtures.mjs`, `fixtures/pir-coordinator.mjs`, `fixtures/plan-command.mjs` (uses `mainUntouched`), `scenario.mjs`, `src/shell/fake/platform.mjs`: take the base from the fixture, default `main`
- a new fixture `src/shell/harness/fixtures/dev-base.mjs` and its scenario test
- `src/shell/plan-rig.mjs` option to seed a dev-only repo with a bare remote; a rig test
- `src/shell/harness/real-fetch-check.mjs` (new): clones nothing, inits a temp repo with this repo's public https origin as `origin`, runs `prepareBase(root, 'main')` (which creates the local main from the remote), prints the sha and the `local` action, deletes the temp dir

## Tests

- [ ] harness scenario: dev-only repo, remote dev ahead → feature cut from remote sha, all tasks merged, sync merged dev, hand-off `git switch dev && git merge pir/{slug}`, `base-untouched` holds for dev
- [ ] same scenario: the person's merge performed on the bare remote's dev only → run sees it after the watch interval and finishes
- [ ] existing scenarios still pass with the default main

## End to end (the worker drives this)

- suite: planning rig + harness · sizes: 80×24, 120×40
- [ ] `pir plan` in the dev-only repo → planner conversation opens; after the fake planner and reviewer, the go starts the build; the live view shows `preparing: syncing dev` then the dev hand-off
- [ ] the same repo with `.pir/settings.json` removed → `pir plan` prints the no-base-setting text naming both files
- [ ] the drill: use the whole flow at both sizes and judge every line that names a branch against DESIGN §2.9; fix what has one right answer with a test each

## Outside actions

- Public read-only fetch — `worker`

## Automated checks (the worker runs these)

```
node src/shell/harness/real-fetch-check.mjs
```
Record the result in FINDINGS. If the worker's sandbox cannot resolve DNS (a known limit of background
sessions), record it as unverified and ask the person to run the same command.

## Done when

- [ ] the dev-only scenario and rig tests pass in `npm test`
- [ ] the real-fetch check's result is in FINDINGS, run by the worker or the person
- [ ] no user-visible line in the drill says main
