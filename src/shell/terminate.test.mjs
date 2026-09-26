// T04 — the one SIGTERM-wait-SIGKILL escalation, driven with an injected clock and process table so no
// real signal is sent and no test waits in real time.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { terminate } from './terminate.mjs';

// A fake process that dies `dieAfter` ms after it receives one of `diesOn`, and a clock that `sleep`
// advances. `sent` records every signal with the fake time it was sent at.
function harness({ alive = true, diesOn = [], dieAfter = 0 } = {}) {
  let clock = 1000;
  let deathAt = alive ? Infinity : -Infinity;
  const sent = [];
  return {
    sent,
    opts: {
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
      isAlive: () => clock < deathAt,
      kill: (pid, sig) => {
        sent.push({ pid, sig, at: clock - 1000 });
        if (diesOn.includes(sig)) deathAt = Math.min(deathAt, clock + dieAfter);
      },
      pollMs: 10,
    },
  };
}

test('a dead pid is a no-op: nothing is signalled', async () => {
  const h = harness({ alive: false });
  assert.deepEqual(await terminate(42, { ...h.opts, graceMs: 100, killMs: 200 }), { escalated: false, signal: null });
  assert.deepEqual(h.sent, []);
});

test('a process that leaves within the grace is never signalled', async () => {
  const h = harness();
  let clock = 0;
  const opts = { ...h.opts, isAlive: () => clock < 50, sleep: async (ms) => { clock += ms; }, now: () => clock };
  assert.deepEqual(await terminate(42, { ...opts, graceMs: 100, killMs: 200 }), { escalated: false, signal: null });
  assert.deepEqual(h.sent, []);
});

test('exits after SIGTERM: SIGTERM at graceMs, no SIGKILL', async () => {
  const h = harness({ diesOn: ['SIGTERM'], dieAfter: 30 });
  assert.deepEqual(await terminate(42, { ...h.opts, graceMs: 100, killMs: 200 }), { escalated: false, signal: 'SIGTERM' });
  assert.deepEqual(h.sent, [{ pid: 42, sig: 'SIGTERM', at: 100 }]);
});

test('escalates to SIGKILL at killMs when SIGTERM is ignored', async () => {
  const h = harness({ diesOn: ['SIGKILL'] });
  assert.deepEqual(await terminate(42, { ...h.opts, graceMs: 100, killMs: 200 }), { escalated: true, signal: 'SIGKILL' });
  assert.deepEqual(h.sent, [{ pid: 42, sig: 'SIGTERM', at: 100 }, { pid: 42, sig: 'SIGKILL', at: 200 }]);
});

test('graceMs 0 signals at once, the shape stopRun uses', async () => {
  const h = harness({ diesOn: ['SIGTERM'] });
  await terminate(7, { ...h.opts, graceMs: 0, killMs: 4000 });
  assert.deepEqual(h.sent, [{ pid: 7, sig: 'SIGTERM', at: 0 }]);
});

test('a process gone between the check and the signal (kill throws ESRCH) is not an error', async () => {
  const h = harness();
  const kill = () => {
    throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
  };
  assert.deepEqual(await terminate(42, { ...h.opts, kill, graceMs: 10, killMs: 20 }), { escalated: true, signal: 'SIGKILL' });
});
