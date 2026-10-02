import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseWatchVerdict, watchDue } from './basewatch.mjs';

const still = { containsTip: false, localTip: 'L1', localSeen: 'L1', watched: null, baseSha: 'B1' };

test('baseWatchVerdict: the base holding the tip is merged, whatever else moved', () => {
  assert.equal(baseWatchVerdict({ ...still, containsTip: true }), 'merged');
  assert.equal(
    baseWatchVerdict({ containsTip: true, localTip: 'L2', localSeen: 'L1', watched: { ok: true, sha: 'B2' }, baseSha: 'B1' }),
    'merged',
  );
});

test('baseWatchVerdict: the local tip leaving where the sync saw it is moved', () => {
  assert.equal(baseWatchVerdict({ ...still, localTip: 'L2' }), 'moved');
  // localSeen, not baseSha, is the reference: a local tip behind the merged remote copy is not a move.
  assert.equal(baseWatchVerdict({ ...still, localTip: 'L1', localSeen: 'L1', baseSha: 'R9' }), null);
});

test('baseWatchVerdict: an ok refresh with a new remote commit is moved; a failed one moves nothing', () => {
  assert.equal(baseWatchVerdict({ ...still, watched: { ok: true, sha: 'B2' } }), 'moved');
  assert.equal(baseWatchVerdict({ ...still, watched: { ok: true, sha: 'B1' } }), null);
  assert.equal(baseWatchVerdict({ ...still, watched: { ok: false, reason: 'fetch-failed', sha: 'B2' } }), null);
});

test('baseWatchVerdict: nothing changed is null', () => {
  assert.equal(baseWatchVerdict(still), null);
});

test('watchDue: the first call starts the clock and is not due', () => {
  assert.deepEqual(watchDue({ now: 1000, watchFrom: null, watchMs: 300 }), { due: false, watchFrom: 1000 });
  assert.deepEqual(watchDue({ now: 1000, watchFrom: undefined, watchMs: 300 }), { due: false, watchFrom: 1000 });
});

test('watchDue: due at exactly watchMs, restarting the clock; not due just before', () => {
  assert.deepEqual(watchDue({ now: 1299, watchFrom: 1000, watchMs: 300 }), { due: false, watchFrom: 1000 });
  assert.deepEqual(watchDue({ now: 1300, watchFrom: 1000, watchMs: 300 }), { due: true, watchFrom: 1300 });
  assert.deepEqual(watchDue({ now: 5000, watchFrom: 1000, watchMs: 300 }), { due: true, watchFrom: 5000 });
});
