# T01 — drop-canonical-guard

**Phase:** 1 · **Depends on:** — · **Weight:** light

## Goal

`pir plan`, the new box and `pir start` refuse to work inside the `plan-implement-review` checkout unless
`PARALLEL_ALLOW_HERE=1`. The user builds this project with the flag set anyway, so the guard protects
against nothing they fear. Remove it, and the variable with it, everywhere but the harness's paid-scenario
guard, which switches to `--into` alone.

## Design sections this implements

DESIGN §2.8.

## Files

- `src/shell/coordinate.mjs` (`canPromoteHere`, `CANONICAL_REPO` and the LIVE refusal in `main`), `coordinate.test.mjs`
- `src/shell/launch.mjs` (`planPreflight` step 3 and its import; the `canonical-repo` reason in the `startPlanRun` comment), `launch.test.mjs`
- `src/shell/pir.mjs` (`PLAN_REFUSALS['canonical-repo']`), `pir.test.mjs`
- `src/shell/harness/run.mjs` (`allowHere` in `seatbeltEnv`, the three scenario runners and `planEnv`; `main`'s guard keeps `--into` as its only override), `harness/run.test.mjs`, `harness/run-plan.test.mjs`
- `src/shell/plan-rig.mjs` (the comment and the `delete env.PARALLEL_ALLOW_HERE`; keep dropping it harmlessly or remove, either way no test depends on it), `plan-rig.test.mjs`
- `src/shell/pir-tui.test.mjs` line ~414 uses the old refusal text as sample data: leave it or update it, it asserts nothing about the guard
- `docs/run-lifecycle.md` (step 4, renumber), `docs/planning-runs.md` (pre-flight list: two refusals, not three), `README.md` wherever it mentions the flag

## Interface

```
planPreflight({ cwd, env }) → { ok: true, root, repo } | { ok: false, reason: 'not-a-repo'|'no-main' }
startPlanRun(...)           → reasons: 'not-a-repo'|'no-main'|'empty-brief'
harness run.mjs main: refuses in a cwd named plan-implement-review unless --into <dir> is given
```

## Tests

- [ ] `startPlanRun` in a scratch repo named `plan-implement-review`, env without the variable, starts.
- [ ] `planPreflight` never returns `canonical-repo`; the old test is replaced, not deleted silently.
- [ ] `pir plan` has no `canonical-repo` message left (`PLAN_REFUSALS` has two pre-flight keys plus `empty-brief`).
- [ ] `planEnv` no longer sets or reads `PARALLEL_ALLOW_HERE`; an inherited one is still dropped, so an outer shell cannot leak it into a fixture.
- [ ] `git grep PARALLEL_ALLOW_HERE -- src docs README.md` finds only the inherited-variable drops (`planEnv`, and `plan-rig.mjs` if kept), their tests, and comments saying it is gone.

## Done when

- [ ] No code path refuses planning or building because of the repo's name; `npm test` green.
- [ ] The harness live launcher still refuses in the canonical checkout without `--into`.
- [ ] `docs/` and `README.md` say the guard is gone, and nothing still tells a person to set the flag.
