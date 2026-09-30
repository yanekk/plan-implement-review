// single-runs T03 — the session holder shared by the planning program and the single program, run
// against the fake Claude behind a shim. No real `claude` is ever started.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeClaudeShim } from './fake/claude-shim.mjs';
import { canUseTool, initEvent, toolUse, turn } from './fake/claude-stream.mjs';
import { startPersonInbox, dropPersonInput } from './person-inbox.mjs';
import { STOP_CLOSE, createSessionHolder, findSessionLog, nextSessionLogPath, readLogEntries } from './held-session.mjs';

const OPENING = { build: 'Build the thing. Reports folder: /nowhere.', review: 'Review the thing. Reports folder: /nowhere.' };
const ROLE = { build: 'builder', review: 'reviewer' };

async function waitFor(fn, what, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

// A scratch control folder and worktree folder, the fake `claude` behind a shim running `script` for any
// opening, and a holder on them. `more` overrides the holder's options.
function setup(t, script, more = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pir-held-session-'));
  const s = { dir, controlDir: join(dir, 'control'), worktree: join(dir, 'worktree'), lines: [], holders: [] };
  mkdirSync(s.controlDir);
  mkdirSync(s.worktree);
  const fakeDir = join(dir, 'fake');
  mkdirSync(fakeDir);
  const scriptsFile = join(fakeDir, 'scripts.json');
  writeFileSync(scriptsFile, JSON.stringify([{ match: '.', script }]));
  s.received = join(fakeDir, 'received.ndjson');
  s.shim = writeClaudeShim(join(dir, 'bin'), { scriptsFile, received: s.received });
  s.holder = (extra = {}) => {
    const h = createSessionHolder({
      controlDir: () => s.controlDir,
      cwd: () => s.worktree,
      taskLabel: 'single',
      roleOf: (step) => ROLE[step],
      nameOf: (step) => `repo / fix / single / ${ROLE[step]}`,
      instructionOf: (step) => OPENING[step],
      remote: true,
      claudePath: s.shim,
      log: (l) => s.lines.push(l),
      ...more,
      ...extra,
    });
    s.holders.push(h);
    return h;
  };
  // Nothing may outlive the test: every holder's session is closed before the folder goes.
  t.after(async () => {
    for (const h of s.holders) await h.closeCurrent(STOP_CLOSE);
    rmSync(dir, { recursive: true, force: true });
  });
  return s;
}

const workersOf = (s) => JSON.parse(readFileSync(join(s.controlDir, 'workers.json'), 'utf8'));
const notes = (log, kind) => log.filter((e) => e.dir === 'note' && e.kind === kind);
const pirMessages = (log) => log.filter((e) => e.dir === 'out' && e.from === 'pir' && e.kind === 'message');
const results = (log) => log.filter((e) => e.dir === 'in' && e.event?.type === 'result');
const wire = (s) => readFileSync(s.received, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

const ONE_TURN = [{ await: 'user' }, ...turn('Done.')];

test('spawn: workers.json carries the task label, role and worktree; the instruction is sent; Remote Control goes on', async (t) => {
  const s = setup(t, ONE_TURN);
  const h = s.holder();
  assert.equal(h.current(), null);
  assert.equal(h.activity(), 'none');

  const rec = h.spawn('build');
  assert.equal(h.current(), rec);
  assert.deepEqual(h.sessions, [rec]);
  assert.equal(rec.step, 'build');
  assert.equal(rec.n, 1);
  assert.equal(rec.logPath, join(s.controlDir, 'conversations', 'build-1.ndjson'));
  assert.equal(rec.live, true);
  assert.equal(typeof h.since.build, 'number');

  const workers = workersOf(s);
  assert.equal(workers.length, 1);
  assert.deepEqual({ ...workers[0], pid: null, startTime: null }, { id: rec.id, task: 'single', role: 'builder', pid: null, startTime: null, cwd: s.worktree });
  assert.equal(workers[0].pid, rec.worker.pid);

  await waitFor(() => results(readLogEntries(rec.logPath)).length === 1, 'the first turn to end');
  const log = readLogEntries(rec.logPath);
  assert.deepEqual(pirMessages(log).map((e) => e.text), [OPENING.build]);
  await waitFor(() => notes(readLogEntries(rec.logPath), 'remote-control').some((n) => n.on), 'Remote Control on');
  assert.equal(h.activity(), 'idle');
  assert.deepEqual(h.views().map((v) => [v.id, v.step, v.n, v.cwd, v.live, v.activity.state]), [[rec.id, 'build', 1, s.worktree, true, 'idle']]);

  // The session was started under the caller's name, in the caller's folder.
  const argv = wire(s).find((x) => x.argv).argv;
  assert.ok(argv.includes('repo / fix / single / builder'), argv.join(' '));
  assert.ok(s.lines.some((l) => l === `builder started: session ${rec.id}, log ${rec.logPath}`), s.lines.join('\n'));
});

test('spawn with remote off: no Remote Control request reaches the session', async (t) => {
  const s = setup(t, ONE_TURN, { remote: false });
  const h = s.holder();
  const rec = h.spawn('review');
  assert.equal(workersOf(s)[0].role, 'reviewer');
  assert.equal(rec.logPath, join(s.controlDir, 'conversations', 'review-1.ndjson'));
  await waitFor(() => results(readLogEntries(rec.logPath)).length === 1, 'the turn to end');
  await h.closeCurrent();
  assert.equal(notes(readLogEntries(rec.logPath), 'remote-control').length, 0);
  assert.doesNotMatch(readFileSync(s.received, 'utf8'), /remote_control/);
});

test('closeCurrent: the session is no longer live or current, and workers.json is rewritten empty', async (t) => {
  const s = setup(t, ONE_TURN);
  const h = s.holder();
  const rec = h.spawn('build');
  await waitFor(() => results(readLogEntries(rec.logPath)).length === 1, 'the turn to end');
  await h.closeCurrent();
  assert.equal(rec.live, false);
  assert.equal(h.current(), null);
  assert.equal(h.activity(rec), 'exited');
  assert.deepEqual(workersOf(s), []);
  assert.ok(notes(readLogEntries(rec.logPath), 'exited').length === 1);
  assert.ok(s.lines.includes(`builder closed: session ${rec.id}`));
  // Closing with nothing held is a no-op.
  await h.closeCurrent();
  assert.equal(h.platform.send(rec.id, 'too late').ok, false);
  assert.deepEqual(h.platform.pending(rec.id), []);
});

test('a session that exits by itself reads not live, workers.json is rewritten, and the waker is woken', async (t) => {
  const s = setup(t, [{ await: 'user' }, ...turn('Bye.'), { exit: 0 }]);
  const h = s.holder();
  const rec = h.spawn('build');
  await waitFor(() => !rec.live, 'the session to exit');
  assert.deepEqual(workersOf(s), []);
  assert.equal(h.activity(), 'exited');
  // The wake from the exit is still flagged: a wait armed now returns at once, not on its backstop.
  const t0 = Date.now();
  await h.waker.wait([], 10000, { unref: true });
  assert.ok(Date.now() - t0 < 5000, 'the wait returned on the flagged wake');
});

test('resume: load lists the earlier session with its log; spawn reopens it by id, appends after a `resumed` note, sends no instruction', async (t) => {
  // The fake takes the message a resumed session is sent as its resume prompt and carries on from the
  // first step it did not finish, so the script has no second `await`. The gate fails until the file is
  // there: the first session stops at it with an error result, and the resumed one runs it again.
  const gate = join(tmpdir(), `pir-held-session-gate-${process.pid}-${Date.now()}`);
  t.after(() => rmSync(gate, { force: true }));
  const s = setup(t, [{ await: 'user' }, ...turn('First turn.'), { sh: `test -f '${gate}'` }, ...turn('After the resume.')]);
  const first = s.holder();
  const rec = first.spawn('build');
  await waitFor(() => results(readLogEntries(rec.logPath)).length === 2, 'the first session to stop at the gate');
  await first.closeCurrent();
  const before = readLogEntries(rec.logPath).length;
  writeFileSync(gate, '');

  // A new program: it knows the session only from state.json's id list.
  const second = s.holder();
  second.load({ build: [rec.id], review: [] }, ['build', 'review']);
  assert.deepEqual(second.sessions.map((x) => [x.id, x.step, x.n, x.logPath, x.live, x.worker]), [[rec.id, 'build', 1, rec.logPath, false, null]]);
  assert.equal(second.platform.logPathOf(rec.id), rec.logPath);
  assert.deepEqual(second.views().map((v) => v.activity.state), ['exited']);

  const again = second.spawn('build', rec.id);
  assert.equal(again, second.sessions[0], 'taken up again in the same record');
  assert.equal(second.sessions.length, 1);
  assert.equal(again.logPath, rec.logPath);
  assert.equal(again.n, 1);
  assert.equal(again.live, true);
  assert.equal(workersOf(s)[0].id, rec.id);

  // The caller sends what a resumed session is told; the holder sent nothing.
  assert.equal(second.platform.send(rec.id, 'Carry on.', { from: 'pir' }).ok, true);
  await waitFor(() => results(readLogEntries(rec.logPath)).at(-1).event.result === 'After the resume.', 'the resumed turn to end');
  const log = readLogEntries(rec.logPath);
  const resumed = log.findIndex((e) => e.dir === 'note' && e.kind === 'resumed');
  assert.equal(resumed, before, 'appended to the same log, the note first');
  assert.equal(log[resumed].sessionId, rec.id);
  assert.deepEqual(pirMessages(log).map((e) => e.text), [OPENING.build, 'Carry on.']);
  assert.equal(existsSync(join(s.controlDir, 'conversations', 'build-2.ndjson')), false);
  const argvs = wire(s).filter((x) => x.argv).map((x) => x.argv.join(' '));
  assert.equal(argvs.length, 2);
  assert.match(argvs[1], new RegExp(`--resume[= ]${rec.id}`));
  assert.ok(s.lines.includes(`builder resumed: session ${rec.id}, log ${rec.logPath}`));
  // One log, two working segments: the time between the close and the resume is not counted.
  assert.equal(typeof second.workedMs('build'), 'number');
  assert.equal(second.workedMs('review'), null);
});

test('grants: a covered permission request is answered by pir; a question set is never answered by a grant', async (t) => {
  const file = '/tmp/pir-held-session-read';
  const questions = [{ question: 'Which one?', header: 'Pick', multiSelect: false, options: [{ label: 'A', description: 'a' }, { label: 'B', description: 'b' }] }];
  const s = setup(t, [
    { await: 'user' },
    { emit: initEvent() },
    { emit: toolUse('toolu_r1', 'Read', { file_path: file }) },
    { emit: canUseTool('r1', 'Read', { file_path: file }) },
    { await: 'control_response' },
    { resultFor: 'r1', allowed: 'the file' },
    { emit: toolUse('toolu_r2', 'Read', { file_path: '/tmp/other' }) },
    { emit: canUseTool('r2', 'Read', { file_path: '/tmp/other' }) },
    { await: 'control_response' },
    { resultFor: 'r2', allowed: 'the other file' },
    { emit: toolUse('toolu_q1', 'AskUserQuestion', { questions }) },
    { emit: canUseTool('q1', 'AskUserQuestion', { questions }, { requires_user_interaction: true }) },
    { await: 'control_response' },
    { resultFor: 'q1' },
    ...turn('Answered.').slice(1),
  ]);
  const h = s.holder();
  const inbox = startPersonInbox({ controlDir: s.controlDir, platform: h.platform, grants: h.grants, log: (l) => s.lines.push(l) });
  t.after(() => inbox.stop());
  const rec = h.spawn('build');
  // The session is still waiting for its process to start: the grants are in place before it asks.
  h.grants.add(rec.id, { rules: [{ toolName: 'Read', ruleContent: `/${file}` }] });
  h.grants.add(rec.id, { rules: [{ toolName: 'AskUserQuestion' }] });

  // r1 is covered: allowed by pir, noted, never pending for the person. r2 is not: it waits.
  const r2 = await waitFor(() => h.platform.pending(rec.id).find((p) => p.requestId === 'r2'), 'the uncovered request pending');
  assert.equal(r2.toolName, 'Read');
  let log = readLogEntries(rec.logPath);
  const reply = log.find((e) => e.dir === 'out' && e.kind === 'reply' && e.requestId === 'r1');
  assert.equal(reply.from, 'pir');
  assert.equal(reply.result.behavior, 'allow');
  assert.deepEqual(notes(log, 'delivered-by-grant').map((n) => [n.requestId, n.toolName]), [['r1', 'Read']]);
  assert.equal(h.activity(), 'permission');

  // The person allows r2 through the inbox, which forwards through the holder's platform.
  assert.deepEqual(dropPersonInput(s.controlDir, { to: rec.id, kind: 'permission', requestId: 'r2', decision: 'allow' }, { coordinatorAlive: true }), { ok: true });
  await waitFor(() => h.platform.pending(rec.id).some((p) => p.requestId === 'q1'), 'the question set pending');
  assert.equal(h.activity(), 'questions');
  // A bare AskUserQuestion grant is in the list and would match by tool name: the holder does not ask it.
  await new Promise((r) => setTimeout(r, 200));
  log = readLogEntries(rec.logPath);
  assert.equal(log.some((e) => e.dir === 'out' && e.kind === 'reply' && e.requestId === 'q1'), false, 'the question set is still the person\'s');
  assert.deepEqual(notes(log, 'delivered-by-grant').length, 1);

  assert.deepEqual(dropPersonInput(s.controlDir, { to: rec.id, kind: 'answers', requestId: 'q1', answers: { 'Which one?': 'A' } }, { coordinatorAlive: true }), { ok: true });
  await waitFor(() => results(readLogEntries(rec.logPath)).length === 1, 'the turn to end');
  assert.equal(readLogEntries(rec.logPath).find((e) => e.dir === 'out' && e.kind === 'reply' && e.requestId === 'q1').from, 'person');
});

test('platform: note and interrupt reach the live session; an unknown id is refused', async (t) => {
  const s = setup(t, ONE_TURN);
  const h = s.holder();
  const rec = h.spawn('build');
  assert.deepEqual(h.platform.note(rec.id, 'preface', { text: 'fyi' }), { ok: true });
  assert.deepEqual(h.platform.note('nobody', 'preface', {}), { ok: false });
  assert.deepEqual(h.platform.interrupt('nobody'), { ok: false });
  assert.deepEqual(h.platform.answer('nobody', 'r', {}), { ok: false });
  assert.equal(h.platform.logPathOf('nobody'), null);
  assert.deepEqual(h.platform.interrupt(rec.id, { from: 'person' }), { ok: true });
  await waitFor(() => notes(readLogEntries(rec.logPath), 'preface').length === 1, 'the note in the log');
});

test('controlMoved: log paths follow the folder and workers.json is written in the new one', async (t) => {
  const s = setup(t, ONE_TURN);
  const h = s.holder();
  const rec = h.spawn('build');
  await waitFor(() => results(readLogEntries(rec.logPath)).length === 1, 'the turn to end');
  await h.closeCurrent();
  const from = s.controlDir;
  const to = join(s.dir, 'renamed');
  renameSync(from, to);
  rmSync(join(to, 'workers.json'));
  s.controlDir = to;
  h.controlMoved(from, to);
  assert.equal(rec.logPath, join(to, 'conversations', 'build-1.ndjson'));
  assert.deepEqual(workersOf(s), []);
  // The next session is numbered from the moved folder and starts in it.
  const next = h.spawn('review');
  assert.equal(next.logPath, join(to, 'conversations', 'review-1.ndjson'));
  assert.deepEqual(workersOf(s).map((w) => w.role), ['reviewer']);
  assert.deepEqual(findSessionLog(to, 'build', rec.id), { logPath: rec.logPath, n: 1 });
});

test('env: null passes no environment; an object or a function is merged over process.env at each spawn', () => {
  const calls = [];
  const fakeWorker = () => ({ pid: null, onEvent() {}, onExit() {}, send: () => true, note() {}, remoteControl: async () => {}, entries: () => [], pending: () => [], close: async () => {} });
  const make = (env) =>
    createSessionHolder({
      controlDir: () => '/c', cwd: () => '/w', taskLabel: 'single', roleOf: (x) => x, nameOf: (x) => `name ${x}`, instructionOf: () => 'go', remote: false,
      claudePath: '/claude', uuid: () => 'id-1', startTimeOf: () => null, env,
      startWorker: (opts) => (calls.push(opts), fakeWorker()),
    });
  make(null).spawn('build');
  assert.deepEqual(calls[0], { cwd: '/w', sessionId: 'id-1', name: 'name build', logPath: '/c/conversations/build-1.ndjson', claudePath: '/claude' });
  make({ PIR_X: '1' }).spawn('build');
  assert.equal(calls[1].env.PIR_X, '1');
  assert.equal(calls[1].env.PATH, process.env.PATH, 'merged over process.env, not instead of it');
  let n = 0;
  const h = make(() => (++n === 1 ? { PIR_X: 'first' } : null));
  h.spawn('build');
  h.spawn('review');
  assert.equal(calls[2].env.PIR_X, 'first');
  assert.equal('env' in calls[3], false, 'a function returning null passes no environment');
});

test('nextSessionLogPath numbers {step}-{n}.ndjson per step prefix; findSessionLog reads only that step\'s logs', () => {
  const readdir = () => ['build-1.ndjson', 'build-3.ndjson', 'review-1.ndjson', 'rebuild-9.ndjson', 'build-x.ndjson', 'build-7.txt'];
  assert.equal(nextSessionLogPath('/c', 'build', { readdir }), '/c/conversations/build-4.ndjson');
  assert.equal(nextSessionLogPath('/c', 'review', { readdir }), '/c/conversations/review-2.ndjson');
  assert.equal(nextSessionLogPath('/c', 'plan', { readdir }), '/c/conversations/plan-1.ndjson');
  assert.equal(nextSessionLogPath('/c', 'build', { readdir: () => { throw new Error('none'); } }), '/c/conversations/build-1.ndjson');
  // A step name is matched literally, never as a pattern.
  assert.equal(nextSessionLogPath('/c', 'b.ild', { readdir }), '/c/conversations/b.ild-1.ndjson');

  const init = (id) => `${JSON.stringify({ dir: 'in', event: { type: 'system', subtype: 'init', session_id: id } })}\n`;
  const files = { 'build-1.ndjson': init('a'), 'build-3.ndjson': init('a'), 'review-1.ndjson': init('b'), 'rebuild-9.ndjson': init('a') };
  const readFile = (p) => files[p.split('/').at(-1)];
  assert.deepEqual(findSessionLog('/c', 'build', 'a', { readdir, readFile }), { logPath: '/c/conversations/build-3.ndjson', n: 3 });
  assert.deepEqual(findSessionLog('/c', 'review', 'b', { readdir, readFile }), { logPath: '/c/conversations/review-1.ndjson', n: 1 });
  assert.equal(findSessionLog('/c', 'review', 'a', { readdir, readFile }), null);
  assert.equal(findSessionLog('/c', 'build', 'a', { readdir: () => { throw new Error('none'); } }), null);
});

test('readLogEntries skips a torn line and reads a missing log as empty', () => {
  assert.deepEqual(readLogEntries('/x', { readFile: () => '{"t":1}\n\n{"t":2}\n{"t":' }), [{ t: 1 }, { t: 2 }]);
  assert.deepEqual(readLogEntries('/x', { readFile: () => { throw new Error('ENOENT'); } }), []);
});
