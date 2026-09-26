import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readWorkersFile, reapRecorded } from './reap.mjs';
import { writeWorkersFile } from './worker-proc.mjs';

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'pir-reap-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A set of fake processes on one fake clock. `procs` maps pid → { startTime, diesOnTerm }; a pid not
// in it is dead. sig 0 throws ESRCH for a dead pid, as the kernel does; SIGKILL is unconditional.
function fakeProcesses(procs) {
  const clock = { t: 0 };
  const signals = [];
  const dead = new Set();
  const alive = (pid) => pid in procs && !dead.has(pid);
  const kill = (pid, sig) => {
    if (sig === 0) {
      if (!alive(pid)) {
        const e = new Error('ESRCH');
        e.code = 'ESRCH';
        throw e;
      }
      return;
    }
    signals.push([pid, sig]);
    if (sig === 'SIGKILL' || (sig === 'SIGTERM' && procs[pid]?.diesOnTerm)) dead.add(pid);
  };
  return {
    signals,
    clock,
    kill,
    isAlive: alive,
    startTimeOf: (pid) => (alive(pid) ? procs[pid].startTime : null),
    now: () => clock.t,
    wait: async (ms) => {
      clock.t += ms;
    },
  };
}

const rec = (pid, startTime, task = 'T01') => ({ id: `id-${pid}`, task, role: 'implement', pid, startTime });

test('a live recorded pid with a matching start time is SIGTERMed, and SIGKILLed 3 s later if still alive', async (t) => {
  const dir = scratch(t);
  writeWorkersFile(dir, [rec(101, 'Fri Sep 25 10:00:00 2026')]);
  const p = fakeProcesses({ 101: { startTime: 'Fri Sep 25 10:00:00 2026', diesOnTerm: false } });

  const r = await reapRecorded(dir, p);

  assert.deepEqual(r, { reaped: [101], skipped: [] });
  assert.deepEqual(p.signals, [[101, 'SIGTERM'], [101, 'SIGKILL']]);
  assert.ok(p.clock.t >= 3000, 'the SIGKILL waited out the 3 s window');
});

test('a recorded pid that leaves on SIGTERM is not SIGKILLed', async (t) => {
  const dir = scratch(t);
  writeWorkersFile(dir, [rec(102, 'A')]);
  const p = fakeProcesses({ 102: { startTime: 'A', diesOnTerm: true } });

  const r = await reapRecorded(dir, p);

  assert.deepEqual(r, { reaped: [102], skipped: [] });
  assert.deepEqual(p.signals, [[102, 'SIGTERM']]);
});

test('a pid alive with a different start time (reused by another process) is skipped, never signalled', async (t) => {
  const dir = scratch(t);
  writeWorkersFile(dir, [rec(103, 'old launch')]);
  const p = fakeProcesses({ 103: { startTime: 'new launch' } });

  const r = await reapRecorded(dir, p);

  assert.deepEqual(r, { reaped: [], skipped: [103] });
  assert.deepEqual(p.signals, []);
});

test('a dead pid is skipped; a record with no start time is skipped even when its pid is alive', async (t) => {
  const dir = scratch(t);
  writeWorkersFile(dir, [rec(104, 'A'), rec(105, null, 'T02')]);
  const p = fakeProcesses({ 105: { startTime: 'B' } });

  const r = await reapRecorded(dir, p);

  assert.deepEqual(r, { reaped: [], skipped: [104, 105] });
  assert.deepEqual(p.signals, []);
});

test('mixed records: only the matching live ones are reaped, in parallel', async (t) => {
  const dir = scratch(t);
  writeWorkersFile(dir, [rec(201, 'A'), rec(202, 'X'), rec(203, 'C'), rec(204, 'D')]);
  const p = fakeProcesses({ 201: { startTime: 'A' }, 202: { startTime: 'B' }, 203: { startTime: 'C', diesOnTerm: true } });

  const r = await reapRecorded(dir, p);

  assert.deepEqual(r, { reaped: [201, 203], skipped: [202, 204] });
  assert.deepEqual(
    p.signals.filter(([, s]) => s === 'SIGTERM').map(([pid]) => pid),
    [201, 203],
  );
  assert.deepEqual(p.signals.filter(([, s]) => s === 'SIGKILL'), [[201, 'SIGKILL']]);
});

test('a missing workers.json reads as [] and reaps nothing', async (t) => {
  const dir = scratch(t);
  assert.deepEqual(readWorkersFile(dir), []);
  const p = fakeProcesses({});
  assert.deepEqual(await reapRecorded(dir, p), { reaped: [], skipped: [] });
});

test('a corrupt, non-list or malformed workers.json reads as [] or drops bad entries, and never throws', async (t) => {
  const dir = scratch(t);
  const file = join(dir, 'workers.json');

  writeFileSync(file, '[{"pid": 12');
  assert.deepEqual(readWorkersFile(dir), []);
  assert.deepEqual(await reapRecorded(dir, fakeProcesses({})), { reaped: [], skipped: [] });

  writeFileSync(file, '{"pid": 12}');
  assert.deepEqual(readWorkersFile(dir), []);

  writeFileSync(file, JSON.stringify([null, { pid: 'x' }, { pid: -1 }, { pid: 7, startTime: 'A' }]));
  assert.deepEqual(readWorkersFile(dir), [{ pid: 7, startTime: 'A' }]);
});

test('readWorkersFile returns the five fields writeWorkersFile records', (t) => {
  const dir = scratch(t);
  writeWorkersFile(dir, [{ ...rec(9, 'A'), worker: {}, logPath: '/x' }]);
  assert.deepEqual(readWorkersFile(dir), [rec(9, 'A')]);
});
