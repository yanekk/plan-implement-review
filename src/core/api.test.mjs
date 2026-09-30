// Tests for the pure API rules (plans/api-service T02, DESIGN §2.1, §2.2, §2.8, §3.4): the home rule
// row by row, the port per kind, the file names, and every row of the request table with its headers.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  API_VERSION,
  API_PORT,
  EXIT_PORT_TAKEN,
  homeKind,
  portFor,
  apiFiles,
  discoveryRecord,
  healthBody,
  route,
} from './api.mjs';

const OS_HOME = '/Users/me';

// ── constants ──────────────────────────────────────────────────────────────────────────────────

test('constants: version 1, port 47717, port-taken exit code 47', () => {
  assert.equal(API_VERSION, 1);
  assert.equal(API_PORT, 47717);
  assert.equal(EXIT_PORT_TAKEN, 47);
});

// ── homeKind (§2.8) ────────────────────────────────────────────────────────────────────────────

test('homeKind: the real home with no test context is real', () => {
  assert.equal(homeKind({ HOME: OS_HOME }, OS_HOME), 'real');
});

test('homeKind: PIR_HOME elsewhere is scratch, whatever HOME and the test context say', () => {
  assert.equal(homeKind({ PIR_HOME: '/tmp/x', HOME: OS_HOME }, OS_HOME), 'scratch');
  assert.equal(homeKind({ PIR_HOME: '/tmp/x' }, OS_HOME), 'scratch');
  assert.equal(homeKind({ PIR_HOME: '/tmp/x', HOME: OS_HOME, NODE_TEST_CONTEXT: 'child-v8' }, OS_HOME), 'scratch');
});

test('homeKind: HOME elsewhere with no PIR_HOME is scratch', () => {
  assert.equal(homeKind({ HOME: '/tmp/home' }, OS_HOME), 'scratch');
  assert.equal(homeKind({ HOME: '/tmp/home', NODE_TEST_CONTEXT: 'child-v8' }, OS_HOME), 'scratch');
});

test('homeKind: the real home under the test runner is test-real', () => {
  assert.equal(homeKind({ HOME: OS_HOME, NODE_TEST_CONTEXT: 'child-v8' }, OS_HOME), 'test-real');
  assert.equal(homeKind({ PIR_HOME: OS_HOME, HOME: '/tmp/home', NODE_TEST_CONTEXT: 'child-v8' }, OS_HOME), 'test-real');
  // Set but empty is still set: the rule fails closed.
  assert.equal(homeKind({ HOME: OS_HOME, NODE_TEST_CONTEXT: '' }, OS_HOME), 'test-real');
});

test('homeKind: PIR_HOME equal to the real home is real, and wins over a scratch HOME', () => {
  assert.equal(homeKind({ PIR_HOME: OS_HOME }, OS_HOME), 'real');
  assert.equal(homeKind({ PIR_HOME: OS_HOME, HOME: '/tmp/home' }, OS_HOME), 'real');
});

test('homeKind: one trailing slash on either side is the same folder', () => {
  assert.equal(homeKind({ HOME: `${OS_HOME}/` }, OS_HOME), 'real');
  assert.equal(homeKind({ PIR_HOME: `${OS_HOME}/` }, OS_HOME), 'real');
  assert.equal(homeKind({ HOME: OS_HOME }, `${OS_HOME}/`), 'real');
  assert.equal(homeKind({ HOME: `${OS_HOME}/`, NODE_TEST_CONTEXT: 'child-v8' }, OS_HOME), 'test-real');
  // Only one slash is stripped, and a longer path is a different folder.
  assert.equal(homeKind({ HOME: `${OS_HOME}//` }, OS_HOME), 'scratch');
  assert.equal(homeKind({ HOME: `${OS_HOME}/sub` }, OS_HOME), 'scratch');
  assert.equal(homeKind({ HOME: `${OS_HOME}2` }, OS_HOME), 'scratch');
});

test('homeKind: neither variable set is test-real, with and without the test context', () => {
  assert.equal(homeKind({}, OS_HOME), 'test-real');
  assert.equal(homeKind({ NODE_TEST_CONTEXT: 'child-v8' }, OS_HOME), 'test-real');
});

test('homeKind: an unknown OS home is test-real, never scratch', () => {
  assert.equal(homeKind({ HOME: OS_HOME }, undefined), 'test-real');
  assert.equal(homeKind({ HOME: '/tmp/home' }, null), 'test-real');
});

// ── portFor (§2.2) ─────────────────────────────────────────────────────────────────────────────

test('portFor: real is the fixed port, scratch is OS-chosen, test-real refuses', () => {
  assert.equal(portFor('real'), 47717);
  assert.equal(portFor('scratch'), 0);
  assert.equal(portFor('test-real'), null);
});

test('portFor: an unknown kind refuses', () => {
  assert.equal(portFor('nope'), null);
  assert.equal(portFor(undefined), null);
});

// ── apiFiles (§3.4) ────────────────────────────────────────────────────────────────────────────

test('apiFiles: the three files under the .pir folder', () => {
  assert.deepEqual(apiFiles('/tmp/home/.pir'), {
    discovery: '/tmp/home/.pir/api.json',
    usage: '/tmp/home/.pir/usage.json',
    off: '/tmp/home/.pir/api-service.off',
  });
  assert.deepEqual(apiFiles('/tmp/home/.pir/'), apiFiles('/tmp/home/.pir'));
});

// ── discoveryRecord and healthBody (§2.1) ──────────────────────────────────────────────────────

test('discoveryRecord: shape and key order match the contract', () => {
  const record = discoveryRecord({ port: 47717, pid: 4711 });
  assert.deepEqual(record, { version: 1, url: 'http://127.0.0.1:47717', pid: 4711 });
  // Key order is part of what a person reading the file sees, so it is pinned through the text.
  assert.equal(JSON.stringify(record), '{"version":1,"url":"http://127.0.0.1:47717","pid":4711}');
});

test('discoveryRecord: carries the port it was given, not the fixed one', () => {
  assert.equal(discoveryRecord({ port: 51234, pid: 9 }).url, 'http://127.0.0.1:51234');
});

test('healthBody: shape and key order match the contract', () => {
  const body = healthBody({ pid: 4711 });
  assert.deepEqual(body, { version: 1, status: 'ok', pid: 4711 });
  assert.equal(JSON.stringify(body), '{"version":1,"status":"ok","pid":4711}');
});

// ── route (§2.1) ───────────────────────────────────────────────────────────────────────────────

const USAGE = {
  version: 1,
  observed_at: 1790669288699,
  rate_limits: {
    five_hour: { used_percentage: 97, resets_at: 1790673000 },
    seven_day: { used_percentage: 77, resets_at: 1790830800 },
  },
};

// The two-row table the service will pass in (T05), with plain values standing in for the file read.
const endpoints = {
  '/v1/usage': () => USAGE,
  '/health': () => healthBody({ pid: 4711 }),
};

const BASE_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

const NOT_FOUND = '{"version":1,"error":"not_found"}';
const METHOD_NOT_ALLOWED = '{"version":1,"error":"method_not_allowed"}';
const INTERNAL = '{"version":1,"error":"internal"}';

// Every response any test below produces is collected here, so the two rules that hold "in any case"
// (no CORS header, a version-1 JSON body) are checked against all of them at the end of the file.
const seen = [];
function ask(method, url, table = endpoints) {
  const response = route({ method, url }, { endpoints: table });
  seen.push({ method, url, response });
  return response;
}

test('route: GET /v1/usage answers 200 with that endpoint’s body as JSON', () => {
  const r = ask('GET', '/v1/usage');
  assert.equal(r.status, 200);
  assert.deepEqual(r.headers, BASE_HEADERS);
  assert.equal(typeof r.body, 'string');
  assert.deepEqual(JSON.parse(r.body), USAGE);
});

test('route: GET /health answers 200 with the health body', () => {
  const r = ask('GET', '/health');
  assert.equal(r.status, 200);
  assert.deepEqual(r.headers, BASE_HEADERS);
  assert.equal(r.body, '{"version":1,"status":"ok","pid":4711}');
});

test('route: a query string is ignored', () => {
  for (const url of ['/v1/usage?x=1', '/health?x=1', '/health?', '/v1/usage?a=1?b=2', '/health?x=/v1/usage']) {
    const r = ask('GET', url);
    assert.equal(r.status, 200, url);
    assert.deepEqual(r.headers, BASE_HEADERS, url);
  }
  assert.deepEqual(JSON.parse(ask('GET', '/v1/usage?x=1').body), USAGE);
  assert.equal(JSON.parse(ask('GET', '/health?x=1').body).status, 'ok');
});

test('route: an unknown path is 404 not_found', () => {
  const unknown = ['/v1/usage/', '/health/', '/', '/v1', '/v2/usage', '', '/V1/usage', '/Health', '//health', '/health/?x=1', '/nope?x=1'];
  for (const url of unknown) {
    const r = ask('GET', url);
    assert.equal(r.status, 404, url);
    assert.deepEqual(r.headers, BASE_HEADERS, url);
    assert.equal(r.body, NOT_FOUND, url);
  }
});

test('route: a path that names an Object.prototype member is unknown, not a crash', () => {
  for (const url of ['/constructor', 'constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    assert.equal(ask('GET', url).status, 404, url);
    assert.equal(ask('POST', url).status, 404, url);
  }
});

test('route: a missing url is an unknown path', () => {
  assert.equal(ask('GET', undefined).status, 404);
});

test('route: a known path with any method but GET is 405 with Allow: GET', () => {
  for (const url of ['/v1/usage', '/health', '/v1/usage?x=1']) {
    for (const method of ['POST', 'HEAD', 'OPTIONS', 'DELETE', 'PUT', 'PATCH', 'get', undefined]) {
      const r = ask(method, url);
      assert.equal(r.status, 405, `${method} ${url}`);
      assert.deepEqual(r.headers, { ...BASE_HEADERS, Allow: 'GET' }, `${method} ${url}`);
      assert.equal(r.body, METHOD_NOT_ALLOWED, `${method} ${url}`);
    }
  }
});

test('route: the path is checked before the method, so POST /nope is 404 with no Allow', () => {
  for (const method of ['POST', 'HEAD', 'OPTIONS', 'DELETE']) {
    const r = ask(method, '/nope');
    assert.equal(r.status, 404, method);
    assert.equal(r.body, NOT_FOUND, method);
    assert.equal('Allow' in r.headers, false, method);
  }
});

test('route: a 405 never runs the handler', () => {
  let calls = 0;
  const table = { '/health': () => { calls += 1; return healthBody({ pid: 1 }); } };
  ask('POST', '/health', table);
  ask('HEAD', '/health', table);
  assert.equal(calls, 0);
  ask('GET', '/health', table);
  assert.equal(calls, 1);
});

test('route: an endpoint that throws is 500 internal, and the other endpoint still answers', () => {
  const table = {
    '/v1/usage': () => { throw new Error('boom: /secret/path'); },
    '/health': () => healthBody({ pid: 4711 }),
  };
  const r = ask('GET', '/v1/usage', table);
  assert.equal(r.status, 500);
  assert.deepEqual(r.headers, BASE_HEADERS);
  // The fixed body only: nothing of the error reaches the reader.
  assert.equal(r.body, INTERNAL);
  assert.equal(ask('GET', '/health', table).status, 200);
});

test('route: a body that cannot be written as JSON is 500 internal', () => {
  const loop = { version: 1 };
  loop.self = loop;
  const table = {
    '/loop': () => loop,
    '/big': () => ({ version: 1, n: 10n }),
    '/nothing': () => undefined,
  };
  for (const url of Object.keys(table)) {
    const r = ask('GET', url, table);
    assert.equal(r.status, 500, url);
    assert.equal(r.body, INTERNAL, url);
  }
});

test('route: a third endpoint is one more table row', () => {
  const table = { ...endpoints, '/v1/runs': () => ({ version: 1, runs: [] }) };
  const r = ask('GET', '/v1/runs', table);
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body), { version: 1, runs: [] });
  assert.equal(ask('GET', '/v1/runs').status, 404);
});

// These two run last on purpose: node:test runs a file's top-level tests in order, so `seen` holds
// every response the tests above produced.

test('route: no response in any case carries an Access-Control- header', () => {
  assert.ok(seen.length > 50, `only ${seen.length} responses were collected`);
  for (const { method, url, response } of seen) {
    for (const name of Object.keys(response.headers)) {
      assert.equal(name.toLowerCase().startsWith('access-control-'), false, `${method} ${url}: ${name}`);
    }
  }
});

test('route: every body parses as JSON and carries version 1, under the same three headers', () => {
  const statuses = new Set();
  for (const { method, url, response } of seen) {
    const where = `${method} ${url}`;
    statuses.add(response.status);
    assert.equal(JSON.parse(response.body).version, 1, where);
    assert.equal(response.headers['Content-Type'], 'application/json', where);
    assert.equal(response.headers['Cache-Control'], 'no-store', where);
    assert.equal(response.headers['X-Content-Type-Options'], 'nosniff', where);
  }
  // The check means nothing unless every row of the §2.1 table went through it.
  assert.deepEqual([...statuses].sort(), [200, 404, 405, 500]);
});
