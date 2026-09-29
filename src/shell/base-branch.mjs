// The world-touching half of choosing the base branch (plans/base-branch DESIGN §2.1, §2.3, §2.4):
// read the two settings files, pick the remote, ask it for the branch and fetch it with calls that can
// never hang on a prompt, gather the facts the pure decideBase (src/core/basebranch.mjs) rules on, apply
// its create or fast-forward, and return the commit to cut from or merge. pir reads from the remote and
// never writes to it: nothing here pushes.

import { spawnSync } from 'node:child_process';
import * as nodeFs from 'node:fs';
import { basename, join } from 'node:path';
import { parseSettings, effectiveBase, decideBase, refusalText } from '../core/basebranch.mjs';

export const REPO_SETTINGS = join('.pir', 'settings.json');
export const DEFAULT_FETCH_TIMEOUT_MS = 30000;

// defaultGit(args, { cwd, env, timeout }) → { status, stdout, stderr, timedOut }. Never throws: every
// caller branches on the exit status (ls-remote's 0/2/other is the whole answer, §2.3 step 2).
// spawnSync's own timeout bounds the call; macOS has no GNU `timeout` (FINDINGS 2026-09-29).
export function defaultGit(args, { cwd, env, timeout } = {}) {
  const r = spawnSync('git', args, {
    cwd,
    env: env ?? process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...(timeout ? { timeout } : {}),
  });
  const timedOut = r.error?.code === 'ETIMEDOUT';
  return {
    status: r.status,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? (r.error ? String(r.error.message) : ''),
    timedOut,
  };
}

// The two files of §2.1. The user file sits under ${PIR_HOME ?? HOME}/.pir/{repo}, {repo} being the
// primary checkout's folder name, the same name the run index uses.
export function settingsPaths(root, env = process.env) {
  const repo = basename(root);
  const home = env.PIR_HOME ?? env.HOME;
  return { repo, repoFile: join(root, REPO_SETTINGS), userFile: join(home, '.pir', repo, 'settings.json') };
}

// resolveBaseSetting(root, { env, fs }) → effectiveBase result ({ ok, base, file } or a refusal).
// The primary checkout's working tree is read, not a committed tree: the setting decides which branch
// to read, so it cannot be read from that branch (§2.1). The refusal's `file` is the path a person can
// open: the repo file relative to the repo, the user file in full.
export function resolveBaseSetting(root, { env = process.env, fs = nodeFs } = {}) {
  const { repo, repoFile, userFile } = settingsPaths(root, env);
  const repoLabel = REPO_SETTINGS;
  const userLabel = userFile;
  const read = (path, label) => {
    let text;
    try {
      text = fs.readFileSync(path, 'utf8');
    } catch (err) {
      if (err?.code === 'ENOENT') return parseSettings(null, label);
      // A file that exists but cannot be read (a folder, no permission) is a broken file (§2.2).
      return { ok: false, reason: 'bad-settings', file: label, why: `it cannot be read (${err?.code ?? err?.message})` };
    }
    return parseSettings(text, label);
  };
  const result = effectiveBase({
    repo: read(repoFile, repoLabel),
    user: read(userFile, userLabel),
    repoFile: repoLabel,
    userFile: userLabel,
  });
  return result.ok ? result : { ...result, repo };
}

// pickRemote(root, base, { git }) → string|null (§2.4). The base's configured upstream if it names a
// real remote (`.` is a local upstream, not a remote), else `origin` if it exists, else none. A repo
// whose only remotes have other names is treated as having no remote.
export function pickRemote(root, base, { git = defaultGit } = {}) {
  const listed = git(['remote'], { cwd: root });
  const remotes = listed.status === 0 ? listed.stdout.split('\n').map((s) => s.trim()).filter(Boolean) : [];
  const upstream = git(['config', '--get', `branch.${base}.remote`], { cwd: root });
  const name = upstream.status === 0 ? upstream.stdout.trim() : '';
  if (name && remotes.includes(name)) return name;
  return remotes.includes('origin') ? 'origin' : null;
}

// The env every network call runs under (§2.4): no terminal prompt, and ssh in batch mode unless the
// person configured their own ssh command, so an expired login fails at once instead of waiting on a
// prompt nobody can see in a detached run.
export function networkEnv(root, { env = process.env, git = defaultGit } = {}) {
  const out = { ...env, GIT_TERMINAL_PROMPT: '0' };
  if (!env.GIT_SSH_COMMAND) {
    const configured = git(['config', '--get', 'core.sshCommand'], { cwd: root, env });
    if (configured.status !== 0 || !configured.stdout.trim()) out.GIT_SSH_COMMAND = 'ssh -o BatchMode=yes';
  }
  return out;
}

function revParse(root, ref, git) {
  const r = git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: root });
  return r.status === 0 ? r.stdout.trim() : null;
}

function isAncestor(root, a, b, git) {
  return git(['merge-base', '--is-ancestor', a, b], { cwd: root }).status === 0;
}

// Where `base` is checked out, if anywhere: { path, clean } or null. Clean means no tracked file is
// modified or staged; untracked files do not count (§2.3), and a fast-forward that would overwrite one
// is refused by git itself and reported as ff-refused.
function findCheckout(root, base, git) {
  const r = git(['worktree', 'list', '--porcelain'], { cwd: root });
  if (r.status !== 0) return null;
  let path = null;
  for (const line of r.stdout.split('\n')) {
    if (line.startsWith('worktree ')) path = line.slice('worktree '.length);
    else if (line === `branch refs/heads/${base}` && path) {
      const st = git(['status', '--porcelain', '--untracked-files=no'], { cwd: path });
      return { path, clean: st.status === 0 && st.stdout.trim() === '' };
    }
  }
  return null;
}

function failText(r, what, timeoutMs) {
  if (r.timedOut) return `${what} timed out after ${Math.round(timeoutMs / 1000)} s`;
  return (r.stderr || r.stdout || '').trim() || `${what} exited ${r.status}`;
}

// prepareBase(root, base, { mode, timeoutMs, git, env }) →
//   { ok: true, sha, remote, local: 'keep'|'create'|'ff'|'ff-refused'|'create-refused' }
//   | { ok: false, reason, base, remote, ... }   (the rest is what refusalText needs)
// §2.3 end to end. mode 'start' applies decideBase's create or fast-forward; mode 'watch' (the
// ready-to-merge check, §2.8) only fetches and never creates or moves the local branch, reporting
// local 'keep'. A move git refuses leaves the local branch where it was and still returns the chosen
// commit: work starts from the newest commit, and the person's copy moves only when that is safe.
export function prepareBase(root, base, { mode = 'start', timeoutMs = DEFAULT_FETCH_TIMEOUT_MS, git = defaultGit, env = process.env } = {}) {
  const remote = pickRemote(root, base, { git });
  const localRef = `refs/heads/${base}`;
  const local = revParse(root, localRef, git);
  const facts = { remote, local, reached: false, remoteHas: false, fetchError: null, tracking: null };

  if (remote) {
    const netEnv = networkEnv(root, { env, git });
    // One deadline across both calls, so the whole preparation is bounded by timeoutMs.
    const deadline = Date.now() + timeoutMs;
    const left = () => Math.max(1, deadline - Date.now());
    // The full ref as the pattern: a bare `dev` would also match `feature/dev`.
    const ls = git(['ls-remote', '--exit-code', '--heads', remote, localRef], { cwd: root, env: netEnv, timeout: left() });
    if (ls.status === 0 || ls.status === 2) {
      facts.reached = true;
      facts.remoteHas = ls.status === 0;
    } else {
      facts.fetchError = failText(ls, 'git ls-remote', timeoutMs);
    }
    if (facts.remoteHas) {
      const trackingRef = `refs/remotes/${remote}/${base}`;
      const fetch = git(['fetch', '--no-tags', '--quiet', remote, `+${localRef}:${trackingRef}`], {
        cwd: root,
        env: netEnv,
        timeout: left(),
      });
      if (fetch.status !== 0) facts.fetchError = failText(fetch, 'git fetch', timeoutMs);
      else facts.tracking = revParse(root, trackingRef, git);
      if (!facts.fetchError && !facts.tracking) facts.fetchError = `fetch left no ${trackingRef}`;
    }
    if (local && facts.tracking) {
      facts.localInTracking = isAncestor(root, local, facts.tracking, git);
      facts.trackingInLocal = isAncestor(root, facts.tracking, local, git);
      if (!facts.localInTracking && !facts.trackingInLocal) {
        const c = git(['rev-list', '--left-right', '--count', `${local}...${facts.tracking}`], { cwd: root });
        const [a, b] = c.stdout.trim().split(/\s+/).map(Number);
        facts.aheadBehind = c.status === 0 ? { local: a, remote: b } : null;
      }
      facts.checkout = findCheckout(root, base, git);
    }
  }

  const d = decideBase(facts);
  if (!d.ok) return { ...d, base, remote: d.remote ?? remote };
  const done = (localState) => ({ ok: true, sha: d.use, remote, local: localState });
  if (mode === 'watch' || d.local === 'keep') return done('keep');

  if (d.local === 'create') {
    // Not `git branch --track`: it refuses a start point no fetch refspec covers, which is every base
    // other than the cloned one in a --single-branch clone. Tracking is just these two config keys.
    const r = git(['branch', '--no-track', base, d.use], { cwd: root });
    if (r.status !== 0) return done('create-refused');
    git(['config', `branch.${base}.remote`, remote], { cwd: root });
    git(['config', `branch.${base}.merge`, localRef], { cwd: root });
    return done('create');
  }
  // d.local === 'ff'. `git branch -f` refuses a branch checked out anywhere, so a checkout that
  // appeared since findCheckout is refused, not trampled; a clean checkout moves with --ff-only in
  // its own worktree, which git refuses if the move would touch an untracked or changed file.
  const checkout = facts.checkout;
  const r = checkout
    ? git(['merge', '--ff-only', '--quiet', d.use], { cwd: checkout.path })
    : git(['branch', '-f', base, d.use], { cwd: root });
  return done(r.status === 0 ? 'ff' : 'ff-refused');
}

// resolveRunBase(root, slug, { env, prepare, git }) →
//   { ok: true, base, baseSha: string|null, existing: bool } | { ok: false, reason, message }
// Which base a build of `slug` runs on (DESIGN §2.5, §2.7), decided before anything is spawned so a
// refusal reaches the person:
//   - pir/{slug} exists and records pirBase → that base, no fetch. The branch is already cut, the
//     settings may have changed since, and the run remembers its base, not the settings.
//   - pir/{slug} exists without pirBase (cut before pirBase existed) → the settings' base, recorded on
//     the branch now; still no fetch, since there is nothing left to cut.
//   - no pir/{slug} (a plan made by hand on the base branch) → the settings' base, prepared (§2.3):
//     baseSha is the commit to cut the feature branch from. Nothing is cut here; the caller cuts.
// `message` is the §2.9 refusal text, ready to print.
export function resolveRunBase(root, slug, { env = process.env, prepare = prepareBase, git = defaultGit } = {}) {
  const branch = `pir/${slug}`;
  const exists = git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: root }).status === 0;
  if (exists) {
    const recorded = git(['config', '--get', `branch.${branch}.pirBase`], { cwd: root });
    const base = recorded.status === 0 ? recorded.stdout.trim() : '';
    if (base) return { ok: true, base, baseSha: null, existing: true };
  }
  const setting = resolveBaseSetting(root, { env });
  if (!setting.ok) return { ok: false, reason: setting.reason, message: refusalText(setting, { repo: setting.repo }) };
  const { base, file } = setting;
  if (exists) {
    const r = git(['config', `branch.${branch}.pirBase`, base], { cwd: root });
    if (r.status !== 0) throw new Error(`resolveRunBase: could not record ${base} on ${branch}: ${r.stderr.trim()}`);
    return { ok: true, base, baseSha: null, existing: true };
  }
  const prepared = prepare(root, base, { mode: 'start', env });
  if (!prepared.ok) {
    return { ok: false, reason: prepared.reason, message: refusalText(prepared, { repo: basename(root), base, file }) };
  }
  return { ok: true, base, baseSha: prepared.sha, existing: false };
}
