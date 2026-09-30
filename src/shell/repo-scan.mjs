// repo-scan.mjs — the repos the plan box's `@` list offers (dashboard-plan-box DESIGN §2.4, §2.5).
//
// Every git repo directly inside each root, with the time it was last worked in, ranked by
// planbox.rankRepos. No branch or settings check (base-branch DESIGN §2.6): a repo pir cannot start in
// is still listed, and picking it shows the short reason, rather than vanishing from the list with no
// hint why. Shell side: it reads the disk, so the filesystem is injectable and the ranking stays in the
// pure core. It runs no git and no network call.

import * as nodeFs from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { rankRepos } from '../core/planbox.mjs';

// HOME comes from the env passed in, not os.homedir(): the plan rig points HOME at a scratch folder
// and the scan must follow it. os.homedir() is only the fallback when the env has no HOME at all.
// Normalised so a HOME with a trailing slash still matches the roots rootsLabel shows as `~`.
function homeOf(env) {
  return resolve(env.HOME || homedir());
}

// repoRoots(env) → absolute roots. PIR_REPOS split on ':', `~` expanded against env.HOME, empty
// entries dropped; unset or all-empty, the one root is $HOME/src (§2.4).
export function repoRoots(env = process.env) {
  const home = homeOf(env);
  const roots = String(env.PIR_REPOS ?? '')
    .split(':')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s === '~' ? home : s.startsWith('~/') ? join(home, s.slice(2)) : resolve(s)));
  return roots.length ? roots : [join(home, 'src')];
}

// rootsLabel(roots, env) → the roots as the person would type them, HOME shown as `~` (§2.5 {roots}).
export function rootsLabel(roots, env = process.env) {
  const home = homeOf(env);
  return (roots ?? [])
    .map((r) => (r === home ? '~' : r.startsWith(home + '/') ? '~' + r.slice(home.length) : r))
    .join(', ');
}

// The newest mtime of the three files that move on commit, checkout and staging (§2.4); 0 when none
// exists, so such a repo sorts last.
function lastWorked(fs, gitDir) {
  let newest = 0;
  for (const f of ['index', 'HEAD', join('logs', 'HEAD')]) {
    try {
      newest = Math.max(newest, fs.statSync(join(gitDir, f)).mtimeMs);
    } catch {
      // missing file: contributes nothing
    }
  }
  return newest;
}

// scanRepos({ env, fs }) → [{ name, path, mtimeMs }] ranked. Never throws on a bad root or repo: a
// root that is missing or unreadable, an entry that is not a folder, or a folder whose `.git` is not a
// directory (a linked worktree's `.git` file — its main worktree is the repo) is skipped and the rest
// are still listed.
export function scanRepos({ env = process.env, fs = nodeFs } = {}) {
  const repos = [];
  for (const root of repoRoots(env)) {
    let entries;
    try {
      entries = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const name of entries) {
      const path = join(root, name);
      const gitDir = join(path, '.git');
      try {
        if (!fs.statSync(path).isDirectory()) continue;
        if (!fs.statSync(gitDir).isDirectory()) continue;
      } catch {
        continue;
      }
      repos.push({ name, path, mtimeMs: lastWorked(fs, gitDir) });
    }
  }
  return rankRepos(repos);
}
