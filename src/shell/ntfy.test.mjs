// reliable-notifications T02 — the ntfy client, against a fake fetch. No test reaches the network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publish, clear } from './ntfy.mjs';

// fakeFetch(outcomes) → a fetch that records every call and plays the outcomes in order: a number is
// a response status, an Error is thrown.
function fakeFetch(outcomes) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const next = outcomes[Math.min(calls.length - 1, outcomes.length - 1)];
    if (next instanceof Error) throw next;
    return { ok: next >= 200 && next < 300, status: next };
  };
  fn.calls = calls;
  return fn;
}

function recordingSleep() {
  const waits = [];
  const fn = async (ms) => { waits.push(ms); };
  fn.waits = waits;
  return fn;
}

const FIELDS = {
  server: 'https://ntfy.sh',
  topic: 'pir-abc',
  title: 'repo · plan · T05',
  message: 'asks: which one?',
  click: 'https://claude.ai/code/session_x',
  seq: 'pir-plan-T05-1',
  icon: 'https://example.test/icon.png',
};

test('publish sends one JSON POST to the server root with every field', async () => {
  const fetch = fakeFetch([200]);
  const sleep = recordingSleep();
  const r = await publish(FIELDS, { fetch, sleep });
  assert.deepEqual(r, { ok: true, status: 200 });
  assert.equal(fetch.calls.length, 1);
  const { url, init } = fetch.calls[0];
  assert.equal(url, 'https://ntfy.sh');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(init.body), {
    topic: 'pir-abc',
    title: 'repo · plan · T05',
    message: 'asks: which one?',
    priority: 4,
    tags: ['bell'],
    click: 'https://claude.ai/code/session_x',
    icon: 'https://example.test/icon.png',
    sequence_id: 'pir-plan-T05-1',
  });
  // The '·' travels in the body, never in a header, so fetch cannot reject it as non-Latin-1.
  for (const v of Object.values(init.headers)) assert.match(v, /^[\x00-\xff]*$/);
  assert.deepEqual(sleep.waits, []);
});

test('publish omits click, icon and sequence_id when null, and honours priority and tags', async () => {
  const fetch = fakeFetch([200]);
  await publish(
    { ...FIELDS, server: 'https://ntfy.sh/', click: null, icon: null, seq: null, priority: 3, tags: ['tada'] },
    { fetch, sleep: recordingSleep() },
  );
  assert.equal(fetch.calls[0].url, 'https://ntfy.sh');
  const body = JSON.parse(fetch.calls[0].init.body);
  assert.deepEqual(Object.keys(body).sort(), ['message', 'priority', 'tags', 'title', 'topic']);
  assert.equal(body.priority, 3);
  assert.deepEqual(body.tags, ['tada']);
});

test('publish omits the optional fields when they are not given at all', async () => {
  const fetch = fakeFetch([200]);
  await publish({ server: 'https://ntfy.sh', topic: 't', title: 'a', message: 'b' }, { fetch });
  assert.deepEqual(Object.keys(JSON.parse(fetch.calls[0].init.body)).sort(),
    ['message', 'priority', 'tags', 'title', 'topic']);
});

test('a 5xx then a 2xx is retried once after the first delay and returns ok', async () => {
  const fetch = fakeFetch([503, 200]);
  const sleep = recordingSleep();
  const r = await publish(FIELDS, { fetch, sleep, delays: [5000, 30000] });
  assert.deepEqual(r, { ok: true, status: 200 });
  assert.equal(fetch.calls.length, 2);
  assert.deepEqual(sleep.waits, [5000]);
  assert.equal(fetch.calls[1].init.body, fetch.calls[0].init.body);
});

for (const [name, outcomes, last] of [
  ['three 5xx', [500, 502, 503], { ok: false, status: 503, error: 'HTTP 503' }],
  ['three 429', [429, 429, 429], { ok: false, status: 429, error: 'HTTP 429' }],
  ['three throws', [new Error('a'), new Error('b'), new Error('getaddrinfo ENOTFOUND')],
    { ok: false, status: null, error: 'getaddrinfo ENOTFOUND' }],
  ['mixed', [new Error('offline'), 429, 500], { ok: false, status: 500, error: 'HTTP 500' }],
]) {
  test(`${name}: returns the last error after exactly the injected delays`, async () => {
    const fetch = fakeFetch(outcomes);
    const sleep = recordingSleep();
    const r = await publish(FIELDS, { fetch, sleep, delays: [7, 11] });
    assert.deepEqual(r, last);
    assert.equal(fetch.calls.length, 3);
    assert.deepEqual(sleep.waits, [7, 11]);
  });
}

test('the default delays are 5 s and 30 s', async () => {
  const fetch = fakeFetch([500]);
  const sleep = recordingSleep();
  await publish(FIELDS, { fetch, sleep });
  assert.deepEqual(sleep.waits, [5000, 30000]);
  assert.equal(fetch.calls.length, 3);
});

for (const status of [400, 401, 403, 404, 413]) {
  test(`a ${status} is not retried`, async () => {
    const fetch = fakeFetch([status, 200]);
    const sleep = recordingSleep();
    const r = await publish(FIELDS, { fetch, sleep });
    assert.deepEqual(r, { ok: false, status, error: `HTTP ${status}` });
    assert.equal(fetch.calls.length, 1);
    assert.deepEqual(sleep.waits, []);
  });
}

test('a 4xx after a retried 5xx stops the retries', async () => {
  const fetch = fakeFetch([500, 400, 200]);
  const sleep = recordingSleep();
  const r = await publish(FIELDS, { fetch, sleep });
  assert.equal(r.status, 400);
  assert.equal(fetch.calls.length, 2);
  assert.deepEqual(sleep.waits, [5000]);
});

test('clear sends one PUT to {server}/{topic}/{seq}/clear', async () => {
  const fetch = fakeFetch([200]);
  const r = await clear({ server: 'https://ntfy.sh/', topic: 'pir-abc', seq: 'pir-plan-T05-1' }, { fetch });
  assert.deepEqual(r, { ok: true, status: 200 });
  assert.equal(fetch.calls.length, 1);
  assert.equal(fetch.calls[0].url, 'https://ntfy.sh/pir-abc/pir-plan-T05-1/clear');
  assert.equal(fetch.calls[0].init.method, 'PUT');
});

test('a failed clear resolves { ok: false } once, never rejects and never retries', async () => {
  const f500 = fakeFetch([500, 200]);
  const r1 = await clear({ server: 'https://ntfy.sh', topic: 't', seq: 's' }, { fetch: f500 });
  assert.deepEqual(r1, { ok: false, status: 500, error: 'HTTP 500' });
  assert.equal(f500.calls.length, 1);

  const fThrow = fakeFetch([new Error('offline')]);
  const r2 = await clear({ server: 'https://ntfy.sh', topic: 't', seq: 's' }, { fetch: fThrow });
  assert.deepEqual(r2, { ok: false, status: null, error: 'offline' });
  assert.equal(fThrow.calls.length, 1);
});
