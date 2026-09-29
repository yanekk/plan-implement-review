# T05 — plan-start

**Phase:** 2 · **Depends on:** T01, T02, T03 · **Weight:** medium

## Goal

Wire the base into starting a planning run. `pir plan`, the brief box and the dashboard's `@repo/plan`
resolve the settings, prepare the base, cut the planning branch from the prepared commit, record `pirBase`
and the run record's `baseBranch`, and refuse with §2.9's text before anything is created. The repo list
lists every git repo (no `main` or settings filter; a pick pir cannot start shows the short reason), and
the slug check reads the run's base.

## Design sections this implements

DESIGN §2.1, §2.6, §2.9, §2.11.

## Files

- `src/shell/launch.mjs` (`planPreflight`, `startPlanRun`), `src/shell/pir.mjs` (refusal messages), `src/core/planbox.mjs` (short reasons), `src/shell/repo-scan.mjs`, `src/shell/plan-run.mjs` (slug check with the run's base, via `readRunBase`)
- their tests, including per-file repo helpers that now need a settings file

## Interface

```js
planPreflight({ cwd, env }) → { ok: true, root, repo, base, baseSha, remote }
  | { ok: false, reason: 'not-a-repo'|'no-base-setting'|'bad-settings'|'no-base-branch'|'fetch-failed'|'diverged', message }
startPlanRun(brief, …) → as today, reason set widened as above; record.baseBranch = base
scanRepos(…)  // lists every repo whose .git is a directory; the refs/heads/main check is dropped
```

`message` is `refusalText(...)`; `pir.mjs` prints it, the dashboard box shows the planbox short form.

## Tests

- [ ] repo with only `dev` + settings + bare remote ahead → planning branch cut at the remote's sha, pirBase=dev, record.baseBranch=dev
- [ ] no settings → no-base-setting, nothing created (no branch, no control folder, no index record)
- [ ] unreachable remote → fetch-failed, nothing created
- [ ] repo with no remote and local dev → plans from local dev
- [ ] slug check: a plan committed on dev makes the slug taken in a dev-based run
- [ ] repo-scan: lists a dev-only repo, a repo without settings and a repo with no `main`
- [ ] `pir plan` in a repo without settings prints the §2.9 text and exits non-zero (pir.test)

## End to end (the worker drives this)

- suite: planning rig (`plan-rig.mjs`) · sizes: 80×24, 120×40
- [ ] dashboard box `@repo/plan brief` in a repo with no settings → the box shows the short no-base-setting reason and nothing starts
- [ ] same in a dev-based repo → the planner's conversation opens

## Done when

- [ ] every §2.9 refusal is reachable from `pir plan` and leaves the repo unchanged
- [ ] a dev-only repo plans end to end in the rig
- [ ] `npm test` green
