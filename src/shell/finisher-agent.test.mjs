// finisher T04 — the finisher held as a live session, against the scripted fake `claude`
// (fake/claude-stream.mjs) through the real Agent SDK. No test spawns the real `claude` or pays for a model.
//
// The fake honours the SDK's PreToolUse hook and simulates a settings allow rule (`allowRuled`) the way T00
// measured the real CLI 2.1.284 doing it (finisher DESIGN §3.3). That the real CLI behaves so is T00's
// measurement, not these tests': they show pir wires the hook and gate as the measurement requires.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startWorker as realStartWorker } from './worker-proc.mjs';
import { startFinisher, FINISHER_TOOLS, FINISHER_HOOKS, ASK_EVERY_CALL } from './finisher-agent.mjs';
import { fakeClaudeSpawner, toolUse, toolResult, canUseTool } from './fake/claude-stream.mjs';
import { RESTARTED_MID_FINISH } from '../core/finisher-policy.mjs';

const CLAUDE = '/nonexistent/claude';

async function waitFor(pred, what, ms = 5000) {
  const start = Date.now();
  for (;;) {
    const v = pred();
    if (v) return v;
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'pir-finisher-'));
  const closers = [];
  t.after(async () => {
    await Promise.all(closers.map((close) => close()));
    rmSync(dir, { recursive: true, force: true });
  });
  const repoRoot = join(dir, 'repo');
  const featurePath = join(repoRoot, '.claude', 'worktrees', 'pir-demo');
  const controlDir = join(repoRoot, 'plans', 'demo', '.parallel', 'control');
  const skillsDir = join(dir, 'skills');
  const engineDir = join(dir, 'engine');
  const pirHome = join(dir, 'pirhome');
  for (const d of [featurePath, controlDir, skillsDir, engineDir, pirHome]) mkdirSync(d, { recursive: true });
  const finDir = join(controlDir, 'finisher');
  return {
    dir, closers, repoRoot, featurePath, controlDir, skillsDir, engineDir, pirHome, finDir,
    statusDir: join(finDir, 'status'), received: join(dir, 'received.ndjson'),
  };
}

function start(s, script, t, opts = {}) {
  const scriptPath = join(s.dir, `script-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(scriptPath, JSON.stringify(script));
  const spawner = fakeClaudeSpawner({ script: scriptPath, received: s.received });
  const calls = [];
  const fin = startFinisher({
    controlDir: s.controlDir, featurePath: s.featurePath, repoRoot: s.repoRoot, slug: 'demo',
    mainCheckout: s.repoRoot, base: 'dev', rules: { path: join(s.featurePath, '.pir', 'rules', 'on-finish.md'), source: 'project' },
    reportPath: join(s.repoRoot, 'plans', 'demo', 'REPORT.md'), askRules: [], claudePath: CLAUDE,
    skillsDir: s.skillsDir, engineDir: s.engineDir, pirHome: s.pirHome, remote: false,
    startWorker: (o) => {
      calls.push(o);
      return realStartWorker({ ...o, spawnProcess: spawner });
    },
    ...opts,
  });
  s.closers.push(() => fin.close({ graceMs: 100, killMs: 300 }));
  return { fin, spawner, calls };
}

const told = (fin) => fin.session.entries().filter((e) => e.dir === 'out' && e.kind === 'message').map((e) => e.text);
const status = (s, name, obj) => writeFileSync(join(s.statusDir, name), typeof obj === 'string' ? obj : JSON.stringify(obj));
const received = (s) => (existsSync(s.received) ? readFileSync(s.received, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const gateNotes = (fin) => fin.session.entries().filter((e) => e.kind === 'decided-by-gate');
const state = (s) => JSON.parse(readFileSync(join(s.finDir, 'state.json'), 'utf8'));

const READY = { kind: 'ready', rules: '/r/on-finish.md', summary: 'All clean.', steps: ['git -C /repo merge pir/demo', './install.sh'] };
const STUCK = { kind: 'stuck', summary: 'install.sh failed', proposal: 'retry', steps: ['./install.sh'] };
const Q = 'Ready to finish? 2 steps from project rules';
const GOQ = { questions: [{ question: Q, header: 'Go', options: [{ label: 'Go' }, { label: 'Not yet' }], multiSelect: false }] };
const goReply = (answer, input = GOQ) => ({ behavior: 'allow', updatedInput: { ...input, answers: { [input.questions[0].question]: answer } } });

// Drive a finisher from preparing to awaiting-go, then let the script ask its go question.
async function toAwaitingGo(s, fin) {
  status(s, '1-ready.json', READY);
  const out = fin.drain();
  assert.deepEqual(out.accepted.map((x) => x.kind), ['ready']);
  assert.equal(fin.phase(), 'awaiting-go');
  fin.tell('ask it');
  const req = await waitFor(() => fin.session.pending().find((p) => p.kind === 'questions'), 'the go question parked');
  fin.drain(); // sees the question in this generation
  return req;
}

async function toFinishing(s, fin) {
  const req = await toAwaitingGo(s, fin);
  assert.equal(fin.session.answer(req.requestId, goReply('Go'), { from: 'person' }), true);
  const out = fin.drain();
  assert.deepEqual(out.go, { by: 'person' });
  assert.equal(fin.phase(), 'finishing');
}

// A script that asks the go question after the test's first message, then runs `after`.
const askThen = (after = []) => [{ await: 'user' }, { await: 'user' }, { tool: { id: 'q1', name: 'AskUserQuestion', input: GOQ } }, ...after];

// ---- The fence (DESIGN §3.3) ----

test('fence: started with the hook T00 chose, default mode and the tool allowlist; the hook asks for every call', async (t) => {
  const s = scratch(t);
  const { fin, calls } = start(s, [{ await: 'user' }], t);
  assert.equal(calls.length, 1);
  const o = calls[0];
  assert.equal(o.permissionMode, 'default');
  assert.deepEqual(o.tools, FINISHER_TOOLS);
  assert.equal(o.hooks, FINISHER_HOOKS);
  assert.equal(o.handTool, undefined, 'the finisher is never handed the hand tool (bang-commands §2.6)');
  assert.equal(FINISHER_HOOKS.PreToolUse.length, 1);
  assert.equal(FINISHER_HOOKS.PreToolUse[0].matcher, undefined, 'no matcher: every tool');
  for (const tool of ['Bash', 'Read', 'Write', 'AskUserQuestion', 'Agent', 'CronCreate']) {
    const r = await ASK_EVERY_CALL({ tool_name: tool, tool_input: {} });
    assert.equal(r.hookSpecificOutput.permissionDecision, 'ask', tool);
  }
  assert.equal(o.name, 'repo / demo / finisher');
  assert.equal(fin.logPath, join(s.controlDir, 'conversations', 'finisher-1.ndjson'));
  assert.match(told(fin)[0], /pir-finisher skill/);
  assert.match(told(fin)[0], /Status folder: .*finisher\/status/);
  // The SDK registered the hook with the CLI at initialize.
  await waitFor(() => received(s).some((r) => r.line?.includes('"subtype":"initialize"')), 'initialize');
  const init = JSON.parse(received(s).find((r) => r.line?.includes('"subtype":"initialize"')).line);
  assert.equal(init.request.hooks.PreToolUse[0].hookCallbackIds.length, 1);
});

test('fence: in preparing an allow-ruled git merge reaches pir through the hook and is denied', async (t) => {
  const s = scratch(t);
  const merge = { command: 'git merge pir/demo' };
  const { fin } = start(s, [{ await: 'user' }, { tool: { id: 'm1', name: 'Bash', input: merge, allowRuled: true } }, { await: 'user' }], t);
  await waitFor(() => gateNotes(fin).length === 1, 'the gate decided');
  assert.equal(gateNotes(fin)[0].verdict, 'deny');
  assert.equal(gateNotes(fin)[0].toolName, 'Bash');
  await waitFor(() => received(s).some((r) => r.tool === 'm1'), 'the fake recorded the outcome');
  assert.equal(received(s).find((r) => r.tool === 'm1').outcome, 'asked', 'the hook sent it on to can_use_tool');
  const reply = fin.session.entries().find((e) => e.kind === 'reply' && e.requestId === 'm1');
  assert.equal(reply.result.behavior, 'deny');
  assert.match(reply.result.message, /phase is preparing, so you may only look/);
});

test('fence control: without the hook the fake runs an allow-ruled merge unseen, so the test above is not vacuous', async (t) => {
  const s = scratch(t);
  const scriptPath = join(s.dir, 'plain.json');
  writeFileSync(scriptPath, JSON.stringify([{ await: 'user' }, { tool: { id: 'm2', name: 'Bash', input: { command: 'git merge x' }, allowRuled: true } }, { await: 'user' }]));
  const w = realStartWorker({
    cwd: s.featurePath, sessionId: '11111111-1111-4111-8111-111111111111', name: 'plain', logPath: join(s.dir, 'plain.ndjson'),
    claudePath: CLAUDE, permissionMode: 'default', decide: () => 'deny', spawnProcess: fakeClaudeSpawner({ script: scriptPath, received: s.received }),
  });
  s.closers.push(() => w.close({ graceMs: 100, killMs: 300 }));
  w.send('go');
  await waitFor(() => received(s).some((r) => r.tool === 'm2'), 'outcome');
  assert.equal(received(s).find((r) => r.tool === 'm2').outcome, 'ran');
  assert.equal(w.entries().filter((e) => e.kind === 'decided-by-gate').length, 0);
});

test('fence: Write only into the status folder and the pir-finisher skill while looking', async (t) => {
  const s = scratch(t);
  const inside = join(s.statusDir, '9-x.json');
  const outside = join(s.featurePath, 'src.mjs');
  const { fin } = start(s, [
    { await: 'user' },
    { tool: { id: 'w1', name: 'Write', input: { file_path: inside, content: '{}' } } },
    { tool: { id: 'w2', name: 'Write', input: { file_path: outside, content: 'x' } } },
    { tool: { id: 's1', name: 'Skill', input: { skill: 'pir-finisher' } } },
    { tool: { id: 's2', name: 'Skill', input: { skill: 'pir-coordinator' } } },
    { tool: { id: 'r1', name: 'Read', input: { file_path: join(s.pirHome, 'default', 'rules', 'on-finish.md') } } },
    { tool: { id: 'r2', name: 'Read', input: { file_path: '/etc/passwd' } } },
    { tool: { id: 'b1', name: 'Bash', input: { command: 'git -C /x status && git log --oneline -3' } } },
    { await: 'user' },
  ], t);
  await waitFor(() => gateNotes(fin).length === 7, 'seven verdicts');
  const v = Object.fromEntries(gateNotes(fin).map((n) => [n.requestId, n.verdict]));
  assert.deepEqual(v, { w1: 'allow', w2: 'deny', s1: 'allow', s2: 'deny', r1: 'allow', r2: 'deny', b1: 'allow' });
});

// ---- A single run's finisher (single-finisher DESIGN §2.7) ----

// A single run's control folder is plans/{name}/.parallel/single/, so its status folder sits under it.
function singleOpts(s) {
  const controlDir = join(s.repoRoot, 'plans', 'demo', '.parallel', 'single');
  mkdirSync(controlDir, { recursive: true });
  return { kind: 'single', controlDir, reportPath: null, promptPath: join(controlDir, 'prompt.md') };
}

test('single: starts with the single opening and the single session name; no Report line', async (t) => {
  const s = scratch(t);
  const opts = singleOpts(s);
  const { fin, calls } = start(s, [{ await: 'user' }], t, opts);
  assert.equal(calls[0].name, 'repo / demo / single / finisher');
  assert.equal(calls[0].hooks, FINISHER_HOOKS, 'the same fence as a build');
  assert.deepEqual(calls[0].tools, FINISHER_TOOLS);
  const text = told(fin)[0];
  assert.match(text, /^Invoke the pir-finisher skill and follow it\. You are the finisher of the single run `demo`/);
  assert.ok(text.includes(`Change asked for: ${opts.promptPath}`));
  assert.ok(text.includes(`Status folder: ${join(opts.controlDir, 'finisher', 'status')}`));
  assert.doesNotMatch(text, /^Report:/m);
  assert.doesNotMatch(text, /^Plan:/m);
  assert.doesNotMatch(text, /null/);
  assert.equal(fin.logPath, join(opts.controlDir, 'conversations', 'finisher-1.ndjson'));
});

test('single: in preparing a git merge is refused and a git log allowed, exactly as for a build', async (t) => {
  for (const kind of ['build', 'single']) {
    const s = scratch(t);
    const opts = kind === 'single' ? singleOpts(s) : {};
    const { fin } = start(s, [
      { await: 'user' },
      { tool: { id: 'm1', name: 'Bash', input: { command: 'git merge pir/demo' }, allowRuled: true } },
      { tool: { id: 'l1', name: 'Bash', input: { command: 'git log --oneline dev..pir/demo' } } },
      { await: 'user' },
    ], t, opts);
    await waitFor(() => gateNotes(fin).length === 2, `${kind}: two verdicts`);
    const v = Object.fromEntries(gateNotes(fin).map((n) => [n.requestId, n.verdict]));
    assert.deepEqual(v, { m1: 'deny', l1: 'allow' }, kind);
    assert.equal(fin.phase(), 'preparing', kind);
  }
});

// ---- Status files (DESIGN §2.6) ----

test('status: ready → awaiting-go with a ledger line and state.json; malformed retried once then refused', async (t) => {
  const s = scratch(t);
  const { fin } = start(s, [{ await: 'user' }, { await: 'user' }], t);
  status(s, '1-a.json', READY);
  const out = fin.drain();
  assert.deepEqual(out.accepted, [READY]);
  assert.equal(fin.phase(), 'awaiting-go');
  assert.ok(!existsSync(join(s.statusDir, '1-a.json')), 'consumed');
  const line = fin.ledger().at(-1);
  assert.deepEqual([line.kind, line.status, line.from, line.to, line.summary, line.steps], ['status', 'ready', 'preparing', 'awaiting-go', READY.summary, READY.steps]);
  assert.equal(state(s).phase, 'awaiting-go');
  assert.deepEqual(state(s).lastReady, { rules: READY.rules, summary: READY.summary, steps: READY.steps });
  assert.deepEqual(fin.view().steps, READY.steps);

  status(s, '2-b.json', '{"kind": "stu');
  assert.deepEqual(fin.drain().refused, [], 'left one more pass');
  assert.ok(existsSync(join(s.statusDir, '2-b.json')));
  const again = fin.drain();
  assert.deepEqual(again.refused, [{ file: '2-b.json', why: 'it is not valid JSON' }]);
  assert.match(told(fin).at(-1), /2-b\.json was refused: it is not valid JSON/);
  assert.equal(fin.phase(), 'awaiting-go');
});

test('status: a kind refused for its phase is answered once and changes nothing', async (t) => {
  const s = scratch(t);
  const { fin } = start(s, [{ await: 'user' }, { await: 'user' }], t);
  status(s, '1-a.json', { kind: 'done', summary: 'did it' });
  const out = fin.drain();
  assert.equal(out.accepted.length, 0);
  assert.match(out.refused[0].why, /not accepted while the finisher is preparing/);
  assert.equal(fin.phase(), 'preparing');
  assert.match(told(fin).at(-1), /was refused/);
});

test('status: files left from before the start are cleared', (t) => {
  const s = scratch(t);
  mkdirSync(s.statusDir, { recursive: true });
  status(s, '0-old.json', READY);
  const { fin } = start(s, [{ await: 'user' }], t);
  assert.deepEqual(fin.drain().accepted, []);
});

// ---- The go (DESIGN §2.7) ----

test('go: the person answering Go in pir → finishing, ledger by person, goGiven', async (t) => {
  const s = scratch(t);
  const { fin } = start(s, askThen([{ await: 'user' }]), t);
  await toFinishing(s, fin);
  assert.equal(fin.goGiven(), true);
  assert.equal(state(s).goGiven, true);
  const go = fin.ledger().find((l) => l.kind === 'go');
  assert.deepEqual([go.by, go.from, go.to], ['person', 'awaiting-go', 'finishing']);
});

test('go: a phone answer (answered-remotely + tool result naming Go) → finishing, by phone', async (t) => {
  const s = scratch(t);
  const { fin } = start(s, [
    { await: 'user' },
    { await: 'user' },
    { emit: toolUse('toolu_q9', 'AskUserQuestion', GOQ) },
    { emit: canUseTool('q9', 'AskUserQuestion', GOQ) },
    { await: 'user' },
    { emit: { type: 'control_cancel_request', request_id: 'q9' } },
    { sleep: 50 },
    { emit: toolResult('toolu_q9', `User has answered your questions: "${Q}"="Go". You can now continue with the user's answers in mind.`) },
    { await: 'user' },
  ], t);
  status(s, '1-a.json', READY);
  fin.drain();
  fin.tell('ask it');
  await waitFor(() => fin.session.pending().length === 1, 'parked');
  fin.drain();
  fin.tell('phone now');
  await waitFor(() => fin.session.entries().some((e) => e.dir === 'in' && JSON.stringify(e).includes('You can now continue')), 'tool result');
  const out = fin.drain();
  assert.deepEqual(out.go, { by: 'phone' });
  assert.equal(fin.phase(), 'finishing');
  assert.equal(fin.ledger().find((l) => l.kind === 'go').by, 'phone');
});

test('go: Not yet leaves the phase and is ledgered; a Go to a question with another header changes nothing', async (t) => {
  const s = scratch(t);
  const other = { questions: [{ question: 'Colour?', header: 'Colour', options: [{ label: 'Go' }, { label: 'Stop' }] }] };
  const { fin } = start(s, askThen([{ tool: { id: 'q2', name: 'AskUserQuestion', input: other } }, { await: 'user' }]), t);
  const req = await toAwaitingGo(s, fin);
  fin.session.answer(req.requestId, goReply('Not yet'), { from: 'person' });
  let out = fin.drain();
  assert.equal(out.go, null);
  assert.equal(fin.phase(), 'awaiting-go');
  const ny = fin.ledger().find((l) => l.kind === 'not-yet');
  assert.deepEqual([ny.by, ny.phase, ny.answer], ['person', 'awaiting-go', 'Not yet']);

  const r2 = await waitFor(() => fin.session.pending().find((p) => p.requestId === 'q2'), 'second question');
  fin.drain();
  fin.session.answer(r2.requestId, goReply('Go', other), { from: 'person' });
  out = fin.drain();
  assert.equal(out.go, null);
  assert.equal(fin.phase(), 'awaiting-go');
  assert.equal(fin.goGiven(), false);
});

test('go: a Go to a question asked before the latest ready does not count, and the finisher is told', async (t) => {
  const s = scratch(t);
  const { fin } = start(s, askThen([{ await: 'user' }]), t);
  const req = await toAwaitingGo(s, fin);
  status(s, '2-ready.json', { ...READY, steps: ['something else'] }); // re-prepared steps
  fin.drain();
  fin.session.answer(req.requestId, goReply('Go'), { from: 'person' });
  const out = fin.drain();
  assert.equal(out.go, null);
  assert.equal(fin.phase(), 'awaiting-go');
  assert.match(told(fin).at(-1), /That Go does not count/);
  assert.equal(fin.ledger().at(-1).kind, 'stale-go');
});

test('go: a Go answered in preparing (no ready yet) does not open the fence', async (t) => {
  const s = scratch(t);
  const { fin } = start(s, askThen([{ await: 'user' }]), t);
  fin.tell('ask it');
  const req = await waitFor(() => fin.session.pending()[0], 'parked');
  fin.drain();
  fin.session.answer(req.requestId, goReply('Go'), { from: 'person' });
  assert.equal(fin.drain().go, null);
  assert.equal(fin.phase(), 'preparing');
});

// ---- After the go (DESIGN §2.5, §2.12) ----

test('finishing: rm -rf x parks for the person (not allowed, not denied); asking in the view', async (t) => {
  const s = scratch(t);
  const { fin } = start(s, askThen([{ await: 'user' }, { tool: { id: 'rm1', name: 'Bash', input: { command: 'rm -rf x' }, allowRuled: true } }, { await: 'user' }]), t);
  await toFinishing(s, fin);
  fin.tell('carry on');
  const req = await waitFor(() => fin.session.pending().find((p) => p.requestId === 'rm1'), 'rm parked');
  assert.equal(req.toolName, 'Bash');
  assert.equal(gateNotes(fin).filter((n) => n.requestId === 'rm1').length, 0, 'not decided by the gate');
  assert.equal(fin.view().asking, true);
  assert.equal(fin.view().state, 'finishing');
});

test('finishing: an ordinary step is allowed; a request the CLI flags defaultToNo parks', async (t) => {
  const s = scratch(t);
  const { fin } = start(s, askThen([
    { await: 'user' },
    { tool: { id: 'ok1', name: 'Bash', input: { command: 'git -C /repo merge pir/demo' } } },
    { tool: { id: 'dn1', name: 'Bash', input: { command: 'npm publish' }, request: { default_to_no: true } } },
    { await: 'user' },
  ]), t);
  await toFinishing(s, fin);
  fin.tell('carry on');
  await waitFor(() => fin.session.pending().find((p) => p.requestId === 'dn1'), 'publish parked');
  assert.equal(gateNotes(fin).find((n) => n.requestId === 'ok1').verdict, 'allow');
});

test('stuck: back to look-only; a Bash git merge is then denied', async (t) => {
  const s = scratch(t);
  const { fin } = start(s, askThen([{ await: 'user' }, { tool: { id: 'm3', name: 'Bash', input: { command: 'git merge pir/demo' }, allowRuled: true } }, { await: 'user' }]), t);
  await toFinishing(s, fin);
  status(s, '2-stuck.json', STUCK);
  assert.deepEqual(fin.drain().accepted.map((x) => x.kind), ['stuck']);
  assert.equal(fin.phase(), 'stuck');
  assert.equal(fin.view().summary, STUCK.summary);
  fin.tell('try merging');
  await waitFor(() => gateNotes(fin).find((n) => n.requestId === 'm3'), 'merge decided');
  assert.equal(gateNotes(fin).find((n) => n.requestId === 'm3').verdict, 'deny');
  assert.equal(fin.goGiven(), true, 'the go survives stuck');
});

test('done: accepted only in finishing; the view reads done', async (t) => {
  const s = scratch(t);
  const { fin } = start(s, askThen([{ await: 'user' }]), t);
  await toFinishing(s, fin);
  status(s, '3-done.json', { kind: 'done', summary: 'merged and installed' });
  assert.deepEqual(fin.drain().accepted, [{ kind: 'done', summary: 'merged and installed' }]);
  assert.equal(fin.phase(), 'done');
  assert.equal(fin.view().summary, 'merged and installed');
});

// ---- Restarts (DESIGN §2.12) ----

test('exit in finishing → resumed with its session id, phase stuck, the resumed message carries the summary', async (t) => {
  const s = scratch(t);
  const { fin, spawner } = start(s, askThen([{ await: 'user' }, { exit: 1 }]), t);
  const id = fin.id;
  await toFinishing(s, fin);
  const first = fin.session;
  fin.tell('crash now');
  await waitFor(() => spawner.calls.length === 2 && fin.session !== first && fin.alive(), 'resumed');
  assert.ok(spawner.calls[1].args.includes(`--resume=${id}`));
  assert.equal(fin.phase(), 'stuck');
  assert.equal(fin.goGiven(), true, 'goGiven survives a finisher restart');
  assert.match(told(fin)[0], new RegExp(RESTARTED_MID_FINISH));
  assert.match(told(fin)[0], /fresh go/);
  const r = fin.ledger().find((l) => l.kind === 'restart');
  assert.deepEqual([r.from, r.to], ['finishing', 'stuck']);
  assert.equal(fin.logPath, join(s.controlDir, 'conversations', 'finisher-1.ndjson'), 'the same conversation, appended');
});

test('four exits within an hour → given up; a pir restart within the hour keeps it given up', async (t) => {
  const s = scratch(t);
  const now = () => Date.parse('2026-09-29T10:00:00Z');
  const { fin, spawner } = start(s, [{ await: 'user' }, { exit: 1 }], t, { now });
  await waitFor(() => spawner.calls.length === 4 && fin.givenUp(), 'given up', 10000);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(spawner.calls.length, 4);
  assert.equal(fin.view().state, 'given-up');
  assert.equal(fin.ledger().at(-1).kind, 'given-up');
  const again = startFinisher({
    controlDir: s.controlDir, featurePath: s.featurePath, repoRoot: s.repoRoot, slug: 'demo', rules: { path: '/r', source: 'default' },
    claudePath: CLAUDE, now: () => Date.parse('2026-09-29T10:30:00Z'), remote: false,
    startWorker: () => assert.fail('a given-up finisher is not started again'),
  });
  assert.equal(again.givenUp(), true);
  assert.equal(again.view().state, 'given-up');
  assert.equal(again.view().logPath, join(s.controlDir, 'conversations', 'finisher-1.ndjson'));
});

test('pir restart with state.json: finishing → stuck, goGiven kept; awaiting-go kept and told to ask again', async (t) => {
  const s = scratch(t);
  mkdirSync(s.finDir, { recursive: true });
  writeFileSync(join(s.finDir, 'session.json'), JSON.stringify({ sessionId: '22222222-2222-4222-8222-222222222222', restarts: [] }));
  writeFileSync(join(s.finDir, 'state.json'), JSON.stringify({ phase: 'finishing', goGiven: true, rules: '/r', rulesSource: 'project', steps: ['a'] }));
  const { fin, spawner } = start(s, [{ await: 'user' }, { await: 'user' }], t);
  await waitFor(() => spawner.calls.length === 1, 'spawned');
  assert.ok(spawner.calls[0].args.includes('--resume=22222222-2222-4222-8222-222222222222'));
  assert.equal(fin.phase(), 'stuck');
  assert.equal(fin.goGiven(), true, 'goGiven survives a pir restart');
  assert.equal(state(s).phase, 'stuck');
  assert.match(told(fin)[0], /pir restarted your session/);
  assert.match(told(fin)[0], new RegExp(RESTARTED_MID_FINISH));
  await fin.close({ graceMs: 100, killMs: 300 });

  writeFileSync(join(s.finDir, 'state.json'), JSON.stringify({ phase: 'awaiting-go', goGiven: false, steps: ['a'] }));
  const { fin: f2 } = start(s, [{ await: 'user' }], t);
  assert.equal(f2.phase(), 'awaiting-go');
  assert.match(told(f2)[0], /ask it again/);
});

test('an unreadable state.json reads as preparing', (t) => {
  const s = scratch(t);
  mkdirSync(s.finDir, { recursive: true });
  writeFileSync(join(s.finDir, 'state.json'), '{torn');
  const { fin } = start(s, [{ await: 'user' }], t);
  assert.equal(fin.phase(), 'preparing');
});

// ---- Re-sync (DESIGN §2.8) ----

test('resynced: before any go, back to preparing and told; after a go nothing changes', async (t) => {
  const s = scratch(t);
  const { fin } = start(s, askThen([{ await: 'user' }]), t);
  const req = await toAwaitingGo(s, fin);
  assert.equal(fin.resynced('abcdef1234567890'), true);
  assert.equal(fin.phase(), 'preparing');
  assert.match(told(fin).at(-1), /^dev moved to abcdef123456/);
  assert.equal(fin.ledger().at(-1).kind, 'resync');
  assert.equal(fin.ledger().at(-1).base, 'dev');
  assert.equal(fin.ledger().at(-1).baseSha, 'abcdef1234567890');
  // The old question is void even once a fresh ready arrives.
  status(s, '2-ready.json', READY);
  fin.drain();
  fin.session.answer(req.requestId, goReply('Go'), { from: 'person' });
  assert.equal(fin.drain().go, null);
  assert.equal(fin.phase(), 'awaiting-go');
});

test('resynced: false in finishing and in stuck after a go', async (t) => {
  const s = scratch(t);
  const { fin } = start(s, askThen([{ await: 'user' }]), t);
  await toFinishing(s, fin);
  assert.equal(fin.resynced('abc'), false);
  status(s, '2-stuck.json', STUCK);
  fin.drain();
  assert.equal(fin.resynced('abc'), false);
  assert.equal(fin.phase(), 'stuck');
});

// ---- The go between passes (review T04) ----

test('go: a step the finisher takes straight after the Go, before the next drain, is judged in finishing', async (t) => {
  const s = scratch(t);
  const { fin } = start(s, askThen([
    { tool: { id: 'm5', name: 'Bash', input: { command: 'git -C /repo merge pir/demo' }, allowRuled: true } },
    { await: 'user' },
  ]), t);
  const req = await toAwaitingGo(s, fin);
  fin.session.answer(req.requestId, goReply('Go'), { from: 'person' });
  // No drain: pir's pass may be seconds away, and the finisher acts on the Go at once.
  await waitFor(() => gateNotes(fin).find((n) => n.requestId === 'm5'), 'merge decided');
  assert.equal(gateNotes(fin).find((n) => n.requestId === 'm5').verdict, 'allow');
  assert.equal(fin.phase(), 'finishing');
  // The next drain still reports the go, once.
  assert.deepEqual(fin.drain().go, { by: 'person' });
  assert.equal(fin.drain().go, null);
  assert.equal(fin.ledger().filter((l) => l.kind === 'go').length, 1);
});

test('go between passes: a waiting ready is applied before the log, and a torn status is not refused early', async (t) => {
  const s = scratch(t);
  const { fin } = start(s, askThen([
    { tool: { id: 'l1', name: 'Bash', input: { command: 'git status' } } },
    { tool: { id: 'l2', name: 'Bash', input: { command: 'git status' } } },
    { await: 'user' },
  ]), t);
  const req = await toAwaitingGo(s, fin);
  status(s, '2-ready.json', { ...READY, steps: ['re-prepared'] });
  status(s, '3-torn.json', '{"kind": "st');
  fin.session.answer(req.requestId, goReply('Not yet'), { from: 'person' });
  await waitFor(() => gateNotes(fin).filter((n) => n.requestId?.startsWith('l')).length === 2, 'two looks decided');
  assert.deepEqual(fin.view().steps, ['re-prepared'], 'the ready was applied by the gate');
  assert.ok(existsSync(join(s.statusDir, '3-torn.json')), 'two gate checks are not two passes');
  const out = fin.drain();
  assert.deepEqual(out.accepted.map((x) => x.steps), [['re-prepared']], 'reported by the next drain');
  assert.deepEqual(out.refused, []);
  assert.equal(fin.drain().refused.length, 1, 'refused on the second pass');
});
