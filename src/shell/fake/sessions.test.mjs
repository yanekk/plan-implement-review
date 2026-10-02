// single-finisher T05 — the fake sessions' sync helpers and single-run finisher, and the program commands
// their `sh` steps run (resolve-both, finisher-merge, single-report after a helper's opening).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { helperInstruction } from '../../core/singleflow.mjs';
import {
  FINISHER_GO_QUESTION,
  SINGLE_FINISHER_MATCH,
  SINGLE_FIX_MATCH,
  SINGLE_RESOLVE_MATCH,
  finisherScript,
  singleFinisherScript,
  singleFixScript,
  singleResolveScript,
} from './sessions.mjs';

const SELF = fileURLToPath(new URL('./sessions.mjs', import.meta.url));
const cli = (cwd, args, env = {}) => execFileSync(process.execPath, [SELF, ...args], { cwd, env: { ...process.env, ...env }, encoding: 'utf8', stdio: 'pipe' });
const g = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.invalid', ...args], { cwd, encoding: 'utf8' }).trim();

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'pir-fake-sessions-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = join(dir, 'repo');
  mkdirSync(root);
  g(root, 'init', '-q', '-b', 'main');
  writeFileSync(join(root, 'a.txt'), 'base\n');
  g(root, 'add', '-A');
  g(root, 'commit', '-q', '-m', 'init');
  return { dir, root };
}

test('the helper and finisher matches find the openings pir sends', () => {
  const resolve = helperInstruction({ role: 'resolve', name: 'n', base: 'main', reportsDir: '/r', files: ['a'] });
  const fix = helperInstruction({ role: 'fix', name: 'n', base: 'main', reportsDir: '/r' });
  assert.match(resolve, new RegExp(SINGLE_RESOLVE_MATCH));
  assert.doesNotMatch(fix, new RegExp(SINGLE_RESOLVE_MATCH));
  assert.match(fix, new RegExp(SINGLE_FIX_MATCH));
  assert.match('Invoke the pir-finisher skill and follow it. You are the finisher of the single run `n`: …', new RegExp(SINGLE_FINISHER_MATCH));
});

test('singleResolveScript and singleFixScript: one report each, after the work', () => {
  const r = JSON.stringify(singleResolveScript({ name: 'n' }));
  assert.match(r, /resolve-both/);
  assert.match(r, /single-report' 'resolved' 'n'/);
  const f = JSON.stringify(singleFixScript({ name: 'n', fix: 'git rm -q broken' }));
  assert.match(f, /git rm -q broken && git .* add -A && git .* commit -q/);
  assert.match(f, /single-report' 'fixed' 'n'/);
});

test('single-report reads the reports folder out of a helper opening (`. Base:` follows it)', (t) => {
  const { dir } = scratch(t);
  const reports = join(dir, 'reports');
  cli(dir, ['single-report', 'fixed', 'n', 'body'], { FAKE_OPENING: helperInstruction({ role: 'fix', name: 'n', base: 'main', reportsDir: reports }) });
  const [file] = readdirSync(reports);
  assert.equal(JSON.parse(readFileSync(join(reports, file), 'utf8')).text, '[pir:v1 kind=fixed single=n]\nbody');
});

test('resolve-both: every clashing file keeps both sides and the merge is committed', (t) => {
  const { root } = scratch(t);
  g(root, 'switch', '-q', '-c', 'side');
  writeFileSync(join(root, 'a.txt'), 'side\n');
  g(root, 'commit', '-q', '-am', 'side');
  g(root, 'switch', '-q', 'main');
  writeFileSync(join(root, 'a.txt'), 'main\n');
  g(root, 'commit', '-q', '-am', 'main');
  assert.throws(() => g(root, 'merge', '-q', 'side'));
  cli(root, ['resolve-both']);
  assert.equal(g(root, 'status', '--porcelain'), '');
  assert.equal(g(root, 'rev-list', '--count', 'HEAD^@'), '3', 'a merge commit with two parents');
  assert.deepEqual(readFileSync(join(root, 'a.txt'), 'utf8').split('\n').filter(Boolean), ['main', 'side']);
  assert.throws(() => cli(root, ['resolve-both']), /no merge in progress/);
});

test('finisher-merge: merges only once the finisher phase is finishing', (t) => {
  const { dir, root } = scratch(t);
  g(root, 'switch', '-q', '-c', 'pir/n');
  writeFileSync(join(root, 'b.txt'), 'b\n');
  g(root, 'add', '-A');
  g(root, 'commit', '-q', '-m', 'b');
  g(root, 'switch', '-q', 'main');
  const statusDir = join(dir, 'finisher', 'status');
  mkdirSync(statusDir, { recursive: true });
  writeFileSync(join(dir, 'finisher', 'state.json'), JSON.stringify({ phase: 'awaiting-go' }));
  assert.throws(() => cli(dir, ['finisher-merge', statusDir, root, 'pir/n']), /the phase is awaiting-go, not finishing/);
  assert.equal(g(root, 'rev-parse', 'main'), g(root, 'rev-parse', 'pir/n~1'));
  writeFileSync(join(dir, 'finisher', 'state.json'), JSON.stringify({ phase: 'finishing' }));
  cli(dir, ['finisher-merge', statusDir, root, 'pir/n']);
  assert.equal(g(root, 'rev-parse', 'main'), g(root, 'rev-parse', 'pir/n'));
});

test('singleFinisherScript: ready, the Go question, the gated merge for real after the Bash call, then done', () => {
  const steps = singleFinisherScript({ name: 'n', statusDir: '/c/finisher/status', repoRoot: '/r' });
  const json = JSON.stringify(steps);
  assert.match(json, /1-ready\.json/);
  const go = steps.findIndex((x) => x.tool?.name === 'AskUserQuestion');
  assert.equal(steps[go].tool.input.questions[0].header, 'Go');
  assert.equal(steps[go].tool.input.questions[0].question, FINISHER_GO_QUESTION);
  const bash = steps.findIndex((x) => x.tool?.name === 'Bash');
  assert.equal(steps[bash].tool.input.command, 'git -C /r merge pir/n');
  assert.match(steps[bash + 1].sh, /'finisher-merge' '\/c\/finisher\/status' '\/r' 'pir\/n'/);
  assert.ok(steps.findIndex((x) => /9-done\.json/.test(x.sh ?? '')) > bash);
  // The rig's finisher is the same script without the real merge.
  assert.ok(!JSON.stringify(finisherScript({ statusDir: '/s', repoRoot: '/r', branch: 'pir/rig' })).includes('finisher-merge'));
});
