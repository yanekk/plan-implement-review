# T06 — build-start

**Phase:** 2 · **Depends on:** T01, T02, T03 · **Weight:** medium

## Goal

Wire the base into starting and restarting a build. An existing feature branch keeps the base it records;
a hand-made plan's build resolves the settings, prepares the base and cuts the feature branch before the
detached coordinator starts, so refusals reach the person. The coordinator is told its base and holds it
for the rest of the run. `ensureMain` goes.

## Design sections this implements

DESIGN §2.5, §2.7, §2.9.

## Files

- `src/shell/launch.mjs` (`startRun`, `resumeRun`), `src/shell/coordinate.mjs` (argument parsing, start path, removal of `ensureMain`, threading `base` into the loop state the end of run reads), `src/shell/pir.mjs` (start refusal messages)
- `src/shell/coordinate.test.mjs`, `src/shell/launch.test.mjs`, and the harness/fake callers of `ensureMain`

## Interface

```js
// shell/base-branch.mjs addition (this task):
resolveRunBase(root, slug, { env, prepare = prepareBase }) →
  { ok: true, base, baseSha|null, existing: bool } | { ok: false, reason, message }
// existing branch with pirBase → { base, baseSha: null, existing: true }, no fetch
// existing branch without pirBase → settings, record pirBase, no fetch
// no branch → settings + prepareBase('start')

startRun(slug, …) → as today, plus refusal reasons; record.baseBranch; spawns coordinate with --base <b> [--base-sha <sha>]
coordinate.mjs: parses --base/--base-sha; without them calls resolveRunBase itself; openFeature({ base, from: baseSha })
```

## Tests

- [ ] `pir start` of a hand-made plan in a dev repo with a bare remote ahead → feature cut from the remote sha, pirBase=dev
- [ ] start with an existing pir/{slug} carrying pirBase=dev while settings now say stage → base stays dev, no fetch
- [ ] existing branch without pirBase → base from settings, pirBase recorded
- [ ] no settings, no branch → refused with the §2.9 text, nothing created, no process spawned
- [ ] resumeRun of a work record keeps its base
- [ ] coordinate.mjs started without --base resolves it the same way
- [ ] `ensureMain` is gone and no test references it

## Done when

- [ ] a build always knows its base from `pirBase`, and every start path refuses before spawning
- [ ] `grep ensureMain src` finds nothing
- [ ] `npm test` green
