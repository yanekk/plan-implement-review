// The person's `!` through the forwarder (bang-commands T03, DESIGN §2.2–§2.4, §3.3). The forwarder is
// tested against a fake platform and a fake `startShell` for its rules, against real `sh` processes for
// the records, the rename and the restart reap, against the three hosts' platforms for `cwdOf` and `log`,
// and end to end through the conversation rig's `bang` scenario: the real SDK against the fake `claude`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn as nodeSpawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createShellTable, cutOffMessage, dropPersonInput, reapPersonShells, shellsDirOf, startPersonInbox,
} from './person-inbox.mjs';
import { bangMessage, LOG_OUTPUT_CAP } from '../core/bang.mjs';
import { createPlatform } from './platform.mjs';
import { createSessionHolder } from './held-session.mjs';
import { withAgent } from './coordinator-agent.mjs';
import { startWorker } from './worker-proc.mjs';
import { startTimeOf } from './identity.mjs';
import { fakeClaudeSpawner, turn } from './fake/claude-stream.mjs';
import { RIG_BANG_REPLY, startRig } from './conversation-rig.mjs';
import { scratchHome } from './conversation-rig-helpers.mjs';

async function waitFor(pred, what, ms = 8000) {
  const start = Date.now();
  for (;;) {
    const v = pred();
    if (v) return v;
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 15));
  }
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// A watch that never fires: every test drives drain() itself.
function quietWatch() {
  return () => {
    const w = new EventEmitter();
    w.close = () => {};
    return w;
  };
}

// fakePlatform() → the forwarder's platform for one live session `W1`, keeping what it was asked.
function fakePlatform({ cwd = tmpdir() } = {}) {
  const logs = [];
  const sent = [];
  const notes = [];
  const live = new Set(['W1']);
  return {
    logs, sent, notes, live,
    logPathOf: (id) => (id === 'W1' || id === 'W2' ? `/fake/${id}.ndjson` : null),
    cwdOf: (id) => (live.has(id) ? cwd : null),
    log: (id, entry) => {
      const full = { t: Date.now(), to: id, ...entry };
      logs.push(full);
      return full;
    },
    send: (id, text, opts) => {
      sent.push({ id, text, opts });
      return { ok: live.has(id) };
    },
    note: (id, kind, fields) => {
      notes.push({ id, kind, ...fields });
      return { ok: true };
    },
    pending: () => [],
    interrupt: () => ({ ok: true }),
    answer: () => ({ ok: true }),
  };
}

// fakeStarter() → a startShell that runs nothing: the test plays the output and the end.
function fakeStarter() {
  const runs = [];
  const startShell = (o) => {
    const r = { o, stops: [] };
    r.handle = { id: o.id, pid: 4242, stop: (reason = 'person') => r.stops.push(reason) };
    runs.push(r);
    return r.handle;
  };
  return { runs, startShell };
}

function setup(t, { platform = fakePlatform(), startShell, shells = createShellTable(), controlDir } = {}) {
  const dir = controlDir ?? join(mkdtempSync(join(tmpdir(), 'pir-bang-')), 'control');
  const fake = startShell ? null : fakeStarter();
  const runLog = [];
  const inbox = startPersonInbox({
    controlDir: dir, platform, watch: quietWatch(), log: (l) => runLog.push(l), shells, shellsDir: shellsDirOf(dir),
    startShell: startShell ?? fake.startShell, partialLineMs: 30,
  });
  t.after(() => {
    inbox.stopAll('session-closed');
    inbox.stop();
  });
  const drop = (input) => {
    assert.deepEqual(dropPersonInput(dir, { to: 'W1', ...input }, { coordinatorAlive: true }), { ok: true });
    return inbox.drain();
  };
  return { dir, platform, inbox, drop, runs: fake?.runs, runLog, shells };
}

const shellEntries = (platform) => platform.logs.filter((e) => e.dir === 'shell');

// ---- The rules, on a fake platform and a fake runner. ----

test('a shell drop logs start, output and end in order, then sends the agent the T02 message from the person', (t) => {
  const { drop, runs, platform } = setup(t);
  const [o] = drop({ kind: 'shell', command: 'printf hi' });
  assert.equal(o.outcome, 'delivered');
  assert.equal(runs.length, 1);
  const { o: opts } = runs[0];
  assert.equal(opts.command, 'printf hi');
  assert.equal(opts.cwd, tmpdir());
  assert.match(opts.id, /^sh-\d+-[0-9a-z]{4}$/);
  assert.equal(opts.recordPath.endsWith(join('shells', 'W1.json')), true, 'the record is keyed by session id');

  opts.onOutput('hi\n');
  opts.onEnd({ code: 0, signal: null, stopped: null, ms: 6000 });

  const kinds = shellEntries(platform).map((e) => e.kind);
  assert.deepEqual(kinds, ['start', 'output', 'end']);
  const [start, out, end] = shellEntries(platform);
  assert.deepEqual([start.id, start.command, start.cwd], [opts.id, 'printf hi', tmpdir()]);
  assert.equal(out.text, 'hi\n');
  assert.deepEqual({ ...end, t: undefined, to: undefined }, { t: undefined, to: undefined, dir: 'shell', kind: 'end', id: opts.id, code: 0, signal: null, stopped: null, ms: 6000, sent: 'message' });

  assert.equal(platform.sent.length, 1);
  const [msg] = platform.sent;
  assert.equal(msg.text, bangMessage({ command: 'printf hi', output: 'hi\n', code: 0, signal: null, stopped: null, ms: 6000 }));
  assert.equal(msg.text, '[pir] The person ran a command in your working folder:\n$ printf hi\nexit 0 · 6s\nhi');
  assert.deepEqual(msg.opts, { from: 'person', shell: opts.id });
});

test('a drop carrying requestId is forwarded the same way, the id on its start entry and its record', (t) => {
  const { drop, runs, platform } = setup(t);
  drop({ kind: 'shell', command: 'gcloud auth login', requestId: 'req-1' });
  assert.equal(runs[0].o.requestId, 'req-1');
  assert.equal(shellEntries(platform)[0].requestId, 'req-1');
  runs[0].o.onEnd({ code: 0, signal: null, stopped: null, ms: 10 });
  assert.equal(platform.sent.length, 1, 'T05 turns this end into the answer; here it is a message');
});

test('a second command while one runs is refused busy, in a note, and nothing starts', (t) => {
  const { drop, runs, platform } = setup(t);
  drop({ kind: 'shell', command: 'sleep 30' });
  const [o] = drop({ kind: 'shell', command: 'ls' });
  assert.deepEqual([o.outcome, o.reason], ['refused', 'busy']);
  assert.equal(runs.length, 1);
  assert.deepEqual(platform.notes, [{ id: 'W1', kind: 'shell-refused', command: 'ls', reason: 'busy' }]);
});

test('a command for a session that is not live is refused no-session; an unknown id is undelivered', (t) => {
  const { drop, runs, platform } = setup(t);
  platform.live.delete('W1');
  const [o] = drop({ kind: 'shell', command: 'ls' });
  assert.deepEqual([o.outcome, o.reason], ['refused', 'no-session']);
  assert.deepEqual(platform.notes, [{ id: 'W1', kind: 'shell-refused', command: 'ls', reason: 'no-session' }]);
  const [u] = drop({ kind: 'shell', command: 'ls', to: 'nobody' });
  assert.equal(u.outcome, 'undelivered');
  assert.equal(runs.length, 0);
});

test('shell-stop stops the running command as the person; with none it is a no-op', (t) => {
  const { drop, runs, platform } = setup(t);
  const [none] = drop({ kind: 'shell-stop' });
  assert.equal(none.outcome, 'ignored');
  drop({ kind: 'shell', command: 'sleep 30' });
  const [o] = drop({ kind: 'shell-stop' });
  assert.equal(o.outcome, 'delivered');
  assert.deepEqual(runs[0].stops, ['person']);
  runs[0].o.onEnd({ code: null, signal: 'SIGHUP', stopped: 'person', ms: 1200 });
  const end = shellEntries(platform).at(-1);
  assert.deepEqual([end.stopped, end.sent], ['person', 'message']);
  assert.match(platform.sent[0].text, /\nstopped by the person · 1s\n\(no output\)$/);
  // The session is free again.
  drop({ kind: 'shell', command: 'ls' });
  assert.equal(runs.length, 2);
});

test('output past 1 MB logs one clipped marker; the agent gets the tail and the whole cut counted', (t) => {
  const { drop, runs, platform } = setup(t);
  drop({ kind: 'shell', command: 'yes' });
  const line = 'y'.repeat(99) + '\n'; // 100 bytes
  const chunk = line.repeat(80); // 8000 bytes
  const chunks = 200; // 1.6 MB
  for (let i = 0; i < chunks; i++) runs[0].o.onOutput(chunk);
  runs[0].o.onOutput('last line\n');
  runs[0].o.onEnd({ code: 0, signal: null, stopped: null, ms: 2000 });
  const outs = shellEntries(platform).filter((e) => e.kind === 'output');
  const clipped = outs.filter((e) => e.clipped);
  assert.equal(clipped.length, 1);
  assert.equal(outs.at(-1).clipped, true, 'nothing is logged after the marker');
  const logged = outs.reduce((n, e) => n + Buffer.byteLength(e.text), 0);
  assert.equal(logged, LOG_OUTPUT_CAP);
  const total = chunks * chunk.length + 'last line\n'.length;
  const text = platform.sent[0].text;
  const kept = 30000;
  // The trailing newline is not part of what the command said, so it is not counted as cut.
  assert.match(text, new RegExp(`\\(output cut: the first ${total - 1 - kept} characters are not shown\\)`));
  assert.ok(text.endsWith('\nlast line'), 'the tail is kept');
  assert.equal(text.split('\n').slice(4).join('\n').length, kept);
});

test('output is cleaned per completed line, so a split escape or \\r line comes out plain; a waiting prompt still shows', async (t) => {
  const { drop, runs, platform } = setup(t);
  drop({ kind: 'shell', command: 'build' });
  const whole = '\x1b[32mok\x1b[0m 3 passed\nfetch  10%\rfetch  50%\rfetch 100%\ndone\n';
  for (const c of whole) runs[0].o.onOutput(c);
  const text = () => shellEntries(platform).filter((e) => e.kind === 'output').map((e) => e.text).join('');
  assert.equal(text(), 'ok 3 passed\nfetch 100%\ndone\n');
  runs[0].o.onOutput('Password: ');
  await waitFor(() => text().endsWith('Password: '), 'the unfinished line to show');
});

test("stopAll('session-closed') stops the command, closes its block now and sends nothing", (t) => {
  const { drop, runs, platform, inbox } = setup(t);
  drop({ kind: 'shell', command: 'tail -f x' });
  runs[0].o.onOutput('a\n');
  inbox.stopAll('session-closed', 'W1');
  assert.deepEqual(runs[0].stops, ['session-closed']);
  const end = shellEntries(platform).at(-1);
  assert.deepEqual([end.kind, end.stopped, end.sent, end.code, end.signal], ['end', 'session-closed', 'none', null, null]);
  assert.equal(platform.sent.length, 0);
  assert.equal(inbox.running('W1'), null);
  // The shell's own end, arriving later, is not logged a second time.
  runs[0].o.onEnd({ code: null, signal: 'SIGHUP', stopped: 'session-closed', ms: 5 });
  assert.equal(shellEntries(platform).filter((e) => e.kind === 'end').length, 1);
});

test('stopAll for one session leaves another session\'s command running; with no session named it stops all', (t) => {
  const platform = fakePlatform();
  platform.live.add('W2');
  const { drop, runs, inbox } = setup(t, { platform });
  drop({ kind: 'shell', command: 'sleep 30' });
  drop({ kind: 'shell', command: 'sleep 30', to: 'W2' });
  inbox.stopAll('session-closed', 'W1');
  assert.equal(inbox.running('W1'), null);
  assert.ok(inbox.running('W2'));
  inbox.stopAll('session-closed');
  assert.equal(inbox.running('W2'), null);
  assert.deepEqual(runs.map((r) => r.stops), [['session-closed'], ['session-closed']]);
});

test('a command whose session ended before it did is sent undelivered, and its end says so', (t) => {
  const { drop, runs, platform } = setup(t);
  drop({ kind: 'shell', command: 'sleep 1' });
  platform.live.delete('W1');
  runs[0].o.onEnd({ code: 0, signal: null, stopped: null, ms: 1000 });
  assert.equal(shellEntries(platform).at(-1).sent, 'undelivered');
});

// ---- Real processes: the record, the rename, the restart reap. ----

test('stopAll keeps the record of a command that outlives its stop, so a host that exits first leaves it for the reap', async (t) => {
  const dir = join(mkdtempSync(join(tmpdir(), 'pir-bang-keep-')), 'control');
  t.after(() => rmSync(join(dir, '..'), { recursive: true, force: true }));
  const platform = fakePlatform();
  const inbox = startPersonInbox({ controlDir: dir, platform, watch: quietWatch(), shellsDir: shellsDirOf(dir), env: { ...process.env, SHELL: '/bin/sh' } });
  t.after(() => inbox.stop());
  // Ignored signals are inherited, so the sleep ignores HUP and TERM as its shell does.
  dropPersonInput(dir, { to: 'W1', kind: 'shell', command: "trap '' HUP TERM; echo ready; sleep 30" }, { coordinatorAlive: true });
  inbox.drain();
  const record = join(shellsDirOf(dir), 'W1.json');
  await waitFor(() => shellEntries(platform).some((e) => e.kind === 'output'), 'the trap to be set');
  const { pid } = JSON.parse(readFileSync(record, 'utf8'));
  inbox.stopAll('session-closed');
  assert.equal(shellEntries(platform).filter((e) => e.kind === 'end').length, 1, 'the block is closed at once');
  assert.equal(inbox.running('W1'), null);
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(alive(pid), 'the command ignored its stop');
  assert.ok(existsSync(record), 'its record stays while it runs');
  // A host start now finds the record and kills the command.
  const shells = createShellTable();
  const reaped = reapPersonShells({ controlDir: dir, shells, log: () => {} });
  assert.deepEqual(reaped.map((r) => r.killed), [true]);
  await waitFor(() => !alive(pid), 'the reap to kill it');
});

test('the reap of a block already closed appends no second end and tells nobody', (t) => {
  const controlDir = mkdtempSync(join(tmpdir(), 'pir-bang-closed-'));
  t.after(() => rmSync(controlDir, { recursive: true, force: true }));
  const l = leftover(controlDir);
  writeFileSync(l.logPath, readFileSync(l.logPath, 'utf8') + JSON.stringify({ t: 2200, dir: 'shell', kind: 'end', id: l.id, code: null, signal: null, stopped: 'session-closed', ms: 200, sent: 'none' }) + '\n');
  const shells = createShellTable();
  reapPersonShells({ controlDir, shells, now: () => 5000 });
  const ends = readFileSync(l.logPath, 'utf8').trim().split('\n').map((x) => JSON.parse(x)).filter((e) => e.kind === 'end');
  assert.deepEqual(ends.map((e) => e.stopped), ['session-closed']);
  assert.equal(shells.cutOff.size, 0);
});

test('a real command: its record exists while it runs and is gone after; the agent gets its output', async (t) => {
  const dir = join(mkdtempSync(join(tmpdir(), 'pir-bang-real-')), 'control');
  t.after(() => rmSync(join(dir, '..'), { recursive: true, force: true }));
  const platform = fakePlatform();
  const inbox = startPersonInbox({ controlDir: dir, platform, watch: quietWatch(), shellsDir: shellsDirOf(dir) });
  t.after(() => inbox.stop());
  dropPersonInput(dir, { to: 'W1', kind: 'shell', command: 'printf "hi\\n"; sleep 0.3' }, { coordinatorAlive: true });
  inbox.drain();
  const record = join(shellsDirOf(dir), 'W1.json');
  await waitFor(() => existsSync(record), 'the record');
  const rec = JSON.parse(readFileSync(record, 'utf8'));
  assert.equal(rec.to, 'W1');
  assert.equal(rec.command, 'printf "hi\\n"; sleep 0.3');
  await waitFor(() => platform.sent.length === 1, 'the result message');
  assert.equal(existsSync(record), false);
  assert.match(platform.sent[0].text, /\nexit 0 · \d+s\nhi$/);
});

test('a command running across a control-folder rename keeps its busy check and stop, and its record goes from the moved folder', async (t) => {
  const base = mkdtempSync(join(tmpdir(), 'pir-bang-move-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const from = join(base, 'plans', 'p-1', '.parallel', 'plan');
  const to = join(base, 'plans', 'demo', '.parallel', 'plan');
  mkdirSync(from, { recursive: true });
  const platform = fakePlatform();
  const shells = createShellTable();
  const startOn = (controlDir) => startPersonInbox({ controlDir, platform, watch: quietWatch(), shells, shellsDir: shellsDirOf(controlDir) });
  let inbox = startOn(from);
  t.after(() => {
    inbox.stopAll('session-closed');
    inbox.stop();
  });
  dropPersonInput(from, { to: 'W1', kind: 'shell', command: 'sleep 30' }, { coordinatorAlive: true });
  inbox.drain();
  await waitFor(() => existsSync(join(shellsDirOf(from), 'W1.json')), 'the record');
  const pid = JSON.parse(readFileSync(join(shellsDirOf(from), 'W1.json'), 'utf8')).pid;

  // The rename, as plan-run.mjs and single-run.mjs do it: stop the forwarder, move, start it again.
  inbox.stop();
  mkdirSync(join(base, 'plans', 'demo', '.parallel'), { recursive: true });
  renameSync(from, to);
  inbox = startOn(to);
  assert.ok(existsSync(join(shellsDirOf(to), 'W1.json')), 'the record moved with the folder');

  dropPersonInput(to, { to: 'W1', kind: 'shell', command: 'ls' }, { coordinatorAlive: true });
  const [busy] = inbox.drain();
  assert.deepEqual([busy.outcome, busy.reason], ['refused', 'busy']);
  dropPersonInput(to, { to: 'W1', kind: 'shell-stop' }, { coordinatorAlive: true });
  const [stopped] = inbox.drain();
  assert.equal(stopped.outcome, 'delivered');
  await waitFor(() => platform.logs.some((e) => e.kind === 'end'), 'the end');
  assert.equal(platform.logs.find((e) => e.kind === 'end').stopped, 'person');
  assert.equal(existsSync(join(shellsDirOf(to), 'W1.json')), false, 'the record is deleted in the moved folder');
  await waitFor(() => !alive(pid), 'the sleep to die');
});

// A dead host's leftover: a live `sleep` group, its record, and the start entry in the session's log.
function leftover(controlDir, { to = 'S1', id = 'sh-1-abcd', command = 'tail -f app.log' } = {}) {
  const child = nodeSpawn('/bin/sh', ['-c', 'sleep 30'], { detached: true, stdio: 'ignore' });
  child.unref();
  mkdirSync(shellsDirOf(controlDir), { recursive: true });
  writeFileSync(join(shellsDirOf(controlDir), `${to}.json`), JSON.stringify({ id, to, pid: child.pid, startTime: startTimeOf(child.pid), command }));
  mkdirSync(join(controlDir, 'conversations'), { recursive: true });
  const logPath = join(controlDir, 'conversations', 'T01-implement-1.ndjson');
  writeFileSync(logPath, [
    JSON.stringify({ t: 1000, dir: 'in', event: { type: 'system', subtype: 'init', session_id: to } }),
    JSON.stringify({ t: 2000, dir: 'shell', kind: 'start', id, command, cwd: '/x' }),
    JSON.stringify({ t: 2100, dir: 'shell', kind: 'output', id, text: 'line\n' }),
  ].join('\n') + '\n');
  return { pid: child.pid, logPath, id, to, command };
}

test('a host start kills a leftover live group, deletes its record and closes its block as pir-restart', async (t) => {
  const controlDir = mkdtempSync(join(tmpdir(), 'pir-bang-reap-'));
  t.after(() => rmSync(controlDir, { recursive: true, force: true }));
  const l = leftover(controlDir);
  assert.ok(alive(l.pid));
  const shells = createShellTable();
  const reaped = reapPersonShells({ controlDir, shells, now: () => 5000 });
  assert.deepEqual(reaped.map((r) => [r.id, r.to, r.killed]), [[l.id, l.to, true]]);
  await waitFor(() => !alive(l.pid), 'the leftover sleep to die');
  assert.deepEqual(readdirSync(shellsDirOf(controlDir)), []);
  const last = JSON.parse(readFileSync(l.logPath, 'utf8').trim().split('\n').at(-1));
  assert.deepEqual(last, { t: 5000, dir: 'shell', kind: 'end', id: l.id, code: null, signal: null, stopped: 'pir-restart', sent: 'none', ms: 3000 });
  assert.equal(shells.cutOff.get(l.to), l.command);
});

test('a reaped session, once live again in the new host, is told its command was cut off', (t) => {
  const controlDir = mkdtempSync(join(tmpdir(), 'pir-bang-cut-'));
  t.after(() => rmSync(controlDir, { recursive: true, force: true }));
  const shells = createShellTable();
  shells.cutOff.set('W1', 'tail -f app.log');
  const platform = fakePlatform();
  platform.live.delete('W1');
  const inbox = startPersonInbox({ controlDir, platform, watch: quietWatch(), shells });
  t.after(() => inbox.stop());
  inbox.drain();
  assert.equal(platform.sent.length, 0, 'not live yet: nothing sent');
  platform.live.add('W1');
  inbox.drain();
  assert.deepEqual(platform.sent.map((s) => [s.id, s.text]), [['W1', cutOffMessage('tail -f app.log')]]);
  assert.equal(platform.sent[0].text, '[pir] A command the person ran was cut off when pir restarted: $ tail -f app.log');
  inbox.drain();
  assert.equal(platform.sent.length, 1, 'told once');
});

// ---- The three hosts' platforms: cwdOf and log. ----

const scratch = (t, prefix) => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return d;
};
const readLog = (p) => readFileSync(p, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test("the build platform's cwdOf is the worker's folder and log lands in its ndjson; a dead worker gives null", async (t) => {
  const dir = scratch(t, 'pir-bang-plat-');
  const controlDir = join(dir, 'control');
  const script = join(dir, 'script.json');
  writeFileSync(script, JSON.stringify([{ await: 'user' }, ...turn('ok')]));
  const exits = [];
  const platform = createPlatform({
    controlDir, transport: { drain: () => [] }, claudePath: '/nonexistent/claude',
    startWorker: (o) => startWorker({ ...o, spawnProcess: fakeClaudeSpawner({ script, received: join(dir, 'r.ndjson') }) }),
    onWorkerExit: (id) => exits.push(id),
  });
  const wt = join(dir, 'wt');
  mkdirSync(wt);
  const id = platform.spawn({ cwd: wt, name: 'r / p / T01 / s / implement', phase: 'implement' });
  t.after(async () => {
    platform.close(id, { immediate: true });
    await waitFor(() => platform.list().length === 0, 'the worker to exit');
  });
  assert.equal(platform.cwdOf(id), wt);
  assert.equal(platform.cwdOf('nobody'), null);
  const e = platform.log(id, { dir: 'shell', kind: 'start', id: 'sh-1-aaaa', command: 'ls', cwd: wt });
  assert.ok(Number.isFinite(e.t));
  assert.ok(readLog(platform.logPathOf(id)).some((x) => x.dir === 'shell' && x.id === 'sh-1-aaaa'));
  assert.equal(platform.log('nobody', { dir: 'shell' }), null);
  platform.close(id, { immediate: true });
  await waitFor(() => platform.list().length === 0, 'the worker to exit');
  assert.equal(platform.cwdOf(id), null, 'a dead worker has no folder to run in');
  assert.deepEqual(exits, [id], 'the host hears the exit, to kill its command');
  platform.log(id, { dir: 'shell', kind: 'end', id: 'sh-1-aaaa' });
  assert.ok(readLog(platform.logPathOf(id)).some((x) => x.kind === 'end' && x.id === 'sh-1-aaaa'), 'an end after the exit still closes the block');
});

test("the held session's cwdOf is the run's worktree while live; log lands in its ndjson, by path once closed", async (t) => {
  const dir = scratch(t, 'pir-bang-held-');
  let controlDir = join(dir, 'control');
  const wt = join(dir, 'wt');
  mkdirSync(wt);
  const script = join(dir, 'script.json');
  writeFileSync(script, JSON.stringify([{ await: 'user' }, ...turn('ok')]));
  const exits = [];
  const holder = createSessionHolder({
    controlDir: () => controlDir, cwd: () => wt, taskLabel: 'plan', roleOf: () => 'planner', nameOf: () => 'planner', instructionOf: () => 'go',
    remote: false, claudePath: '/nonexistent/claude',
    startWorker: (o) => startWorker({ ...o, spawnProcess: fakeClaudeSpawner({ script, received: join(dir, 'r.ndjson') }) }),
    onSessionExit: (id) => exits.push(id),
  });
  const rec = holder.spawn('plan');
  t.after(() => holder.closeCurrent({ graceMs: 0, killMs: 500 }));
  assert.equal(holder.platform.cwdOf(rec.id), wt);
  holder.platform.log(rec.id, { dir: 'shell', kind: 'start', id: 'sh-2-bbbb', command: 'ls', cwd: wt });
  assert.ok(readLog(rec.logPath).some((x) => x.id === 'sh-2-bbbb'));
  await holder.closeCurrent({ graceMs: 0, killMs: 500 });
  assert.equal(holder.platform.cwdOf(rec.id), null);
  assert.deepEqual(exits, [rec.id]);
  // The rename moves the folder after the close; the closed session's log is written where it is now.
  const moved = join(dir, 'moved');
  renameSync(controlDir, moved);
  holder.controlMoved(controlDir, moved);
  controlDir = moved;
  const e = holder.platform.log(rec.id, { dir: 'shell', kind: 'end', id: 'sh-2-bbbb' });
  assert.ok(Number.isFinite(e.t));
  assert.ok(readLog(rec.logPath).some((x) => x.kind === 'end' && x.id === 'sh-2-bbbb'));
  assert.ok(rec.logPath.startsWith(moved));
  assert.equal(holder.platform.log('nobody', {}), null);
});

test("withAgent's cwdOf is the agent's worktree while it is alive and log goes to its session; others pass through", () => {
  const logged = [];
  let up = true;
  const agent = { id: 'A1', alive: () => up, logPath: '/a.ndjson', session: { cwd: '/feature', logEntry: (e) => (logged.push(e), { t: 1, ...e }) } };
  const base = { cwdOf: (id) => (id === 'W1' ? '/wt' : null), log: (id, e) => (id === 'W1' ? { t: 2, ...e } : null), logPathOf: () => null };
  const p = withAgent(base, () => agent);
  assert.equal(p.cwdOf('A1'), '/feature');
  assert.equal(p.cwdOf('W1'), '/wt');
  assert.deepEqual(p.log('A1', { dir: 'shell' }), { t: 1, dir: 'shell' });
  assert.deepEqual(p.log('W1', { dir: 'shell' }), { t: 2, dir: 'shell' });
  assert.equal(logged.length, 1);
  up = false;
  assert.equal(p.cwdOf('A1'), null, 'an agent restarting has no folder for a command');
});

// ---- End to end: the rig's bang scenario, the real SDK and the fake `claude`. ----

const receivedUsers = (rig) =>
  (existsSync(rig.received) ? readFileSync(rig.received, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
    .filter((l) => l.line)
    .map((l) => JSON.parse(l.line))
    .filter((m) => m.type === 'user');
const userText = (m) => (typeof m.message.content === 'string' ? m.message.content : m.message.content.map((b) => b.text ?? '').join(''));
const rigLog = (rig) => readLog(rig.logPath);

test('rig bang: a hand-written shell drop of printf hi reaches the log and the agent; shell-stop on sleep 30 ends it stopped', async (t) => {
  const env = scratchHome(t);
  const rig = startRig({ env, scenario: 'bang', paceMs: 0 });
  t.after(() => rig.stop());
  const drop = (input) => assert.deepEqual(dropPersonInput(rig.controlDir, { to: rig.workerId, ...input }, { coordinatorAlive: true }), { ok: true });
  await waitFor(() => rig.platform.list()[0]?.state === 'idle', 'the opening turn to end');

  drop({ kind: 'shell', command: 'printf hi' });
  const end = await waitFor(() => rigLog(rig).find((e) => e.dir === 'shell' && e.kind === 'end'), 'the end entry');
  const shell = rigLog(rig).filter((e) => e.dir === 'shell');
  assert.deepEqual(shell.map((e) => e.kind), ['start', 'output', 'end']);
  assert.deepEqual([shell[0].command, shell[0].cwd, shell[1].text], ['printf hi', rig.repoRoot, 'hi']);
  assert.deepEqual([end.code, end.signal, end.stopped, end.sent], [0, null, null, 'message']);
  const out = rigLog(rig).find((e) => e.dir === 'out' && e.shell === end.id);
  assert.equal(out.from, 'person');
  const expected = bangMessage({ command: 'printf hi', output: 'hi', code: 0, signal: null, stopped: null, ms: end.ms });
  assert.equal(out.text, expected);
  const users = await waitFor(() => (receivedUsers(rig).length >= 2 ? receivedUsers(rig) : null), 'the agent to receive the message');
  assert.deepEqual(users.slice(1).map(userText), [expected], 'exactly one user message for the command');
  await waitFor(() => rigLog(rig).some((e) => e.dir === 'in' && e.event?.type === 'result' && e.event.result === RIG_BANG_REPLY), 'the reply');

  drop({ kind: 'shell', command: 'sleep 30' });
  const record = join(shellsDirOf(rig.controlDir), `${rig.workerId}.json`);
  await waitFor(() => existsSync(record), 'the record');
  const pid = JSON.parse(readFileSync(record, 'utf8')).pid;
  drop({ kind: 'shell-stop' });
  const end2 = await waitFor(() => rigLog(rig).filter((e) => e.dir === 'shell' && e.kind === 'end')[1], 'the second end');
  assert.deepEqual([end2.stopped, end2.sent], ['person', 'message']);
  assert.equal(existsSync(record), false);
  await waitFor(() => !alive(pid), 'the sleep to die');
  const msgs = rigLog(rig).filter((e) => e.dir === 'out' && e.shell === end2.id);
  assert.equal(msgs.length, 1);
  assert.match(msgs[0].text, /^\[pir\] The person ran a command in your working folder:\n\$ sleep 30\nstopped by the person · \d+s\n\(no output\)$/);
});
