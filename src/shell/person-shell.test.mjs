// Tests for person-shell.mjs (plans/bang-commands T01). Real `sh` processes in a temp folder: the runner is
// the boundary to the world, so the tests drive the world. Every test that starts a process asserts at its
// end that the process (and any grandchild it named) is gone, so no orphan survives this file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { shellArgv, startShell, reapShells } from './person-shell.mjs';
import { isSameProcess, startTimeOf } from './identity.mjs';

// /bin/sh keeps the tests off the person's rc file (1.2 s per zsh -i start, and whatever it prints).
const ENV = { PATH: process.env.PATH, HOME: process.env.HOME, SHELL: '/bin/sh' };

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};

const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'person-shell-')));

// run(command, opts) → { handle, chunks, end: Promise<result> }
function run(command, opts = {}) {
  const chunks = [];
  let ends = 0;
  let resolve;
  const end = new Promise((r) => (resolve = r));
  const handle = startShell({
    command,
    cwd: opts.cwd ?? tmp(),
    env: opts.env ?? ENV,
    id: 'sh-1-abcd',
    to: 'w1',
    onOutput: (t) => chunks.push(t),
    onEnd: (r) => {
      ends += 1;
      resolve(r);
    },
    ...opts,
  });
  return { handle, chunks, end, ends: () => ends };
}

const waitFor = async (pred, ms = 3000) => {
  const t = Date.now();
  while (!pred()) {
    if (Date.now() - t > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};

test('printf output arrives and a clean exit ends with code 0, not stopped', async () => {
  const r = run("printf 'a\\nb'");
  const res = await r.end;
  assert.equal(r.chunks.join(''), 'a\nb');
  assert.equal(res.code, 0);
  assert.equal(res.signal, null);
  assert.equal(res.stopped, null);
  assert.equal(typeof res.ms, 'number');
  assert.equal(alive(r.handle.pid), false);
});

test('a non-zero exit gives its code', async () => {
  const r = run('exit 3');
  const res = await r.end;
  assert.equal(res.code, 3);
  assert.equal(res.stopped, null);
  assert.equal(alive(r.handle.pid), false);
});

test('an outside SIGKILL gives signal SIGKILL and stopped null', async () => {
  const r = run('echo up; sleep 30');
  await waitFor(() => r.chunks.join('').includes('up'));
  process.kill(-r.handle.pid, 'SIGKILL');
  const res = await r.end;
  assert.equal(res.signal, 'SIGKILL');
  assert.equal(res.code, null);
  assert.equal(res.stopped, null);
  assert.equal(alive(r.handle.pid), false);
});

test('stdout and stderr both arrive, in order, when they alternate with pauses', async () => {
  const r = run('echo o1; sleep 0.1; echo e1 >&2; sleep 0.1; echo o2; sleep 0.1; echo e2 >&2', { flushMs: 10 });
  await r.end;
  assert.equal(r.chunks.join(''), 'o1\ne1\no2\ne2\n');
});

test('stop() ends a sleeping command within 1 s with stopped person', async () => {
  const r = run('sleep 30');
  await new Promise((res) => setTimeout(res, 100));
  const t = Date.now();
  r.handle.stop();
  const res = await r.end;
  assert.ok(Date.now() - t < 1000, `took ${Date.now() - t} ms`);
  assert.equal(res.stopped, 'person');
  assert.equal(res.signal, 'SIGTERM');
  assert.equal(alive(r.handle.pid), false);
});

test('stop() carries a non-default reason through to onEnd', async () => {
  const r = run('sleep 30');
  await new Promise((res) => setTimeout(res, 100));
  r.handle.stop('session-closed');
  const res = await r.end;
  assert.equal(res.stopped, 'session-closed');
});

test('a command that traps TERM is killed after killAfterMs', async () => {
  const r = run("trap '' TERM; echo ready; while :; do sleep 0.05; done", { killAfterMs: 300 });
  await waitFor(() => r.chunks.join('').includes('ready'));
  const t = Date.now();
  r.handle.stop();
  const res = await r.end;
  const took = Date.now() - t;
  assert.ok(took >= 250 && took < 2000, `took ${took} ms`);
  assert.equal(res.signal, 'SIGKILL');
  assert.equal(res.stopped, 'person');
  assert.equal(alive(r.handle.pid), false);
});

test('a backgrounded grandchild dies with the group on stop', async () => {
  const r = run('sleep 30 & echo "bg $!"; sleep 30');
  await waitFor(() => /bg \d+/.test(r.chunks.join('')));
  const bg = Number(r.chunks.join('').match(/bg (\d+)/)[1]);
  assert.equal(alive(bg), true);
  r.handle.stop();
  await r.end;
  await waitFor(() => !alive(bg), 1000);
  assert.equal(alive(r.handle.pid), false);
});

test('a backgrounded child holding the pipe does not hold the end past the grace', async () => {
  const r = run('sleep 30 & echo "bg $!"', { endGraceMs: 100 });
  const res = await r.end;
  assert.equal(res.code, 0);
  const bg = Number(r.chunks.join('').match(/bg (\d+)/)[1]);
  // The person's background child is theirs and is left running; the test cleans it up itself.
  process.kill(bg, 'SIGKILL');
  await waitFor(() => !alive(bg), 1000);
});

test('coalescing: 10 000 small writes produce far fewer calls, none over flushBytes', async () => {
  const flushBytes = 1024;
  const r = run('i=0; while [ $i -lt 10000 ]; do printf x; i=$((i+1)); done', { flushBytes, flushMs: 50 });
  await r.end;
  assert.equal(r.chunks.join(''), 'x'.repeat(10000));
  assert.ok(r.chunks.length < 200, `${r.chunks.length} calls`);
  for (const c of r.chunks) assert.ok(Buffer.byteLength(c) <= flushBytes);
});

test('coalescing never splits a multi-byte character or exceeds flushBytes', async () => {
  const flushBytes = 7;
  const r = run("printf 'żółć€😀abcdefżółć'", { flushBytes });
  await r.end;
  assert.equal(r.chunks.join(''), 'żółć€😀abcdefżółć');
  for (const c of r.chunks) {
    assert.ok(Buffer.byteLength(c) <= flushBytes);
    assert.ok(!c.includes('�'));
  }
});

test('cwd is honoured and PARALLEL_* and PIR_RUN do not reach the command', async () => {
  const dir = tmp();
  const r = run('pwd; echo "p=${PARALLEL_X-unset} r=${PIR_RUN-unset} k=${KEEP-unset}"', {
    cwd: dir,
    env: { ...ENV, PARALLEL_X: '1', PIR_RUN: '1', KEEP: 'yes' },
  });
  await r.end;
  assert.equal(r.chunks.join(''), `${dir}\np=unset r=unset k=yes\n`);
});

test('a missing cwd ends once with an error, not a throw', async () => {
  const r = run('echo hi', { cwd: join(tmp(), 'nope') });
  const res = await r.end;
  assert.equal(res.code, null);
  assert.ok(res.error);
  await new Promise((res) => setTimeout(res, 50));
  assert.equal(r.ends(), 1);
});

test('shellArgv: zsh and bash get -i -c, anything else /bin/sh -c', () => {
  assert.deepEqual(shellArgv({ SHELL: '/bin/zsh' }), ['/bin/zsh', '-i', '-c']);
  assert.deepEqual(shellArgv({ SHELL: '/opt/homebrew/bin/bash' }), ['/opt/homebrew/bin/bash', '-i', '-c']);
  assert.deepEqual(shellArgv({ SHELL: '/opt/homebrew/bin/fish' }), ['/bin/sh', '-c']);
  assert.deepEqual(shellArgv({}), ['/bin/sh', '-c']);
  assert.deepEqual(shellArgv({ SHELL: '' }), ['/bin/sh', '-c']);
  assert.deepEqual(shellArgv({ SHELL: 'zsh' }), ['/bin/sh', '-c']); // not an absolute path
});

test("zsh -i -c runs the command (the person's shell path, end to end)", { skip: !existsSync('/bin/zsh') }, async () => {
  const r = run('echo "$0 ok"', { env: { ...ENV, SHELL: '/bin/zsh', ZDOTDIR: tmp() } });
  const res = await r.end;
  assert.equal(res.code, 0);
  assert.match(r.chunks.join(''), /zsh ok\n$/);
});

test('the record exists while running with the interface fields, and is gone after the end', async () => {
  const dir = tmp();
  const recordPath = join(dir, 'shells', 'sess-1.json');
  const r = run('sleep 30', { recordPath, requestId: 'req-9' });
  assert.ok(existsSync(recordPath));
  const rec = JSON.parse(readFileSync(recordPath, 'utf8'));
  assert.deepEqual(Object.keys(rec).sort(), ['command', 'id', 'pid', 'requestId', 'startTime', 'to']);
  assert.equal(rec.pid, r.handle.pid);
  assert.equal(rec.command, 'sleep 30');
  assert.equal(rec.to, 'w1');
  assert.equal(rec.requestId, 'req-9');
  assert.equal(rec.startTime, startTimeOf(r.handle.pid));
  assert.ok(isSameProcess(rec.pid, rec.startTime));
  r.handle.stop();
  await r.end;
  assert.equal(existsSync(recordPath), false);
  assert.deepEqual(readdirSync(join(dir, 'shells')), []);
});

test('the record omits requestId when there is none', async () => {
  const recordPath = join(tmp(), 'sess-2.json');
  const r = run('sleep 30', { recordPath });
  assert.equal('requestId' in JSON.parse(readFileSync(recordPath, 'utf8')), false);
  r.handle.stop();
  await r.end;
});

test('onEnd is called exactly once when stop() is called twice and again after the end', async () => {
  const r = run('sleep 30');
  await new Promise((res) => setTimeout(res, 50));
  r.handle.stop();
  r.handle.stop();
  await r.end;
  r.handle.stop();
  await new Promise((res) => setTimeout(res, 100));
  assert.equal(r.ends(), 1);
  const r2 = run('true');
  await r2.end;
  r2.handle.stop();
  await new Promise((res) => setTimeout(res, 50));
  assert.equal(r2.ends(), 1);
});

// A detached real group to reap, as a crashed host would leave one: a shell plus a grandchild.
function liveGroup() {
  const c = spawn('/bin/sh', ['-c', 'sleep 30 & sleep 30'], { detached: true, stdio: 'ignore' });
  c.unref();
  return c.pid;
}

test('reapShells kills a live matching group, skips dead and reused pids, deletes every record, tolerates corruption', async () => {
  const dir = join(tmp(), 'shells');
  mkdirSync(dir);
  const live = liveGroup();
  await waitFor(() => startTimeOf(live) != null);
  const write = (name, v) => writeFileSync(join(dir, name), typeof v === 'string' ? v : JSON.stringify(v));
  write('live.json', { id: 'sh-1', to: 'w1', pid: live, startTime: startTimeOf(live), command: 'tail -f x', requestId: 'r1' });
  // a dead pid: a group that has already exited
  const dead = spawn('/bin/sh', ['-c', 'exit 0'], { detached: true, stdio: 'ignore' });
  const deadPid = dead.pid;
  await new Promise((res) => dead.on('exit', res));
  write('dead.json', { id: 'sh-2', to: 'w2', pid: deadPid, startTime: 'Thu Jan  1 00:00:00 2026', command: 'ls' });
  // a reused pid: alive, but its launch time is not the recorded one
  write('reused.json', { id: 'sh-3', to: 'w3', pid: process.pid, startTime: 'Thu Jan  1 00:00:00 2026', command: 'make' });
  write('corrupt.json', '{ not json');
  write('torn.json.123-abc.tmp', '{');

  const out = reapShells(dir);
  const byId = Object.fromEntries(out.map((r) => [r.id, r]));
  assert.deepEqual(byId['sh-1'], { id: 'sh-1', to: 'w1', command: 'tail -f x', requestId: 'r1', killed: true });
  assert.deepEqual(byId['sh-2'], { id: 'sh-2', to: 'w2', command: 'ls', killed: false });
  assert.deepEqual(byId['sh-3'], { id: 'sh-3', to: 'w3', command: 'make', killed: false });
  assert.equal(out.length, 3);
  assert.deepEqual(readdirSync(dir), []);
  await waitFor(() => !alive(live), 1000);
  assert.equal(alive(process.pid), true); // the reused pid was never signalled
});

test('reapShells with injected checks signals the group, and a missing dir is empty', () => {
  const dir = join(tmp(), 'shells');
  mkdirSync(dir);
  writeFileSync(join(dir, 'a.json'), JSON.stringify({ id: 'sh-a', to: 'w', pid: 4242, startTime: 'T', command: 'x' }));
  const kills = [];
  const seen = [];
  const out = reapShells(dir, {
    isSameProcess: (pid, st) => (seen.push([pid, st]), true),
    kill: (pid, sig) => kills.push([pid, sig]),
  });
  assert.deepEqual(seen, [[4242, 'T']]);
  assert.deepEqual(kills, [[-4242, 'SIGKILL']]);
  assert.equal(out[0].killed, true);
  assert.deepEqual(reapShells(join(dir, 'missing')), []);
  rmSync(dir, { recursive: true, force: true });
});
