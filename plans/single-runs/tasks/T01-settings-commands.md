# T01 — settings-commands

**Phase:** 1 · **Depends on:** — · **Weight:** light

## Goal

Teach the base-branch settings files the `setup` and `test` keys a single run needs, merged the way
`baseBranch` is, with a refusal that names the file and the exact line to add. Give this repo and every
shared test-repo helper those keys, so the later tasks and the suite can start single runs.

## Design sections this implements

DESIGN §2.2, §2.3 (the `bad-settings`/`no-commands` refusals).

## Files

- `src/core/basebranch.mjs`, `src/core/basebranch.test.mjs`
- `src/shell/base-branch.mjs`, `src/shell/base-branch.test.mjs`
- `.pir/settings.json` (this repo: add `"setup": ["test ! -f package-lock.json || npm ci"]`, `"test": ["npm test"]`)
- the test-repo helpers base-branch T02 gave a settings file (`src/shell/fake/worktree.mjs`,
  `src/shell/harness/fixtures.mjs` `seedGit`, `src/shell/plan-rig.mjs`): add `"setup": []` and a
  `"test"` line that passes in their repos (e.g. `["true"]`)

## Interface

```js
// basebranch.mjs — parseSettings keeps its signature; settings may now also hold setup/test.
parseSettings(text, source) → { ok: true, settings: { baseBranch?, setup?: string[], test?: string[] } }
  | { ok: false, reason: 'bad-settings', file, why }
// why for the new keys: '"setup" must be a list of commands', '"test" must be a non-empty list of commands'

// repo/user: parseSettings results. User overrides repo per key (setup and test independently);
// either !ok → that error, repo checked first (same order as effectiveBase).
effectiveCommands({ repo, user, repoFile, userFile }) →
  { ok: true, setup: string[], test: string[] } | { ok: false, reason: 'no-commands', missing: ['setup'|'test', …] }
  | { ok: false, reason: 'bad-settings', file, why }

commandsRefusalText(result, { repo, repoFile, userFile }) → string
// no-commands: `{repo} has no setup/test commands for a single run. Add to {repoFile} (or {userFile}):
//   "setup": ["<install command>"], "test": ["<test command>"]` — names only the missing keys
// bad-settings: `{file}: {why}`

// base-branch.mjs
resolveSettings(root, { env, fs }) → { repo: parseSettings result, user: parseSettings result, repoFile, userFile }
// resolveBaseSetting keeps working, now built on resolveSettings.
```

## Tests

- [ ] parseSettings: `setup: []` ok; `setup: ["a","b"]` ok; `setup` string, number, `[""]`, `[1]` → bad-settings with the why
- [ ] parseSettings: `test: []` → bad-settings; `test: ["npm test"]` ok; unknown keys still ignored
- [ ] effectiveCommands: repo only; user only; user overrides test but repo's setup kept; neither → missing both; only setup anywhere → missing ['test']
- [ ] effectiveCommands: bad repo file with good user file → bad-settings naming the repo file
- [ ] commandsRefusalText names both files and only the missing keys
- [ ] resolveSettings reads both files from a temp `PIR_HOME`; absent files read as empty settings
- [ ] this repo's `.pir/settings.json` parses and yields `npm test`

## Done when

- [ ] the interface above is exported and the boundary test passes
- [ ] every helper that makes a test repo writes setup/test keys, and this repo has its own
- [ ] `npm test` green
