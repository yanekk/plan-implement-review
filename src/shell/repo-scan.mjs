// repo-scan.mjs — the repos the plan box's `@` list offers (dashboard-plan-box DESIGN §2.4, §2.5).
//
// Every git repo directly inside each root that has a local `main`, with the time it was last worked
// in, ranked by planbox.rankRepos. Shell side: it reads the disk and runs git, so the filesystem and
// the git call are injectable and the ranking stays in the pure core.

import * as nodeFs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { rankRepos } from '../core/planbox.mjs';

// HOME comes from the env passed in, not os.homedir(): the plan rig points HOME at a scratch folder
// and the scan must follow it. os.homedir() is only the fallback when the env has no HOME at all.
function homeOf(env) {
  return env.HOME || homedir();
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

function defaultExec(cmd, args, opts) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], ...opts });
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

// scanRepos({ env, fs, exec }) → [{ name, path, mtimeMs }] ranked. Never throws on a bad root or repo:
// a root that is missing or unreadable, an entry that is not a folder, a folder whose `.git` is not a
// directory (a linked worktree's `.git` file — its main worktree is the repo), or a repo whose git
// call fails or finds no local `main` is skipped and the rest are still listed.
export function scanRepos({ env = process.env, fs = nodeFs, exec = defaultExec } = {}) {
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
        // `pir plan` refuses a repo without a local main, so the list offers only repos where Enter
        // works. --verify --quiet exits non-zero (exec throws) when the ref is absent.
        exec('git', ['rev-parse', '--verify', '--quiet', 'refs/heads/main'], { cwd: path });
      } catch {
        continue;
      }
      repos.push({ name, path, mtimeMs: lastWorked(fs, gitDir) });
    }
  }
  return rankRepos(repos);
}
