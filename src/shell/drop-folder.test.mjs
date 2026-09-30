// drop-folder.mjs createWaker (fast-tests T01, DESIGN §2.1, §2.2): the one wake-up both loops wait on.
// The watch is a manual fake and the gap's clock and timer are injected, so no test waits on real time
// beyond a few milliseconds. waitForDrop's own tests live in person-inbox.test.mjs and coordinate.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createWaker } from './drop-folder.mjs';

// A watch that fires only when the test says so.
function manualWatch() {
  const cbs = [];
  const watch = (dir, cb) => {
    const w = new EventEmitter();
    w.close = () => {
      const i = cbs.indexOf(cb);
      if (i >= 0) cbs.splice(i, 1);
    };
    cbs.push(cb);
    return w;
  };
  watch.fire = () => [...cbs].forEach((cb) => cb('rename', 'x.json'));
  watch.count = () => cbs.length;
  return watch;
}

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

// settledWithin(p, ms) → true when p settles inside ms of real time.
async function settledWithin(p, ms) {
  let done = false;
  p.then(() => (done = true));
  await tick(ms);
  return done;
}

test('waker: a wake before the wait makes the next wait return at once, and only that one', async () => {
  const watch = manualWatch();
  const w = createWaker();
  w.wake();
  assert.equal(await settledWithin(w.wait(['/a'], 10_000, { watch }), 5), true, 'the flagged wake returns at once');
  const next = w.wait(['/a'], 10_000, { watch });
  assert.equal(await settledWithin(next, 20), false, 'the flag was spent on the first wait');
  w.wake();
  await next;
});

test('waker: a wake during the wait resolves it; two wakes during one wait give one return and no early flag', async () => {
  const watch = manualWatch();
  const w = createWaker();
  const p = w.wait(['/a', '/b'], 10_000, { watch });
  assert.equal(watch.count(), 2, 'both folders watched while waiting');
  w.wake();
  w.wake(); // the second has no wait pending: it must not carry over to the next wait
  await p;
  assert.equal(watch.count(), 0, 'the watchers are closed once the wait returns');
  const next = w.wait(['/a'], 10_000, { watch });
  assert.equal(await settledWithin(next, 20), false, 'no early flag left behind by the doubled wake');
  w.wake();
  await next;
});

test('waker: with no wake a wait ends on the timeout (the backstop) and on a drop in a watched folder', async () => {
  const watch = manualWatch();
  const w = createWaker();
  const started = Date.now();
  await w.wait(['/a'], 30, { watch });
  assert.ok(Date.now() - started >= 25, 'the backstop timeout ends it');

  const p = w.wait(['/a', '/b'], 10_000, { watch });
  assert.equal(await settledWithin(p, 10), false);
  watch.fire();
  assert.equal(await settledWithin(p, 5), true, 'a drop ends it');
});

test('waker: with minGapMs, a wake 50 ms after the last return resolves at the gap end, not before; wakes in the gap coalesce', async () => {
  const watch = manualWatch();
  let clock = 1000;
  const timers = [];
  const setTimer = (fn, ms) => {
    const t = { fn, ms, unref() {} };
    timers.push(t);
    return t;
  };
  const w = createWaker({ minGapMs: 250, now: () => clock, setTimer });
  w.wake();
  await w.wait(['/a'], 10_000, { watch }); // the first return is never held: there is no previous one
  assert.equal(timers.length, 0);

  clock = 1050;
  let done = false;
  const p = w.wait(['/a'], 10_000, { watch }).then(() => (done = true));
  w.wake();
  await tick();
  assert.equal(timers.length, 1, 'held by one gap timer');
  assert.equal(timers[0].ms, 200, 'for what is left of the 250 ms gap');
  assert.equal(done, false, 'not before the gap ends');
  w.wake(); // inside the gap: served by the same return
  w.wake();
  clock = 1250;
  timers[0].fn();
  await p;
  assert.equal(done, true);

  // The wakes inside the gap were absorbed, not flagged for the wait after.
  clock = 2000; // well past the gap, so no hold
  const next = w.wait(['/a'], 10_000, { watch });
  assert.equal(await settledWithin(next, 20), false, 'no extra pass for the coalesced wakes');
  w.wake();
  await next;
});

test('waker: a signal abort resolves the wait, and is never held by the gap', async () => {
  const watch = manualWatch();
  let clock = 0;
  const w = createWaker({ minGapMs: 250, now: () => clock, setTimer: () => ({ unref() {} }) }); // a gap timer that never fires
  const ac = new AbortController();
  const p = w.wait(['/a'], 10_000, { watch, signal: ac.signal });
  assert.equal(await settledWithin(p, 10), false);
  ac.abort();
  assert.equal(await settledWithin(p, 5), true, 'an abort ends the wait');

  // Now inside the gap of that return: an aborted signal still returns at once.
  clock = 10;
  const ac2 = new AbortController();
  const q = w.wait(['/a'], 10_000, { watch, signal: ac2.signal });
  w.wake();
  assert.equal(await settledWithin(q, 10), false, 'the wake is held by the gap');
  ac2.abort();
  assert.equal(await settledWithin(q, 5), true, 'the abort cuts the gap short');
});
