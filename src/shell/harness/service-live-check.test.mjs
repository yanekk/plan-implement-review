// service-live-check.mjs against a fake launchd (api-service T09): the five steps, their order, the
// limits and the teardown, with a fake clock so the 11 s wait and the 15 s limit cost nothing. No test
// here runs the real launchctl (DESIGN §5.2); the real run is the worker's, recorded in FINDINGS.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECK_LABEL, main, serviceLiveCheck } from './service-live-check.mjs';

const UID = 501;
const TARGET = `gui/${UID}/${CHECK_LABEL}`;
const SOURCE = fileURLToPath(new URL('./service-live-check.mjs', import.meta.url));
const SERVICE = fileURLToPath(new URL('../api-service.mjs', import.meta.url));

// A launchd that keeps one job: `bootstrap` starts a service (a new pid, its api.json written under
// the PIR_HOME the plist names), `kill` ends it and schedules the restart `restartMs[n]` later on the
// fake clock (null: never), `bootout` ends it the clean way, api.json removed.
function world(t, { restartMs = [200, 10_000], loaded = false, stuck = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'pir-service-check-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const w = {
    root,
    clock: 1_000_000,
    loaded,
    alive: false,
    pid: 4000,
    url: 'http://127.0.0.1:51000',
    home: null,
    startedAt: null,
    restartAt: null,
    calls: [],
    kills: [],
    plists: [],
    events: [],
    discovery: () => join(w.home, '.pir', 'api.json'),
  };
  const start = () => {
    w.pid += 1;
    w.alive = true;
    w.startedAt = w.clock;
    w.restartAt = null;
    mkdirSync(dirname(w.discovery()), { recursive: true });
    writeFileSync(w.discovery(), JSON.stringify({ version: 1, url: w.url, pid: w.pid }));
  };
  const result = (status, stderr = '') => ({ status, stdout: status === 0 ? 'state = running\n' : '', stderr });
  w.launchctl = (args) => {
    w.calls.push(args);
    const [verb] = args;
    if (verb === 'print') return result(w.loaded ? 0 : 113);
    w.events.push(verb);
    if (verb === 'bootstrap') {
      if (w.loaded) return result(5, 'Bootstrap failed: 5: Input/output error');
      const plist = readFileSync(args[2], 'utf8');
      w.plists.push({ path: args[2], text: plist });
      w.home = /<key>PIR_HOME<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)[1];
      w.loaded = true;
      start();
      return result(0);
    }
    if (verb === 'bootout') {
      if (!w.loaded) return result(3, 'Boot-out failed: 3: No such process');
      if (stuck) return result(1, 'Boot-out failed');
      w.loaded = false;
      w.alive = false;
      w.restartAt = null;
      rmSync(w.discovery(), { force: true });
      return result(0);
    }
    throw new Error(`unexpected launchctl ${args.join(' ')}`);
  };
  w.get = async (url) => {
    if (!w.alive || !url.startsWith(`${w.url}/`)) return null;
    if (url.endsWith('/health')) return { status: 200, body: JSON.stringify({ version: 1, status: 'ok', pid: w.pid }) };
    if (url.endsWith('/v1/usage')) return { status: 200, body: w.usage ?? '{"version":1,"observed_at":null,"rate_limits":null}' };
    return { status: 404, body: '{"version":1,"error":"not_found"}' };
  };
  w.kill = (pid) => {
    assert.equal(pid, w.pid, 'only the live service is killed');
    assert.equal(w.alive, true);
    w.events.push('kill');
    const delay = restartMs[w.kills.length];
    w.kills.push({ pid, upMs: w.clock - w.startedAt });
    w.alive = false;
    w.restartAt = delay == null ? null : w.clock + delay;
  };
  w.sleep = async (ms) => {
    w.clock += ms;
    if (w.restartAt !== null && w.clock >= w.restartAt && w.loaded) start();
  };
  w.opts = { launchctl: w.launchctl, get: w.get, kill: w.kill, sleep: w.sleep, now: () => w.clock, tmp: root, uid: UID };
  return w;
}

test('the five steps run in order against a fake launchd, ok is true and the folder is gone', async (t) => {
  const w = world(t);
  const logged = [];
  const r = await serviceLiveCheck({ ...w.opts, log: (line) => logged.push(line) });

  assert.equal(r.ok, true, r.lines.join('\n'));
  assert.deepEqual(logged, r.lines);
  assert.deepEqual(r.lines.map((line) => line.split(':')[0]), [
    '1 on',
    '2 kill -9 after 11 s up',
    '3 kill -9 again at once',
    '4 refresh',
    '5 off',
    'teardown',
    'service-live-check',
  ]);
  // on → two kills → refresh (bootout, bootstrap) → off (bootout) → the teardown's own bootout.
  assert.deepEqual(w.events, ['bootstrap', 'kill', 'kill', 'bootout', 'bootstrap', 'bootout', 'bootout']);
  assert.match(r.lines[0], /^1 on: api\.json written, http:\/\/127\.0\.0\.1:51000 answers \/health as pid 4001, \/v1\/usage 200 with nulls, after \d+\.\d s$/);
  assert.match(r.lines[1], /^2 kill -9 after 11 s up: pid 4001 → 4002, answering after 0\.2 s$/);
  assert.match(r.lines[2], /^3 kill -9 again at once: pid 4002 → 4003, answering after 10\.0 s$/);
  assert.match(r.lines[3], /^4 refresh: pid 4003 → 4004, answering after \d+\.\d s$/);
  assert.match(r.lines[4], /^5 off: api\.json gone, launchctl print fails, after \d+\.\d s$/);
  assert.equal(r.lines[5], `teardown: ${CHECK_LABEL} not loaded, temp folder removed`);
  assert.equal(r.lines[6], 'service-live-check: passed');

  // The first kill waits out launchd's 10 s minimum runtime; the second does not wait at all.
  assert.ok(w.kills[0].upMs >= 11_000, `up ${w.kills[0].upMs} ms`);
  assert.equal(w.kills[1].upMs, 0);

  // Everything lived in the one temp folder, and it is gone.
  assert.equal(dirname(r.dir), w.root);
  assert.match(r.dir, /\/pir-service-check-[^/]+$/);
  assert.equal(existsSync(r.dir), false);
  assert.deepEqual(readdirSync(w.root), []);
  assert.equal(w.loaded, false);

  // The plist: the scratch label, this checkout's service, PIR_HOME the temp folder, the file in it.
  assert.equal(w.plists.length, 2);
  for (const plist of w.plists) {
    assert.equal(plist.path, join(r.dir, `${CHECK_LABEL}.plist`));
    assert.ok(plist.text.includes(`<key>Label</key>\n\t<string>${CHECK_LABEL}</string>`));
    assert.ok(plist.text.includes(`<string>${SERVICE}</string>`));
    assert.ok(plist.text.includes(`<key>PIR_HOME</key>\n\t\t<string>${r.dir}</string>`));
    assert.ok(plist.text.includes('<key>KeepAlive</key>\n\t<true/>'));
  }
  // Every launchctl call names the scratch label or its plist, never anything else.
  for (const call of w.calls) {
    if (call[0] === 'bootstrap') assert.deepEqual(call, ['bootstrap', `gui/${UID}`, join(r.dir, `${CHECK_LABEL}.plist`)]);
    else assert.deepEqual(call, [call[0], TARGET]);
  }
});

test('no new pid after the first kill: ok false, the later steps skipped, the teardown still run', async (t) => {
  const w = world(t, { restartMs: [null] });
  const r = await serviceLiveCheck(w.opts);

  assert.equal(r.ok, false);
  assert.match(r.lines[0], /^1 on: api\.json written/);
  assert.equal(r.lines[1], '2 kill -9 after 11 s up: FAILED: no new pid answering within 5.0 s');
  assert.deepEqual(r.lines.slice(2), [
    '3 kill -9 again at once: skipped',
    '4 refresh: skipped',
    '5 off: skipped',
    `teardown: ${CHECK_LABEL} not loaded, temp folder removed`,
    'service-live-check: FAILED',
  ]);
  assert.deepEqual(w.events, ['bootstrap', 'kill', 'bootout']);
  assert.equal(w.loaded, false);
  assert.equal(existsSync(r.dir), false);
  assert.deepEqual(readdirSync(w.root), []);
});

test('a restart slower than its limit fails the step: 5 s after a long run, 15 s when throttled', async (t) => {
  const slowFirst = await serviceLiveCheck(world(t, { restartMs: [6_000] }).opts);
  assert.equal(slowFirst.ok, false);
  assert.equal(slowFirst.lines[1], '2 kill -9 after 11 s up: FAILED: no new pid answering within 5.0 s');

  const w = world(t, { restartMs: [200, 16_000] });
  const slowSecond = await serviceLiveCheck(w.opts);
  assert.equal(slowSecond.ok, false);
  assert.match(slowSecond.lines[1], /^2 kill -9 after 11 s up: pid 4001 → 4002/);
  assert.equal(slowSecond.lines[2], '3 kill -9 again at once: FAILED: no new pid answering within 15.0 s');
  assert.equal(slowSecond.lines[3], '4 refresh: skipped');
  assert.equal(existsSync(slowSecond.dir), false);
  assert.equal(w.loaded, false);
});

test('step 1 fails when the service never answers, or answers usage with a reading: nothing is killed', async (t) => {
  const silent = world(t);
  silent.opts.get = async () => null;
  const a = await serviceLiveCheck(silent.opts);
  assert.equal(a.ok, false);
  assert.equal(a.lines[0], '1 on: FAILED: pir service: registered but not answering');
  assert.deepEqual(silent.kills, []);
  assert.deepEqual(silent.events, ['bootstrap', 'bootout']);
  assert.equal(existsSync(a.dir), false);

  const fed = world(t);
  fed.usage = '{"version":1,"observed_at":5,"rate_limits":{"five_hour":null,"seven_day":null}}';
  const b = await serviceLiveCheck(fed.opts);
  assert.equal(b.ok, false);
  assert.equal(b.lines[0], '1 on: FAILED: GET /v1/usage did not answer 200 with nulls');
  assert.deepEqual(fed.kills, []);
  assert.equal(existsSync(b.dir), false);
});

test('a throw inside a step is that step\'s failure, and the teardown still runs', async (t) => {
  const w = world(t);
  w.opts.kill = () => {
    throw new Error('kill ESRCH');
  };
  const r = await serviceLiveCheck(w.opts);
  assert.equal(r.ok, false);
  assert.equal(r.lines[1], '2 kill -9 after 11 s up: FAILED: kill ESRCH');
  assert.equal(r.lines.at(-2), `teardown: ${CHECK_LABEL} not loaded, temp folder removed`);
  assert.equal(w.loaded, false);
  assert.equal(existsSync(r.dir), false);
});

test('the label already loaded: refuses, says how to remove it, registers nothing and makes no folder', async (t) => {
  const w = world(t, { loaded: true });
  const r = await serviceLiveCheck(w.opts);
  assert.deepEqual(r, {
    ok: false,
    lines: [
      `refused: ${CHECK_LABEL} is already loaded (another check is running, or one was cut off)`,
      `remove it with: launchctl bootout ${TARGET}`,
    ],
    dir: null,
  });
  // One question asked, nothing changed: the loaded job may belong to a check that is still running.
  assert.deepEqual(w.calls, [['print', TARGET]]);
  assert.deepEqual(w.kills, []);
  assert.deepEqual(readdirSync(w.root), []);
});

test('a label that will not boot out fails the check, names the way back, and the folder still goes', async (t) => {
  const w = world(t, { restartMs: [null], stuck: true });
  const r = await serviceLiveCheck(w.opts);
  assert.equal(r.ok, false);
  assert.equal(r.lines.at(-2), `teardown: FAILED: ${CHECK_LABEL} is still loaded; remove it with: launchctl bootout ${TARGET}`);
  assert.equal(r.lines.at(-1), 'service-live-check: FAILED');
  assert.equal(existsSync(r.dir), false);
});

// Reproduced on the real launchd at T09 review: SIGTERM six seconds in killed the check before its
// `finally`, and the job stayed loaded and running with its folder in place.
test('a signal during the 11 s wait fails that step and the teardown still runs: nothing is killed', async (t) => {
  const w = world(t);
  const signals = new EventEmitter();
  const sleep = w.sleep;
  let sent = false;
  w.opts.sleep = async (ms) => {
    // The long wait of step 2 is the only sleep this long; the signal lands while it is pending.
    if (ms > 5_000 && !sent) {
      sent = true;
      signals.emit('SIGTERM', 'SIGTERM');
    }
    await sleep(ms);
  };
  const r = await serviceLiveCheck({ ...w.opts, signals });

  assert.equal(r.ok, false);
  assert.match(r.lines[0], /^1 on: api\.json written/);
  assert.deepEqual(r.lines.slice(1), [
    '2 kill -9 after 11 s up: FAILED: interrupted by SIGTERM',
    '3 kill -9 again at once: skipped',
    '4 refresh: skipped',
    '5 off: skipped',
    `teardown: ${CHECK_LABEL} not loaded, temp folder removed`,
    'service-live-check: FAILED',
  ]);
  assert.deepEqual(w.kills, []);
  assert.deepEqual(w.events, ['bootstrap', 'bootout']);
  assert.equal(w.loaded, false);
  assert.equal(existsSync(r.dir), false);
  // The check leaves no handler behind on the emitter it was given.
  for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP']) assert.equal(signals.listenerCount(name), 0, name);
});

test('a signal that lands outside a wait stops the check before the next step, and is held during the teardown', async (t) => {
  const w = world(t);
  const signals = new EventEmitter();
  const get = w.get;
  w.opts.get = async (url) => {
    if (url.endsWith('/v1/usage')) signals.emit('SIGINT', 'SIGINT');
    return get(url);
  };
  const launchctl = w.launchctl;
  w.opts.launchctl = (args) => {
    // A second signal while the job is being removed must not cut the removal short.
    if (args[0] === 'bootout') signals.emit('SIGTERM', 'SIGTERM');
    return launchctl(args);
  };
  const r = await serviceLiveCheck({ ...w.opts, signals });

  assert.equal(r.ok, false);
  assert.match(r.lines[0], /^1 on: api\.json written/);
  assert.equal(r.lines[1], '2 kill -9 after 11 s up: FAILED: interrupted by SIGINT');
  assert.equal(r.lines.at(-2), `teardown: ${CHECK_LABEL} not loaded, temp folder removed`);
  assert.deepEqual(w.kills, []);
  assert.equal(w.loaded, false);
  assert.equal(existsSync(r.dir), false);
});

test('with no launchctl injected it refuses under the test runner, before asking launchd anything', async (t) => {
  const w = world(t);
  assert.notEqual(process.env.NODE_TEST_CONTEXT, undefined, 'this file runs under node --test');
  await assert.rejects(
    serviceLiveCheck({ tmp: w.root, kill: w.kill, get: w.get, sleep: w.sleep }),
    /refusing to run the real launchctl under the test runner/,
  );
  assert.deepEqual(readdirSync(w.root), []);
});

test('main prints each line as it comes and exits 0 on a pass, 1 on a failure or a throw', async () => {
  const out = [];
  const write = (line) => out.push(line);
  const passing = async ({ log }) => {
    log('1 on: fine');
    return { ok: true };
  };
  assert.equal(await main({ check: passing, write }), 0);
  assert.equal(await main({ check: async () => ({ ok: false }), write }), 1);
  // The default check, under the test runner: the guard's refusal is printed, not thrown.
  assert.equal(await main({ write }), 1);
  assert.deepEqual(out, ['1 on: fine', 'service-live-check: refusing to run the real launchctl under the test runner']);
});

test('static: the source names only the scratch label and no login-item folder', () => {
  const source = readFileSync(SOURCE, 'utf8');
  assert.equal(CHECK_LABEL, 'com.pir.api-service.check');
  assert.ok(source.includes(CHECK_LABEL));
  // The real label is the scratch one without its suffix; it must not appear, in code or comment.
  assert.deepEqual(source.match(/com\.pir\.api-service(?!\.check)/g), null);
  assert.equal(source.includes('SERVICE_LABEL'), false, 'the real label is not imported either');
  // A plist there would be loaded again at the next login.
  assert.equal(/LaunchAgents|LaunchDaemons/.test(source), false);
  // The temp folder is the only root it builds a path from.
  assert.equal(/homedir|userInfo|env\.HOME/.test(source), false);
});
