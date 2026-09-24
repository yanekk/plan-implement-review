import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scrubEnv, runLines, startLines } from './commands.mjs';

// Tests run real /bin/sh in a scratch folder: the runner's whole job is shell semantics, so a fake
// would test nothing.
function scratch(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'pir-commands-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, logPath: join(dir, 'run.log') };
}

async function settle(handle, ms = 10000) {
  const until = Date.now() + ms;
  for (;;) {
    const r = handle.poll();
    if (r) return r;
    if (Date.now() > until) throw new Error('handle never settled');
    await new Promise((res) => setTimeout(res, 10));
  }
}

test('scrubEnv drops PARALLEL_* and PIR_RUN and keeps the rest', () => {
  const env = { PARALLEL_X: '1', PARALLEL_Y: '2', PIR_RUN: 'r', PIR_OTHER: 'k', PATH: '/bin' };
  assert.deepEqual(scrubEnv(env), { PIR_OTHER: 'k', PATH: '/bin' });
  assert.equal(env.PIR_RUN, 'r', 'the input is not mutated');
});

test('runLines: green lines are ok, and the log holds a $ header per line and the output', (t) => {
  const { dir, logPath } = scratch(t);
  const r = runLines(['true', 'echo hi'], { cwd: dir, logPath });
  assert.deepEqual(r, { ok: true, logPath });
  assert.equal(readFileSync(logPath, 'utf8'), '$ true\n$ echo hi\nhi\n');
});

test('runLines: stops at the first failure and names the line and its status', (t) => {
  const { dir, logPath } = scratch(t);
  const r = runLines(['true', 'exit 3', 'touch never'], { cwd: dir, logPath });
  assert.equal(r.ok, false);
  assert.equal(r.line, 'exit 3');
  assert.equal(r.status, 3);
  assert.equal(r.signal, null);
  assert.equal(r.logPath, logPath);
  assert.equal(r.reason, '`exit 3` exited 3');
  assert.equal(existsSync(join(dir, 'never')), false, 'the third line did not run');
});

test('runLines: a missing binary exits 127 and the tail holds the shell error', (t) => {
  const { dir, logPath } = scratch(t);
  const r = runLines(['no-such-binary-pir-xyz'], { cwd: dir, logPath });
  assert.equal(r.status, 127);
  assert.match(r.reason, /exited 127/);
  assert.match(r.tail, /no-such-binary-pir-xyz/);
  assert.match(r.tail, /not found/);
});

test('runLines: append keeps earlier content; the default rewrites', (t) => {
  const { dir, logPath } = scratch(t);
  runLines(['echo one'], { cwd: dir, logPath });
  runLines(['echo two'], { cwd: dir, logPath, append: true });
  assert.equal(readFileSync(logPath, 'utf8'), '$ echo one\none\n$ echo two\ntwo\n');
  runLines(['echo three'], { cwd: dir, logPath });
  assert.equal(readFileSync(logPath, 'utf8'), '$ echo three\nthree\n');
});

test('runLines: cwd is honoured and a cd in one line does not carry to the next', (t) => {
  const { dir, logPath } = scratch(t);
  mkdirSync(join(dir, 'sub'));
  const r = runLines(['pwd', 'cd sub && pwd', 'pwd'], { cwd: dir, logPath });
  assert.equal(r.ok, true);
  assert.equal(readFileSync(logPath, 'utf8'), `$ pwd\n${dir}\n$ cd sub && pwd\n${dir}/sub\n$ pwd\n${dir}\n`);
});

test('runLines: PARALLEL_* and PIR_RUN do not reach the child; other variables do', (t) => {
  const { dir, logPath } = scratch(t);
  const env = { ...process.env, PARALLEL_X: 'leak', PIR_RUN: 'leak', KEEP_ME: 'kept' };
  const r = runLines(['echo "x=${PARALLEL_X-unset} r=${PIR_RUN-unset} k=${KEEP_ME-unset}"'], { cwd: dir, logPath, env });
  assert.equal(r.ok, true);
  assert.match(readFileSync(logPath, 'utf8'), /x=unset r=unset k=kept/);
});

test('runLines: an unwritable log still runs the lines and returns ok on green', (t) => {
  const { dir } = scratch(t);
  const logPath = join(dir, 'missing-dir', 'run.log');
  const r = runLines(['touch ran'], { cwd: dir, logPath });
  assert.deepEqual(r, { ok: true, logPath: null });
  assert.equal(existsSync(join(dir, 'ran')), true);
  const red = runLines(['exit 2'], { cwd: dir, logPath });
  assert.equal(red.reason, '`exit 2` exited 2');
  assert.equal(red.tail, '', 'no log, no tail');
});

test('runLines: a folder that does not exist could not run, with the error code', (t) => {
  const { dir, logPath } = scratch(t);
  const r = runLines(['true'], { cwd: join(dir, 'gone'), logPath });
  assert.equal(r.ok, false);
  assert.equal(r.status, null);
  assert.equal(r.reason, '`true` could not run (ENOENT)');
});

test('runLines: tail is capped at 20 lines', (t) => {
  const { dir, logPath } = scratch(t);
  const r = runLines(['i=1; while [ $i -le 50 ]; do echo line$i; i=$((i+1)); done; exit 1'], { cwd: dir, logPath });
  const tail = r.tail.split('\n');
  assert.equal(tail.length, 20);
  assert.equal(tail[0], 'line31');
  assert.equal(tail[19], 'line50');
});

test('startLines: polls null while running, then ok, and the result is stable', async (t) => {
  const { dir, logPath } = scratch(t);
  const h = startLines(['sleep 0.2', 'echo hi'], { cwd: dir, logPath });
  assert.equal(h.poll(), null);
  const r = await settle(h);
  assert.deepEqual(r, { ok: true, logPath });
  assert.equal(h.poll(), r, 'stable once returned');
  assert.equal(readFileSync(logPath, 'utf8'), '$ sleep 0.2\n$ echo hi\nhi\n');
});

test('startLines: a failing line gives the same result shape as runLines', async (t) => {
  const { dir, logPath } = scratch(t);
  const lines = ['echo before', 'exit 4', 'touch never'];
  const sync = runLines(lines, { cwd: dir, logPath });
  const r = await settle(startLines(lines, { cwd: dir, logPath }));
  assert.deepEqual(r, sync);
  assert.equal(existsSync(join(dir, 'never')), false);
});

test('startLines: rewrites the log and scrubs the env', async (t) => {
  const { dir, logPath } = scratch(t);
  writeFileSync(logPath, 'old attempt\n');
  const env = { ...process.env, PIR_RUN: 'leak' };
  await settle(startLines(['echo "r=${PIR_RUN-unset}"'], { cwd: dir, logPath, env }));
  assert.equal(readFileSync(logPath, 'utf8'), '$ echo "r=${PIR_RUN-unset}"\nr=unset\n');
});

test('startLines: no lines settles ok on the first poll', () => {
  const h = startLines([], { cwd: '/', logPath: null });
  assert.equal(h.poll().ok, true);
});

test('startLines: a spawn that throws settles as could-not-run', () => {
  const spawn = () => {
    throw Object.assign(new Error('boom'), { code: 'EAGAIN' });
  };
  const h = startLines(['true'], { cwd: '/', logPath: null, spawn });
  assert.equal(h.poll().reason, '`true` could not run (EAGAIN)');
});

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test('startLines: kill() stops the line and its children, and the result is killed', async (t) => {
  const { dir, logPath } = scratch(t);
  // The shell forks a sleep and records both pids: killing only the shell would leave the sleep behind.
  const h = startLines(['echo $$ > sh.pid; sleep 30 & echo $! > sleep.pid; wait'], { cwd: dir, logPath });
  const until = Date.now() + 5000;
  while (!existsSync(join(dir, 'sleep.pid')) || !readFileSync(join(dir, 'sleep.pid'), 'utf8').trim()) {
    if (Date.now() > until) throw new Error('the line never started its sleep');
    await new Promise((res) => setTimeout(res, 10));
  }
  const shPid = Number(readFileSync(join(dir, 'sh.pid'), 'utf8'));
  const sleepPid = Number(readFileSync(join(dir, 'sleep.pid'), 'utf8'));
  assert.equal(h.poll(), null);
  assert.equal(alive(sleepPid), true);
  h.kill();
  assert.deepEqual(h.poll(), { ok: false, reason: 'killed' });
  const gone = Date.now() + 3000;
  while ((alive(shPid) || alive(sleepPid)) && Date.now() < gone) await new Promise((res) => setTimeout(res, 20));
  assert.equal(alive(sleepPid), false, 'the forked sleep is gone');
  assert.equal(alive(shPid), false, 'the shell is gone');
  h.kill();
  assert.deepEqual(h.poll(), { ok: false, reason: 'killed' }, 'a second kill changes nothing');
});
