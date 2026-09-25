// person-inbox.mjs (live-workers T07, DESIGN §2.5–§2.8). The forwarder runs against the real platform,
// whose workers are the real Agent SDK driving the scripted fake `claude` (fake/claude-stream.mjs), so each
// input is checked as the line the worker actually received. No test spawns the real `claude`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dropPersonInput, startPersonInbox, createGrants, inboxDirOf } from './person-inbox.mjs';
import { createPlatform } from './platform.mjs';
import { startWorker } from './worker-proc.mjs';
import { waitForDrop } from './drop-folder.mjs';
import { clearTransientFeeds, fileControl, startupControlHygiene } from './coordinate.mjs';
import { fakeClaudeSpawner, turn, canUseTool, initEvent, resultEvent } from './fake/claude-stream.mjs';

const NAME = (task) => `plan-implement-review / live-workers / ${task} / person-inbox / implement`;

async function waitFor(pred, what, ms = 5000) {
  const start = Date.now();
  for (;;) {
    const v = pred();
    if (v) return v;
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

// A watch that never fires on its own: a test fires it by hand, or relies on drain() alone.
function manualWatch() {
  const fire = [];
  const watch = (dir, cb) => {
    const w = new EventEmitter();
    w.close = () => {
      const i = fire.indexOf(cb);
      if (i >= 0) fire.splice(i, 1);
    };
    fire.push(cb);
    return w;
  };
  watch.fire = () => [...fire].forEach((cb) => cb('rename', 'x.json'));
  watch.count = () => fire.length;
  return watch;
}

// setup(t, scripts, { watch }) → a platform over a scratch control folder, workers on the fake `claude`,
// plus a person inbox wired as coordinate.mjs wires it (one shared grants list).
function setup(t, scripts = {}, { watch = manualWatch() } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pir-inbox-'));
  const controlDir = join(dir, 'control');
  const spawned = [];
  const start = (o) => {
    const task = o.name.split(' / ')[2];
    const n = spawned.length + 1;
    const scriptPath = join(dir, `script-${n}.json`);
    writeFileSync(scriptPath, JSON.stringify(scripts[task] ?? [{ await: 'user' }, ...turn('ok')]));
    const received = join(dir, `received-${n}.ndjson`);
    spawned.push({ task, received });
    return startWorker({ ...o, spawnProcess: fakeClaudeSpawner({ script: scriptPath, received }) });
  };
  const grants = createGrants();
  const platform = createPlatform({ controlDir, transport: { drain: () => [] }, startWorker: start, claudePath: '/nonexistent/claude', grants });
  const runLog = [];
  const inbox = startPersonInbox({ controlDir, platform, grants, watch, log: (l) => runLog.push(l) });
  t.after(async () => {
    inbox.stop();
    for (const w of platform.list()) platform.close(w.id, { immediate: true });
    await waitFor(() => platform.list().length === 0, 'every child to exit');
    rmSync(dir, { recursive: true, force: true });
  });
  const received = (i) =>
    existsSync(spawned[i].received)
      ? readFileSync(spawned[i].received, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
      : [];
  const lines = (i) => received(i).filter((l) => l.line).map((l) => JSON.parse(l.line));
  const replies = (i) => lines(i).filter((m) => m.type === 'control_response').map((m) => m.response.response);
  const logOf = (id) => readFileSync(platform.logPathOf(id), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const drop = (input) => dropPersonInput(controlDir, input, { coordinatorAlive: true });
  const spawn = (task = 'T01') => platform.spawn({ cwd: tmpdir(), name: NAME(task), phase: 'implement' });
  return { dir, controlDir, platform, grants, inbox, runLog, watch, received, lines, replies, logOf, drop, spawn };
}

const ASK = (id, command, suggestions) =>
  canUseTool(id, 'Bash', { command }, suggestions ? { permission_suggestions: suggestions } : {});
const RULE = (ruleContent) => [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent }], behavior: 'allow', destination: 'localSettings' }];
const QUESTIONS = { questions: [{ question: 'Which colour?', header: 'Colour', multiSelect: false, options: [{ label: 'red', description: '' }, { label: 'blue', description: '' }] }] };

// --- dropPersonInput: the screen's side ------------------------------------------------------------

test('dropPersonInput with the coordinator not alive writes nothing and returns not-running', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'pir-drop-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const input = { to: 'w1', kind: 'message', text: 'hello' };
  assert.deepEqual(dropPersonInput(dir, input, { coordinatorAlive: false }), { ok: false, reason: 'not-running' });
  assert.deepEqual(dropPersonInput(dir, input, { coordinatorAlive: () => false }), { ok: false, reason: 'not-running' });
  assert.deepEqual(dropPersonInput(dir, input, {}), { ok: false, reason: 'not-running' }, 'no verdict is not alive');
  assert.equal(existsSync(inboxDirOf(dir)), false, 'not even the folder was made');
});

test('dropPersonInput writes one validated *.json into inbox/, and refuses an invalid input unwritten', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'pir-drop-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = dropPersonInput(dir, { to: 'w1', kind: 'message', text: 'hello', stray: 1 }, { coordinatorAlive: () => true, now: () => 1234 });
  assert.deepEqual(r, { ok: true });
  const names = readdirSync(inboxDirOf(dir));
  assert.equal(names.length, 1);
  assert.match(names[0], /^1234-[a-z0-9]+\.json$/);
  assert.deepEqual(JSON.parse(readFileSync(join(inboxDirOf(dir), names[0]), 'utf8')), { to: 'w1', kind: 'message', text: 'hello' });

  const bad = dropPersonInput(dir, { to: 'w1', kind: 'shout' }, { coordinatorAlive: true });
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /unknown kind/);
  assert.equal(readdirSync(inboxDirOf(dir)).length, 1, 'the invalid input was not written');
});

// --- each kind reaches the worker as the right line ----------------------------------------------

test('a message reaches the worker as a user message, logged from the person', async (t) => {
  const s = setup(t, { T01: [{ await: 'user' }, ...turn('one'), { await: 'user' }, ...turn('two')] });
  const id = s.spawn();
  await waitFor(() => s.platform.list()[0]?.state === 'idle', 'the first turn');
  assert.deepEqual(s.drop({ to: id, kind: 'message', text: 'please also add a test' }), { ok: true });
  assert.deepEqual(s.inbox.drain().map((o) => o.outcome), ['delivered']);
  await waitFor(() => s.lines(0).filter((m) => m.type === 'user').length === 2, 'the message at the fake');
  assert.equal(s.lines(0).filter((m) => m.type === 'user')[1].message.content, 'please also add a test');
  const out = s.logOf(id).filter((e) => e.dir === 'out').at(-1);
  assert.deepEqual([out.from, out.kind, out.text], ['person', 'message', 'please also add a test']);
  assert.equal(readdirSync(s.inbox.inboxDir).length, 0, 'the drop was deleted');
  assert.match(s.runLog.at(-1), /message for .*: delivered/);
});

test('an interrupt reaches the worker as the interrupt control request', async (t) => {
  const s = setup(t, { T01: [{ await: 'user' }, { emit: initEvent() }, { await: 'interrupt' }, { emit: resultEvent('error_during_execution') }] });
  const id = s.spawn();
  await waitFor(() => s.lines(0).some((m) => m.type === 'user'), 'the opening turn');
  s.drop({ to: id, kind: 'interrupt' });
  assert.deepEqual(s.inbox.drain().map((o) => o.outcome), ['delivered']);
  await waitFor(() => s.lines(0).some((m) => m.request?.subtype === 'interrupt'), 'the interrupt at the fake');
  assert.ok(s.logOf(id).some((e) => e.dir === 'out' && e.from === 'person' && e.kind === 'interrupt'));
});

test('allow, deny, answers and decline-questions each reach the worker as the right PermissionResult', async (t) => {
  const s = setup(t, {
    T01: [
      { await: 'user' }, { emit: initEvent() },
      { emit: ASK('r-allow', 'git push -f') }, { await: 'control_response' },
      { emit: ASK('r-deny', 'rm -rf build') }, { await: 'control_response' },
      { emit: canUseTool('q-answer', 'AskUserQuestion', QUESTIONS) }, { await: 'control_response' },
      { emit: canUseTool('q-decline', 'AskUserQuestion', QUESTIONS) }, { await: 'control_response' },
      { emit: resultEvent('success', 'done') },
    ],
  });
  const id = s.spawn();
  const pendingIs = (rid) => s.platform.pending(id).some((r) => r.requestId === rid);

  await waitFor(() => pendingIs('r-allow'), 'r-allow');
  s.drop({ to: id, kind: 'permission', requestId: 'r-allow', decision: 'allow' });
  s.inbox.drain();
  await waitFor(() => pendingIs('r-deny'), 'r-deny');
  s.drop({ to: id, kind: 'permission', requestId: 'r-deny', decision: 'deny', text: 'use make clean instead' });
  s.inbox.drain();
  await waitFor(() => pendingIs('q-answer'), 'q-answer');
  s.drop({ to: id, kind: 'answers', requestId: 'q-answer', answers: { 'Which colour?': 'blue' } });
  s.inbox.drain();
  await waitFor(() => pendingIs('q-decline'), 'q-decline');
  s.drop({ to: id, kind: 'decline-questions', requestId: 'q-decline', text: 'let us talk about this first' });
  s.inbox.drain();
  await waitFor(() => s.platform.list()[0]?.state === 'idle', 'the turn to end');

  const [allow, deny, answers, decline] = s.replies(0);
  assert.deepEqual([allow.behavior, allow.updatedInput], ['allow', { command: 'git push -f' }]);
  assert.deepEqual([deny.behavior, deny.message], ['deny', 'use make clean instead']);
  assert.equal(answers.behavior, 'allow');
  assert.deepEqual(answers.updatedInput.answers, { 'Which colour?': 'blue' });
  assert.deepEqual(answers.updatedInput.questions, QUESTIONS.questions, 'the request input is kept');
  assert.deepEqual([decline.behavior, decline.message], ['deny', 'let us talk about this first']);
  assert.ok(!('updatedPermissions' in allow), 'an allow never carries updatedPermissions (DESIGN §2.6)');
  const outs = s.logOf(id).filter((e) => e.dir === 'out' && e.kind === 'reply').map((e) => [e.from, e.requestId]);
  assert.deepEqual(outs, [['person', 'r-allow'], ['person', 'r-deny'], ['person', 'q-answer'], ['person', 'q-decline']]);
});

test('a deny with no text refuses with the default wording', async (t) => {
  const s = setup(t, { T01: [{ await: 'user' }, { emit: initEvent() }, { emit: ASK('r1', 'git push -f') }, { await: 'control_response' }, { emit: resultEvent() }] });
  const id = s.spawn();
  await waitFor(() => s.platform.pending(id).length, 'the request');
  s.drop({ to: id, kind: 'permission', requestId: 'r1', decision: 'deny' });
  s.inbox.drain();
  await waitFor(() => s.replies(0).length, 'the reply');
  const [reply] = s.replies(0);
  assert.deepEqual([reply.behavior, reply.message], ['deny', 'The person refused.']);
});

// --- what is not delivered is logged, never lost ------------------------------------------------

test('an invalid drop is deleted and logged, never forwarded, and never stops the forwarder', async (t) => {
  const s = setup(t, { T01: [{ await: 'user' }, ...turn('one'), { await: 'user' }, ...turn('two')] });
  const id = s.spawn();
  await waitFor(() => s.platform.list()[0]?.state === 'idle', 'the first turn');
  writeFileSync(join(s.inbox.inboxDir, '0001-torn.json'), '{"to":');
  writeFileSync(join(s.inbox.inboxDir, '0002-bad.json'), JSON.stringify({ to: id, kind: 'shout', text: 'hi' }));
  writeFileSync(join(s.inbox.inboxDir, '0003-array.json'), '[1,2]');
  s.drop({ to: id, kind: 'message', text: 'still here' });

  const outcomes = s.inbox.drain();
  assert.deepEqual(outcomes.map((o) => o.outcome), ['invalid', 'invalid', 'invalid', 'delivered']);
  assert.equal(readdirSync(s.inbox.inboxDir).length, 0, 'every drop is deleted, invalid or not');
  assert.equal(s.runLog.filter((l) => /invalid drop/.test(l)).length, 3, 'each invalid drop has a run-log line');
  await waitFor(() => s.lines(0).filter((m) => m.type === 'user').length === 2, 'the valid message');
  assert.equal(s.lines(0).filter((m) => m.type === 'user').length, 2, 'nothing invalid reached the worker');

  // The forwarder is still alive: a later drop is forwarded when the watch fires.
  s.drop({ to: id, kind: 'message', text: 'and again' });
  s.watch.fire();
  await waitFor(() => s.lines(0).filter((m) => m.type === 'user').length === 3, 'the later message');
});

test('a drop for a dead worker, an unknown worker or an already-answered request is logged undelivered', async (t) => {
  const s = setup(t, {
    T01: [{ await: 'user' }, { emit: initEvent() }, { emit: ASK('r1', 'git push -f') }, { await: 'control_response' }, { emit: resultEvent() }],
    T02: [{ await: 'user' }, ...turn('bye'), { exit: 0 }],
  });
  const live = s.spawn('T01');
  const dead = s.spawn('T02');
  await waitFor(() => s.platform.pending(live).length && !s.platform.list().some((w) => w.id === dead), 'T01 asking and T02 gone');

  s.drop({ to: live, kind: 'permission', requestId: 'r1', decision: 'allow' });
  s.drop({ to: live, kind: 'permission', requestId: 'r1', decision: 'deny' }); // the second screen's answer
  s.drop({ to: dead, kind: 'message', text: 'are you there?' });
  s.drop({ to: dead, kind: 'permission', requestId: 'r9', decision: 'allow' });
  s.drop({ to: 'nobody', kind: 'interrupt' });
  const outcomes = s.inbox.drain();
  // The drops' names start with the same millisecond often enough that their order is not guaranteed;
  // compare as a multiset per worker.
  const by = (to) => outcomes.filter((o) => o.to === to).map((o) => o.outcome).sort();
  assert.deepEqual(by(live), ['delivered', 'undelivered']);
  assert.deepEqual(by(dead), ['undelivered', 'undelivered']);
  assert.deepEqual(by('nobody'), ['undelivered']);

  assert.equal(s.logOf(live).filter((e) => e.kind === 'undelivered').length, 1, 'the second answer is noted in the live log');
  const deadNotes = s.logOf(dead).filter((e) => e.kind === 'undelivered').map((e) => e.what).sort();
  assert.deepEqual(deadNotes, ['message', 'reply']);
  assert.ok(s.runLog.some((l) => /interrupt for nobody: undelivered \(no such worker in this run\)/.test(l)));
  await waitFor(() => s.replies(0).length === 1, 'exactly one reply at the fake');
});

test('answers sent to a permission request (or allow to a question set) is undelivered, the request stays pending', async (t) => {
  const s = setup(t, { T01: [{ await: 'user' }, { emit: initEvent() }, { emit: ASK('r1', 'ls') }, { await: 'control_response' }, { emit: resultEvent() }] });
  const id = s.spawn();
  await waitFor(() => s.platform.pending(id).length, 'the request');
  s.drop({ to: id, kind: 'answers', requestId: 'r1', answers: { q: 'a' } });
  assert.deepEqual(s.inbox.drain().map((o) => o.outcome), ['undelivered']);
  assert.equal(s.platform.pending(id).length, 1);
  assert.match(s.logOf(id).find((e) => e.kind === 'undelivered').reason, /permission, not a questions/);
});

// --- grants (DESIGN §2.6) --------------------------------------------------------------------------

test('allow-always then an identical request: the second is answered by pir with no pending state', async (t) => {
  const s = setup(t, {
    T01: [
      { await: 'user' }, { emit: initEvent() },
      { emit: ASK('r1', 'npm test', RULE('npm test *')) }, { await: 'control_response' },
      { emit: ASK('r2', 'npm test') }, { await: 'control_response' },
      { emit: ASK('r3', 'npm test -- --watch') }, { await: 'control_response' },
      { emit: ASK('r4', 'git push -f') }, { await: 'control_response' },
      { emit: resultEvent() },
    ],
  });
  const id = s.spawn();
  // Record every state the platform would report between log entries: r2 and r3 must never be pending.
  const seen = [];
  await waitFor(() => s.platform.pending(id).length, 'r1');
  s.drop({ to: id, kind: 'permission', requestId: 'r1', decision: 'allow-always' });
  s.inbox.drain();
  await waitFor(() => {
    seen.push(...s.platform.pending(id).map((r) => r.requestId));
    return s.platform.pending(id).some((r) => r.requestId === 'r4');
  }, 'r4, which the grant does not cover');
  assert.ok(!seen.includes('r2') && !seen.includes('r3'), 'the covered requests were never pending');

  const log = s.logOf(id);
  for (const rid of ['r2', 'r3']) {
    const i = log.findIndex((e) => e.dir === 'request' && e.requestId === rid);
    assert.deepEqual([log[i + 1].dir, log[i + 1].from, log[i + 1].requestId], ['out', 'pir', rid], `${rid} answered by pir right after its request`);
    assert.deepEqual([log[i + 2].kind, log[i + 2].requestId], ['delivered-by-grant', rid]);
  }
  assert.deepEqual(s.replies(0).map((r) => r.behavior), ['allow', 'allow', 'allow']);
  s.drop({ to: id, kind: 'permission', requestId: 'r4', decision: 'deny' });
  s.inbox.drain();
  await waitFor(() => s.platform.list()[0]?.state === 'idle', 'the turn to end');
});

test('allow-always on a request with no addRules suggestion allows once and grants nothing', async (t) => {
  const s = setup(t, {
    T01: [
      { await: 'user' }, { emit: initEvent() },
      { emit: ASK('r1', 'npm test') }, { await: 'control_response' },
      { emit: ASK('r2', 'npm test') }, { await: 'control_response' },
      { emit: resultEvent() },
    ],
  });
  const id = s.spawn();
  await waitFor(() => s.platform.pending(id).length, 'r1');
  s.drop({ to: id, kind: 'permission', requestId: 'r1', decision: 'allow-always' });
  s.inbox.drain();
  await waitFor(() => s.platform.pending(id).some((r) => r.requestId === 'r2'), 'r2 asks the person again');
  assert.equal(s.logOf(id).filter((e) => e.kind === 'delivered-by-grant').length, 0);
});

test('a grant is per worker: another worker asking the same is still asked', async (t) => {
  const script = [{ await: 'user' }, { emit: initEvent() }, { emit: ASK('r1', 'npm test', RULE('npm test')) }, { await: 'control_response' }, { emit: resultEvent() }];
  const s = setup(t, { T01: script, T02: [{ await: 'user' }, { emit: initEvent() }, { sleep: 300 }, { emit: ASK('r1', 'npm test', RULE('npm test')) }, { await: 'control_response' }, { emit: resultEvent() }] });
  const a = s.spawn('T01');
  const b = s.spawn('T02');
  await waitFor(() => s.platform.pending(a).length, 'T01 asks');
  s.drop({ to: a, kind: 'permission', requestId: 'r1', decision: 'allow-always' });
  s.inbox.drain();
  await waitFor(() => s.platform.pending(b).length, 'T02 still asks');
  s.drop({ to: b, kind: 'permission', requestId: 'r1', decision: 'allow' });
  s.inbox.drain();
});

test('createGrants ignores a null grant and decides per worker', () => {
  const g = createGrants();
  assert.equal(g.add('w1', null), false);
  assert.equal(g.decide('w1', { toolName: 'Bash', input: { command: 'ls' } }), 'ask');
  g.add('w1', { rules: [{ toolName: 'Bash', ruleContent: 'ls' }] });
  assert.equal(g.decide('w1', { toolName: 'Bash', input: { command: 'ls' } }), 'allow-by-grant');
  assert.equal(g.decide('w2', { toolName: 'Bash', input: { command: 'ls' } }), 'ask');
});

// --- the forwarder and the folder -------------------------------------------------------------------

test('forwarding does not wait for the next pass: the watcher firing between passes delivers it', async (t) => {
  const s = setup(t, { T01: [{ await: 'user' }, ...turn('one'), { await: 'user' }, ...turn('two')] });
  const id = s.spawn();
  await waitFor(() => s.platform.list()[0]?.state === 'idle', 'the first turn');
  await waitFor(() => s.watch.count() > 0, 'the forwarder to be waiting on its watch');
  s.drop({ to: id, kind: 'message', text: 'between passes' });
  s.watch.fire(); // no drain() call: this is the only thing that happens between two passes
  await waitFor(() => s.lines(0).filter((m) => m.type === 'user').length === 2, 'the message forwarded by the watcher');
  assert.equal(readdirSync(s.inbox.inboxDir).length, 0);
});

test('the forwarder on a real fs.watch: permission asked, allow dropped, the worker continues to its result', async (t) => {
  const s = setup(
    t,
    { T01: [{ await: 'user' }, { emit: initEvent() }, { emit: ASK('r1', 'git push -f') }, { await: 'control_response' }, { emit: resultEvent('success', 'pushed') }] },
    { watch: null },
  );
  const id = s.spawn();
  await waitFor(() => s.platform.list()[0]?.state === 'permission', 'the request');
  assert.deepEqual(s.drop({ to: id, kind: 'permission', requestId: 'r1', decision: 'allow' }), { ok: true });
  await waitFor(() => s.logOf(id).some((e) => e.dir === 'in' && e.event.type === 'result'), 'the result, with no drain() called');
  assert.equal(s.platform.list()[0].state, 'idle');
  assert.equal(s.replies(0)[0].behavior, 'allow');
});

test('a partial file (not yet renamed) is never read, and temp files are left alone', async (t) => {
  const s = setup(t);
  const id = s.spawn();
  await waitFor(() => s.platform.list()[0]?.state === 'idle', 'the first turn');
  writeFileSync(join(s.inbox.inboxDir, '1-a.json.123-abc.tmp'), JSON.stringify({ to: id, kind: 'message', text: 'half' }).slice(0, 10));
  assert.deepEqual(s.inbox.drain(), []);
  assert.deepEqual(readdirSync(s.inbox.inboxDir), ['1-a.json.123-abc.tmp']);
});

test('stop() ends the forwarder: a drop after it waits for someone to drain', async (t) => {
  const s = setup(t);
  const id = s.spawn();
  await waitFor(() => s.platform.list()[0]?.state === 'idle', 'the first turn');
  s.inbox.stop();
  s.drop({ to: id, kind: 'message', text: 'late' });
  s.watch.fire();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(readdirSync(s.inbox.inboxDir).length, 1, 'nothing drained it');
});

test('waitForDrop wakes on any of several folders, and on abort', async () => {
  const watch = manualWatch();
  let woke = false;
  const p = waitForDrop(['/a', '/b'], 10_000, { watch }).then(() => (woke = true));
  assert.equal(watch.count(), 2, 'one watcher per folder');
  watch.fire();
  await p;
  assert.equal(woke, true);
  assert.equal(watch.count(), 0, 'every watcher is closed');

  const ac = new AbortController();
  const q = waitForDrop('/a', 10_000, { watch, signal: ac.signal });
  ac.abort();
  await q;
  assert.equal(watch.count(), 0);
});

// --- startup hygiene ------------------------------------------------------------------------------

test('startup hygiene empties inbox/ like reports/', (t) => {
  const repo = mkdtempSync(join(tmpdir(), 'pir-hygiene-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const control = fileControl(repo, 'plan');
  mkdirSync(inboxDirOf(control.dir), { recursive: true });
  writeFileSync(join(inboxDirOf(control.dir), '1.json'), JSON.stringify({ to: 'old-worker', kind: 'message', text: 'stale' }));
  const { halted, cleared } = startupControlHygiene(control);
  assert.equal(halted, false);
  assert.ok(cleared.includes('inbox/'));
  assert.deepEqual(readdirSync(inboxDirOf(control.dir)), []);
  assert.deepEqual(clearTransientFeeds(control.dir).cleared, ['inbox/'], 'no reports/ folder, only inbox/');
});
