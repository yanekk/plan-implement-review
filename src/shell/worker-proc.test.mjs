// T04 — one worker held through the real Agent SDK, against the scripted fake `claude`
// (fake/claude-stream.mjs). Every test here runs the SDK's own `query()`; the only thing swapped is the
// process it launches, which is always the fake — no test spawns the real `claude` or pays for a model.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import { startWorker, workerOptions, writeWorkersFile } from './worker-proc.mjs';
import { fakeClaudeSpawner, turn, wakeUp, backgroundTasks, remoteInputTurn, canUseTool, initEvent, assistantText, resultEvent, REMOTE_CONTROL_RESPONSE } from './fake/claude-stream.mjs';
import { workerActivity, allowResult } from '../core/stream.mjs';
import { defaultUsageReporter } from './usage-report.mjs';

const SESSION = '11111111-1111-4111-8111-111111111111';
const NAME = 'plan-implement-review / live-workers / T04 / worker-process / implement';
// Never launched: the fake spawner ignores the command. A path that does not exist makes sure of it.
const CLAUDE = '/nonexistent/claude';

// setup(script) → a scratch dir, a fake spawner running `script`, and a worker started on it.
function setup(script, t, opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pir-worker-proc-'));
  const scriptPath = join(dir, 'script.json');
  const received = join(dir, 'received.ndjson');
  writeFileSync(scriptPath, JSON.stringify(script));
  const spawner = fakeClaudeSpawner({ script: scriptPath, received });
  const logPath = join(dir, 'conversations', 'T04-implement-1.ndjson');
  const worker = startWorker({ cwd: dir, sessionId: SESSION, name: NAME, logPath, claudePath: CLAUDE, spawnProcess: spawner, ...opts });
  t.after(async () => {
    await worker.close({ graceMs: 100, killMs: 300 });
    rmSync(dir, { recursive: true, force: true });
  });
  const receivedLines = () =>
    existsSync(received) ? readFileSync(received, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const logLines = () => readFileSync(logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  return { dir, worker, spawner, logPath, receivedLines, logLines };
}

async function waitFor(pred, what, ms = 5000) {
  const start = Date.now();
  for (;;) {
    const v = pred();
    if (v) return v;
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

const exited = (worker) => new Promise((resolve) => worker.onExit(resolve));
const hasResult = (worker, subtype) => () =>
  worker.entries().find((e) => e.dir === 'in' && e.event.type === 'result' && (!subtype || e.event.subtype === subtype));

test('workerOptions is exactly DESIGN §2.1', () => {
  const canUseToolFn = () => {};
  const spawnProcess = () => {};
  assert.deepEqual(workerOptions({ cwd: '/w', sessionId: SESSION, name: NAME, claudePath: '/bin/claude', canUseTool: canUseToolFn, spawnProcess }), {
    cwd: '/w',
    sessionId: SESSION,
    permissionMode: 'auto',
    pathToClaudeCodeExecutable: '/bin/claude',
    extraArgs: { name: NAME },
    canUseTool: canUseToolFn,
    spawnClaudeCodeProcess: spawnProcess,
  });
});

test('workerOptions with resume: `resume` and no `sessionId`', () => {
  const opts = workerOptions({ cwd: '/w', resume: SESSION, name: NAME, claudePath: '/bin/claude' });
  assert.equal(opts.resume, SESSION);
  assert.equal('sessionId' in opts, false);
  // A stray sessionId beside resume is dropped: the SDK refuses both without forkSession.
  const both = workerOptions({ cwd: '/w', sessionId: 'other', resume: SESSION, name: NAME, claudePath: '/bin/claude' });
  assert.equal(both.resume, SESSION);
  assert.equal('sessionId' in both, false);
});

test('startWorker with resume: --resume on the argv, the resumed id everywhere, the log appended to', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'pir-worker-proc-resume-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const scriptPath = join(dir, 'script.json');
  const received = join(dir, 'received.ndjson');
  writeFileSync(scriptPath, JSON.stringify([{ await: 'user' }, ...turn('back')]));
  const spawner = fakeClaudeSpawner({ script: scriptPath, received });
  const logPath = join(dir, 'conversations', 'plan-1.ndjson');
  const earlier = { t: 1, dir: 'note', kind: 'earlier' };
  mkdirSync(dirname(logPath), { recursive: true });
  writeFileSync(logPath, JSON.stringify(earlier) + '\n');
  const worker = startWorker({ cwd: dir, resume: SESSION, name: NAME, logPath, claudePath: CLAUDE, spawnProcess: spawner });
  t.after(() => worker.close({ graceMs: 100, killMs: 300 }));
  assert.equal(worker.id, SESSION);
  worker.send('you were resumed', { from: 'pir' });
  await waitFor(hasResult(worker), 'the resumed turn');
  const args = spawner.calls[0].args;
  assert.ok(args.includes(`--resume=${SESSION}`), args.join(' '));
  assert.ok(!args.some((a) => a.startsWith('--session-id')), 'no --session-id beside --resume');
  const lines = readFileSync(logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines[0], earlier, 'the earlier conversation is kept');
  assert.equal(lines.length, 1 + worker.entries().length);
  const sent = readFileSync(received, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((x) => x.line).map((x) => JSON.parse(x.line)).find((m) => m.type === 'user');
  assert.equal(sent.session_id, SESSION, 'the message carries the resumed id');
});

test('the SDK spawns the argv T00 measured, and the process it runs is the fake', async (t) => {
  const { worker, spawner, receivedLines } = setup([], t);
  await waitFor(() => receivedLines().length > 0, 'the fake to start');
  const argv = [
    '--output-format', 'stream-json', '--verbose', '--input-format', 'stream-json',
    '--permission-prompt-tool', 'stdio', '--permission-mode', 'auto', `--session-id=${SESSION}`, '--name', NAME,
  ];
  assert.equal(spawner.calls.length, 1);
  assert.equal(spawner.calls[0].command, CLAUDE, 'the SDK asked for the configured claude');
  assert.deepEqual(spawner.calls[0].args, argv);
  assert.deepEqual(receivedLines()[0], { argv }, 'the fake ran with that argv');
  assert.equal(typeof worker.pid, 'number');
  assert.equal(worker.id, SESSION);
});

test('every SDK message is logged `in`, in order, before onEvent fires; the log folds to idle', async (t) => {
  const { worker, logPath, logLines } = setup([{ await: 'user' }, ...turn('hello')], t);
  const seen = [];
  worker.onEvent((entry) => {
    const lines = readFileSync(logPath, 'utf8').trim().split('\n');
    assert.deepEqual(JSON.parse(lines.at(-1)), entry, 'the entry is on disk when onEvent fires');
    seen.push(entry);
  });
  assert.equal(worker.send('begin', { from: 'pir' }), true);
  await waitFor(hasResult(worker), 'the result');
  const ins = worker.entries().filter((e) => e.dir === 'in').map((e) => `${e.event.type}:${e.event.subtype ?? ''}`);
  assert.deepEqual(ins, ['system:init', 'assistant:', 'result:success']);
  assert.deepEqual(logLines(), worker.entries(), 'file and memory agree, in order');
  assert.deepEqual(seen, worker.entries(), 'onEvent saw every entry, in order');
  assert.deepEqual(worker.entries()[0], { t: worker.entries()[0].t, dir: 'out', from: 'pir', kind: 'message', text: 'begin' });
  assert.equal(workerActivity(logLines()).state, 'idle');
});

// visible-helpers T05 (DESIGN §2.6): the note goes to the model first; the log keeps the person's text as typed.
test('send with a preface queues preface, blank line, text and logs text unchanged plus both fields; without one, the text alone', async (t) => {
  const { worker, logLines, receivedLines } = setup([{ await: 'user' }, ...turn('one'), { await: 'user' }, ...turn('two')], t);
  assert.equal(worker.send('continue', { from: 'person', preface: '[pir] note', helpersStopped: ['h1'] }), true);
  await waitFor(hasResult(worker), 'the first result');
  assert.equal(worker.send('again', { from: 'person' }), true);
  await waitFor(() => worker.entries().filter((e) => e.dir === 'in' && e.event.type === 'result').length === 2, 'two results');
  const outs = logLines().filter((e) => e.dir === 'out').map(({ t: _t, ...e }) => e);
  assert.deepEqual(outs, [
    { dir: 'out', from: 'person', kind: 'message', text: 'continue', preface: '[pir] note', helpersStopped: ['h1'] },
    { dir: 'out', from: 'person', kind: 'message', text: 'again' },
  ]);
  const users = receivedLines().filter((l) => l.line).map((l) => JSON.parse(l.line)).filter((m) => m.type === 'user');
  assert.deepEqual(users.map((m) => m.message.content), ['[pir] note\n\ncontinue', 'again']);
});

test('a wake-up and a Remote Control turn pass through the SDK and fold to their causes (real-asking-state T03)', async (t) => {
  const { worker, logLines } = setup([{ await: 'user' }, ...turn('asked'), ...wakeUp(), ...remoteInputTurn()], t);
  worker.send('begin', { from: 'pir' });
  await waitFor(() => worker.entries().filter((e) => e.dir === 'in' && e.event.type === 'result').length === 3, 'three results');
  await waitFor(() => worker.entries().some((e) => e.event?.type === 'command_lifecycle' && e.event.state === 'completed'), 'completed');
  const a = workerActivity(logLines());
  assert.deepEqual(a.turnCauses, ['pir', 'system', 'remote']);
  assert.equal(a.remoteSends, 1);
  assert.equal(a.state, 'idle');
});

test('a fake background job and its wakeUp() fold like the recorded case 5 (stopped-worker-asking T01)', async (t) => {
  // The job starts inside the first turn; the turn ends with it running; wakeUp() sends the shrunken list,
  // the notification and the wake-up turn, as the real CLI does.
  const script = [{ await: 'user' }, { emit: initEvent() }, { emit: backgroundTasks(['bgfake']) }, { emit: assistantText('waiting') }, { emit: resultEvent('success', 'waiting') }, ...wakeUp()];
  const { worker, logLines } = setup(script, t);
  worker.send('begin', { from: 'pir' });
  await waitFor(() => worker.entries().filter((e) => e.dir === 'in' && e.event.type === 'result').length === 2, 'two results');
  const log = logLines();
  const firstResult = log.findIndex((e) => e.event?.type === 'result');
  const wakeInit = log.findIndex((e, i) => i > firstResult && e.event?.subtype === 'init');
  assert.ok(log.slice(firstResult, wakeInit).some((e) => e.event?.subtype === 'background_tasks_changed'), 'the shrunken list comes before the wake-up');
  for (let i = firstResult; i < wakeInit; i += 1) {
    const a = workerActivity(log.slice(0, i + 1));
    assert.equal(a.state, 'idle', `entry ${i}`);
    assert.deepEqual(a.background, ['bgfake'], `entry ${i}: held while idle before the wake-up`);
  }
  const woke = workerActivity(log.slice(0, wakeInit + 1));
  assert.equal(woke.state, 'busy');
  assert.deepEqual(woke.background, []);
  const end = workerActivity(log);
  assert.equal(end.state, 'idle');
  assert.deepEqual(end.background, []);
  assert.deepEqual(end.turnCauses, ['pir', 'system']);
});

test('a can_use_tool becomes a request entry and a pending request; answer sends the PermissionResult', async (t) => {
  const ask = canUseTool('req-1', 'Bash', { command: 'rm x' }, {
    description: 'Remove x',
    decision_reason: 'This command requires approval',
    permission_suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'rm x' }], behavior: 'allow', destination: 'session' }],
  });
  const { worker, receivedLines } = setup([{ await: 'user' }, { emit: initEvent() }, { emit: ask }, { await: 'control_response' }, { emit: assistantText('ok') }, { emit: resultEvent('success', 'ok') }], t);
  worker.send('go');
  await waitFor(() => worker.pending().length === 1, 'the pending request');

  const req = worker.entries().find((e) => e.dir === 'request');
  assert.equal(req.requestId, 'req-1');
  assert.equal(req.toolUseId, 'toolu_req-1', "canUseTool's toolUseID, so a refusal is tied to its step (group-commands §2.2)");
  assert.equal(req.toolName, 'Bash');
  assert.deepEqual(req.input, { command: 'rm x' });
  assert.equal(req.description, 'Remove x');
  assert.equal(req.reason, 'This command requires approval');
  assert.deepEqual(req.suggestions, [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'rm x' }], behavior: 'allow', destination: 'session' }]);
  assert.equal(req.defaultToNo, false);
  assert.equal(req.suppressAlwaysAllowRule, false);
  const [pending] = worker.pending();
  assert.equal(pending.kind, 'permission');
  assert.equal(pending.requestId, 'req-1');
  assert.equal(workerActivity(worker.entries()).state, 'permission');

  const result = allowResult(pending);
  assert.equal(worker.answer('req-1', result, { from: 'person' }), true);
  await waitFor(hasResult(worker), 'the turn to finish');
  const reply = receivedLines().map((r) => r.line && JSON.parse(r.line)).find((m) => m?.type === 'control_response');
  assert.equal(reply.response.request_id, 'req-1');
  assert.equal(reply.response.response.behavior, 'allow');
  assert.deepEqual(reply.response.response.updatedInput, { command: 'rm x' });
  assert.equal(worker.pending().length, 0);
  const logged = worker.entries().find((e) => e.dir === 'out' && e.kind === 'reply');
  assert.deepEqual({ ...logged, t: 0 }, { t: 0, dir: 'out', from: 'person', kind: 'reply', requestId: 'req-1', result });

  assert.equal(worker.answer('req-1', result, { from: 'person' }), false, 'a second answer finds nothing pending');
  const last = worker.entries().at(-1);
  assert.equal(last.dir, 'note');
  assert.equal(last.kind, 'undelivered');
  assert.equal(last.requestId, 'req-1');
  assert.equal(workerActivity(worker.entries()).state, 'idle');
});

// visible-helpers T03 (DESIGN §2.4): a helper's request carries the SDK's agentID, logged as agentId.
test('a can_use_tool from a helper logs agentId; the parent\'s logs no such field', async (t) => {
  const { worker } = setup([
    { await: 'user' }, { emit: initEvent() },
    { emit: canUseTool('h-1', 'Bash', { command: 'git log' }, { agentId: 'a0helper' }) },
    { emit: canUseTool('p-1', 'Bash', { command: 'ls' }) },
    { await: 'control_response' }, { await: 'control_response' }, { emit: resultEvent('success', 'ok') },
  ], t);
  worker.send('go');
  await waitFor(() => worker.pending().length === 2, 'both requests');
  const [helper, parent] = worker.entries().filter((e) => e.dir === 'request');
  assert.equal(helper.requestId, 'h-1');
  assert.equal(helper.agentId, 'a0helper');
  assert.equal(parent.requestId, 'p-1');
  assert.equal('agentId' in parent, false);
  assert.equal(worker.pending()[0].agentId, 'a0helper', 'the pending request carries it too');
  for (const r of worker.pending()) worker.answer(r.requestId, allowResult(r), { from: 'person' });
  await waitFor(hasResult(worker), 'the turn to finish');
});

// pir-coordinator T03: the gate and the extra SDK options, for the coordinator agent's session.
test('workerOptions passes permissionMode, tools and disallowedTools only when given', () => {
  const opts = workerOptions({ cwd: '/w', sessionId: SESSION, name: NAME, claudePath: '/bin/claude', permissionMode: 'default', tools: ['Read'], disallowedTools: ['Bash'] });
  assert.equal(opts.permissionMode, 'default');
  assert.deepEqual(opts.tools, ['Read']);
  assert.deepEqual(opts.disallowedTools, ['Bash']);
});

test('the SDK spawns the agent argv: --permission-mode default, --tools and --disallowedTools', async (t) => {
  const { spawner, receivedLines } = setup([], t, { permissionMode: 'default', tools: ['Read', 'Write'], disallowedTools: ['Bash', 'Edit'] });
  await waitFor(() => receivedLines().length > 0, 'the fake to start');
  const args = spawner.calls[0].args;
  const after = (flag) => args[args.indexOf(flag) + 1];
  assert.equal(after('--permission-mode'), 'default');
  assert.equal(after('--tools'), 'Read,Write');
  assert.equal(after('--disallowedTools'), 'Bash,Edit');
});

test('a gate verdict answers a request at once, logged decided-by-gate; null parks it as before', async (t) => {
  const decide = (toolName, input) => (toolName === 'Bash' ? 'deny' : toolName === 'Read' ? 'allow' : null);
  const { worker, receivedLines } = setup([
    { await: 'user' }, { emit: initEvent() },
    { emit: canUseTool('g-1', 'Bash', { command: 'ls' }) }, { await: 'control_response' },
    { emit: canUseTool('g-2', 'Read', { file_path: '/x' }) }, { await: 'control_response' },
    { emit: canUseTool('g-3', 'Write', { file_path: '/y' }) }, { await: 'control_response' },
    { emit: resultEvent('success', 'ok') },
  ], t, { decide, denyMessage: (tool) => `no ${tool}` });
  worker.send('go');
  await waitFor(() => worker.pending().length === 1, 'the third request to park');

  const replies = () => receivedLines().map((r) => r.line && JSON.parse(r.line)).filter((m) => m?.type === 'control_response');
  const byId = (id) => replies().find((m) => m.response.request_id === id)?.response.response;
  assert.equal(byId('g-1').behavior, 'deny');
  assert.equal(byId('g-1').message, 'no Bash');
  assert.equal(byId('g-2').behavior, 'allow');
  assert.deepEqual(byId('g-2').updatedInput, { file_path: '/x' });
  assert.equal(byId('g-3'), undefined, 'null parks: nothing sent');
  assert.equal(worker.pending()[0].requestId, 'g-3');

  const gated = worker.entries().filter((e) => e.dir === 'note' && e.kind === 'decided-by-gate');
  assert.deepEqual(gated.map((e) => [e.requestId, e.toolName, e.verdict]), [['g-1', 'Bash', 'deny'], ['g-2', 'Read', 'allow']]);
  const outs = worker.entries().filter((e) => e.dir === 'out' && e.kind === 'reply');
  assert.deepEqual(outs.map((e) => [e.requestId, e.from]), [['g-1', 'pir'], ['g-2', 'pir']]);
  assert.equal(workerActivity(worker.entries()).state, 'permission', 'only the parked one is pending');

  worker.answer('g-3', allowResult(worker.pending()[0]), { from: 'person' });
  await waitFor(hasResult(worker), 'the turn to finish');
});

test('workerOptions passes hooks only when given (finisher T04)', () => {
  const hooks = { PreToolUse: [{ hooks: [async () => ({})] }] };
  assert.equal(workerOptions({ cwd: '/w', sessionId: SESSION, name: NAME, claudePath: '/bin/claude', hooks }).hooks, hooks);
  assert.equal('hooks' in workerOptions({ cwd: '/w', sessionId: SESSION, name: NAME, claudePath: '/bin/claude' }), false);
});

test('the gate gets what the CLI said about the request; a `person` verdict parks (finisher T04)', async (t) => {
  const seen = [];
  const decide = (toolName, input, info) => {
    seen.push(info);
    return 'person';
  };
  const { worker } = setup([
    { await: 'user' }, { emit: initEvent() },
    { emit: canUseTool('p-1', 'Bash', { command: 'npm publish' }, { default_to_no: true, decision_reason: 'ask rule' }) }, { await: 'control_response' },
    { emit: resultEvent('success', 'ok') },
  ], t, { decide });
  worker.send('go');
  await waitFor(() => worker.pending().length === 1, 'parked');
  assert.deepEqual(seen, [{ defaultToNo: true, reason: 'ask rule', suggestions: [] }]);
  assert.equal(worker.entries().filter((e) => e.kind === 'decided-by-gate').length, 0);
  worker.answer('p-1', allowResult(worker.pending()[0]), { from: 'person' });
  await waitFor(hasResult(worker), 'the turn to finish');
});

test('a gate that throws denies', async (t) => {
  const { worker, receivedLines } = setup([
    { await: 'user' }, { emit: initEvent() }, { emit: canUseTool('g-9', 'Read', { file_path: '/x' }) }, { await: 'control_response' }, { emit: resultEvent('success', 'ok') },
  ], t, { decide: () => { throw new Error('boom'); } });
  worker.send('go');
  await waitFor(hasResult(worker), 'the turn to finish');
  const reply = receivedLines().map((r) => r.line && JSON.parse(r.line)).find((m) => m?.type === 'control_response');
  assert.equal(reply.response.response.behavior, 'deny');
});

test('interrupt reaches the fake as the interrupt control request and the turn ends error_during_execution', async (t) => {
  const { worker, receivedLines } = setup([
    { await: 'user' }, { emit: initEvent() }, { emit: assistantText('1. Aardvark') },
    { await: 'interrupt' }, { emit: resultEvent('error_during_execution') },
  ], t);
  worker.send('list animals');
  await waitFor(() => worker.entries().some((e) => e.dir === 'in' && e.event.type === 'assistant'), 'the assistant text');
  assert.equal(await worker.interrupt({ from: 'person' }), true);
  await waitFor(hasResult(worker, 'error_during_execution'), 'the interrupted result');
  const sent = receivedLines().map((r) => r.line && JSON.parse(r.line)).filter(Boolean);
  assert.ok(sent.some((m) => m.type === 'control_request' && m.request.subtype === 'interrupt'));
  assert.ok(worker.entries().some((e) => e.dir === 'out' && e.kind === 'interrupt' && e.from === 'person'));
  assert.equal(workerActivity(worker.entries()).state, 'idle');
});

// The CLI cancels an open ask with `control_cancel_request`, which aborts the SDK's canUseTool signal
// (the T01 review probe saw the abort; the cancel line itself is the SDK's documented path to it).
test('an interrupt drops a request pending at it from pending()', async (t) => {
  const { worker } = setup([
    { await: 'user' }, { emit: initEvent() }, { emit: canUseTool('req-2', 'Bash', { command: 'ls' }) },
    { await: 'interrupt' }, { emit: { type: 'control_cancel_request', request_id: 'req-2' } },
    { emit: resultEvent('error_during_execution') },
  ], t);
  worker.send('go');
  await waitFor(() => worker.pending().length === 1, 'the pending request');
  await worker.interrupt();
  await waitFor(() => worker.pending().length === 0, 'the request to be cancelled');
  await waitFor(hasResult(worker, 'error_during_execution'), 'the interrupted result');
  assert.equal(worker.answer('req-2', { behavior: 'allow', updatedInput: {} }), false);
});

// Remote Control is the SDK's undocumented enableRemoteControl (probed 2026-09-26): a `remote_control`
// control request carrying `enabled` and the session name.
const sentControl = (receivedLines, subtype) =>
  receivedLines().map((r) => r.line && JSON.parse(r.line)).filter((m) => m?.type === 'control_request' && m.request.subtype === subtype);

test('remoteControl switches on with the worker name, logs the session url, and sends nothing for a repeat', async (t) => {
  const { worker, receivedLines } = setup([{ await: 'user' }, ...turn('ok')], t);
  worker.send('go');
  await waitFor(hasResult(worker), 'the turn');
  await worker.remoteControl(true);
  assert.equal(worker.remote, true);
  const [on] = sentControl(receivedLines, 'remote_control');
  assert.equal(on.request.enabled, true);
  assert.equal(on.request.name, NAME);
  const note = worker.entries().find((e) => e.kind === 'remote-control');
  assert.equal(note.on, true);
  assert.equal(note.url, REMOTE_CONTROL_RESPONSE.session_url);

  await worker.remoteControl(true);
  assert.equal(sentControl(receivedLines, 'remote_control').length, 1, 'already on: nothing sent');

  await worker.remoteControl(false);
  assert.equal(worker.remote, false);
  const sent = sentControl(receivedLines, 'remote_control');
  assert.equal(sent.length, 2);
  assert.equal(sent[1].request.enabled, false);
  assert.equal(worker.entries().filter((e) => e.kind === 'remote-control').at(-1).on, false);
});

test('a request answered over Remote Control leaves pending() and is logged answered-remotely', async (t) => {
  const ask = canUseTool('req-3', 'AskUserQuestion', { questions: [{ question: 'Colour?', header: 'Colour', options: [{ label: 'Red' }, { label: 'Blue' }], multiSelect: false }] });
  const toolResult = {
    type: 'user', parent_tool_use_id: null, session_id: '{{session}}',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_req-3', content: 'Your questions have been answered: "Colour?"="Red".' }] },
  };
  const { worker } = setup([
    { await: 'user' }, { emit: initEvent() }, { emit: ask },
    { await: 'user' }, { emit: { type: 'control_cancel_request', request_id: 'req-3' } },
    { emit: toolResult }, { emit: assistantText('You picked red.') }, { emit: resultEvent('success', 'You picked red.') },
  ], t);
  worker.send('go');
  await waitFor(() => worker.pending().length === 1, 'the pending question');
  assert.equal(workerActivity(worker.entries()).state, 'questions');
  worker.send('(the phone answers)'); // releases the fake's cancel
  await waitFor(() => worker.pending().length === 0, 'the question to be withdrawn');
  const note = worker.entries().find((e) => e.kind === 'answered-remotely');
  assert.equal(note.requestId, 'req-3');
  assert.equal(note.toolName, 'AskUserQuestion');
  // Mid-turn, with no `result` yet: the note alone is what stops the task reading `asking you`.
  const beforeResult = worker.entries().slice(0, worker.entries().indexOf(note) + 1);
  assert.equal(workerActivity(beforeResult).state, 'busy');
  await waitFor(hasResult(worker), 'the turn to finish');
  assert.equal(workerActivity(worker.entries()).state, 'idle');
});

test('a request cancelled by pir\'s own interrupt is not logged answered-remotely', async (t) => {
  const { worker } = setup([
    { await: 'user' }, { emit: initEvent() }, { emit: canUseTool('req-4', 'Bash', { command: 'ls' }) },
    { await: 'interrupt' }, { emit: { type: 'control_cancel_request', request_id: 'req-4' } },
    { emit: resultEvent('error_during_execution') },
  ], t);
  worker.send('go');
  await waitFor(() => worker.pending().length === 1, 'the pending request');
  await worker.interrupt();
  await waitFor(hasResult(worker, 'error_during_execution'), 'the interrupted result');
  assert.equal(worker.entries().some((e) => e.kind === 'answered-remotely'), false);
});

// Stopping a planner mid-question showed "answered on claude.ai" for a question nobody answered: the
// close aborts the request's signal, which read as a Remote Control answer (pir-plan-command T14).
test('a request pending at close is not logged answered-remotely', async (t) => {
  const { worker, logLines } = setup([
    { await: 'user' }, { emit: initEvent() }, { emit: canUseTool('req-5', 'AskUserQuestion', { questions: [] }) },
    { await: 'control_response' },
  ], t);
  worker.send('go');
  await waitFor(() => worker.pending().length === 1, 'the pending question');
  await worker.remoteControl(true);
  await worker.close({ graceMs: 500, killMs: 1000 });
  assert.ok(logLines().some((e) => e.kind === 'exited'));
  assert.equal(logLines().some((e) => e.kind === 'answered-remotely'), false);
});

test('close switches Remote Control off before the worker goes', async (t) => {
  const { worker, receivedLines } = setup([{ await: 'user' }, ...turn('ok')], t);
  worker.send('go');
  await waitFor(hasResult(worker), 'the turn');
  await worker.remoteControl(true);
  await worker.close({ graceMs: 500, killMs: 1000 });
  const sent = sentControl(receivedLines, 'remote_control');
  assert.deepEqual(sent.map((m) => m.request.enabled), [true, false]);
});

test('send logs `out` with its sender; after exit it returns false and logs only an undelivered note', async (t) => {
  const { worker } = setup([{ await: 'user' }, ...turn('hi'), { exit: 0 }], t);
  const gone = exited(worker);
  assert.equal(worker.send('hello', { from: 'person' }), true);
  assert.equal(worker.entries()[0].from, 'person');
  await gone;
  const before = worker.entries().length;
  assert.equal(worker.send('anyone?', { from: 'pir' }), false);
  const added = worker.entries().slice(before);
  assert.equal(added.length, 1);
  assert.deepEqual({ ...added[0], t: 0 }, { t: 0, dir: 'note', kind: 'undelivered', what: 'message', from: 'pir', text: 'anyone?' });
  assert.equal(await worker.interrupt(), false, 'an interrupt after exit is undelivered too');
});

// The SDK skips a stdout line it cannot parse (probed in review: garbage alone raises nothing); the
// stream error here comes from the non-zero exit mid-turn. The garbage line stays to show it is harmless.
test('an SDK stream error (the fake exits 1 mid-turn) is logged sdk-error and reported as exit', async (t) => {
  const { worker } = setup([{ await: 'user' }, { emit: initEvent() }, { emit: 'this is {not json' }, { exit: 1 }], t);
  const gone = exited(worker);
  worker.send('go');
  const info = await gone;
  assert.equal(info.code, 1);
  const kinds = worker.entries().filter((e) => e.dir === 'note').map((e) => e.kind);
  assert.ok(kinds.includes('sdk-error'), `notes were ${kinds}`);
  assert.equal(kinds.at(-1), 'exited');
  assert.equal(worker.send('still there?'), false);
});

test('exit code and signal are reported once, logged once, and a late onExit is still told', async (t) => {
  const { worker } = setup([{ exit: 3 }], t);
  const calls = [];
  worker.onExit((info) => calls.push(info));
  await exited(worker);
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(calls, [{ code: 3, signal: null }]);
  const notes = worker.entries().filter((e) => e.kind === 'exited');
  assert.equal(notes.length, 1);
  assert.equal(notes[0].code, 3);
  assert.equal(notes[0].signal, null);
  const late = await exited(worker);
  assert.deepEqual(late, { code: 3, signal: null });
});

test('close on a worker that exits on EOF sends no signal', async (t) => {
  const { worker, receivedLines } = setup([{ await: 'user' }, ...turn('hi')], t);
  worker.send('go');
  await waitFor(hasResult(worker), 'the result');
  await worker.close({ graceMs: 2000, killMs: 4000 });
  const note = worker.entries().find((e) => e.kind === 'exited');
  assert.equal(note.code, 0);
  assert.equal(note.signal, null);
  assert.ok(!receivedLines().some((r) => r.signal));
  assert.equal(workerActivity(worker.entries()).state, 'idle');
});

test('close on a fake that ignores EOF and SIGTERM escalates to SIGTERM, then SIGKILL', async (t) => {
  const { worker, receivedLines } = setup([{ onEof: 'ignore' }, { onSigterm: 'ignore' }], t);
  await waitFor(() => receivedLines().length > 0, 'the fake to start');
  const start = Date.now();
  await worker.close({ graceMs: 200, killMs: 500 });
  const took = Date.now() - start;
  const note = worker.entries().find((e) => e.kind === 'exited');
  assert.equal(note.signal, 'SIGKILL');
  assert.ok(receivedLines().some((r) => r.signal === 'SIGTERM'), 'SIGTERM reached it first');
  assert.ok(took >= 450 && took < 3000, `took ${took} ms`);
});

// Reproduced in review: with the log's folder gone, send threw ENOENT, the exit note threw inside the
// exit path, onExit never fired and close hung, and the coordinator took an uncaught exception.
test('a log that cannot be written never stops the worker: send, exit and close still work', async (t) => {
  const { worker, logPath } = setup([{ await: 'user' }, ...turn('hi'), { exit: 0 }], t);
  rmSync(dirname(logPath), { recursive: true });
  const gone = exited(worker);
  assert.equal(worker.send('go'), true);
  assert.deepEqual(await gone, { code: 0, signal: null });
  assert.ok(hasResult(worker)(), 'the in-memory log still has the turn');
  assert.equal(worker.entries().at(-1).kind, 'exited');
  await worker.close({ graceMs: 100, killMs: 300 });
  assert.equal(existsSync(dirname(logPath)), false, 'the removed folder is not recreated');
});

test('writeWorkersFile writes the recorded fields, temp then rename, leaving no temp', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'pir-workers-file-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const controlDir = join(dir, 'control');
  writeWorkersFile(controlDir, [{ id: SESSION, task: 'T04', role: 'implement', pid: 42, startTime: 'Fri Sep 25 10:00:00 2026', cwd: '/wt/T04', extra: 'dropped' }]);
  assert.deepEqual(JSON.parse(readFileSync(join(controlDir, 'workers.json'), 'utf8')), [
    { id: SESSION, task: 'T04', role: 'implement', pid: 42, startTime: 'Fri Sep 25 10:00:00 2026', cwd: '/wt/T04' },
  ]);
  writeWorkersFile(controlDir, []);
  assert.deepEqual(JSON.parse(readFileSync(join(controlDir, 'workers.json'), 'utf8')), []);
  assert.deepEqual(readdirSync(controlDir), ['workers.json']);
});

test('worker-proc.mjs is the only module in src/ that imports the Agent SDK', () => {
  const src = join(dirname(fileURLToPath(import.meta.url)), '..');
  const importers = readdirSync(src, { recursive: true })
    .filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs'))
    .filter((f) => /from\s+['"]@anthropic-ai\/claude-agent-sdk/.test(readFileSync(join(src, f), 'utf8')))
    .map((f) => relative(src, join(src, f)));
  assert.deepEqual(importers, [join('shell', 'worker-proc.mjs')]);
});

// ---- reliable-notifications T04: the Remote Control link and the session environment ----

test('remoteUrl is the session_url once Remote Control is on, and null once it is off', async (t) => {
  const { worker } = setup([{ await: 'user' }, ...turn('ok')], t);
  worker.send('go');
  await waitFor(hasResult(worker), 'the turn');
  assert.equal(worker.remoteUrl, null, 'null before any switch-on');
  assert.equal(worker.remoteRefused, false);
  await worker.remoteControl(true);
  assert.equal(worker.remoteUrl, REMOTE_CONTROL_RESPONSE.session_url);
  await worker.remoteControl(false);
  assert.equal(worker.remoteUrl, null);
  assert.equal(worker.remoteRefused, false);
});

test('a refused Remote Control leaves remoteRefused true and no link', async (t) => {
  // An SDK without enableRemoteControl is one of the refusals syncRemote names; the real query otherwise.
  const query = (args) => {
    const q = sdkQuery(args);
    q.enableRemoteControl = undefined;
    return q;
  };
  const { worker } = setup([{ await: 'user' }, ...turn('ok')], t, { query });
  worker.send('go');
  await waitFor(hasResult(worker), 'the turn');
  await worker.remoteControl(true);
  assert.equal(worker.remoteRefused, true);
  assert.equal(worker.remote, false);
  assert.equal(worker.remoteUrl, null);
  assert.ok(worker.entries().some((e) => e.kind === 'remote-control-failed'));
});

// spawnerSeeing(spawner) → the same spawner, recording the env the SDK handed each spawn.
function spawnerSeeing(spawner) {
  const envs = [];
  const s = (o) => {
    envs.push(o.env);
    return spawner(o);
  };
  s.envs = envs;
  return s;
}

test('startWorker with env: the spawned process gets exactly that environment', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'pir-worker-proc-env-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const scriptPath = join(dir, 'script.json');
  writeFileSync(scriptPath, JSON.stringify([{ await: 'user' }, ...turn('ok')]));
  const spawner = spawnerSeeing(fakeClaudeSpawner({ script: scriptPath }));
  const env = { ...process.env, CLAUDE_CLIENT_PRESENCE_FILE: '/tmp/presence' };
  const worker = startWorker({ cwd: dir, sessionId: SESSION, name: NAME, logPath: join(dir, 'c.ndjson'), claudePath: CLAUDE, spawnProcess: spawner, env });
  t.after(() => worker.close({ graceMs: 100, killMs: 300 }));
  worker.send('go');
  await waitFor(hasResult(worker), 'the turn');
  assert.equal(spawner.envs[0].CLAUDE_CLIENT_PRESENCE_FILE, '/tmp/presence');
  assert.equal(spawner.envs[0].PATH, process.env.PATH, 'the inherited environment is kept');
  assert.equal(workerOptions({ cwd: '/w', sessionId: SESSION, name: NAME, env }).env, env);
});

test('startWorker without env inherits process.env and passes no env option', async (t) => {
  assert.equal('env' in workerOptions({ cwd: '/w', sessionId: SESSION, name: NAME }), false);
  const dir = mkdtempSync(join(tmpdir(), 'pir-worker-proc-env-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const scriptPath = join(dir, 'script.json');
  writeFileSync(scriptPath, JSON.stringify([{ await: 'user' }, ...turn('ok')]));
  const spawner = spawnerSeeing(fakeClaudeSpawner({ script: scriptPath }));
  const worker = startWorker({ cwd: dir, sessionId: SESSION, name: NAME, logPath: join(dir, 'c.ndjson'), claudePath: CLAUDE, spawnProcess: spawner });
  t.after(() => worker.close({ graceMs: 100, killMs: 300 }));
  worker.send('go');
  await waitFor(hasResult(worker), 'the turn');
  assert.equal(spawner.envs[0].PATH, process.env.PATH);
  assert.equal(spawner.envs[0].CLAUDE_CLIENT_PRESENCE_FILE, process.env.CLAUDE_CLIENT_PRESENCE_FILE);
});

// ---- api-service T04: usage readings are handed to `reportUsage` (DESIGN §2.4) ----

const usageEvent = (utilization) => ({
  type: 'rate_limit_event',
  rate_limit_info: {
    status: 'allowed',
    unifiedWindows: { five_hour: { utilization, resetsAt: 1790673000 }, seven_day: { utilization: 0.77, resetsAt: 1790830800 } },
  },
});

// One turn with two usage events in it, as a real session on a subscription yields them.
const usageTurn = () => [
  { await: 'user' },
  { emit: initEvent() },
  { emit: usageEvent(0.5) },
  { emit: assistantText('ok') },
  { emit: usageEvent(0.6) },
  { emit: resultEvent('success', 'ok') },
];

test('reportUsage is called with every SDK message and the t of its log entry, after the entry is logged', async (t) => {
  const calls = [];
  let tick = 1000;
  let logPathSeen;
  const reportUsage = (message, at) => {
    const onDisk = readFileSync(logPathSeen, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    calls.push({ message, at, loggedFirst: onDisk.at(-1).t === at && onDisk.at(-1).dir === 'in' });
  };
  // A clock that moves on every read: each entry has its own t, so a wrong t cannot pass by chance.
  const { worker, logPath, logLines } = setup(usageTurn(), t, { reportUsage, now: () => (tick += 7) });
  logPathSeen = logPath;
  worker.send('go');
  await waitFor(hasResult(worker), 'the turn');

  const ins = logLines().filter((e) => e.dir === 'in');
  assert.deepEqual(calls.map((c) => c.message), ins.map((e) => e.event), 'every message, in order');
  assert.deepEqual(calls.map((c) => c.at), ins.map((e) => e.t), 'each with the t of its own log entry');
  assert.ok(calls.every((c) => c.loggedFirst), 'the entry is on disk before the reporter runs');

  const usage = calls.filter((c) => c.message.type === 'rate_limit_event');
  assert.equal(usage.length, 2, 'both usage events reach the reporter');
  assert.deepEqual(usage.map((c) => c.message.rate_limit_info.unifiedWindows.five_hour.utilization), [0.5, 0.6]);
  assert.equal(new Set(usage.map((c) => c.at)).size, 2);
});

test('a reportUsage that throws leaves the log, the listeners and the exit untouched', async (t) => {
  let thrown = 0;
  const reportUsage = () => {
    thrown += 1;
    throw new Error('reporter broke');
  };
  const { worker, logLines } = setup([...usageTurn(), { exit: 0 }], t, { reportUsage });
  const seen = [];
  worker.onEvent((e) => seen.push(e));
  const gone = exited(worker);
  worker.send('go');
  assert.deepEqual(await gone, { code: 0, signal: null });

  assert.ok(thrown >= 5, `the reporter was called for every message (${thrown})`);
  const ins = worker.entries().filter((e) => e.dir === 'in').map((e) => e.event.type);
  assert.deepEqual(ins, ['system', 'rate_limit_event', 'assistant', 'rate_limit_event', 'result']);
  assert.deepEqual(logLines(), worker.entries(), 'file and memory agree');
  assert.deepEqual(seen, worker.entries(), 'listeners saw every entry');
  assert.equal(worker.entries().some((e) => e.kind === 'sdk-error'), false, 'not mistaken for an SDK failure');
  assert.equal(worker.entries().at(-1).kind, 'exited');
  assert.equal(workerActivity(logLines().slice(0, -1)).state, 'idle');
});

test('startWorker with no reportUsage under the test runner reports nothing: the default is null here', async (t) => {
  // The default is usageReporterFromEnv(process.env). This process runs under `node --test` with no
  // scratch home of its own, so it is off whatever PIR_RUN says and no test here can write the real
  // ~/.pir/usage.json. A scratch home set by mistake would turn it on, so that is checked too.
  assert.equal(defaultUsageReporter(), null);
  const { dir, worker } = setup(usageTurn(), t);
  worker.send('go');
  await waitFor(hasResult(worker), 'the turn');
  assert.equal(worker.entries().filter((e) => e.dir === 'in' && e.event.type === 'rate_limit_event').length, 2, 'the events arrived');
  const written = readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith('usage.json') || String(f).endsWith('.tmp'));
  assert.deepEqual(written, []);
});

test('a PIR_RUN=1 process on a scratch home saves the newest reading with no reportUsage passed: the default is wired', (t) => {
  // The three tests above pass with the default parameter replaced by null (review, by mutation). The
  // default is computed once from process.env, so only a process of its own can show it switched on.
  // The scratch PIR_HOME is what lets the child write although it inherits NODE_TEST_CONTEXT (§2.8).
  const home = mkdtempSync(join(tmpdir(), 'pir-worker-proc-home-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const scriptPath = join(home, 'script.json');
  const logPath = join(home, 'conversations', 'T04-implement-1.ndjson');
  writeFileSync(scriptPath, JSON.stringify(usageTurn()));
  const url = (rel) => JSON.stringify(new URL(rel, import.meta.url).href);
  // The child closes its worker before it exits, so no write can land after the home is removed.
  const code = `
    const { startWorker } = await import(${url('./worker-proc.mjs')});
    const { fakeClaudeSpawner } = await import(${url('./fake/claude-stream.mjs')});
    const worker = startWorker({
      cwd: ${JSON.stringify(home)}, sessionId: ${JSON.stringify(SESSION)}, name: ${JSON.stringify(NAME)},
      logPath: ${JSON.stringify(logPath)}, claudePath: ${JSON.stringify(CLAUDE)},
      spawnProcess: fakeClaudeSpawner({ script: ${JSON.stringify(scriptPath)} }),
    });
    worker.send('go');
    const start = Date.now();
    while (!worker.entries().some((e) => e.dir === 'in' && e.event.type === 'result')) {
      if (Date.now() - start > 20000) throw new Error('timed out waiting for the turn');
      await new Promise((r) => setTimeout(r, 10));
    }
    await worker.close({ graceMs: 100, killMs: 300 });
  `;
  execFileSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: dirname(fileURLToPath(import.meta.url)),
    env: { ...process.env, PIR_RUN: '1', PIR_HOME: home },
    timeout: 60_000,
  });

  const log = readFileSync(logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const last = log.filter((e) => e.dir === 'in' && e.event.type === 'rate_limit_event').at(-1);
  assert.deepEqual(JSON.parse(readFileSync(join(home, '.pir', 'usage.json'), 'utf8')), {
    version: 1,
    observed_at: last.t,
    five_hour: { utilization: 0.6, resets_at: 1790673000 },
    seven_day: { utilization: 0.77, resets_at: 1790830800 },
  });
  assert.deepEqual(readdirSync(join(home, '.pir')), ['usage.json']);
});
