// run.mjs's plan runner (pir-plan-command T17): the pure pieces, the planning-side seatbelts driven with
// injected programs, and one dry pass of the whole plan-command scenario with the REAL planning program,
// the REAL coordinator and the T05 fake `claude` first on PATH — so the path the live run (T18) takes is
// proven in `npm test` with no model called (DESIGN §5.2).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { planEnv, planRecordOf, holdPlanReplies, planEnd, runPlanScenario } from './run.mjs';
import { indexDir, writeRecord } from '../index-store.mjs';
import { writeClaudeShim } from '../fake/claude-shim.mjs';
import { PLANNER_MATCH, REVIEWER_MATCH, plannerScript, reviewerScript, workerScripts } from '../fake/sessions.mjs';
import { assistantText, resultEvent } from '../fake/claude-stream.mjs';
import { REPLY } from './fixtures/plan-command.mjs';

const tmp = (p) => mkdtempSync(join(tmpdir(), p));

// --- The pure pieces ------------------------------------------------------------------------------

test('planEnv sets PIR_HOME and the ceiling, and drops an inherited PARALLEL_ALLOW_HERE unless asked', () => {
  const env = planEnv({ baseEnv: { PATH: '/bin', PARALLEL_ALLOW_HERE: '1' }, pirHome: '/s/.pir-home', ceiling: 2 });
  assert.deepEqual(env, { PATH: '/bin', PIR_HOME: '/s/.pir-home', PARALLEL_MAX_WORKERS: '2' });
  assert.equal(planEnv({ baseEnv: {}, allowHere: true }).PARALLEL_ALLOW_HERE, '1');
});

test('planRecordOf finds the run before and after the rename, and prefers the slug when both exist', () => {
  const byId = { repo: 'r', slug: 'plan-ab12', kind: 'plan' };
  const bySlug = { repo: 'r', slug: 'slugify', kind: 'plan' };
  const work = { repo: 'r', slug: 'slugify', kind: 'work' };
  assert.equal(planRecordOf([byId], { repo: 'r', runId: 'plan-ab12' }), byId);
  assert.equal(planRecordOf([bySlug], { repo: 'r', runId: 'plan-ab12' }), bySlug);
  assert.equal(planRecordOf([byId, bySlug], { repo: 'r', runId: 'plan-ab12' }), bySlug);
  assert.equal(planRecordOf([work, { ...byId, repo: 'other' }], { repo: 'r', runId: 'plan-ab12' }), null);
});

test('holdPlanReplies holds while a report waits in the folder or a claim is accepted', () => {
  const dir = tmp('pir-hold-');
  try {
    assert.equal(holdPlanReplies(dir), false);
    writeFileSync(join(dir, 'state.json'), JSON.stringify({ accepted: null }));
    assert.equal(holdPlanReplies(dir), false);
    mkdirSync(join(dir, 'reports'));
    writeFileSync(join(dir, 'reports', '1-plan-x.json'), '{}');
    assert.equal(holdPlanReplies(dir), true);
    rmSync(join(dir, 'reports', '1-plan-x.json'));
    writeFileSync(join(dir, 'state.json'), JSON.stringify({ accepted: { kind: 'planned', plan: 'slugify' } }));
    assert.equal(holdPlanReplies(dir), true);
    assert.equal(holdPlanReplies(null), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('planEnd: the final status wins, then a dead program, then the reply cap, then the clock', () => {
  const rec = (finalState = null) => ({ pid: 1, finalState });
  assert.equal(planEnd({ record: rec(), alive: true }), null);
  assert.equal(planEnd({ record: null, alive: false }), null, 'no record yet is still starting');
  assert.equal(planEnd({ record: rec('finished'), alive: false, capReached: true, timedOut: true }), 'finished');
  assert.equal(planEnd({ record: rec('stopped'), alive: false }), 'stopped');
  assert.equal(planEnd({ record: rec(), alive: false }), 'crashed');
  assert.equal(planEnd({ record: rec(), alive: true, capReached: true, timedOut: true }), 'reply-cap');
  assert.equal(planEnd({ record: rec(), alive: true, timedOut: true }), 'timeout');
});

// --- The planning-side seatbelts, with injected programs ------------------------------------------

// A planning run that never ends: startPlan writes its index record and returns; nothing else happens.
function stuckPlanning(t, { capReached = false } = {}) {
  const repoDir = tmp('pir-plan-stuck-');
  t.after(() => rmSync(repoDir, { recursive: true, force: true }));
  const stops = [];
  const builds = [];
  const opts = {
    fixtureId: 'plan-command',
    scratchDir: repoDir,
    pollMs: 5,
    install: (_id, { into }) => mkdirSync(into, { recursive: true }),
    gitRun: () => ({ ok: true, stdout: 'abc\n' }),
    procs: { isAlive: () => true, startTimeOf: () => 'T', kill: () => {} },
    reap: async () => ({ reaped: [] }),
    startPlan: (brief, { cwd, env }) => {
      const controlDir = join(cwd, 'plans', 'plan-ab12', '.parallel', 'plan');
      mkdirSync(controlDir, { recursive: true });
      writeRecord(
        { version: 1, kind: 'plan', label: 'x', slug: 'plan-ab12', repo: cwd.split('/').at(-1), repoPath: cwd, controlDir, pid: 4242, startTime: 'T', branch: 'pir/plan-ab12' },
        { dir: indexDir({ env }) },
      );
      return { started: true, runId: 'plan-ab12', pid: 4242, controlDir, brief };
    },
    startBuild: (...a) => (builds.push(a), { started: false, reason: 'unexpected' }),
    stopPlan: async (record) => (stops.push(record.pid), { stopped: true }),
    makeAnswerer: () => ({ tick() {}, capReached: () => capReached }),
  };
  return { opts, stops, builds, repoDir };
}

test('runPlanScenario stops a planning run that outlives the wall clock, as pir stops it, and never gives the go', async (t) => {
  const { opts, stops, builds } = stuckPlanning(t);
  const r = await runPlanScenario({ ...opts, timeoutMs: 30 });
  assert.equal(r.reason, 'timeout');
  assert.equal(r.ok, false);
  assert.deepEqual(stops, [4242]);
  assert.equal(builds.length, 0);
  assert.ok(r.report.facts.every((f) => f.pass === false || f.id === 'main-untouched'), 'nothing was planned or built');
});

test('runPlanScenario stops the planning run once the reply cap is spent and a session still waits', async (t) => {
  const { opts, stops } = stuckPlanning(t, { capReached: true });
  const r = await runPlanScenario({ ...opts, timeoutMs: 60_000 });
  assert.equal(r.reason, 'reply-cap');
  assert.deepEqual(stops, [4242]);
});

test('runPlanScenario refuses a fixture that is not a plan scenario', async () => {
  await assert.rejects(() => runPlanScenario({ fixtureId: 'single' }), /not a plan scenario/);
});

// --- The dry pass: the real programs, the fake Claude ---------------------------------------------

// The fake planner ends one turn on a plain-words question (the canned reply's case), then asks one
// AskUserQuestion (the question form's case), then plans `slugify`; the reviewer and the build workers
// are the stock fakes.
function scripts() {
  const planner = plannerScript({ slug: 'slugify', question: 'How small should it be?' });
  const words = 'Shall I keep it to one task?';
  return [
    { match: PLANNER_MATCH, script: [planner[0], planner[1], { emit: assistantText(words) }, { emit: resultEvent('success', words) }, { await: 'user' }, ...planner.slice(2)] },
    { match: REVIEWER_MATCH, script: reviewerScript({ slug: 'slugify' }) },
    ...workerScripts(),
  ];
}

test('a dry pass of the plan-command scenario with the fake claude on PATH reaches every fact green', { timeout: 180_000 }, async (t) => {
  const root = tmp('pir-plan-dry-');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  const bin = join(root, 'bin');
  const repoDir = join(root, 'repo');
  mkdirSync(home);
  // A scratch HOME has no git identity, and the coordinator's merges need one.
  writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = pir dry\n\temail = dry@pir.invalid\n');
  const scriptsFile = join(bin, 'fake-scripts.json');
  mkdirSync(bin);
  writeFileSync(scriptsFile, JSON.stringify(scripts()));
  const received = join(bin, 'fake-received.ndjson');
  writeClaudeShim(bin, { scriptsFile, received });
  const baseEnv = { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: home, FORCE_COLOR: '0', NO_COLOR: '1' };
  for (const k of ['PIR_HOME', 'PARALLEL_ALLOW_HERE', 'PIR_FAKE_CLAUDE_SCRIPT', 'PIR_FAKE_CLAUDE_SCRIPTS', 'PIR_FAKE_CLAUDE_RECEIVED', 'NODE_TEST_CONTEXT']) delete baseEnv[k];

  const lines = [];
  const r = await runPlanScenario({ fixtureId: 'plan-command', scratchDir: repoDir, baseEnv, pollMs: 250, timeoutMs: 150_000, log: (l) => lines.push(l) });
  const why = `${r.reason}\n${r.report.facts.map((f) => `${f.pass ? '✓' : '✗'} ${f.id}: ${f.detail}`).join('\n')}\n--- log\n${lines.join('\n')}`;
  assert.equal(r.ok, true, why);
  assert.equal(r.reason, 'completed', why);
  assert.ok(r.report.facts.every((f) => f.pass), why);

  // The canned reply reached the planner as the person's words, and the scratch index stayed in the scratch.
  const sent = readFileSync(received, 'utf8');
  assert.ok(sent.includes(REPLY), 'the planner was sent the canned reply');
  assert.ok(lines.some((l) => l.includes('said') && l.includes('reply:plan-1.ndjson')), why);
  assert.ok(existsSync(join(repoDir, '.pir-home', '.pir', 'runs')), 'PIR_HOME is the scratch one');
  assert.ok(existsSync(join(r.bundleDir, 'plan-run.json')));
  assert.ok(existsSync(join(r.bundleDir, 'plan-conversations', 'plan-1.ndjson')));
});
