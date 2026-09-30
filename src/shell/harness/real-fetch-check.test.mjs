// real-fetch-check.mjs against a local bare repository (base-branch T09): the same code path the real
// check takes over https, with no network (DESIGN §5.2 seatbelt).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { realFetchCheck, PUBLIC_ORIGIN } from './real-fetch-check.mjs';

const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.invalid', ...a], { cwd, encoding: 'utf8' }).trim();

function bareWithMain(t) {
  const root = mkdtempSync(join(tmpdir(), 'pir-real-fetch-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const src = join(root, 'src');
  git(root, 'init', '-q', '-b', 'main', src);
  writeFileSync(join(src, 'a.txt'), 'a\n');
  git(src, 'add', '-A');
  git(src, 'commit', '-q', '-m', 'a');
  git(root, 'clone', '-q', '--bare', src, join(root, 'origin.git'));
  return { root, url: join(root, 'origin.git'), sha: git(src, 'rev-parse', 'HEAD') };
}

test('realFetchCheck creates the missing local main from the remote, reports its commit, and removes the temp repo', (t) => {
  const { root, url, sha } = bareWithMain(t);
  const r = realFetchCheck({ url, tmp: root });
  assert.equal(r.ok, true, r.text);
  assert.equal(r.sha, sha);
  assert.equal(r.local, 'create');
  assert.equal(r.remote, 'origin');
  assert.equal(r.text, `fetched main from ${url}: ${sha} · local main: create`);
  assert.equal(existsSync(r.dir), false, 'the temp repo is gone');
});

test('realFetchCheck prints pir\'s fetch-failed refusal for an unreachable remote, and still removes the temp repo', (t) => {
  const { root } = bareWithMain(t);
  const r = realFetchCheck({ url: join(root, 'gone.git'), tmp: root });
  assert.equal(r.ok, false);
  assert.match(r.text, /^pir: could not fetch main from origin: .+\. Nothing was created; try again when origin is reachable\.$/);
  assert.equal(existsSync(r.dir), false);
});

test('the bin prints the result and exits 0, or 1 on a refusal; its default is the public https origin', (t) => {
  const { root, url, sha } = bareWithMain(t);
  const bin = fileURLToPath(new URL('./real-fetch-check.mjs', import.meta.url));
  const ok = spawnSync(process.execPath, [bin, '--url', url], { encoding: 'utf8', env: { ...process.env, TMPDIR: root } });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, new RegExp(`^fetched main from .+: ${sha} · local main: create\\ntemp repo removed: `));
  const bad = spawnSync(process.execPath, [bin, '--url', join(root, 'gone.git')], { encoding: 'utf8', env: { ...process.env, TMPDIR: root } });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /^pir: could not fetch main from origin/);
  assert.match(PUBLIC_ORIGIN, /^https:\/\//);
});
