import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { repoRoots, rootsLabel, scanRepos } from './repo-scan.mjs';

// scanRepos against real `git init` repos in scratch roots (dashboard-plan-box DESIGN §2.4).

function git(cwd, ...args) {
  return execFileSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

function scratchHome(t) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'pir-reposcan-')));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return home;
}

// A repo with one commit on `branch`, so refs/heads/{branch} exists.
function repo(root, name, branch = 'main') {
  const path = join(root, name);
  mkdirSync(path, { recursive: true });
  git(path, 'init', '-q', '-b', branch);
  git(path, 'commit', '-q', '--allow-empty', '-m', 'init');
  return path;
}

// Set all three "last worked in" files of a repo to `sec` seconds since the epoch (missing ones skipped).
function touch(path, sec) {
  for (const f of ['index', 'HEAD', 'logs/HEAD']) {
    try {
      utimesSync(join(path, '.git', f), sec, sec);
    } catch {}
  }
}

test('default root is $HOME/src from the env passed in, not os.homedir()', () => {
  assert.deepEqual(repoRoots({ HOME: '/tmp/fakehome' }), ['/tmp/fakehome/src']);
  assert.deepEqual(repoRoots({ HOME: '/tmp/fakehome', PIR_REPOS: '' }), ['/tmp/fakehome/src']);
  assert.deepEqual(repoRoots({ HOME: '/tmp/fakehome', PIR_REPOS: '::' }), ['/tmp/fakehome/src']);
});

test('PIR_REPOS=a::~/b gives two roots, ~ expanded, empties dropped', () => {
  assert.deepEqual(repoRoots({ HOME: '/h', PIR_REPOS: 'a::~/b' }), [resolve('a'), '/h/b']);
  assert.deepEqual(repoRoots({ HOME: '/h', PIR_REPOS: '~:/abs/x' }), ['/h', '/abs/x']);
});

test('rootsLabel shows HOME as ~ and joins with a comma', () => {
  const env = { HOME: '/h' };
  assert.equal(rootsLabel(['/h/src'], env), '~/src');
  assert.equal(rootsLabel(['/h/src', '/h/code'], env), '~/src, ~/code');
  assert.equal(rootsLabel(['/h', '/other', '/hx/src'], env), '~, /other, /hx/src');
});

test('scanRepos returns exactly the qualifying repos, ranked', (t) => {
  const home = scratchHome(t);
  const src = join(home, 'src');
  const alpha = repo(src, 'alpha');
  const beta = repo(src, 'beta');
  const gamma = repo(src, 'gamma');
  repo(src, 'masteronly', 'master'); // no local main
  mkdirSync(join(src, 'plain')); // no .git
  writeFileSync(join(src, 'afile'), 'x'); // a file in the root
  // A linked worktree of alpha: its .git is a file.
  git(alpha, 'worktree', 'add', '-q', '-b', 'side', join(src, 'alpha-wt'));

  touch(alpha, 1_000_000);
  touch(beta, 3_000_000);
  touch(gamma, 2_000_000);

  const got = scanRepos({ env: { HOME: home } });
  assert.deepEqual(got.map((r) => r.name), ['beta', 'gamma', 'alpha']);
  assert.equal(got[0].path, beta);
  assert.equal(got[0].mtimeMs, 3_000_000_000);
});

test('the newest of index, HEAD and logs/HEAD decides; a repo missing all three sorts last', (t) => {
  const home = scratchHome(t);
  const src = join(home, 'src');
  const a = repo(src, 'a');
  const b = repo(src, 'b');
  const c = repo(src, 'c');
  touch(a, 1_000_000);
  touch(b, 1_000_000);
  touch(c, 1_000_000);
  utimesSync(join(a, '.git', 'logs', 'HEAD'), 5_000_000, 5_000_000); // only one file newer
  utimesSync(join(b, '.git', 'index'), 4_000_000, 4_000_000);
  // c: remove all three files; HEAD's absence breaks git, so fake the git call.
  for (const f of ['index', 'HEAD', 'logs/HEAD']) rmSync(join(c, '.git', f), { force: true });
  const exec = () => '';
  const got = scanRepos({ env: { HOME: home }, exec });
  assert.deepEqual(got.map((r) => [r.name, r.mtimeMs]), [
    ['a', 5_000_000_000],
    ['b', 4_000_000_000],
    ['c', 0],
  ]);
});

test('equal times tie-break on the name', (t) => {
  const home = scratchHome(t);
  const src = join(home, 'src');
  for (const n of ['zed', 'amy', 'mid']) touch(repo(src, n), 2_000_000);
  assert.deepEqual(scanRepos({ env: { HOME: home } }).map((r) => r.name), ['amy', 'mid', 'zed']);
});

test('a missing root is skipped; PIR_REPOS roots are all scanned', (t) => {
  const home = scratchHome(t);
  repo(join(home, 'src'), 'one');
  repo(join(home, 'code'), 'two');
  const env = { HOME: home, PIR_REPOS: `~/nope:~/src:${join(home, 'code')}` };
  assert.deepEqual(scanRepos({ env }).map((r) => r.name).sort(), ['one', 'two']);
  assert.deepEqual(scanRepos({ env: { HOME: join(home, 'absent') } }), []);
});

test('a repo whose git call fails is skipped, the rest still listed', (t) => {
  const home = scratchHome(t);
  const src = join(home, 'src');
  const good = repo(src, 'good');
  const bad = repo(src, 'bad');
  const calls = [];
  const exec = (cmd, args, opts) => {
    calls.push([cmd, args, opts.cwd]);
    if (opts.cwd === bad) throw new Error('git exploded');
    return '';
  };
  const got = scanRepos({ env: { HOME: home }, exec });
  assert.deepEqual(got.map((r) => r.path), [good]);
  assert.ok(calls.every(([cmd, args]) => cmd === 'git' && args.join(' ') === 'rev-parse --verify --quiet refs/heads/main'));
});

test('an unreadable filesystem never throws', () => {
  const fs = {
    readdirSync() {
      throw new Error('EACCES');
    },
    statSync() {
      throw new Error('EACCES');
    },
  };
  assert.deepEqual(scanRepos({ env: { HOME: '/h' }, fs, exec: () => '' }), []);
});
