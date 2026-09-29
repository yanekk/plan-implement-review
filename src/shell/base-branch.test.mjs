// base-branch T02: the settings files, the remote, and prepareBase's §2.3 rows against real git in temp
// dirs, with a local bare repo standing in for the remote so no test touches the network (DESIGN §4,
// §5.2). PIR_HOME always points at a temp dir, never the person's own ~/.pir.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveBaseSetting, pickRemote, prepareBase, defaultGit } from './base-branch.mjs';

const ID = ['-c', 'user.name=pir test', '-c', 'user.email=test@pir.invalid', '-c', 'commit.gpgsign=false'];
function git(cwd, ...args) {
  return execFileSync('git', [...ID, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function sha(cwd, ref) {
  return git(cwd, 'rev-parse', ref);
}
function commit(cwd, name, content = name) {
  writeFileSync(join(cwd, name), content);
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', name);
  return sha(cwd, 'HEAD');
}

// A world: {tmp}/remote.git (bare), {tmp}/other (a second clone pushing to it), {tmp}/repo (the person's
// clone, on `work` with no local `dev` until a test makes one), {tmp}/home (PIR_HOME).
function world(t, { branch = 'dev' } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'pir-base-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const remote = join(tmp, 'remote.git');
  const other = join(tmp, 'other');
  const repo = join(tmp, 'repo');
  const home = join(tmp, 'home');
  mkdirSync(home);
  git(tmp, 'init', '-q', '--bare', '-b', branch, remote);
  git(tmp, 'init', '-q', '-b', branch, other);
  commit(other, 'a.txt');
  git(other, 'remote', 'add', 'origin', remote);
  git(other, 'push', '-q', 'origin', branch);
  git(tmp, 'clone', '-q', remote, repo);
  git(repo, 'checkout', '-q', '-b', 'work');
  git(repo, 'branch', '-q', '-D', branch);
  const env = { ...process.env, PIR_HOME: home };
  const push = (name) => {
    const s = commit(other, name);
    git(other, 'push', '-q', 'origin', branch);
    return s;
  };
  return { tmp, remote, other, repo, home, env, push, branch };
}

// --- resolveBaseSetting -------------------------------------------------------------------------------

function settingsWorld(t) {
  const tmp = mkdtempSync(join(tmpdir(), 'pir-base-set-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const root = join(tmp, 'proj');
  const home = join(tmp, 'home');
  mkdirSync(join(root, '.pir'), { recursive: true });
  mkdirSync(join(home, '.pir', 'proj'), { recursive: true });
  const userFile = join(home, '.pir', 'proj', 'settings.json');
  return {
    root,
    env: { PIR_HOME: home, HOME: '/nonexistent' },
    userFile,
    writeRepo: (s) => writeFileSync(join(root, '.pir', 'settings.json'), s),
    writeUser: (s) => writeFileSync(userFile, s),
  };
}

test('resolveBaseSetting: repo file only', (t) => {
  const w = settingsWorld(t);
  w.writeRepo('{"baseBranch": "dev", "other": 1}');
  assert.deepEqual(resolveBaseSetting(w.root, { env: w.env }), { ok: true, base: 'dev', file: '.pir/settings.json' });
});

test('resolveBaseSetting: the user file overrides the repo file', (t) => {
  const w = settingsWorld(t);
  w.writeRepo('{"baseBranch": "dev"}');
  w.writeUser('{"baseBranch": "stage"}');
  assert.deepEqual(resolveBaseSetting(w.root, { env: w.env }), { ok: true, base: 'stage', file: w.userFile });
});

test('resolveBaseSetting: a user file without baseBranch leaves the repo value', (t) => {
  const w = settingsWorld(t);
  w.writeRepo('{"baseBranch": "dev"}');
  w.writeUser('{}');
  assert.equal(resolveBaseSetting(w.root, { env: w.env }).base, 'dev');
});

test('resolveBaseSetting: neither file → no-base-setting, naming the repo', (t) => {
  const w = settingsWorld(t);
  const r = resolveBaseSetting(w.root, { env: w.env });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-base-setting');
  assert.equal(r.repo, 'proj');
});

test('resolveBaseSetting: a broken user file refuses even with a good repo file', (t) => {
  const w = settingsWorld(t);
  w.writeRepo('{"baseBranch": "dev"}');
  w.writeUser('{not json');
  const r = resolveBaseSetting(w.root, { env: w.env });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'bad-settings');
  assert.equal(r.file, w.userFile);
});

test('resolveBaseSetting: falls back to HOME when PIR_HOME is unset', (t) => {
  const w = settingsWorld(t);
  w.writeUser('{"baseBranch": "stage"}');
  const home = w.env.PIR_HOME;
  assert.equal(resolveBaseSetting(w.root, { env: { HOME: home } }).base, 'stage');
});

test('resolveBaseSetting: an unreadable settings path (a folder) is bad-settings', (t) => {
  const w = settingsWorld(t);
  mkdirSync(join(w.root, '.pir', 'settings.json'));
  const r = resolveBaseSetting(w.root, { env: w.env });
  assert.equal(r.reason, 'bad-settings');
  assert.equal(r.file, '.pir/settings.json');
});

// --- pickRemote ---------------------------------------------------------------------------------------

test('pickRemote: the configured upstream wins over origin', (t) => {
  const w = world(t);
  git(w.repo, 'remote', 'add', 'upstream', w.remote);
  git(w.repo, 'branch', '-q', 'dev', 'origin/dev');
  git(w.repo, 'config', 'branch.dev.remote', 'upstream');
  assert.equal(pickRemote(w.repo, 'dev'), 'upstream');
});

test('pickRemote: origin only → origin', (t) => {
  const w = world(t);
  assert.equal(pickRemote(w.repo, 'nobranch'), 'origin');
});

test('pickRemote: only an other-named remote and no upstream → null', (t) => {
  const w = world(t);
  git(w.repo, 'remote', 'rename', 'origin', 'mine');
  assert.equal(pickRemote(w.repo, 'nobranch'), null);
});

test('pickRemote: no remotes → null', (t) => {
  const w = world(t);
  git(w.repo, 'remote', 'remove', 'origin');
  assert.equal(pickRemote(w.repo, 'dev'), null);
});

// --- prepareBase: the §2.3 rows -----------------------------------------------------------------------

// A git spy: real git underneath, every call recorded with the env it ran under.
function spy() {
  const calls = [];
  const run = (args, opts = {}) => {
    calls.push({ args, env: opts.env, timeout: opts.timeout });
    return defaultGit(args, opts);
  };
  return { run, calls, network: () => calls.filter((c) => c.args[0] === 'ls-remote' || c.args[0] === 'fetch') };
}

test('no remote, local present → the local sha, no fetch attempted', (t) => {
  const w = world(t);
  git(w.repo, 'branch', '-q', 'dev', 'origin/dev');
  git(w.repo, 'remote', 'remove', 'origin');
  const s = spy();
  const r = prepareBase(w.repo, 'dev', { git: s.run, env: w.env });
  assert.deepEqual(r, { ok: true, sha: sha(w.repo, 'dev'), remote: null, local: 'keep' });
  assert.equal(s.network().length, 0);
});

test('no remote and no local → no-base-branch', (t) => {
  const w = world(t);
  git(w.repo, 'remote', 'remove', 'origin');
  const r = prepareBase(w.repo, 'dev', { env: w.env });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-base-branch');
  assert.equal(r.remote, null);
});

test('remote ahead, local not checked out → local fast-forwarded, remote sha returned', (t) => {
  const w = world(t);
  git(w.repo, 'branch', '-q', 'dev', 'origin/dev');
  const tip = w.push('b.txt');
  const r = prepareBase(w.repo, 'dev', { env: w.env });
  assert.deepEqual(r, { ok: true, sha: tip, remote: 'origin', local: 'ff' });
  assert.equal(sha(w.repo, 'dev'), tip);
  assert.equal(sha(w.repo, 'origin/dev'), tip);
});

test('remote ahead, local checked out and clean → fast-forwarded in that worktree', (t) => {
  const w = world(t);
  git(w.repo, 'checkout', '-q', '-b', 'dev', 'origin/dev');
  const tip = w.push('b.txt');
  const r = prepareBase(w.repo, 'dev', { env: w.env });
  assert.deepEqual(r, { ok: true, sha: tip, remote: 'origin', local: 'ff' });
  assert.equal(sha(w.repo, 'dev'), tip);
  assert.equal(git(w.repo, 'status', '--porcelain'), '');
  assert.ok(existsSync(join(w.repo, 'b.txt')), 'the worktree was moved with the branch');
});

test('remote ahead, local checked out in a linked worktree and clean → fast-forwarded there', (t) => {
  const w = world(t);
  git(w.repo, 'branch', '-q', 'dev', 'origin/dev');
  const wt = join(w.tmp, 'devtree');
  git(w.repo, 'worktree', 'add', '-q', wt, 'dev');
  const tip = w.push('b.txt');
  const r = prepareBase(w.repo, 'dev', { env: w.env });
  assert.equal(r.local, 'ff');
  assert.equal(sha(w.repo, 'dev'), tip);
  assert.ok(existsSync(join(wt, 'b.txt')));
});

test('remote ahead, local checked out with a modified tracked file → not moved, remote sha returned', (t) => {
  const w = world(t);
  git(w.repo, 'checkout', '-q', '-b', 'dev', 'origin/dev');
  const before = sha(w.repo, 'dev');
  writeFileSync(join(w.repo, 'a.txt'), 'edited');
  const tip = w.push('b.txt');
  const r = prepareBase(w.repo, 'dev', { env: w.env });
  assert.deepEqual(r, { ok: true, sha: tip, remote: 'origin', local: 'keep' });
  assert.equal(sha(w.repo, 'dev'), before);
});

test('remote ahead, a fast-forward git refuses (untracked file in the way) → ff-refused, remote sha', (t) => {
  const w = world(t);
  git(w.repo, 'checkout', '-q', '-b', 'dev', 'origin/dev');
  const before = sha(w.repo, 'dev');
  writeFileSync(join(w.repo, 'b.txt'), 'mine, untracked');
  const tip = w.push('b.txt');
  const r = prepareBase(w.repo, 'dev', { env: w.env });
  assert.deepEqual(r, { ok: true, sha: tip, remote: 'origin', local: 'ff-refused' });
  assert.equal(sha(w.repo, 'dev'), before);
});

test('local missing, remote has it → local created tracking the remote', (t) => {
  const w = world(t);
  const tip = w.push('b.txt');
  const r = prepareBase(w.repo, 'dev', { env: w.env });
  assert.deepEqual(r, { ok: true, sha: tip, remote: 'origin', local: 'create' });
  assert.equal(sha(w.repo, 'dev'), tip);
  assert.equal(git(w.repo, 'config', '--get', 'branch.dev.remote'), 'origin');
  assert.equal(git(w.repo, 'config', '--get', 'branch.dev.merge'), 'refs/heads/dev');
});

test('local equal to the remote → kept', (t) => {
  const w = world(t);
  git(w.repo, 'branch', '-q', 'dev', 'origin/dev');
  const r = prepareBase(w.repo, 'dev', { env: w.env });
  assert.deepEqual(r, { ok: true, sha: sha(w.repo, 'dev'), remote: 'origin', local: 'keep' });
});

test('local ahead → the local sha, nothing moved', (t) => {
  const w = world(t);
  git(w.repo, 'checkout', '-q', '-b', 'dev', 'origin/dev');
  const mine = commit(w.repo, 'mine.txt');
  const remoteTip = sha(w.repo, 'origin/dev');
  const r = prepareBase(w.repo, 'dev', { env: w.env });
  assert.deepEqual(r, { ok: true, sha: mine, remote: 'origin', local: 'keep' });
  assert.equal(sha(w.repo, 'origin/dev'), remoteTip);
});

test('local and remote split → diverged, with the counts, nothing moved', (t) => {
  const w = world(t);
  git(w.repo, 'checkout', '-q', '-b', 'dev', 'origin/dev');
  const mine = commit(w.repo, 'mine.txt');
  w.push('b.txt');
  w.push('c.txt');
  const r = prepareBase(w.repo, 'dev', { env: w.env });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'diverged');
  assert.equal(r.base, 'dev');
  assert.equal(r.remote, 'origin');
  assert.equal(r.ahead, 1);
  assert.equal(r.behind, 2);
  assert.equal(sha(w.repo, 'dev'), mine);
});

test('remote lacks the branch → the local branch is used', (t) => {
  const w = world(t);
  git(w.repo, 'branch', '-q', 'stage', 'origin/dev');
  const r = prepareBase(w.repo, 'stage', { env: w.env });
  assert.deepEqual(r, { ok: true, sha: sha(w.repo, 'stage'), remote: 'origin', local: 'keep' });
});

test('remote lacks the branch and there is no local → no-base-branch naming the remote', (t) => {
  const w = world(t);
  const r = prepareBase(w.repo, 'stage', { env: w.env });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-base-branch');
  assert.equal(r.remote, 'origin');
});

test('a branch whose name is the tail of another remote branch is not mistaken for it', (t) => {
  const w = world(t);
  git(w.other, 'push', '-q', 'origin', 'dev:feature/stage');
  const r = prepareBase(w.repo, 'stage', { env: w.env });
  assert.equal(r.reason, 'no-base-branch');
});

test('a remote path that does not exist → fetch-failed, returned quickly, nothing created', (t) => {
  const w = world(t);
  git(w.repo, 'remote', 'set-url', 'origin', join(w.tmp, 'gone.git'));
  const refsBefore = git(w.repo, 'for-each-ref', '--format=%(refname) %(objectname)');
  const t0 = Date.now();
  const r = prepareBase(w.repo, 'dev', { env: w.env });
  assert.ok(Date.now() - t0 < 5000, 'a failed fetch returns at once');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'fetch-failed');
  assert.equal(r.remote, 'origin');
  assert.match(r.error, /gone\.git|does not appear|not a git repository|Could not read/i);
  assert.equal(git(w.repo, 'for-each-ref', '--format=%(refname) %(objectname)'), refsBefore);
});

test("mode 'watch' fetches but never moves the local branch", (t) => {
  const w = world(t);
  git(w.repo, 'branch', '-q', 'dev', 'origin/dev');
  const before = sha(w.repo, 'dev');
  const tip = w.push('b.txt');
  const r = prepareBase(w.repo, 'dev', { mode: 'watch', env: w.env });
  assert.deepEqual(r, { ok: true, sha: tip, remote: 'origin', local: 'keep' });
  assert.equal(sha(w.repo, 'dev'), before);
  assert.equal(sha(w.repo, 'origin/dev'), tip, 'the remote-tracking ref was updated');
});

test("mode 'watch' never creates a missing local branch", (t) => {
  const w = world(t);
  const tip = w.push('b.txt');
  const r = prepareBase(w.repo, 'dev', { mode: 'watch', env: w.env });
  assert.deepEqual(r, { ok: true, sha: tip, remote: 'origin', local: 'keep' });
  assert.throws(() => git(w.repo, 'rev-parse', '--verify', '--quiet', 'refs/heads/dev'));
});

test('the network calls run with GIT_TERMINAL_PROMPT=0, batch-mode ssh and a timeout', (t) => {
  const w = world(t);
  const env = { ...w.env };
  delete env.GIT_SSH_COMMAND;
  const s = spy();
  prepareBase(w.repo, 'dev', { git: s.run, env, timeoutMs: 7000 });
  const net = s.network();
  assert.deepEqual(net.map((c) => c.args[0]), ['ls-remote', 'fetch']);
  for (const c of net) {
    assert.equal(c.env.GIT_TERMINAL_PROMPT, '0');
    assert.equal(c.env.GIT_SSH_COMMAND, 'ssh -o BatchMode=yes');
    assert.ok(c.timeout > 0 && c.timeout <= 7000);
  }
});

test("a person's own ssh command is left alone", (t) => {
  const w = world(t);
  const s = spy();
  prepareBase(w.repo, 'dev', { git: s.run, env: { ...w.env, GIT_SSH_COMMAND: 'ssh -i key' } });
  for (const c of s.network()) assert.equal(c.env.GIT_SSH_COMMAND, 'ssh -i key');

  const env = { ...w.env };
  delete env.GIT_SSH_COMMAND;
  git(w.repo, 'config', 'core.sshCommand', 'ssh -i other');
  const s2 = spy();
  prepareBase(w.repo, 'dev', { git: s2.run, env });
  for (const c of s2.network()) assert.equal(c.env.GIT_SSH_COMMAND, undefined);
});

test('a network call that times out is fetch-failed, naming the timeout', () => {
  const fake = (args) => {
    if (args[0] === 'remote') return { status: 0, stdout: 'origin\n', stderr: '' };
    if (args[0] === 'ls-remote') return { status: null, stdout: '', stderr: '', timedOut: true };
    return { status: 1, stdout: '', stderr: '' };
  };
  const r = prepareBase('/nowhere', 'dev', { git: fake, env: {}, timeoutMs: 30000 });
  assert.equal(r.reason, 'fetch-failed');
  assert.match(r.error, /timed out after 30 s/);
});
