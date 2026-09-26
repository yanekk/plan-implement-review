# T03 — repo-scan

**Phase:** 1 · **Depends on:** T02 · **Weight:** light

## Goal

Find the repos the `@` list offers: every git repo directly inside `~/src` or the `PIR_REPOS` roots that
has a local `main`, with the time it was last worked in, ranked by T02's `rankRepos`.

## Design sections this implements

DESIGN §2.4 (roots, what counts, the mtime), §2.5 (`{roots}` display string).

## Files

- `src/shell/repo-scan.mjs` (new), `src/shell/repo-scan.test.mjs` (new)

## Interface

```js
export function repoRoots(env = process.env) → string[]          // absolute; PIR_REPOS split on ':', ~ → env.HOME, empties dropped; default [HOME/src]
export function rootsLabel(roots, env) → string                  // '~/src' or '~/src, ~/code' — HOME shown as ~
export function scanRepos({ env, fs, exec } = {}) → [{ name, path, mtimeMs }]   // ranked (rankRepos)
//   exec(cmd, args, opts) is the injected git call; default execFileSync. Never throws on a bad root or repo.
```

## Tests

- [ ] Default root is `$HOME/src` from the env passed in, not `os.homedir()` (the plan rig sets HOME).
- [ ] `PIR_REPOS=a::~/b` gives two roots, `~` expanded.
- [ ] A missing root is skipped; a file in a root is skipped; a folder without `.git` is skipped.
- [ ] A linked worktree (its `.git` is a file) is skipped.
- [ ] A repo with no local `main` (only `master`) is skipped.
- [ ] Order follows the newest of `.git/index`, `.git/HEAD`, `.git/logs/HEAD` (set with `utimesSync`); a repo missing all three sorts last.
- [ ] A repo whose git call fails is skipped, the rest still listed.

## Done when

- [ ] `scanRepos` over temp folders with real `git init` returns exactly the qualifying repos, ranked.
- [ ] `npm test` green.
