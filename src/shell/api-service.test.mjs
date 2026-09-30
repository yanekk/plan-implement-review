// api-service T05 — the HTTP server, `api.json` and the file cache. Every test runs on a temp PIR_HOME
// and an OS-chosen port, through real HTTP requests; none touches the real `~/.pir` or the real port.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { request } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EXIT_PORT_TAKEN, discoveryRecord } from '../core/api.mjs';
import { serializeReading } from '../core/usage.mjs';
import { writeFileAtomic } from './atomic-write.mjs';
import { startApiService } from './api-service.mjs';

const SCRIPT = fileURLToPath(new URL('./api-service.mjs', import.meta.url));

// A fixed clock for the service, so "future-dated" is exact and no test depends on the wall clock.
const NOW = 1_790_669_300_000;

const READING = {
  observedAt: 1_790_669_288_699,
  fiveHour: { utilization: 0.97, resetsAt: 1_790_673_000 },
  sevenDay: { utilization: 0.77, resetsAt: 1_790_830_800 },
};
const READING_BODY = {
  version: 1,
  observed_at: 1_790_669_288_699,
  rate_limits: {
    five_hour: { used_percentage: 97, resets_at: 1_790_673_000 },
    seven_day: { used_percentage: 77, resets_at: 1_790_830_800 },
  },
};
const NULLS = { version: 1, observed_at: null, rate_limits: null };

function scratchHome(t) {
  const home = mkdtempSync(join(tmpdir(), 'pir-api-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return {
    home,
    env: { PIR_HOME: home },
    discovery: join(home, '.pir', 'api.json'),
    usage: join(home, '.pir', 'usage.json'),
  };
}

// A service on a scratch home, closed when the test ends whatever happened.
async function startScratch(t, opts = {}) {
  const scratch = scratchHome(t);
  const service = await startApiService({ env: scratch.env, now: () => NOW, ...opts });
  t.after(() => service.close());
  return { ...scratch, service };
}

// One real HTTP request on a fresh connection. `port` rather than a url, so `Host` can be anything.
function http(port, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers, agent: false }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (text += chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function getJson(port, path, opts) {
  const res = await http(port, path, opts);
  return { ...res, json: JSON.parse(res.text) };
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// Polls until `check` returns something truthy; fails the test after `ms`.
async function until(check, what, ms = 5000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`);
    await sleep(10);
  }
}

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
};

function assertContractHeaders(res) {
  assert.equal(res.headers['content-type'], 'application/json');
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  const cors = Object.keys(res.headers).filter((name) => name.startsWith('access-control-'));
  assert.deepEqual(cors, []);
}

// --- /v1/usage ---------------------------------------------------------------------------------

test('no usage.json: 200 with nulls', async (t) => {
  const { service } = await startScratch(t);
  const res = await getJson(service.port, '/v1/usage');
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, NULLS);
  assertContractHeaders(res);
});

test('a valid usage.json: the contract body with the file\'s numbers', async (t) => {
  const { service, usage } = await startScratch(t);
  writeFileAtomic(usage, serializeReading(READING));
  const res = await getJson(service.port, '/v1/usage');
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, READING_BODY);
  // Key order is part of the contract (DESIGN §2.1).
  assert.equal(res.text, JSON.stringify(READING_BODY));
  assertContractHeaders(res);
});

test('a query string is ignored', async (t) => {
  const { service, usage } = await startScratch(t);
  writeFileAtomic(usage, serializeReading(READING));
  assert.deepEqual((await getJson(service.port, '/v1/usage?x=1')).json, READING_BODY);
  assert.equal((await getJson(service.port, '/health?x=1')).status, 200);
});

test('the file replaced with a newer reading is served by the next request, with no restart', async (t) => {
  const { service, usage } = await startScratch(t);
  writeFileAtomic(usage, serializeReading(READING));
  assert.deepEqual((await getJson(service.port, '/v1/usage')).json, READING_BODY);

  // Same length as the first file, written straight after it: the case a size-and-mtime check alone
  // could miss on a coarse clock.
  const newer = { ...READING, observedAt: READING.observedAt + 1, fiveHour: { utilization: 0.98, resetsAt: 1_790_673_000 } };
  writeFileAtomic(usage, serializeReading(newer));
  const res = await getJson(service.port, '/v1/usage');
  assert.equal(res.json.observed_at, READING.observedAt + 1);
  assert.equal(res.json.rate_limits.five_hour.used_percentage, 98);
  assert.equal(res.json.rate_limits.seven_day.used_percentage, 77);
});

test('the file rewritten in place (same inode) is served too', async (t) => {
  const { service, usage } = await startScratch(t);
  writeFileAtomic(usage, serializeReading(READING));
  assert.deepEqual((await getJson(service.port, '/v1/usage')).json, READING_BODY);
  writeFileSync(usage, serializeReading({ ...READING, sevenDay: null }));
  const res = await getJson(service.port, '/v1/usage');
  assert.equal(res.json.rate_limits.seven_day, null);
  assert.equal(res.json.rate_limits.five_hour.used_percentage, 97);
});

test('garbage, a future-dated reading, then a deleted file: 200 with nulls each time', async (t) => {
  const { service, usage } = await startScratch(t);
  writeFileAtomic(usage, serializeReading(READING));
  assert.deepEqual((await getJson(service.port, '/v1/usage')).json, READING_BODY);

  writeFileAtomic(usage, '{"version":1,"observed_at":17906');
  let res = await getJson(service.port, '/v1/usage');
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, NULLS);

  // One millisecond inside the slack is served, one past it is not (DESIGN §2.5).
  writeFileAtomic(usage, serializeReading({ ...READING, observedAt: NOW + 60_000 }));
  assert.equal((await getJson(service.port, '/v1/usage')).json.observed_at, NOW + 60_000);
  writeFileAtomic(usage, serializeReading({ ...READING, observedAt: NOW + 60_001 }));
  res = await getJson(service.port, '/v1/usage');
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, NULLS);

  writeFileAtomic(usage, serializeReading(READING));
  assert.deepEqual((await getJson(service.port, '/v1/usage')).json, READING_BODY);
  rmSync(usage);
  res = await getJson(service.port, '/v1/usage');
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, NULLS);

  // And it comes back when the file does.
  writeFileAtomic(usage, serializeReading(READING));
  assert.deepEqual((await getJson(service.port, '/v1/usage')).json, READING_BODY);
});

test('a future-dated reading is served once the clock catches up, with the file untouched', async (t) => {
  let clock = NOW;
  const { service, usage } = await startScratch(t, { now: () => clock });
  writeFileAtomic(usage, serializeReading({ ...READING, observedAt: NOW + 120_000 }));
  assert.deepEqual((await getJson(service.port, '/v1/usage')).json, NULLS);
  clock = NOW + 60_000;
  assert.equal((await getJson(service.port, '/v1/usage')).json.observed_at, NOW + 120_000);
});

test('usage.json that is a directory reads as no reading', async (t) => {
  const { service, usage } = await startScratch(t);
  mkdirSync(usage, { recursive: true });
  const res = await getJson(service.port, '/v1/usage');
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, NULLS);
});

// --- /health -----------------------------------------------------------------------------------

test('GET /health: 200 with the service\'s pid, whatever state usage.json is in', async (t) => {
  const { service, usage } = await startScratch(t, { pid: 4711 });
  const expected = { version: 1, status: 'ok', pid: 4711 };

  let res = await getJson(service.port, '/health');
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, expected);
  assert.equal(res.text, JSON.stringify(expected));
  assertContractHeaders(res);

  writeFileAtomic(usage, serializeReading(READING));
  res = await getJson(service.port, '/health');
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, expected);

  writeFileAtomic(usage, 'not json at all');
  res = await getJson(service.port, '/health');
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, expected);
});

test('the pid defaults to this process', async (t) => {
  const { service, discovery } = await startScratch(t);
  assert.equal((await getJson(service.port, '/health')).json.pid, process.pid);
  assert.equal(readJson(discovery).pid, process.pid);
});

// --- everything else ---------------------------------------------------------------------------

test('POST on a known path is 405, an unknown path is 404, headers as the contract', async (t) => {
  const { service } = await startScratch(t);

  for (const path of ['/v1/usage', '/health']) {
    const res = await getJson(service.port, path, { method: 'POST', body: '{"x":1}' });
    assert.equal(res.status, 405, path);
    assert.equal(res.headers.allow, 'GET');
    assert.deepEqual(res.json, { version: 1, error: 'method_not_allowed' });
    assertContractHeaders(res);
  }

  for (const path of ['/nope', '/', '/v1/usage/', '/health/']) {
    const res = await getJson(service.port, path);
    assert.equal(res.status, 404, path);
    assert.deepEqual(res.json, { version: 1, error: 'not_found' });
    assert.equal(res.headers.allow, undefined);
    assertContractHeaders(res);
  }

  const res = await getJson(service.port, '/nope', { method: 'POST' });
  assert.equal(res.status, 404);
});

test('HEAD and OPTIONS are 405 with no CORS grant', async (t) => {
  const { service } = await startScratch(t);
  const options = await getJson(service.port, '/v1/usage', {
    method: 'OPTIONS',
    headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' },
  });
  assert.equal(options.status, 405);
  assertContractHeaders(options);
  const head = await http(service.port, '/health', { method: 'HEAD' });
  assert.equal(head.status, 405);
  assertContractHeaders(head);
});

test('a large POST body is never read and the service keeps answering', async (t) => {
  const { service } = await startScratch(t);
  // The answer goes out before the body has arrived and the connection is then closed, so the sender
  // sees either the 405 or a reset, depending on how much it had still to send. Both are fine; what
  // matters is that the service took no harm.
  const res = await http(service.port, '/v1/usage', { method: 'POST', body: 'x'.repeat(2_000_000) }).catch((err) => err);
  if (res instanceof Error) assert.match(res.code, /^(ECONNRESET|EPIPE)$/);
  else assert.equal(res.status, 405);
  assert.equal((await getJson(service.port, '/health')).status, 200);
});

test('a request with a foreign Host is answered like any other', async (t) => {
  const { service, usage } = await startScratch(t);
  writeFileAtomic(usage, serializeReading(READING));
  const usageRes = await getJson(service.port, '/v1/usage', { headers: { Host: 'evil.example' } });
  assert.equal(usageRes.status, 200);
  assert.deepEqual(usageRes.json, READING_BODY);
  const health = await getJson(service.port, '/health', { headers: { Host: 'evil.example' } });
  assert.equal(health.status, 200);
  assert.equal(health.json.status, 'ok');
});

// --- the listening address and api.json -------------------------------------------------------

test('the listening address is 127.0.0.1 and the url names the bound port', async (t) => {
  const { service } = await startScratch(t);
  assert.ok(Number.isInteger(service.port) && service.port > 0);
  assert.equal(service.url, `http://127.0.0.1:${service.port}`);
  const res = await new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: service.port, path: '/health', agent: false }, (r) => {
      // The server's end of the connection, as the client sees it.
      const address = r.socket.remoteAddress;
      r.resume();
      r.on('end', () => resolve(address));
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(res, '127.0.0.1');
  const connect = (host) =>
    new Promise((resolve, reject) => {
      const req = request({ host, port: service.port, path: '/health', agent: false }, resolve);
      req.on('error', reject);
      req.end();
    });
  // `::1` is refused: not Node's default bind, which is the IPv6 wildcard.
  await assert.rejects(connect('::1'));
  // And not the IPv4 wildcard either, which the two checks above cannot tell from 127.0.0.1: the port
  // is closed on every routable address this machine has. A machine with no network up has none, and
  // the loop then proves nothing.
  const routable = Object.values(networkInterfaces())
    .flat()
    .filter((address) => address.family === 'IPv4' && !address.internal);
  for (const { address } of routable) {
    await assert.rejects(connect(address), (err) => err.code === 'ECONNREFUSED', address);
  }
});

test('api.json exists once startApiService resolves, equals discoveryRecord, no .tmp left', async (t) => {
  const { service, discovery } = await startScratch(t, { pid: 4711 });
  assert.deepEqual(readJson(discovery), discoveryRecord({ port: service.port, pid: 4711 }));
  assert.equal(readFileSync(discovery, 'utf8'), `{"version":1,"url":"${service.url}","pid":4711}\n`);
  assert.deepEqual(readdirSync(dirname(discovery)), ['api.json']);
  // The url in the file is where the service answers.
  const res = await fetch(`${readJson(discovery).url}/health`);
  assert.equal(res.status, 200);
});

test('api.json deleted, or overwritten with another pid, is rewritten within reassertMs', async (t) => {
  const { service, discovery, home } = await startScratch(t, { pid: 4711, reassertMs: 20 });
  const own = discoveryRecord({ port: service.port, pid: 4711 });

  rmSync(discovery);
  await until(() => existsSync(discovery), 'api.json to come back');
  assert.deepEqual(readJson(discovery), own);

  writeFileSync(discovery, JSON.stringify(discoveryRecord({ port: 1, pid: 99 })));
  await until(() => readJson(discovery)?.pid === 4711, 'api.json to be reclaimed');
  assert.deepEqual(readJson(discovery), own);

  writeFileSync(discovery, 'garbage');
  await until(() => readJson(discovery)?.pid === 4711, 'a garbage api.json to be replaced');

  // The whole folder gone, as when somebody deletes ~/.pir.
  rmSync(join(home, '.pir'), { recursive: true });
  await until(() => existsSync(discovery), 'api.json to come back with its folder');
  assert.deepEqual(readJson(discovery), own);
  assert.deepEqual(readdirSync(dirname(discovery)), ['api.json']);
});

test('an api.json that cannot be replaced leaves no temp files, however long it lasts', async (t) => {
  // A directory where the file belongs: the temp is written and the rename onto it fails, every tick.
  // Left alone, the folder would gain a temp file every 30 s for as long as it lasted.
  const scratch = scratchHome(t);
  mkdirSync(scratch.discovery, { recursive: true });
  const service = await startApiService({ env: scratch.env, now: () => NOW, pid: 4711, reassertMs: 5 });
  t.after(() => service.close());
  const pirDir = dirname(scratch.discovery);
  const temps = () => readdirSync(pirDir).filter((name) => name !== 'api.json');
  await sleep(150);
  assert.deepEqual(temps(), []);
  // The service answers all the while, and claims the name once it can.
  assert.equal((await getJson(service.port, '/health')).status, 200);
  rmSync(scratch.discovery, { recursive: true });
  await until(() => readJson(scratch.discovery)?.pid === 4711, 'api.json to be written once the name is free');
  assert.deepEqual(readdirSync(pirDir), ['api.json']);
});

test('close() removes api.json, stops answering and stops the timer', async (t) => {
  const { service, discovery } = await startScratch(t, { reassertMs: 20 });
  assert.ok(existsSync(discovery));
  await service.close();
  assert.equal(existsSync(discovery), false);
  await assert.rejects(http(service.port, '/health'));
  // Several reassert periods later the file has not come back.
  await sleep(100);
  assert.equal(existsSync(discovery), false);
  // A second close is the same close.
  await service.close();
});

test('close() leaves api.json alone when it names another pid', async (t) => {
  const { service, discovery } = await startScratch(t, { pid: 4711 });
  const other = JSON.stringify(discoveryRecord({ port: 1, pid: 99 }));
  writeFileSync(discovery, other);
  await service.close();
  assert.equal(readFileSync(discovery, 'utf8'), other);
});

test('close() returns while a client still holds a keep-alive connection', async (t) => {
  const { service } = await startScratch(t);
  const res = await fetch(`${service.url}/health`);
  await res.text();
  // fetch keeps the connection open; close() must not wait for it.
  await Promise.race([
    service.close(),
    sleep(2000).then(() => assert.fail('close() waited on an idle keep-alive connection')),
  ]);
});

test('a second service on the same port rejects EADDRINUSE and leaves the first one\'s api.json', async (t) => {
  const { service, discovery, env } = await startScratch(t, { pid: 4711 });
  const before = readFileSync(discovery, 'utf8');
  await assert.rejects(
    startApiService({ env, port: service.port, pid: 99, now: () => NOW }),
    (err) => err.code === 'EADDRINUSE',
  );
  assert.equal(readFileSync(discovery, 'utf8'), before);
  assert.deepEqual(readdirSync(dirname(discovery)), ['api.json']);
  assert.equal((await getJson(service.port, '/health')).json.pid, 4711);
});

// A port nothing holds: bound by the OS, then released.
async function freePort() {
  const probe = createTcpServer();
  await new Promise((done) => probe.listen(0, '127.0.0.1', done));
  const { port } = probe.address();
  await new Promise((done) => probe.close(done));
  return port;
}

test('the real home under the test runner rejects TEST_REAL, nothing bound or written', async (t) => {
  // A temp folder stands in for the OS account's home, so the refusal is proven without going near
  // the real one.
  const home = mkdtempSync(join(tmpdir(), 'pir-api-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const env = { HOME: home, NODE_TEST_CONTEXT: 'child-v8' };

  await assert.rejects(startApiService({ env, osHome: home }), (err) => err.code === 'TEST_REAL');
  await assert.rejects(startApiService({ env: { PIR_HOME: home, NODE_TEST_CONTEXT: 'child-v8' }, osHome: home }), (err) => err.code === 'TEST_REAL');
  // No home at all is refused the same way (DESIGN §2.8).
  await assert.rejects(startApiService({ env: {}, osHome: home }), (err) => err.code === 'TEST_REAL');

  // An explicit port does not get past the guard, and that port is still free afterwards.
  const port = await freePort();
  await assert.rejects(startApiService({ env, osHome: home, port }), (err) => err.code === 'TEST_REAL');
  const probe = createTcpServer();
  await new Promise((done, fail) => {
    probe.once('error', fail);
    probe.listen(port, '127.0.0.1', done);
  });
  await new Promise((done) => probe.close(done));

  assert.deepEqual(readdirSync(home), []);
});

test('with this process\'s own environment and OS home the default start never binds the real port', async (t) => {
  // `node --test` sets NODE_TEST_CONTEXT, so whatever HOME is here the kind is scratch or test-real.
  // With PIR_HOME unset and HOME the real home this is the forgotten-scratch-home case, and it must
  // refuse rather than serve on the real machine.
  if (process.env.NODE_TEST_CONTEXT === undefined) return t.skip('not under node --test');
  const env = { ...process.env };
  delete env.PIR_HOME;
  const { userInfo } = await import('node:os');
  if (env.HOME !== userInfo().homedir) return t.skip('HOME is not the real home here');
  await assert.rejects(startApiService({ env }), (err) => err.code === 'TEST_REAL');
});

// --- as a program ------------------------------------------------------------------------------

function runChild(t, args, env) {
  const child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => (stdout += chunk));
  child.stderr.on('data', (chunk) => (stderr += chunk));
  const exited = new Promise((resolve) => {
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  // Never left running, whatever the test did.
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    return exited;
  });
  return { child, exited };
}

// The child's environment: this process's, with the scratch home. NODE_TEST_CONTEXT is inherited, so a
// child that lost its PIR_HOME would refuse to start rather than bind the real port.
const childEnv = (home) => ({ ...process.env, PIR_HOME: home });

for (const signal of ['SIGTERM', 'SIGINT']) {
  test(`as a program on a scratch PIR_HOME: answers, ${signal} exits 0 and api.json is gone`, async (t) => {
    const { home, discovery, usage } = scratchHome(t);
    writeFileAtomic(usage, serializeReading(READING));
    const { child, exited } = runChild(t, [SCRIPT], childEnv(home));

    const record = await until(() => readJson(discovery), 'the child to write api.json', 15_000);
    assert.equal(record.pid, child.pid);
    assert.equal(record.version, 1);
    assert.match(record.url, /^http:\/\/127\.0\.0\.1:\d+$/);

    const health = await fetch(`${record.url}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { version: 1, status: 'ok', pid: child.pid });
    // The reading is real-dated far from the child's real clock only in the past, so it is served.
    const usageRes = await fetch(`${record.url}/v1/usage`);
    assert.equal(usageRes.status, 200);
    assert.deepEqual(await usageRes.json(), READING_BODY);

    child.kill(signal);
    const result = await exited;
    assert.equal(result.code, 0);
    assert.equal(result.signal, null);
    assert.equal(existsSync(discovery), false);
    // Nothing printed in normal operation (DESIGN §2.6).
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  });
}

// The program with startApiService's options forced: the exported `main`, in a child of its own.
const mainSource = (opts) =>
  `import { main } from ${JSON.stringify(pathToFileURL(SCRIPT).href)}; await main(${JSON.stringify(opts)});`;

test('as a program with the port forced to one a test server holds: exit 47, nothing printed, no api.json', async (t) => {
  const { home, discovery } = scratchHome(t);
  const holder = createTcpServer();
  await new Promise((done) => holder.listen(0, '127.0.0.1', done));
  t.after(() => new Promise((done) => holder.close(done)));

  const { exited } = runChild(
    t,
    ['--input-type=module', '-e', mainSource({ port: holder.address().port })],
    childEnv(home),
  );
  const result = await exited;
  assert.equal(result.code, EXIT_PORT_TAKEN);
  assert.equal(result.code, 47);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
  assert.equal(existsSync(discovery), false);
});

test('as a program refused by the home guard: one line on stderr, exit 1, nothing written', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'pir-api-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  // The temp folder is passed as the OS home too, so the child meets the real-home-under-test case
  // without the real home being involved.
  const env = { ...process.env, HOME: home };
  delete env.PIR_HOME;
  const { exited } = runChild(t, ['--input-type=module', '-e', mainSource({ osHome: home })], env);
  const result = await exited;
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^pir api-service: [^\n]+\n$/);
  assert.deepEqual(readdirSync(home), []);
});

// --- the import graph --------------------------------------------------------------------------

// The pattern of src/core/boundary.test.mjs: every static, re-exported and dynamic specifier.
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)(['"])([^'"]+)\1/g;

// Whole-line comments are dropped before matching. The pattern reads prose too, and the graph reaches
// shell files written before this rule existed: index-store.mjs has a comment holding the word "from"
// and then a quoted phrase, which is no import. An import cannot hide on a line that starts with `//`.
const withoutLineComments = (source) =>
  source
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');

function importGraph(entry) {
  const seen = new Map();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    const specs = [...withoutLineComments(readFileSync(file, 'utf8')).matchAll(SPECIFIER)].map((m) => m[2]);
    seen.set(file, specs);
    for (const spec of specs) {
      if (spec.startsWith('./') || spec.startsWith('../')) queue.push(resolvePath(dirname(file), spec));
    }
  }
  return seen;
}

test('the import graph from api-service.mjs holds no bare specifier', () => {
  const graph = importGraph(SCRIPT);
  // The walk really walked: the entry, both core modules and the two shell helpers at least.
  const names = [...graph.keys()].map((file) => file.slice(file.lastIndexOf('/src/') + 1));
  for (const expected of ['src/shell/api-service.mjs', 'src/core/api.mjs', 'src/core/usage.mjs', 'src/shell/atomic-write.mjs', 'src/shell/index-store.mjs']) {
    assert.ok(names.includes(expected), `${expected} is in the graph`);
  }
  const bad = [];
  for (const [file, specs] of graph) {
    for (const spec of specs) {
      if (!(spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('node:'))) bad.push(`${file}: '${spec}'`);
    }
  }
  assert.deepEqual(bad, [], 'the service must start when npm ci failed (DESIGN §2.6)');
});

test('the walk catches a package import', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'pir-api-graph-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'a.mjs'), `// told apart from 'a quoted phrase'\nimport { b } from './b.mjs';\n`);
  writeFileSync(join(dir, 'b.mjs'), `import { query } from '@anthropic-ai/claude-agent-sdk';\n`);
  const graph = importGraph(join(dir, 'a.mjs'));
  assert.deepEqual(graph.get(join(dir, 'a.mjs')), ['./b.mjs']);
  assert.deepEqual(graph.get(join(dir, 'b.mjs')), ['@anthropic-ai/claude-agent-sdk']);
});
