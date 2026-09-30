# T02 — base-git

**Phase:** 1 · **Depends on:** T01 · **Weight:** heavy

## Goal

The world-touching half of choosing the base: read the two settings files, pick the remote, run a
bounded `ls-remote` and `fetch` that can never hang on a prompt, gather the facts `decideBase` needs,
apply its create or fast-forward, and return the commit to use. Also make every shared test-repo helper
carry a settings file, and give this repo its own, so the later wiring tasks do not break the suite.

## Design sections this implements

DESIGN §2.1, §2.3, §2.4, §2.10 (this repo's settings), §5 (test repos need settings).

## Files

- `src/shell/base-branch.mjs` (new), `src/shell/base-branch.test.mjs` (new)
- `.pir/settings.json` (new, `{"baseBranch": "main"}`)
- `src/shell/fake/worktree.mjs`, `src/shell/harness/fixtures.mjs` (`seedGit`), `src/shell/plan-rig.mjs`: commit `.pir/settings.json` naming `main` in every repo they create

## Interface

```js
// root: primary checkout. env for PIR_HOME/HOME. Reads <root>/.pir/settings.json and
// ${PIR_HOME??HOME}/.pir/<basename(root)>/settings.json, returns effectiveBase(...) from T01.
resolveBaseSetting(root, { env, fs }) → effectiveBase result

pickRemote(root, base) → string|null           // §2.4

// §2.3 end to end. mode 'start' may create/ff; mode 'watch' only fetches and never moves the local branch.
prepareBase(root, base, { mode = 'start', timeoutMs = 30000, git, env }) →
  { ok: true, sha, remote, local: 'keep'|'create'|'ff'|'ff-refused' } | { ok: false, reason, ...details for refusalText }
```

Network calls get `GIT_TERMINAL_PROMPT=0` and, when neither `GIT_SSH_COMMAND` nor `core.sshCommand` is set,
`GIT_SSH_COMMAND='ssh -o BatchMode=yes'`, through `spawnSync` with `timeout`. A fast-forward git refuses
is reported as `ff-refused` and the tracking sha is still returned.

## Tests

All with real git in temp dirs and a local bare repo as the remote; `PIR_HOME` pointed at a temp dir.

- [ ] resolveBaseSetting: repo file only, user file overrides, neither, broken user file
- [ ] pickRemote: upstream set, origin only, other-named remote only → null, no remotes → null
- [ ] no remote, local present → local sha, no fetch attempted
- [ ] remote ahead, local not checked out → local fast-forwarded, remote sha returned
- [ ] remote ahead, local checked out and clean → fast-forwarded in that worktree
- [ ] remote ahead, local checked out with a modified tracked file → not moved, remote sha returned
- [ ] local missing, remote has it → local created tracking the remote
- [ ] local ahead → local sha, nothing moved; split → diverged
- [ ] remote lacks the branch → local used; lacks and no local → no-base-branch
- [ ] remote path that does not exist → fetch-failed, returned quickly, nothing created
- [ ] mode 'watch' never moves or creates the local branch
- [ ] the env of the network call carries GIT_TERMINAL_PROMPT=0 (injected git spy)

## Done when

- [ ] `prepareBase` covers every §2.3 row against real git, and no test uses the network
- [ ] this repo and every shared test-repo helper carry `.pir/settings.json`
- [ ] `npm test` green
