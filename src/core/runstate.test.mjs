import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyRun } from './runstate.mjs';

// A real launch time, the shape `ps -o lstart` returns (FINDINGS 2026-09-22). The exact value never
// matters to classifyRun — only whether recordedStartTime and liveStartTime are equal — so one constant
// stands in for both the recorded and the live time throughout.
const LSTART = 'Tue Sep 22 08:27:37 2026';

test('a clean final record wins — finished even when the process is still alive', () => {
  // The recorded number may be alive as something else by the time we look; a finished record is the
  // truth regardless (DESIGN §3.3, check 1).
  assert.equal(
    classifyRun({ recordedStartTime: LSTART, finalState: 'finished', alive: true, liveStartTime: LSTART }),
    'finished',
  );
});

test('finalState stopped → stopped', () => {
  assert.equal(
    classifyRun({ recordedStartTime: LSTART, finalState: 'stopped', alive: false, liveStartTime: null }),
    'stopped',
  );
});

test('no final record, alive, matching launch time → running', () => {
  assert.equal(
    classifyRun({ recordedStartTime: LSTART, finalState: null, alive: true, liveStartTime: LSTART }),
    'running',
  );
});

test('no final record, not alive → crashed (died without recording an end)', () => {
  assert.equal(
    classifyRun({ recordedStartTime: LSTART, finalState: null, alive: false, liveStartTime: null }),
    'crashed',
  );
});

test('no final record, alive, launch time differs → crashed (process number reused)', () => {
  assert.equal(
    classifyRun({
      recordedStartTime: LSTART,
      finalState: null,
      alive: true,
      liveStartTime: 'Tue Sep 22 09:14:02 2026',
    }),
    'crashed',
  );
});

test('no final record, alive, liveStartTime null → crashed (defensive: alive but no start time)', () => {
  assert.equal(
    classifyRun({ recordedStartTime: LSTART, finalState: null, alive: true, liveStartTime: null }),
    'crashed',
  );
});

test('an unknown finalState is not a clean record — it falls through to the liveness checks', () => {
  // A corrupted or unexpected finalState must never mask a crashed run as a clean end. Alive+matching
  // still resolves to running; not alive still resolves to crashed.
  assert.equal(
    classifyRun({ recordedStartTime: LSTART, finalState: 'weird', alive: true, liveStartTime: LSTART }),
    'running',
  );
  assert.equal(
    classifyRun({ recordedStartTime: LSTART, finalState: 'weird', alive: false, liveStartTime: null }),
    'crashed',
  );
});

test('classifyRun returns exactly one of the four state strings for every branch', () => {
  const states = new Set(['running', 'finished', 'stopped', 'crashed']);
  const cases = [
    { recordedStartTime: LSTART, finalState: 'finished', alive: true, liveStartTime: LSTART },
    { recordedStartTime: LSTART, finalState: 'stopped', alive: true, liveStartTime: LSTART },
    { recordedStartTime: LSTART, finalState: null, alive: true, liveStartTime: LSTART },
    { recordedStartTime: LSTART, finalState: null, alive: false, liveStartTime: null },
    { recordedStartTime: LSTART, finalState: null, alive: true, liveStartTime: 'other' },
  ];
  for (const c of cases) assert.ok(states.has(classifyRun(c)), `unexpected state for ${JSON.stringify(c)}`);
});
