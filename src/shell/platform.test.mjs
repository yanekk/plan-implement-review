// platform.mjs, proven without a live agent (live-workers DESIGN §4). The report wire format round-trips
// and the opening instruction is pinned. The live-worker half (live-workers T05) runs the real Agent SDK
// against the scripted fake `claude` (fake/claude-stream.mjs): spawn, list, close, send, interrupt,
// answer and workers.json are all exercised on real child processes, none of them the real `claude`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  encodeMessage,
  parseMessage,
  createMessaging,
  openingInstruction,
  createPlatform,
  nextLogPath,
  resolveClaudePath,
} from './platform.mjs';
import { startWorker } from './worker-proc.mjs';
import { fakeClaudeSpawner, turn, canUseTool, initEvent } from './fake/claude-stream.mjs';
import { allowResult } from '../core/stream.mjs';

// --- the wire format --------------------------------------------------------------------------

test('a constructed message carries from/kind/task/text and parses back', () => {
  const from = 'plan-implement-review / parallel-pir / T05 / work / implement';
  const wire = encodeMessage({ kind: 'question', task: 'T05', text: 'which threshold?' });
  assert.deepEqual(parseMessage({ from, text: wire }), {
    from,
    kind: 'question',
    task: 'T05',
    text: 'which threshold?',
  });
});

test('a multi-line body survives the round-trip intact', () => {
  const from = 'repo / plan / T09 / work / implement';
  const text = 'line one\nline two\n\n[pir:v1 kind=fake task=T01] not a header\n';
  const wire = encodeMessage({ kind: 'conflict', task: 'T09', text });
  const back = parseMessage({ from, text: wire });
  assert.equal(back.kind, 'conflict');
  assert.equal(back.task, 'T09');
  assert.equal(back.text, text); // the header regex is anchored to the first line only
});

test('a message with no task recovers the task from the sender name', () => {
  const from = 'repo / plan / T12 / work / implement';
  const wire = encodeMessage({ kind: 'done', task: null, text: '' });
  const back = parseMessage({ from, text: wire });
  assert.equal(back.task, 'T12');
  assert.equal(back.kind, 'done');
});

test('a body with no header is read as a plain message, task from the sender name', () => {
  const from = 'repo / plan / T03 / work / implement';
  const back = parseMessage({ from, text: 'just a note from a human' });
  assert.equal(back.kind, 'message');
  assert.equal(back.task, 'T03');
  assert.equal(back.text, 'just a note from a human');
});

// --- P3: a REAL worker's message drives the state machine (T12) --------------------------------
//
// The T10 live drill's worker did NOT send the wire header — it wrote natural language with an
// explicit "(kind: question)" marker, which the old parseMessage read as kind `message` and the loop
// then dropped. These assert the two shapes a worker following the updated pir-worker contract sends:
// the header (the contract) and the prose safety net (a worker that forgets it).

test('the exact header shape pir-worker is taught to emit parses to the right kind and task', () => {
  const from = 'plan-implement-review / parallel-pir / T01 / work / implement';
  // The literal string the worker sends: the [pir:v1 …] line, then a multi-line question body.
  const sent =
    '[pir:v1 kind=question task=T01]\n' +
    'The greeting wording is unspecified. Options: (a) "Hello", (b) "Hi there".\n' +
    'Recommend (a). If you say nothing I will use (a).';
  const back = parseMessage({ from, text: sent });
  assert.equal(back.kind, 'question');
  assert.equal(back.task, 'T01');
  assert.match(back.text, /greeting wording is unspecified/);
});

test('a worker that forgets the header but names its kind in prose still parses (the drill shape)', () => {
  const from = 'pir-t10 / scratch / T01 / work / implement';
  // Verbatim-shape from the drill handoff: prose with an explicit "(kind: question)" marker.
  const drillShape = 'T01 question (kind: question) — the greeting wording is unspecified. I recommend "Hello".';
  const back = parseMessage({ from, text: drillShape });
  assert.equal(back.kind, 'question', 'the explicit kind marker is honoured');
  assert.equal(back.task, 'T01', 'the T-id in the text (or the sender name) gives the task');
  assert.equal(back.text, drillShape, 'the whole prose is kept as the body');
});

test('a "kind: done" prose signal parses to done; a bare word "done" in a note does not', () => {
  const from = 'repo / plan / T02 / work / implement';
  assert.equal(parseMessage({ from, text: 'kind=done task=T02 all integrated' }).kind, 'done');
  // A human note that merely contains the word "done" must stay a plain message, not fire a state change.
  const note = parseMessage({ from, text: 'I think this one is basically done, nice work' });
  assert.equal(note.kind, 'message', 'no explicit kind marker → plain message, never guessed');
});

// --- the messaging surface --------------------------------------------------------------------

// createMessaging is the report up-channel only — { inbox }. The line down to a worker is the
// platform's send (live-workers T05), not a report-file feature.
test('createMessaging exposes inbox and no send', () => {
  const m = createMessaging({ transport: { drain: () => [] } });
  assert.equal(typeof m.inbox, 'function');
  assert.equal(m.send, undefined, 'the messaging surface only reads reports');
});

test('createMessaging.inbox parses each report drained from the up-channel transport', () => {
  const transport = {
    drain: () => [
      { from: 'repo / plan / T01 / work / implement', text: encodeMessage({ kind: 'implemented', task: 'T01', text: '' }) },
      { from: 'repo / plan / T02 / work / implement', text: encodeMessage({ kind: 'done', task: 'T02', text: '' }) },
    ],
  };
  const m = createMessaging({ transport });
  const got = m.inbox();
  assert.equal(got.length, 2);
  assert.equal(got[0].kind, 'implemented');
  assert.equal(got[0].task, 'T01');
  assert.equal(got[1].kind, 'done');
});

// --- the opening instruction and argv (T08, DESIGN §5.1: everything short of a live process) ----

test('openingInstruction names the right skill per phase, with the task, and engages the contract', () => {
  const impl = openingInstruction('implement', 'T08');
  assert.match(impl, /pir-implement T08/);
  assert.match(impl, /pir-worker/); // it engages the worker contract
  assert.match(impl, /not .*pick your own task|do not pick your own task/i);

  assert.match(openingInstruction('review', 'T08'), /pir-review T08/);
});

// The string a worker with no note reads, pinned byte for byte: a note must add to it, never change it.
const PLAIN_IMPLEMENT_T08 =
  'You are a worker session in a parallel PIR run. You have been given one task and one phase to ' +
  'carry out — you did not choose it, so do not run pir-work and do not pick your own task. Invoke ' +
  'the pir-worker skill and follow its contract, then carry out exactly this instruction and nothing ' +
  'else: pir-implement T08';

test('openingInstruction without a note is byte-identical to the plain instruction (DESIGN §2.4)', () => {
  assert.equal(openingInstruction('implement', 'T08'), PLAIN_IMPLEMENT_T08);
  assert.equal(openingInstruction('implement', 'T08', null), PLAIN_IMPLEMENT_T08);
});

test('openingInstruction appends a note after one blank line', () => {
  const note = 'Setup failed.\nFull output: /x.log';
  assert.equal(openingInstruction('implement', 'T08', note), `${PLAIN_IMPLEMENT_T08}\n\n${note}`);
});

test('openingInstruction refuses an unknown phase or a missing task', () => {
  assert.throws(() => openingInstruction('deploy', 'T08'), /unknown phase/);
  // `verify` is no longer a phase — the auto/you distinction and pir-verify path were removed (§2.5).
  assert.throws(() => openingInstruction('verify', 'T08'), /unknown phase/);
  assert.throws(() => openingInstruction('implement', null), /no task/);
});


// --- live workers through the real SDK against the fake `claude` (live-workers T05) -------------

const NAME = (task, role = 'implement') => `plan-implement-review / live-workers / ${task} / live-platform / ${role}`;
const CLAUDE = '/nonexistent/claude'; // never launched: the fake spawner ignores the command

// setupPlatform(t, scripts) → a platform over a scratch control folder whose workers run the fake
// `claude`. `scripts` maps a task id to its fake script; each spawn gets its own received-lines file.
function setupPlatform(t, scripts = {}, opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pir-platform-'));
  const controlDir = join(dir, 'control');
  const spawned = []; // { task, role, cwd, received, spawner }
  const start = (o) => {
    const [, , task, , role] = o.name.split(' / ');
    const n = spawned.length + 1;
    const scriptPath = join(dir, `script-${n}.json`);
    writeFileSync(scriptPath, JSON.stringify(scripts[task] ?? [{ await: 'user' }, ...turn('ok')]));
    const received = join(dir, `received-${n}.ndjson`);
    const spawner = fakeClaudeSpawner({ script: scriptPath, received });
    spawned.push({ task, role, cwd: o.cwd, received, spawner, opts: o });
    return startWorker({ ...o, spawnProcess: spawner });
  };
  const platform = createPlatform({ controlDir, transport: { drain: () => [] }, startWorker: start, claudePath: CLAUDE, ...opts });
  t.after(async () => {
    for (const w of platform.list()) platform.close(w.id, { immediate: true });
    await waitFor(() => platform.list().length === 0, 'every child to exit');
    rmSync(dir, { recursive: true, force: true });
  });
  const received = (i) =>
    existsSync(spawned[i].received)
      ? readFileSync(spawned[i].received, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
      : [];
  const logOf = (id) => readFileSync(platform.logPathOf(id), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const workersFile = () => JSON.parse(readFileSync(join(controlDir, 'workers.json'), 'utf8'));
  return { dir, controlDir, platform, spawned, received, logOf, workersFile };
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

const userLines = (lines) => lines.filter((l) => l.line).map((l) => JSON.parse(l.line)).filter((m) => m.type === 'user');

test('spawn starts the worker through the SDK in the task cwd with the §2.1 options; the opening instruction is its first user message', async (t) => {
  const { platform, spawned, received, dir, logOf } = setupPlatform(t);
  const cwd = mkdtempSync(join(dir, 'wt-'));
  const id = platform.spawn({ cwd, name: NAME('T05'), phase: 'implement' });
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, 'the id is a uuid pir chose');

  await waitFor(() => userLines(received(0)).length > 0, 'the first user message');
  const { spawner } = spawned[0];
  assert.equal(spawner.calls[0].command, CLAUDE, 'the SDK was pointed at the resolved claude');
  assert.equal(spawner.calls[0].cwd, cwd, 'the worker runs in the task worktree');
  assert.deepEqual(spawner.calls[0].args, [
    '--output-format', 'stream-json', '--verbose', '--input-format', 'stream-json',
    '--permission-prompt-tool', 'stdio', '--permission-mode', 'auto', `--session-id=${id}`, '--name', NAME('T05'),
  ]);
  const [first] = userLines(received(0));
  assert.equal(first.message.content, openingInstruction('implement', 'T05'), 'the opening instruction is the first user message, not an argument');

  const out = logOf(id).find((e) => e.dir === 'out');
  assert.deepEqual({ from: out.from, kind: out.kind, text: out.text }, { from: 'pir', kind: 'message', text: openingInstruction('implement', 'T05') });
  assert.match(platform.logPathOf(id), /conversations\/T05-implement-1\.ndjson$/);
});

test('spawn with a note appends it to the opening message; a review names pir-review', async (t) => {
  const { platform, received } = setupPlatform(t);
  platform.spawn({ cwd: tmpdir(), name: NAME('T05'), phase: 'implement', note: 'Setup failed.\nline two' });
  platform.spawn({ cwd: tmpdir(), name: NAME('T06', 'review'), phase: 'review' });
  await waitFor(() => userLines(received(0)).length && userLines(received(1)).length, 'both first messages');
  assert.equal(userLines(received(0))[0].message.content, `${openingInstruction('implement', 'T05')}\n\nSetup failed.\nline two`);
  assert.match(userLines(received(1))[0].message.content, /pir-review T06$/);
});

test('list reports each live child with its task, role, pid and activity; status flips to idle on the result', async (t) => {
  const { platform } = setupPlatform(t, { T05: [{ await: 'user' }, { sleep: 300 }, ...turn('ok')] });
  const id = platform.spawn({ cwd: tmpdir(), name: NAME('T05'), phase: 'implement' });
  const [w] = platform.list();
  assert.equal(w.id, id);
  assert.equal(w.task, 'T05');
  assert.equal(w.role, 'implement');
  assert.equal(w.name, NAME('T05'));
  assert.equal(typeof w.pid, 'number');
  assert.equal(w.live, true);
  assert.equal(w.status, 'busy', 'busy while its opening turn is open');
  await waitFor(() => platform.list()[0]?.status === 'idle', 'the result to end the turn');
  assert.equal(platform.list()[0].activity.state, 'idle');
});

test('a worker waiting on a permission request is listed idle (parked on the person), and answer resolves it', async (t) => {
  const { platform, received } = setupPlatform(t, {
    T05: [{ await: 'user' }, { emit: initEvent() }, { emit: canUseTool('req-1', 'Bash', { command: 'git push -f' }) }, { await: 'control_response' }, ...turn('pushed').slice(1)],
  });
  const id = platform.spawn({ cwd: tmpdir(), name: NAME('T05'), phase: 'implement' });
  await waitFor(() => platform.list()[0]?.state === 'permission', 'the request to be pending');
  assert.equal(platform.list()[0].status, 'idle', 'a worker waiting on the person is not busy (DESIGN §2.4)');

  const request = platform.list()[0].activity.pending[0];
  assert.deepEqual(platform.answer(id, 'req-1', allowResult(request)), { ok: true });
  await waitFor(() => received(0).some((l) => l.line && JSON.parse(l.line).type === 'control_response'), 'the reply at the fake');
  assert.deepEqual(platform.answer(id, 'req-1', allowResult(request)), { ok: false }, 'a second answer finds nothing pending');
  await waitFor(() => platform.list()[0]?.status === 'idle' && platform.list()[0].state === 'idle', 'the turn to end');
});

test('a child that exits is gone from list at once, and send / interrupt / answer to it are undelivered', async (t) => {
  const { platform, logOf } = setupPlatform(t, { T05: [{ await: 'user' }, ...turn('bye'), { exit: 3 }] });
  const id = platform.spawn({ cwd: tmpdir(), name: NAME('T05'), phase: 'implement' });
  await waitFor(() => platform.list().length === 0, 'the exit');
  assert.ok(logOf(id).some((e) => e.dir === 'note' && e.kind === 'exited' && e.code === 3));

  assert.deepEqual(platform.send(id, 'hello?', { from: 'person' }), { ok: false });
  assert.deepEqual(platform.interrupt(id), { ok: false });
  assert.deepEqual(platform.answer(id, 'req-x', { behavior: 'allow', updatedInput: {} }), { ok: false });
  await waitFor(() => logOf(id).filter((e) => e.kind === 'undelivered').length === 3, 'three undelivered notes');
  assert.deepEqual(
    logOf(id).filter((e) => e.kind === 'undelivered').map((e) => e.what),
    ['message', 'interrupt', 'reply'],
  );

  for (const r of [platform.send('nobody', 'x'), platform.interrupt('nobody'), platform.answer('nobody', 'r', {})]) {
    assert.deepEqual(r, { ok: false }, 'an id never spawned here has no worker and no log');
  }
  assert.equal(platform.logPathOf('nobody'), null);
});

test('send reaches a live worker as a user message logged with its sender; interrupt is sent', async (t) => {
  const { platform, received, logOf } = setupPlatform(t, { T05: [{ await: 'user' }, ...turn('one'), { await: 'user' }, { emit: initEvent() }, { await: 'interrupt' }] });
  const id = platform.spawn({ cwd: tmpdir(), name: NAME('T05'), phase: 'implement' });
  await waitFor(() => platform.list()[0]?.status === 'idle', 'the first turn');
  assert.deepEqual(platform.send(id, 'merge the feature branch in', { from: 'pir' }), { ok: true });
  await waitFor(() => userLines(received(0)).length === 2, 'the second message at the fake');
  assert.equal(userLines(received(0))[1].message.content, 'merge the feature branch in');
  assert.deepEqual(platform.interrupt(id), { ok: true });
  await waitFor(() => received(0).some((l) => l.line && JSON.parse(l.line).request?.subtype === 'interrupt'), 'the interrupt at the fake');
  const outs = logOf(id).filter((e) => e.dir === 'out').map((e) => [e.from, e.kind]);
  assert.deepEqual(outs, [['pir', 'message'], ['pir', 'message'], ['person', 'interrupt']]);
});

test('workers.json lists exactly the live children after each spawn and exit, with a start time', async (t) => {
  const { platform, workersFile } = setupPlatform(t, {
    T05: [{ await: 'user' }, ...turn('a')],
    T06: [{ await: 'user' }, ...turn('b'), { exit: 0 }],
  });
  const a = platform.spawn({ cwd: tmpdir(), name: NAME('T05'), phase: 'implement' });
  assert.deepEqual(workersFile().map((w) => w.id), [a]);
  const b = platform.spawn({ cwd: tmpdir(), name: NAME('T06', 'review'), phase: 'review' });
  const both = workersFile();
  assert.deepEqual(both.map((w) => [w.id, w.task, w.role]), [[a, 'T05', 'implement'], [b, 'T06', 'review']]);
  for (const w of both) {
    assert.equal(typeof w.pid, 'number');
    assert.equal(typeof w.startTime, 'string', 'stamped with the process start time (DESIGN §2.12)');
    assert.deepEqual(Object.keys(w).sort(), ['id', 'pid', 'role', 'startTime', 'task']);
  }
  await waitFor(() => workersFile().length === 1, 'T06 to exit');
  assert.deepEqual(workersFile().map((w) => w.id), [a], 'the exited child left the file');
  platform.close(a);
  await waitFor(() => workersFile().length === 0, 'T05 to exit after close');
});

test('close ends the input queue and the child exits; the closing child stays listed until it does', async (t) => {
  const { platform } = setupPlatform(t);
  const id = platform.spawn({ cwd: tmpdir(), name: NAME('T05'), phase: 'implement' });
  await waitFor(() => platform.list()[0]?.status === 'idle', 'the first turn');
  assert.deepEqual(platform.close(id), { ok: true });
  assert.equal(platform.list().length, 1, 'close is fire-and-forget: still listed the same tick');
  await waitFor(() => platform.list().length === 0, 'the exit on stdin EOF');
  assert.deepEqual(platform.close(id), { ok: true }, 'closing an exited id is a no-op');
  assert.deepEqual(platform.remove(id), { ok: true });
});

test('close { immediate } SIGTERMs the child synchronously, before the caller could exit', async (t) => {
  const { platform, received } = setupPlatform(t, { T05: [{ onEof: 'ignore' }, { await: 'user' }, ...turn('ok')] });
  const id = platform.spawn({ cwd: tmpdir(), name: NAME('T05'), phase: 'implement' });
  await waitFor(() => platform.list()[0]?.status === 'idle', 'the first turn');
  platform.close(id, { immediate: true });
  await waitFor(() => received(0).some((l) => l.signal === 'SIGTERM'), 'the SIGTERM at the fake');
  await waitFor(() => platform.list().length === 0, 'the exit');
});

test('conversation logs count per task and role, and a new platform on the same folder continues the count', async (t) => {
  const { platform, controlDir } = setupPlatform(t);
  const one = platform.spawn({ cwd: tmpdir(), name: NAME('T05'), phase: 'implement' });
  const two = platform.spawn({ cwd: tmpdir(), name: NAME('T05'), phase: 'implement' });
  const rev = platform.spawn({ cwd: tmpdir(), name: NAME('T05', 'review'), phase: 'review' });
  assert.match(platform.logPathOf(one), /T05-implement-1\.ndjson$/);
  assert.match(platform.logPathOf(two), /T05-implement-2\.ndjson$/);
  assert.match(platform.logPathOf(rev), /T05-review-1\.ndjson$/);
  assert.match(nextLogPath(controlDir, 'T05', 'implement'), /T05-implement-3\.ndjson$/, 'a restart continues, never overwrites');
  assert.deepEqual(readdirSync(join(controlDir, 'conversations')).sort(), ['T05-implement-1.ndjson', 'T05-implement-2.ndjson', 'T05-review-1.ndjson']);
});

test('nextLogPath counts from the highest file, ignores other tasks and roles, and starts at 1 with no folder', () => {
  const readdir = () => ['T05-implement-1.ndjson', 'T05-implement-7.ndjson', 'T15-implement-9.ndjson', 'T05-review-4.ndjson', 'junk'];
  assert.equal(nextLogPath('/c', 'T05', 'implement', { readdir }), '/c/conversations/T05-implement-8.ndjson');
  assert.equal(nextLogPath('/c', 'T05', 'review', { readdir }), '/c/conversations/T05-review-5.ndjson');
  assert.equal(nextLogPath('/nonexistent-pir', 'T05', 'implement'), '/nonexistent-pir/conversations/T05-implement-1.ndjson');
});

test('resolveClaudePath returns the installed claude and throws when there is none', () => {
  assert.equal(resolveClaudePath({ exec: () => '/usr/local/bin/claude\n' }), '/usr/local/bin/claude');
  assert.throws(() => resolveClaudePath({ exec: () => '' }), /no `claude` on PATH/);
  assert.throws(() => resolveClaudePath({ exec: () => { throw new Error('exit 1'); } }), /no `claude` on PATH/);
});

test('a platform without a control folder lists nothing and refuses to spawn', () => {
  const p = createPlatform({});
  assert.deepEqual(p.list(), []);
  assert.throws(() => p.spawn({ cwd: '/x', name: NAME('T05'), phase: 'implement' }), /control folder/);
});

test('platform.mjs calls no `claude agents`, `claude stop` or `claude rm`, and no shell file passes --bg', () => {
  const shellDir = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(shellDir, 'platform.mjs'), 'utf8');
  // Built, not written out, so the task's own grep for the quoted flag does not find this test.
  const BG = `'--${'bg'}'`;
  for (const sub of ["'agents'", "'stop'", "'rm'", BG]) assert.ok(!src.includes(sub), `platform.mjs still names ${sub}`);
  const offenders = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.mjs') && !e.name.endsWith('.test.mjs') && readFileSync(p, 'utf8').includes(BG)) offenders.push(p);
    }
  };
  walk(shellDir);
  assert.deepEqual(offenders, []);
});
