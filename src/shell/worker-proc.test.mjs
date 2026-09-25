// T04 — one worker held through the real Agent SDK, against the scripted fake `claude`
// (fake/claude-stream.mjs). Every test here runs the SDK's own `query()`; the only thing swapped is the
// process it launches, which is always the fake — no test spawns the real `claude` or pays for a model.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startWorker, workerOptions, writeWorkersFile } from './worker-proc.mjs';
import { fakeClaudeSpawner, turn, canUseTool, initEvent, assistantText, resultEvent } from './fake/claude-stream.mjs';
import { workerActivity, allowResult } from '../core/stream.mjs';

const SESSION = '11111111-1111-4111-8111-111111111111';
const NAME = 'plan-implement-review / live-workers / T04 / worker-process / implement';
// Never launched: the fake spawner ignores the command. A path that does not exist makes sure of it.
const CLAUDE = '/nonexistent/claude';

// setup(script) → a scratch dir, a fake spawner running `script`, and a worker started on it.
function setup(script, t) {
  const dir = mkdtempSync(join(tmpdir(), 'pir-worker-proc-'));
  const scriptPath = join(dir, 'script.json');
  const received = join(dir, 'received.ndjson');
  writeFileSync(scriptPath, JSON.stringify(script));
  const spawner = fakeClaudeSpawner({ script: scriptPath, received });
  const logPath = join(dir, 'conversations', 'T04-implement-1.ndjson');
  const worker = startWorker({ cwd: dir, sessionId: SESSION, name: NAME, logPath, claudePath: CLAUDE, spawnProcess: spawner });
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

test('an SDK stream error (the fake writes garbage and exits mid-turn) is logged sdk-error and reported as exit', async (t) => {
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

test('writeWorkersFile writes the five fields, temp then rename, leaving no temp', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'pir-workers-file-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const controlDir = join(dir, 'control');
  writeWorkersFile(controlDir, [{ id: SESSION, task: 'T04', role: 'implement', pid: 42, startTime: 'Fri Sep 25 10:00:00 2026', extra: 'dropped' }]);
  assert.deepEqual(JSON.parse(readFileSync(join(controlDir, 'workers.json'), 'utf8')), [
    { id: SESSION, task: 'T04', role: 'implement', pid: 42, startTime: 'Fri Sep 25 10:00:00 2026' },
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
