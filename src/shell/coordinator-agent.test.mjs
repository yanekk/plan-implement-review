// pir-coordinator T03 — the coordinator agent held as a live session, against the scripted fake `claude`
// (fake/claude-stream.mjs) through the real Agent SDK, and the fake platform. No test spawns the real
// `claude` or pays for a model.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startWorker as realStartWorker } from './worker-proc.mjs';
import { startCoordinatorAgent, gateFor, AGENT_TOOLS } from './coordinator-agent.mjs';
import { createFakePlatform } from './fake/platform.mjs';
import { fakeClaudeSpawner, initEvent, toolUse, resultEvent } from './fake/claude-stream.mjs';
import { allowResult } from '../core/stream.mjs';

const CLAUDE = '/nonexistent/claude';
const HOUR = 60 * 60 * 1000;

async function waitFor(pred, what, ms = 5000) {
  const start = Date.now();
  for (;;) {
    const v = pred();
    if (v) return v;
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

// A scratch repo with a feature worktree and a control folder, and a fake platform holding two workers.
function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'pir-coord-agent-'));
  // Close every agent started in this scratch before removing it: node runs `after` hooks in the order
  // they were added, so a separate close hook ran after the rm, and a fake session still writing into the
  // folder failed the rm with ENOTEMPTY under a loaded full suite (T04 review).
  const closers = [];
  t.after(async () => {
    await Promise.all(closers.map((close) => close()));
    rmSync(dir, { recursive: true, force: true });
  });
  const repoRoot = join(dir, 'repo');
  const featurePath = join(repoRoot, '.claude', 'worktrees', 'pir-demo');
  const controlDir = join(repoRoot, 'plans', 'demo', '.parallel', 'control');
  const skillsDir = join(dir, 'skills');
  for (const d of [featurePath, controlDir, skillsDir]) mkdirSync(d, { recursive: true });
  const platform = createFakePlatform();
  const w1 = platform.spawn({ cwd: dir, name: 'repo / demo / T05 / thing / implement', phase: 'implement' });
  const w2 = platform.spawn({ cwd: dir, name: 'repo / demo / T06 / other / implement', phase: 'implement' });
  return { dir, closers, repoRoot, featurePath, controlDir, skillsDir, platform, w1, w2, decisionsDir: join(controlDir, 'coordinator', 'decisions') };
}

// start(s, script, opts) → a coordinator agent whose session runs `script` in the fake.
function start(s, script, t, opts = {}) {
  const scriptPath = join(s.dir, `script-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(scriptPath, JSON.stringify(script));
  const spawner = fakeClaudeSpawner({ script: scriptPath, received: join(s.dir, 'received.ndjson') });
  const agent = startCoordinatorAgent({
    controlDir: s.controlDir, featurePath: s.featurePath, repoRoot: s.repoRoot, slug: 'demo',
    platform: s.platform, askRules: [], claudePath: CLAUDE, skillsDir: s.skillsDir,
    startWorker: (o) => realStartWorker({ ...o, spawnProcess: spawner }),
    ...opts,
  });
  s.closers.push(() => agent.close({ graceMs: 100, killMs: 300 }));
  return { agent, spawner };
}

const told = (agent) => agent.session.entries().filter((e) => e.dir === 'out' && e.kind === 'message').map((e) => e.text);
const drop = (s, name, obj) => writeFileSync(join(s.decisionsDir, name), typeof obj === 'string' ? obj : JSON.stringify(obj));

const permissionItem = (s, extra = {}) => ({
  worker: s.w1, task: 'T05', kind: 'permission', requestId: 'r1', request: { toolName: 'Bash', input: { command: 'npm test' } }, ...extra,
});
const questionsItem = (s) => ({
  worker: s.w1, task: 'T05', kind: 'questions', requestId: 'r2',
  request: { questions: [{ question: 'Colour?', options: [{ label: 'Red' }, { label: 'Blue' }] }], input: { questions: [{ question: 'Colour?' }] } },
});
const reportItem = (s) => ({ worker: s.w2, task: 'T06', kind: 'report', text: 'Should X be Y?' });

// ---- The gate (DESIGN §3.4) ----

test('gate: each allowed tool and path allowed; everything else denied', (t) => {
  const s = scratch(t);
  mkdirSync(s.decisionsDir, { recursive: true });
  const decide = gateFor({ cwd: s.featurePath, readRoots: [s.repoRoot, s.featurePath, s.skillsDir], decisionsDir: s.decisionsDir });

  assert.equal(decide('Read', { file_path: join(s.repoRoot, 'plans', 'demo', 'DESIGN.md') }), 'allow');
  assert.equal(decide('Read', { file_path: 'plans/demo/PROGRESS.md' }), 'allow', 'relative to the feature worktree');
  assert.equal(decide('Read', { file_path: join(s.skillsDir, 'pir-coordinator', 'SKILL.md') }), 'allow');
  assert.equal(decide('Read', { file_path: '/etc/passwd' }), 'deny');
  assert.equal(decide('Read', { file_path: join(s.repoRoot, '..', 'secret') }), 'deny', '`..` cannot escape');
  assert.equal(decide('Glob', { pattern: '**/*.md' }), 'allow');
  assert.equal(decide('Glob', { pattern: '**/*.md', path: s.repoRoot }), 'allow');
  assert.equal(decide('Glob', { pattern: '/etc/*' }), 'deny');
  assert.equal(decide('Glob', { pattern: '../../../../../*' }), 'deny');
  assert.equal(decide('Glob', { pattern: '**/../../../../../etc/*' }), 'deny', '`..` after a wildcard');
  assert.equal(decide('Grep', { pattern: 'x', path: s.featurePath }), 'allow');
  assert.equal(decide('Grep', { pattern: 'x' }), 'allow');
  assert.equal(decide('Grep', { pattern: 'x', path: '/etc' }), 'deny');
  assert.equal(decide('Skill', { skill: 'pir-coordinator' }), 'allow');
  assert.equal(decide('Skill', { skill: 'pir-implement' }), 'deny');
  assert.equal(decide('Write', { file_path: join(s.decisionsDir, '1-a.json') }), 'allow');
  assert.equal(decide('Write', { file_path: join(s.featurePath, 'x.json') }), 'deny', 'outside the folder');
  assert.equal(decide('Write', { file_path: s.decisionsDir }), 'deny', 'the folder itself');
  assert.equal(decide('Write', { file_path: join(s.decisionsDir, '..', 'ledger.jsonl') }), 'deny', 'via `..`');
  assert.equal(decide('Write', { file_path: join(s.decisionsDir, '..', '..', 'reports', 'x.json') }), 'deny');
  for (const tool of ['Bash', 'Edit', 'NotebookEdit', 'WebFetch', 'EnterWorktree', 'mcp__x__y']) {
    assert.equal(decide(tool, { command: 'ls', file_path: join(s.decisionsDir, 'a.json') }), 'deny', tool);
  }
});

test('gate compares real paths: a /private-form path matches a symlinked root, a symlink out does not', (t) => {
  const s = scratch(t);
  mkdirSync(s.decisionsDir, { recursive: true });
  const decide = gateFor({ cwd: s.featurePath, readRoots: [s.repoRoot], decisionsDir: s.decisionsDir });
  const real = realpathSync(s.decisionsDir);
  assert.equal(decide('Write', { file_path: join(real, 'b.json') }), 'allow');
  const outside = mkdtempSync(join(tmpdir(), 'pir-coord-out-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  symlinkSync(outside, join(s.decisionsDir, 'escape'));
  assert.equal(decide('Write', { file_path: join(s.decisionsDir, 'escape', 'c.json') }), 'deny');
  symlinkSync(outside, join(s.repoRoot, 'link-out'));
  assert.equal(decide('Read', { file_path: join(s.repoRoot, 'link-out', 'f') }), 'deny');
});

// ---- Starting the session ----

test('the agent starts fenced: default mode, the allowlist, its opening, Remote Control on, session.json written', async (t) => {
  const s = scratch(t);
  const { agent, spawner } = start(s, [{ await: 'user' }], t);
  await waitFor(() => agent.session.entries().some((e) => e.kind === 'remote-control'), 'Remote Control on');
  const args = spawner.calls[0].args;
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'default');
  assert.equal(args[args.indexOf('--tools') + 1], AGENT_TOOLS.join(','));
  assert.match(args[args.indexOf('--disallowedTools') + 1], /Bash/);
  assert.equal(spawner.calls[0].cwd, s.featurePath);
  const [opening] = told(agent);
  assert.match(opening, /pir-coordinator skill/);
  assert.ok(opening.includes(`Drop folder: ${s.decisionsDir}`));
  assert.equal(agent.alive(), true);
  const stored = JSON.parse(readFileSync(join(s.controlDir, 'coordinator', 'session.json'), 'utf8'));
  assert.deepEqual(stored, { sessionId: agent.id, restarts: [] });
  assert.ok(existsSync(join(s.controlDir, 'conversations', 'coordinator-1.ndjson')));
});

test('remote: false leaves Remote Control off (PARALLEL_REMOTE=0)', async (t) => {
  const s = scratch(t);
  const { agent } = start(s, [{ await: 'user' }, { emit: resultEvent('success', 'ok') }], t, { remote: false });
  await waitFor(() => agent.session.entries().some((e) => e.dir === 'in' && e.event.type === 'result'), 'a turn');
  assert.equal(agent.session.entries().some((e) => e.kind === 'remote-control'), false);
});

test('an agent tool request outside the allowance is denied by the gate, never parked', async (t) => {
  const s = scratch(t);
  const { agent } = start(s, [
    { await: 'user' }, { emit: initEvent() },
    { emit: { type: 'control_request', request_id: 'a1', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'git push' }, tool_use_id: 'toolu_a1' } } },
    { await: 'control_response' }, { emit: resultEvent('success', 'ok') },
  ], t);
  await waitFor(() => agent.session.entries().some((e) => e.kind === 'decided-by-gate'), 'the gate');
  const n = agent.session.entries().find((e) => e.kind === 'decided-by-gate');
  assert.equal(n.verdict, 'deny');
  assert.equal(agent.session.pending().length, 0);
});

// ---- Briefing ----

test('brief sends briefFor(item) once per item; answeredElsewhere tells the agent', async (t) => {
  const s = scratch(t);
  const { agent } = start(s, [{ await: 'user' }], t);
  const item = permissionItem(s);
  assert.equal(agent.brief(item), true);
  assert.equal(agent.brief(item), false, 'an item is briefed once');
  assert.equal(agent.answeredElsewhere(item), true);
  const texts = told(agent);
  assert.match(texts[1], /asking permission/);
  assert.match(texts[1], /`r1`/);
  assert.match(texts[2], /Already answered by the person/);
  assert.equal(agent.tell('hand-off'), true);
  assert.equal(told(agent).at(-1), 'hand-off');
});

test('forget(item): a worker\'s next report park under the same key is briefed afresh (T04)', async (t) => {
  const s = scratch(t);
  const { agent } = start(s, [{ await: 'user' }], t);
  const item = reportItem(s);
  assert.equal(agent.brief(item), true);
  assert.equal(agent.brief(item), false);
  agent.forget(item);
  assert.equal(agent.brief({ ...item, text: 'A second question' }), true);
});

// ---- Draining decisions ----

test('a scripted agent allows a permission: platform.answer with allowResult from the coordinator, ledgered', async (t) => {
  const s = scratch(t);
  const decision = { kind: 'permission', worker: s.w1, requestId: 'r1', decision: 'allow', reason: 'runs the tests' };
  const file = join(s.decisionsDir, '100-a.json');
  const { agent } = start(s, [
    { await: 'user' }, { emit: initEvent() }, { await: 'user' },
    { emit: toolUse('toolu_w', 'Write', { file_path: file, content: JSON.stringify(decision) }) },
    { sh: `printf '%s' '${JSON.stringify(decision)}' > '${file}'` },
    { emit: resultEvent('success', 'allowed') },
  ], t, { now: () => Date.parse('2026-09-27T10:00:00Z') });
  const item = permissionItem(s);
  agent.brief(item);
  await waitFor(() => existsSync(file), 'the decision file');

  const out = agent.drain([item]);
  assert.deepEqual(out, { passed: [], settled: [{ worker: s.w1, requestId: 'r1' }] });
  assert.deepEqual(s.platform.answers, [{ to: s.w1, requestId: 'r1', result: allowResult(item.request), from: 'coordinator' }]);
  assert.deepEqual(readdirSync(s.decisionsDir), [], 'consumed');
  const [line] = agent.ledger();
  assert.equal(line.t, '2026-09-27T10:00:00.000Z');
  assert.equal(line.kind, 'permission');
  assert.equal(line.worker, s.w1);
  assert.equal(line.answer, 'allow');
  assert.equal(line.reason, 'runs the tests');
  assert.equal(line.notable, false);
});

test('answers to a question set and a message to a report-parked worker: applied and ledgered', async (t) => {
  const s = scratch(t);
  const { agent } = start(s, [{ await: 'user' }], t);
  drop(s, '1-a.json', { kind: 'answers', worker: s.w1, requestId: 'r2', answers: { 'Colour?': 'Red' }, reason: 'the design says red', notable: true });
  drop(s, '2-b.json', { kind: 'message', worker: s.w2, text: 'Yes, make X be Y.', reason: 'DESIGN §2 says so' });
  const out = agent.drain([questionsItem(s), reportItem(s)]);
  assert.deepEqual(out.passed, []);
  assert.equal(s.platform.answers[0].result.updatedInput.answers['Colour?'], 'Red');
  assert.equal(s.platform.answers[0].from, 'coordinator');
  assert.deepEqual(s.platform.sent.at(-1), { to: s.w2, text: 'Yes, make X be Y.', from: 'coordinator' });
  const ledger = agent.ledger();
  assert.deepEqual(ledger.map((l) => [l.kind, l.worker, l.notable]), [['answers', s.w1, true], ['message', s.w2, false]]);
});

test('a permission on a reserved item: refused, returned in passed with the agent\'s reason, agent told', async (t) => {
  const s = scratch(t);
  const { agent } = start(s, [{ await: 'user' }], t);
  const item = permissionItem(s, { reserved: { kind: 'destructive', why: 'a destructive command is always the person\'s to approve' } });
  drop(s, '1-a.json', { kind: 'permission', worker: s.w1, requestId: 'r1', decision: 'allow', reason: 'looks fine to me' });
  const out = agent.drain([item]);
  assert.deepEqual(out.passed, [{ worker: s.w1, requestId: 'r1', reason: 'looks fine to me', suggestion: null }]);
  assert.equal(s.platform.answers.length, 0, 'nothing applied');
  assert.equal(agent.ledger().length, 0);
  assert.match(told(agent).at(-1), /not applied: this request is the person's/);
});

test('malformed file, unknown worker, already-answered request: dropped, agent told, nothing applied', async (t) => {
  const s = scratch(t);
  const { agent } = start(s, [{ await: 'user' }], t);
  drop(s, '1-a.json', { kind: 'permission', worker: s.w1, requestId: 'r1', decision: 'maybe', reason: 'x' });
  drop(s, '2-b.json', { kind: 'permission', worker: 'nobody', requestId: 'r1', decision: 'allow', reason: 'x' });
  drop(s, '3-c.json', { kind: 'permission', worker: s.w1, requestId: 'gone', decision: 'allow', reason: 'x' });
  const out = agent.drain([permissionItem(s)]);
  assert.deepEqual(out.passed, []);
  assert.equal(s.platform.answers.length, 0);
  assert.deepEqual(readdirSync(s.decisionsDir), []);
  const refusals = told(agent).slice(1);
  assert.equal(refusals.length, 3);
  assert.match(refusals[0], /1-a\.json was not applied: unknown decision "maybe"/);
  assert.match(refusals[1], /2-b\.json was not applied: nothing is waiting from worker "nobody"/);
  assert.match(refusals[2], /3-c\.json was not applied: request "gone"/);
});

test('a second decision for an item already applied in the same drain is refused (first answer wins)', async (t) => {
  const s = scratch(t);
  const { agent } = start(s, [{ await: 'user' }], t);
  drop(s, '1-a.json', { kind: 'permission', worker: s.w1, requestId: 'r1', decision: 'allow', reason: 'x' });
  drop(s, '2-b.json', { kind: 'permission', worker: s.w1, requestId: 'r1', decision: 'deny', reason: 'y' });
  agent.drain([permissionItem(s)]);
  assert.equal(s.platform.answers.length, 1);
  assert.equal(s.platform.answers[0].result.behavior, 'allow');
  assert.match(told(agent).at(-1), /2-b\.json was not applied/);
});

test('an answer the platform finds no longer pending: agent told it was answered elsewhere, no ledger line', async (t) => {
  const s = scratch(t);
  const { agent } = start(s, [{ await: 'user' }], t);
  s.platform.answer = () => ({ ok: false });
  drop(s, '1-a.json', { kind: 'permission', worker: s.w1, requestId: 'r1', decision: 'allow', reason: 'x' });
  agent.drain([permissionItem(s)]);
  assert.equal(agent.ledger().length, 0);
  assert.match(told(agent).at(-1), /Already answered by the person/);
});

test('a file that fails to parse is left for one pass and applied if it parses then; refused if it still fails', async (t) => {
  const s = scratch(t);
  const { agent } = start(s, [{ await: 'user' }], t);
  const good = JSON.stringify({ kind: 'permission', worker: s.w1, requestId: 'r1', decision: 'allow', reason: 'x' });
  drop(s, '1-a.json', good.slice(0, 20));
  agent.drain([permissionItem(s)]);
  assert.deepEqual(readdirSync(s.decisionsDir), ['1-a.json'], 'left for one more pass');
  assert.equal(told(agent).length, 1, 'the agent is not told yet');
  drop(s, '1-a.json', good);
  agent.drain([permissionItem(s)]);
  assert.equal(s.platform.answers.length, 1, 'applied once whole');

  drop(s, '2-b.json', '{ not json');
  agent.drain([]);
  agent.drain([]);
  assert.deepEqual(readdirSync(s.decisionsDir), []);
  assert.match(told(agent).at(-1), /2-b\.json was not applied: it is not valid JSON/);
});

test('pass: returned in passed and ledgered; no note written and nothing sent to the worker', async (t) => {
  const s = scratch(t);
  const { agent } = start(s, [{ await: 'user' }], t);
  drop(s, '1-a.json', { kind: 'pass', worker: s.w1, requestId: 'r2', reason: 'the plan does not say', suggestion: 'Red' });
  drop(s, '2-b.json', { kind: 'pass', worker: s.w2, reason: 'a user would see it', suggestion: 'no' });
  const sentBefore = s.platform.sent.length;
  const out = agent.drain([questionsItem(s), reportItem(s)]);
  assert.deepEqual(out.passed, [
    { worker: s.w1, requestId: 'r2', reason: 'the plan does not say', suggestion: 'Red' },
    { worker: s.w2, reason: 'a user would see it', suggestion: 'no' },
  ]);
  assert.deepEqual(s.platform.notes, []);
  assert.equal(s.platform.sent.length, sentBefore);
  assert.equal(s.platform.answers.length, 0);
  assert.deepEqual(agent.ledger().map((l) => l.kind), ['pass', 'pass']);
});

test('report and close: returned; close refused unless the run is ready to merge', async (t) => {
  const s = scratch(t);
  const { agent } = start(s, [{ await: 'user' }], t);
  const sections = { delivered: 'd', checkByHand: 'c', risks: 'r' };
  drop(s, '1-a.json', { kind: 'report', sections });
  drop(s, '2-b.json', { kind: 'close' });
  const out = agent.drain([]);
  assert.deepEqual(out.report, sections);
  assert.equal(out.close, undefined);
  assert.match(told(agent).at(-1), /still building/);
  drop(s, '3-c.json', { kind: 'close' });
  assert.equal(agent.drain([], { ready: true }).close, true);
});

// ---- Exits and restarts (DESIGN §2.11) ----

test('exit: resumed with the stored session id; a fourth exit within an hour gives it up for good', async (t) => {
  const s = scratch(t);
  const { agent, spawner } = start(s, [{ await: 'user' }, { exit: 1 }], t, { now: () => Date.parse('2026-09-27T10:00:00Z') });
  const id = agent.id;
  await waitFor(() => spawner.calls.length === 4 && !agent.alive(), 'four exits and give-up', 10000);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(spawner.calls.length, 4, 'no fifth start');
  for (const call of spawner.calls.slice(1)) assert.ok(call.args.includes(`--resume=${id}`), call.args.join(' '));
  assert.equal(agent.alive(), false);
  const stored = JSON.parse(readFileSync(join(s.controlDir, 'coordinator', 'session.json'), 'utf8'));
  assert.equal(stored.sessionId, id);
  assert.equal(stored.restarts.length, 4);
  assert.ok(agent.session.entries().some((e) => e.kind === 'coordinator-given-up'));
  assert.equal(agent.brief(permissionItem(s)), false, 'a given-up agent takes no briefs');
  assert.equal(readdirSync(join(s.controlDir, 'conversations')).filter((f) => f.startsWith('coordinator-')).length, 1, 'one conversation file, appended');

  // A pir restart within the hour keeps it given up.
  const again = startCoordinatorAgent({
    controlDir: s.controlDir, featurePath: s.featurePath, repoRoot: s.repoRoot, slug: 'demo', platform: s.platform,
    claudePath: CLAUDE, skillsDir: s.skillsDir, now: () => Date.parse('2026-09-27T10:30:00Z'),
    startWorker: () => assert.fail('a given-up agent is not started again'),
  });
  assert.equal(again.alive(), false);
  assert.equal(again.givenUp(), true, 'given up, not restarting: the end of the run carries on without it (T05)');
  assert.equal(again.briefEnd({ tests: 'green' }), false);
});

test('briefEnd sends the end brief; record appends a command-owned ledger line; givenUp is false while alive (T05)', async (t) => {
  const s = scratch(t);
  const { agent } = start(s, [{ await: 'user' }, { await: 'user' }], t);
  assert.equal(agent.givenUp(), false);
  assert.equal(agent.briefEnd({ tasks: [{ num: 'T01', name: 'a', state: '✅' }], tests: 'green' }), true);
  assert.ok(told(agent).some((m) => m.startsWith('Every task is done. Write the delivery report.') && m.includes('- T01 a ✅')));
  agent.record({ kind: 'adopt', task: 'T09', name: 'extra', notable: true });
  assert.deepEqual(agent.ledger().map((l) => [l.kind, l.task, l.notable]), [['adopt', 'T09', true]]);
});

test('exits spread over more than an hour keep being resumed', async (t) => {
  const s = scratch(t);
  let clock = Date.parse('2026-09-27T10:00:00Z');
  const now = () => (clock += 25 * 60 * 1000);
  const { agent, spawner } = start(s, [{ await: 'user' }, { exit: 1 }], t, { now });
  await waitFor(() => spawner.calls.length >= 6, 'six starts', 10000);
  await agent.close({ graceMs: 100, killMs: 300 });
  assert.equal(agent.session.entries().some((e) => e.kind === 'coordinator-given-up'), false);
});

test('restart: a second startCoordinatorAgent on the same control folder resumes the session and keeps the ledger', async (t) => {
  const s = scratch(t);
  const first = start(s, [{ await: 'user' }], t);
  drop(s, '1-a.json', { kind: 'permission', worker: s.w1, requestId: 'r1', decision: 'allow', reason: 'x' });
  first.agent.drain([permissionItem(s)]);
  const id = first.agent.id;
  await first.agent.close({ graceMs: 100, killMs: 300 });

  const second = start(s, [{ await: 'user' }], t);
  assert.equal(second.agent.id, id);
  assert.ok(second.spawner.calls[0].args.includes(`--resume=${id}`));
  assert.equal(second.agent.ledger().length, 1);
  assert.match(told(second.agent)[0], /restarted your session/);
  const stored = JSON.parse(readFileSync(join(s.controlDir, 'coordinator', 'session.json'), 'utf8'));
  assert.deepEqual(stored.restarts, [], 'a close is not an exit');
  assert.deepEqual(readdirSync(join(s.controlDir, 'conversations')).filter((f) => f.startsWith('coordinator-')), ['coordinator-1.ndjson']);
});

test('a torn last ledger line is skipped on read', (t) => {
  const s = scratch(t);
  mkdirSync(join(s.controlDir, 'coordinator'), { recursive: true });
  writeFileSync(join(s.controlDir, 'coordinator', 'ledger.jsonl'), '{"kind":"pass"}\n{"kind":"perm');
  const agent = startCoordinatorAgent({
    controlDir: s.controlDir, featurePath: s.featurePath, repoRoot: s.repoRoot, slug: 'demo', platform: s.platform,
    claudePath: CLAUDE, skillsDir: s.skillsDir,
    startWorker: (o) => realStartWorker({ ...o, spawnProcess: fakeClaudeSpawner({ script: writeScript(s.dir) }) }),
  });
  s.closers.push(() => agent.close({ graceMs: 100, killMs: 300 }));
  assert.deepEqual(agent.ledger(), [{ kind: 'pass' }]);

  // The next applied decision is appended on a line of its own, not fused onto the torn one.
  drop(s, '1-a.json', { kind: 'pass', worker: s.w2, reason: 'r', suggestion: 'no' });
  agent.drain([reportItem(s)]);
  assert.deepEqual(agent.ledger().map((l) => l.kind), ['pass', 'pass']);
  assert.equal(agent.ledger()[1].worker, s.w2);
});

function writeScript(dir) {
  const p = join(dir, 'idle.json');
  writeFileSync(p, JSON.stringify([{ await: 'user' }]));
  return p;
}
