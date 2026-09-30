// The dev-base scenario (base-branch T09, DESIGN §1 success criteria, §4): `pir plan` in a repo with only
// `dev` and a local bare remote whose `dev` is ahead, run by run.mjs's plan runner with the REAL planning
// program, the REAL coordinator (the agent on) and the fake `claude` first on PATH, so no model is called.
// It is plan-command's dry pass on a dev-only repo, and every fact of the fixture must hold: cut from the
// remote's dev, synced with dev, the dev hand-off, and a merge done on the remote only seen by the watch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runPlanScenario } from './run.mjs';
import { installFixture, REMOTE_DIR } from './fixtures.mjs';
import { REMOTE_AHEAD } from './fixtures/dev-base.mjs';
import { writeClaudeShim } from '../fake/claude-shim.mjs';
import { COORDINATOR_MATCH, PLANNER_MATCH, REVIEWER_MATCH, coordinatorScript, plannerScript, reviewerScript, workerScripts } from '../fake/sessions.mjs';

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
// Does the git command succeed? For the probes whose answer is "no" (a missing ref, an unset key).
const gitOk = (cwd, ...a) => spawnSync('git', a, { cwd, stdio: 'ignore' }).status === 0;

test('installFixture(dev-base) seeds a repo with only dev, settings naming dev, and an origin whose dev is one commit ahead', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'pir-dev-base-install-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = installFixture('dev-base', { into: dir });
  assert.equal(r.base, 'dev');
  assert.equal(git(dir, 'branch', '--format=%(refname:short)'), 'dev', 'dev is the only branch');
  assert.equal(git(dir, 'show', 'dev:.pir/settings.json'), '{"baseBranch":"dev","setup":[],"test":["true"]}');
  assert.equal(r.remote.path, join(dir, REMOTE_DIR));
  const remoteDev = git(dir, 'ls-remote', '--heads', 'origin', 'refs/heads/dev').split(/\s/)[0];
  assert.equal(remoteDev, r.remote.ahead);
  const bare = (...a) => git(dir, '--git-dir', r.remote.path, ...a);
  assert.equal(bare('rev-parse', `${r.remote.ahead}^`), git(dir, 'rev-parse', 'dev'), 'the remote is exactly one commit ahead');
  assert.equal(bare('log', '-1', '--format=%s', 'dev'), REMOTE_AHEAD.message);
  assert.equal(git(dir, 'ls-remote', '--heads', 'origin'), `${r.remote.ahead}\trefs/heads/dev`, 'the remote has only dev');
  assert.equal(git(dir, 'status', '--porcelain'), '', 'the bare remote is ignored');
  assert.equal(gitOk(dir, 'config', '--get', 'branch.dev.remote'), false, 'no upstream: origin is picked by name (§2.4)');
  assert.ok(!existsSync(join(dir, Object.keys(REMOTE_AHEAD.files)[0])), 'the local checkout lacks the remote commit');
});

test('a dry pass of the dev-base scenario: cut from origin/dev, synced with dev, handed off on dev, finished on a remote-only merge', { timeout: 180_000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pir-dev-base-dry-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  const bin = join(root, 'bin');
  const repoDir = join(root, 'repo');
  mkdirSync(home);
  mkdirSync(bin);
  writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = pir dry\n\temail = dry@pir.invalid\n');
  const scriptsFile = join(bin, 'fake-scripts.json');
  writeFileSync(
    scriptsFile,
    JSON.stringify([
      { match: PLANNER_MATCH, script: plannerScript({ slug: 'slugify' }) },
      { match: REVIEWER_MATCH, script: reviewerScript({ slug: 'slugify' }) },
      ...workerScripts(),
      { match: COORDINATOR_MATCH, script: coordinatorScript() },
    ]),
  );
  writeClaudeShim(bin, { scriptsFile, received: join(bin, 'fake-received.ndjson') });
  const baseEnv = { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: home, FORCE_COLOR: '0', NO_COLOR: '1' };
  for (const k of ['PIR_HOME', 'PARALLEL_ALLOW_HERE', 'PARALLEL_COORDINATOR', 'PARALLEL_BASE_WATCH_MS', 'PIR_FAKE_CLAUDE_SCRIPT', 'PIR_FAKE_CLAUDE_SCRIPTS', 'PIR_FAKE_CLAUDE_RECEIVED', 'NODE_TEST_CONTEXT']) delete baseEnv[k];

  const lines = [];
  const r = await runPlanScenario({ fixtureId: 'dev-base', scratchDir: repoDir, baseEnv, pollMs: 250, timeoutMs: 150_000, log: (l) => lines.push(l) });
  const why = `${r.reason}\n${r.report.facts.map((f) => `${f.pass ? '✓' : '✗'} ${f.id}: ${f.detail}\n    ${f.evidence.join('\n    ')}`).join('\n')}\n--- log\n${lines.join('\n')}`;
  assert.equal(r.reason, 'completed', why);
  assert.ok(r.report.facts.every((f) => f.pass), why);
  assert.equal(r.ok, true, why);
  assert.ok(lines.some((l) => l.includes("merged pir/slugify into origin's dev")), why);

  // Nothing named main was ever made: the repo still has no main, and the remote gained only dev.
  assert.equal(gitOk(repoDir, 'rev-parse', '--verify', '--quiet', 'refs/heads/main'), false, 'no main was made');
  assert.equal(gitOk(repoDir, 'rev-parse', '--verify', '--quiet', 'refs/heads/dev'), true);
  assert.equal(git(repoDir, 'ls-remote', '--heads', 'origin').split('\n').length, 1, 'the remote still has only dev');
  // The run remembered its base on the feature branch (base-branch DESIGN §2.5).
  assert.equal(git(repoDir, 'config', '--get', 'branch.pir/slugify.pirBase'), 'dev');
});
