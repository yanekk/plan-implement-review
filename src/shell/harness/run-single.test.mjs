// run.mjs's single runner (single-runs T12): the pure pieces, the facts over a hand-written capture, the
// seatbelts driven with injected programs, and one dry pass of the whole single-run-live scenario with the
// REAL single program and the fake `claude` first on PATH, so the path the live run takes is proven in
// `npm test` with no model called (DESIGN §5.2).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { builderHeadFrom, noteProcs, runSingleScenario, singleRecordOf } from './run.mjs';
import { checkScenario, singleBuilderCommitGreen, singleIndexUnderName, singleNoSessionLeft, singleReady, baseUntouched } from './assertions.mjs';
import { parseLogName } from './capture.mjs';
import { defineScenario } from './scenario.mjs';
import { indexDir, writeRecord } from '../index-store.mjs';
import { writeClaudeShim } from '../fake/claude-shim.mjs';
import { BUILDER_MATCH, SINGLE_REVIEWER_MATCH, singleReviewerScript } from '../fake/sessions.mjs';
import { assistantText, canUseTool, initEvent, resultEvent, toolUse } from '../fake/claude-stream.mjs';
import { REPLY } from './fixtures/single-run-live.mjs';

const tmp = (p) => mkdtempSync(join(tmpdir(), p));
const SESSIONS = join(dirname(fileURLToPath(import.meta.url)), '..', 'fake', 'sessions.mjs');

// --- The pure pieces ------------------------------------------------------------------------------

test('parseLogName reads a single builder log as a held session, the way the answerer replies to it', () => {
  assert.deepEqual(parseLogName('build-2.ndjson'), { task: 'plan', role: 'builder', n: 2 });
  assert.deepEqual(parseLogName('review-1.ndjson'), { task: 'plan', role: 'reviewer', n: 1 });
  assert.equal(parseLogName('builder-1.ndjson'), null);
});

test('defineScenario: a single scenario needs the reply and its cap, and keeps them', () => {
  const fact = singleReady();
  assert.throws(() => defineScenario({ id: 's', fixture: 'f', kind: 'single', facts: [fact] }), /single scenario needs a reply/);
  const s = defineScenario({ id: 's', fixture: 'f', kind: 'single', reply: 'go ahead', replyCap: 3, facts: [fact] });
  assert.equal(s.reply, 'go ahead');
  assert.equal(s.replyCap, 3);
});

test('singleRecordOf finds the run under its id, then under the name, and ignores other kinds and repos', () => {
  const byId = { repo: 'r', slug: 'single-ab12', kind: 'single' };
  const byName = { repo: 'r', slug: 'fix-add', kind: 'single' };
  assert.equal(singleRecordOf([byId], { repo: 'r', runId: 'single-ab12' }), byId);
  assert.equal(singleRecordOf([byId, byName], { repo: 'r', runId: 'single-ab12' }), byName);
  assert.equal(singleRecordOf([byName], { repo: 'r', runId: 'single-ab12', name: 'fix-add' }), byName);
  assert.equal(singleRecordOf([{ ...byName, kind: 'plan' }, { ...byId, repo: 'o' }], { repo: 'r', runId: 'single-ab12' }), null);
});

test('builderHeadFrom takes the last green test head before the rename, and nothing without a rename', () => {
  const log = [
    't tests run red: exit 1 (head aaaaaaa, clean)',
    't tests run green (head bbbbbbb, clean)',
    't renamed branch and worktree to pir/fix-add',
    't tests run green (head ccccccc, clean)',
  ].join('\n');
  assert.equal(builderHeadFrom(log), 'bbbbbbb');
  assert.equal(builderHeadFrom('t tests run green (head bbbbbbb, clean)'), null);
  assert.equal(builderHeadFrom(''), null);
});

test('noteProcs keeps every session and command run it has seen, once each', () => {
  const seen = new Map();
  let workers = [{ pid: 11, startTime: 'A', role: 'builder' }];
  const cmd = { pid: 12, startTime: 'B' };
  const deps = { readWorkers: () => workers, readJson: () => cmd };
  noteProcs(seen, '/c', deps);
  workers = [{ pid: 13, startTime: 'C', role: 'reviewer' }];
  noteProcs(seen, '/c', deps);
  assert.deepEqual([...seen.values()].map((p) => `${p.what}:${p.pid}`), ['builder:11', 'command:12', 'reviewer:13']);
  assert.equal(noteProcs(seen, null, deps), seen);
});

// --- The facts over a hand-written capture --------------------------------------------------------

const good = {
  runId: 'single-ab12',
  name: 'fix-add',
  end: 'finished',
  outcome: 'ready',
  finalState: 'finished',
  base: 'main',
  baseBefore: 'abc',
  baseAfter: 'abc',
  builderHead: 'def',
  builderCommits: ['def fix: addAll starts at 0'],
  testAtBase: { ok: false },
  testAtTip: { ok: true },
  seen: [{ pid: 1, what: 'program' }, { pid: 2, what: 'builder' }],
  survivors: [],
  records: [{ repo: 'r', slug: 'fix-add', kind: 'single', finalState: 'finished' }],
};
const facts = [singleReady(), singleBuilderCommitGreen(), singleIndexUnderName(), singleNoSessionLeft(), baseUntouched()];
const verdict = (singleRun) => Object.fromEntries(checkScenario({ id: 'x', facts }, { singleRun }).facts.map((f) => [f.id, f.pass]));

test('the single facts pass on a ready run with a builder commit, one entry under the name and nothing left', () => {
  assert.ok(Object.values(verdict(good)).every(Boolean), JSON.stringify(verdict(good)));
});

test('each single fact fails on its own defect', () => {
  assert.equal(verdict({ ...good, outcome: 'dropped' })['single-ready'], false);
  assert.equal(verdict({ ...good, finalState: 'crashed' })['single-ready'], false);
  assert.equal(verdict({ ...good, builderCommits: [] })['single-builder-commit-green'], false);
  assert.equal(verdict({ ...good, testAtTip: { ok: false } })['single-builder-commit-green'], false);
  assert.equal(verdict({ ...good, testAtBase: { ok: true } })['single-builder-commit-green'], false, 'nothing was broken to fix');
  assert.equal(verdict({ ...good, records: [...good.records, { slug: 'single-ab12', kind: 'single' }] })['single-index-under-name'], false);
  assert.equal(verdict({ ...good, records: [{ slug: 'fix-add', kind: 'work' }] })['single-index-under-name'], false);
  assert.equal(verdict({ ...good, name: null })['single-index-under-name'], false);
  assert.equal(verdict({ ...good, survivors: [{ pid: 2, what: 'builder' }] })['single-no-session-left'], false);
  assert.equal(verdict({ ...good, survivors: null })['single-no-session-left'], false, 'not read is not shown');
  assert.equal(verdict({ ...good, seen: [{ pid: 1, what: 'program' }] })['single-no-session-left'], false);
  assert.equal(verdict({ ...good, baseAfter: 'moved' })['base-untouched'], false);
  assert.ok(Object.values(verdict(null)).every((v) => v === false), 'no capture fails every fact');
});

// --- The seatbelts, with injected programs --------------------------------------------------------

// A single run that never ends: startSingle writes its index record and returns; nothing else happens.
function stuckSingle(t, { capReached = false } = {}) {
  const repoDir = tmp('pir-single-stuck-');
  t.after(() => rmSync(repoDir, { recursive: true, force: true }));
  const stops = [];
  const opts = {
    fixtureId: 'single-run-live',
    scratchDir: repoDir,
    pollMs: 5,
    install: (_id, { into }) => mkdirSync(into, { recursive: true }),
    gitRun: () => ({ ok: true, stdout: 'abc\n' }),
    procs: { isAlive: () => true, startTimeOf: () => 'T', kill: () => {} },
    reap: async () => ({ reaped: [] }),
    startSingle: (prompt, { cwd, env }) => {
      const controlDir = join(cwd, 'plans', 'single-ab12', '.parallel', 'single');
      mkdirSync(controlDir, { recursive: true });
      const record = { version: 1, kind: 'single', label: prompt, slug: 'single-ab12', repo: cwd.split('/').at(-1), repoPath: cwd, controlDir, pid: 4242, startTime: 'T', branch: 'pir/single-ab12' };
      writeRecord(record, { dir: indexDir({ env }) });
      return { started: true, runId: 'single-ab12', pid: 4242, record, controlDir };
    },
    stopSingle: async (record) => (stops.push(record.pid), { stopped: true }),
    testAt: () => ({ ok: null, output: '' }),
    makeAnswerer: () => ({ tick() {}, capReached: () => capReached }),
  };
  return { opts, stops };
}

test('runSingleScenario stops a single run that outlives the wall clock, as pir stops it', async (t) => {
  const { opts, stops } = stuckSingle(t);
  const r = await runSingleScenario({ ...opts, timeoutMs: 30 });
  assert.equal(r.reason, 'timeout');
  assert.equal(r.ok, false);
  assert.deepEqual(stops, [4242]);
});

test('runSingleScenario stops the run once the reply cap is spent and a session still waits', async (t) => {
  const { opts, stops } = stuckSingle(t, { capReached: true });
  const r = await runSingleScenario({ ...opts, timeoutMs: 60_000 });
  assert.equal(r.reason, 'reply-cap');
  assert.deepEqual(stops, [4242]);
});

test('runSingleScenario reports a refused start and starts nothing', async (t) => {
  const { opts, stops } = stuckSingle(t);
  const r = await runSingleScenario({ ...opts, startSingle: () => ({ started: false, reason: 'no-commands' }) });
  assert.equal(r.reason, 'single-refused:no-commands');
  assert.equal(r.ok, false);
  assert.deepEqual(stops, []);
});

test('runSingleScenario refuses a fixture that is not a single scenario', async () => {
  await assert.rejects(() => runSingleScenario({ fixtureId: 'plan-command' }), /not a single scenario/);
});

// --- The dry pass: the real single program, the fake Claude ---------------------------------------

const q = (s) => `'${String(s).replaceAll("'", `'\\''`)}'`;
const GIT = "git -c user.name='pir fake' -c user.email=fake@pir.invalid";
const FIX = `${q(process.execPath)} -e ${q("const f=require('fs');f.writeFileSync('add.mjs',f.readFileSync('add.mjs','utf8').replace('let i = 1','let i = 0'))")}`;

// The fake builder ends one turn on a plain-words question (the canned reply's case), then asks one
// AskUserQuestion (the question form's case), then fixes the off-by-one, commits and reports `built`.
function builderScript(name) {
  const words = 'Shall I fix the loop in add.mjs?';
  const questions = [{ question: 'Fix only addAll?', header: 'Scope', multiSelect: false, options: [{ label: 'Yes', description: 'the one function' }, { label: 'No', description: 'more' }] }];
  return [
    { await: 'user' },
    { emit: initEvent() },
    { emit: assistantText(words) },
    { emit: resultEvent('success', words) },
    { await: 'user' },
    { emit: initEvent() },
    { emit: toolUse('toolu_dry-ask-1', 'AskUserQuestion', { questions }) },
    { emit: canUseTool('dry-ask-1', 'AskUserQuestion', { questions }, { requires_user_interaction: true }) },
    { await: 'control_response' },
    { resultFor: 'dry-ask-1' },
    { sh: `${FIX} && ${GIT} commit -q -am ${q('fix: addAll starts at the first number')}` },
    { sh: [process.execPath, SESSIONS, 'single-report', 'built', name, 'Fixed and committed.'].map(q).join(' ') },
    { emit: assistantText(`Reported built as ${name}.`) },
    { emit: resultEvent('success', `Reported built as ${name}.`) },
  ];
}

test('a dry pass of the single-run-live scenario with the fake claude on PATH reaches every fact green', { timeout: 180_000 }, async (t) => {
  const root = tmp('pir-single-dry-');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  const bin = join(root, 'bin');
  const repoDir = join(root, 'repo');
  mkdirSync(home);
  writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = pir dry\n\temail = dry@pir.invalid\n');
  mkdirSync(bin);
  const scriptsFile = join(bin, 'fake-scripts.json');
  writeFileSync(
    scriptsFile,
    JSON.stringify([
      { match: BUILDER_MATCH, script: builderScript('fix-add-all') },
      { match: SINGLE_REVIEWER_MATCH, script: singleReviewerScript({ name: 'fix-add-all' }) },
    ]),
  );
  const received = join(bin, 'fake-received.ndjson');
  writeClaudeShim(bin, { scriptsFile, received });
  const baseEnv = { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: home, FORCE_COLOR: '0', NO_COLOR: '1' };
  for (const k of ['PIR_HOME', 'PARALLEL_ALLOW_HERE', 'PIR_FAKE_CLAUDE_SCRIPT', 'PIR_FAKE_CLAUDE_SCRIPTS', 'PIR_FAKE_CLAUDE_RECEIVED', 'NODE_TEST_CONTEXT']) delete baseEnv[k];

  const lines = [];
  const r = await runSingleScenario({ fixtureId: 'single-run-live', scratchDir: repoDir, baseEnv, pollMs: 250, timeoutMs: 150_000, log: (l) => lines.push(l) });
  const why = `${r.reason}\n${r.report.facts.map((f) => `${f.pass ? '✓' : '✗'} ${f.id}: ${f.detail} ${f.evidence.join(' | ')}`).join('\n')}\n--- log\n${lines.join('\n')}`;
  assert.equal(r.reason, 'completed', why);
  assert.equal(r.ok, true, why);

  // The canned reply reached the builder twice: as words, and typed on the question form.
  const sent = readFileSync(received, 'utf8');
  assert.ok(sent.split(REPLY).length - 1 >= 2, `the builder was sent "${REPLY}" as words and as an answer\n${why}`);
  assert.ok(lines.some((l) => l.includes('said') && l.includes('reply:build-1.ndjson')), why);
  assert.ok(existsSync(join(repoDir, '.pir-home', '.pir', 'runs')), 'PIR_HOME is the scratch one');
  const capture = JSON.parse(readFileSync(join(r.bundleDir, 'single-run.json'), 'utf8'));
  assert.equal(capture.name, 'fix-add-all');
  assert.equal(capture.builderCommits.length, 1, why);
  assert.equal(capture.branchCommits.length, 2, 'the builder commit and the reviewer commit');
  assert.ok(existsSync(join(r.bundleDir, 'conversations', 'build-1.ndjson')));
});
