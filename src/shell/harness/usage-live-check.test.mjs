// usage-live-check.mjs with a fake harness child (plans/api-service T10). No test here starts a real
// session: `spawn` is always a fake, and the check itself refuses the real one under the test runner.
// The service is a fake too, except in the one test that runs the real one on a temp home to show the
// check looks for readings where a run with that scratch home writes them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serializeReading, readingFromEvent } from '../../core/usage.mjs';
import { FIXTURE, expectedBody, main, usageEvents, usageLiveCheck } from './usage-live-check.mjs';

const R5 = 1790673000;
const R7 = 1790830800;

const event = (five, seven) => ({
  type: 'rate_limit_event',
  rate_limit_info: {
    status: 'allowed',
    unifiedWindows: { five_hour: { utilization: five, resetsAt: R5 }, seven_day: { utilization: seven, resetsAt: R7 } },
  },
});
const entry = (t, five, seven) => ({ t, dir: 'in', event: event(five, seven) });
const body = (t, five, seven) => ({
  version: 1,
  observed_at: t,
  rate_limits: { five_hour: { used_percentage: five, resets_at: R5 }, seven_day: { used_percentage: seven, resets_at: R7 } },
});
const NULLS = { version: 1, observed_at: null, rate_limits: null };
const ok200 = (value) => ({ status: 200, body: JSON.stringify(value) });

function scratch(t) {
  const root = mkdtempSync(join(tmpdir(), 'pir-usage-live-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return join(root, 'into');
}

const controlOf = (into) => join(into, 'plans', FIXTURE, '.parallel', 'control');

function writeLogs(into, logs) {
  const dir = join(controlOf(into), 'conversations');
  mkdirSync(dir, { recursive: true });
  for (const [name, entries] of Object.entries(logs)) {
    writeFileSync(join(dir, name), entries.map((e) => (typeof e === 'string' ? e : JSON.stringify(e))).join('\n') + '\n');
  }
}

// A check wired to fakes. `answers` are the /v1/usage answers in order; the harness child exits with
// `exitCode` during the last but one, so the last is the one asked after the run. `logs` are written by
// the fake child when it starts, as the run's conversations. `haltEnds: false` is a harness that
// ignores HALT.
function rig(t, { answers, logs = {}, exitCode = 0, haltEnds = true, onGet } = {}) {
  const into = scratch(t);
  const seen = { spawned: [], service: [], closed: 0, killed: [], halted: [], teardowns: [], gets: [], lines: [] };
  const child = new EventEmitter();
  child.kill = (signal) => seen.killed.push(signal);
  const signals = new EventEmitter();
  let calls = 0;
  const opts = {
    into,
    env: { HOME: '/nowhere' },
    signals,
    log: (line) => seen.lines.push(line),
    sleep: async () => {},
    now: () => 1_000,
    spawn: (cmd, args, options) => {
      seen.spawned.push({ cmd, args, options });
      writeLogs(into, logs);
      return child;
    },
    startService: async (o) => {
      seen.service.push(o);
      return {
        url: 'http://127.0.0.1:1',
        close: async () => {
          seen.closed += 1;
        },
      };
    },
    get: async (url, o) => {
      seen.gets.push({ url, o });
      const i = calls;
      calls += 1;
      if (onGet) await onGet(i, { child, signals });
      if (i === answers.length - 2) child.emit('exit', exitCode, null);
      return answers[i] === null ? null : ok200(answers[i]);
    },
    halt: (dir) => {
      seen.halted.push(dir);
      if (haltEnds) child.emit('exit', 1, null);
    },
    teardown: async (o) => {
      seen.teardowns.push(o);
      return { closed: [] };
    },
  };
  return { into, seen, opts, child, signals };
}

test('the API serving the newest event, with two distinct times seen → ok', async (t) => {
  const r = rig(t, {
    answers: [NULLS, body(100, 20, 11), body(100, 20, 11), body(300, 21.5, 11), body(300, 21.5, 11)],
    logs: {
      'T01-implement-1.ndjson': [{ t: 50, dir: 'in', event: { type: 'assistant' } }, entry(100, 0.2, 0.11), { t: 120, dir: 'out', event: { type: 'user' } }],
      'T02-implement-1.ndjson': [entry(200, 0.21, 0.11), entry(300, 0.215, 0.11)],
      'notes.txt': ['not a log'],
    },
  });
  const result = await usageLiveCheck(r.opts);

  assert.equal(result.ok, true, result.text);
  assert.equal(result.polls, 5);
  assert.equal(result.distinct, 2);
  assert.equal(result.events, 3);
  assert.equal(result.withWindows, 3);
  assert.deepEqual(result.api, body(300, 21.5, 11));
  assert.deepEqual(result.newest, body(300, 21.5, 11));
  assert.equal(
    result.text,
    [
      'harness run: passed (exit 0)',
      'polls: 5, distinct observed_at: 2',
      'events: 3 rate_limit_event in 2 conversation logs, 3 with unifiedWindows',
      `newest event: observed_at 300, five_hour 21.5 % resets ${R5}, seven_day 11 % resets ${R7}`,
      `api:          observed_at 300, five_hour 21.5 % resets ${R5}, seven_day 11 % resets ${R7}`,
      'usage-live-check: passed',
    ].join('\n'),
  );

  // The harness run as a child, on the scratch repo named.
  assert.equal(r.seen.spawned.length, 1);
  const { cmd, args } = r.seen.spawned[0];
  assert.equal(cmd, process.execPath);
  assert.deepEqual(args, [fileURLToPath(new URL('./run.mjs', import.meta.url)), 'usage-live', '--into', r.into]);
  // The service on the home the harness gives a statusSnapshots scenario.
  assert.equal(r.seen.service.length, 1);
  assert.equal(r.seen.service[0].env.PIR_HOME, join(r.into, 'plans', 'usage-live', '.parallel', 'pir-home'));
  assert.equal(r.seen.service[0].env.HOME, '/nowhere', 'the rest of the environment is passed on unaltered');
  assert.ok(r.seen.gets.every((g) => g.url === 'http://127.0.0.1:1/v1/usage'));
  // Each new time is printed once, as it is first seen.
  assert.deepEqual(r.seen.lines.filter((l) => l.startsWith('poll ')).map((l) => l.split(':')[0]), ['poll 2', 'poll 4']);
  // A run that ended by itself is not halted or killed; the service is closed once.
  assert.equal(r.seen.closed, 1);
  assert.deepEqual(r.seen.killed, []);
  assert.deepEqual(r.seen.halted, []);
  assert.deepEqual(r.seen.teardowns, []);
  assert.equal(r.signals.listenerCount('SIGINT') + r.signals.listenerCount('SIGTERM') + r.signals.listenerCount('SIGHUP'), 0);
});

test('the API one event behind the log → not ok, the text shows both', async (t) => {
  const r = rig(t, {
    answers: [body(100, 20, 11), body(200, 21, 11), body(200, 21, 11)],
    logs: { 'T01-implement-1.ndjson': [entry(100, 0.2, 0.11), entry(200, 0.21, 0.11), entry(300, 0.22, 0.11)] },
  });
  const result = await usageLiveCheck(r.opts);
  assert.equal(result.ok, false);
  assert.equal(result.distinct, 2);
  assert.match(result.text, new RegExp(`^newest event: observed_at 300, five_hour 22 % resets ${R5}`, 'm'));
  assert.match(result.text, new RegExp(`^api: {10}observed_at 200, five_hour 21 % resets ${R5}`, 'm'));
  assert.match(result.text, /^usage-live-check: FAILED: the API's observed_at 200 is not the newest event's t 300$/m);
});

test('the right time with other numbers → not ok', async (t) => {
  const r = rig(t, {
    answers: [body(100, 20, 11), body(200, 99, 11), body(200, 99, 11)],
    logs: { 'T01-implement-1.ndjson': [entry(100, 0.2, 0.11), entry(200, 0.21, 0.11)] },
  });
  const result = await usageLiveCheck(r.opts);
  assert.equal(result.ok, false);
  assert.match(result.text, /FAILED: the API's windows are not the newest event's unifiedWindows$/);
});

test('one distinct time only → not ok, the text says observed_at did not move', async (t) => {
  const r = rig(t, {
    answers: [body(100, 20, 11), body(100, 20, 11), body(100, 20, 11)],
    logs: { 'T01-implement-1.ndjson': [entry(100, 0.2, 0.11)] },
  });
  const result = await usageLiveCheck(r.opts);
  assert.equal(result.ok, false);
  assert.equal(result.distinct, 1);
  assert.match(result.text, /^usage-live-check: FAILED: observed_at did not move: 1 distinct value over 3 polls$/m);
});

test('no rate_limit_event in any log → not ok, the text names the login', async (t) => {
  const r = rig(t, {
    answers: [NULLS, NULLS, NULLS],
    logs: { 'T01-implement-1.ndjson': [{ t: 50, dir: 'in', event: { type: 'assistant' } }] },
  });
  const result = await usageLiveCheck(r.opts);
  assert.equal(result.ok, false);
  assert.equal(result.events, 0);
  assert.equal(result.newest, null);
  assert.match(result.text, /^events: 0 rate_limit_event in 1 conversation log, 0 with unifiedWindows$/m);
  assert.match(result.text, /^newest event: none$/m);
  assert.match(result.text, /^api: {10}observed_at null, five_hour null, seven_day null$/m);
  assert.match(result.text, /FAILED: no rate_limit_event in any conversation log: this login sends none\. Check it with: claude auth status \(expect loggedIn true, authMethod claude\.ai\); observed_at did not move: 0 distinct values over 3 polls$/);
});

test('the run failing → not ok, whatever the numbers', async (t) => {
  const r = rig(t, {
    exitCode: 1,
    answers: [body(100, 20, 11), body(200, 21, 11), body(200, 21, 11)],
    logs: { 'T01-implement-1.ndjson': [entry(100, 0.2, 0.11), entry(200, 0.21, 0.11)] },
  });
  const result = await usageLiveCheck(r.opts);
  assert.equal(result.ok, false);
  assert.match(result.text, /^harness run: FAILED \(exit 1\)$/m);
  assert.match(result.text, /^usage-live-check: FAILED: the harness run failed \(exit 1\)$/m);
  assert.equal(r.seen.closed, 1);
});

test('an event with no unifiedWindows as the newest → not ok: the API keeps the reading before it', async (t) => {
  const bare = { t: 300, dir: 'in', event: { type: 'rate_limit_event', rate_limit_info: { status: 'allowed', resetsAt: R5 } } };
  const r = rig(t, {
    answers: [body(100, 20, 11), body(200, 21, 11), body(200, 21, 11)],
    logs: { 'T01-implement-1.ndjson': [entry(100, 0.2, 0.11), entry(200, 0.21, 0.11), bare] },
  });
  const result = await usageLiveCheck(r.opts);
  assert.equal(result.ok, false);
  assert.equal(result.events, 3);
  assert.equal(result.withWindows, 2);
  assert.match(result.text, /^newest event: observed_at 300, five_hour null, seven_day null$/m);
});

test('two events in the same millisecond: either one is the newest', async (t) => {
  for (const served of [body(200, 21, 11), body(200, 22, 11)]) {
    const r = rig(t, {
      answers: [body(100, 20, 11), served, served],
      logs: { 'T01-implement-1.ndjson': [entry(100, 0.2, 0.11), entry(200, 0.21, 0.11)], 'T02-implement-1.ndjson': [entry(200, 0.22, 0.11)] },
    });
    const result = await usageLiveCheck(r.opts);
    assert.equal(result.ok, true, result.text);
    assert.deepEqual(result.newest, served);
  }
});

test('the service not answering after the run → not ok', async (t) => {
  const r = rig(t, {
    answers: [body(100, 20, 11), body(200, 21, 11), null],
    logs: { 'T01-implement-1.ndjson': [entry(100, 0.2, 0.11), entry(200, 0.21, 0.11)] },
  });
  const result = await usageLiveCheck(r.opts);
  assert.equal(result.ok, false);
  assert.equal(result.api, null);
  assert.match(result.text, /^api: {10}no answer$/m);
  assert.match(result.text, /FAILED: GET \/v1\/usage did not answer after the run$/);
});

test('a throw mid-run: the run is halted and the service closed before the error leaves', async (t) => {
  const r = rig(t, {
    answers: [NULLS, NULLS, NULLS, NULLS],
    onGet: (i) => {
      if (i === 1) throw new Error('boom');
    },
  });
  await assert.rejects(usageLiveCheck(r.opts), /boom/);
  assert.deepEqual(r.seen.halted, [controlOf(r.into)]);
  // The harness stopped on HALT, so it was not killed and nothing was left to reap.
  assert.deepEqual(r.seen.killed, []);
  assert.deepEqual(r.seen.teardowns, []);
  assert.equal(r.seen.closed, 1);
  assert.equal(r.signals.listenerCount('SIGINT'), 0);
});

test('a harness that ignores HALT is killed and its workers reaped, then the service closed', async (t) => {
  const r = rig(t, {
    haltEnds: false,
    answers: [NULLS, NULLS, NULLS, NULLS],
    onGet: (i) => {
      if (i === 1) throw new Error('boom');
    },
  });
  await assert.rejects(usageLiveCheck(r.opts), /boom/);
  assert.deepEqual(r.seen.halted, [controlOf(r.into)]);
  assert.deepEqual(r.seen.killed, ['SIGTERM']);
  assert.deepEqual(r.seen.teardowns, [{ controlDir: controlOf(r.into) }]);
  assert.equal(r.seen.closed, 1);
});

test('a signal stops the polling, halts the run and fails the check', async (t) => {
  const r = rig(t, {
    answers: [body(100, 20, 11), body(200, 21, 11), body(200, 21, 11), body(200, 21, 11)],
    logs: { 'T01-implement-1.ndjson': [entry(100, 0.2, 0.11), entry(200, 0.21, 0.11)] },
    onGet: (i, { signals }) => {
      if (i === 1) signals.emit('SIGINT', 'SIGINT');
    },
  });
  const result = await usageLiveCheck(r.opts);
  assert.equal(result.ok, false);
  assert.equal(result.polls, 2, 'no poll after the signal');
  assert.deepEqual(r.seen.halted, [controlOf(r.into)]);
  assert.equal(r.seen.closed, 1);
  assert.match(result.text, /^usage-live-check: FAILED: interrupted by SIGINT; the harness run failed \(exit 1\)/m);
});

test('a harness still running at the limit is halted and the check fails', async (t) => {
  let clock = 0;
  const r = rig(t, { answers: [NULLS, NULLS, NULLS, NULLS, NULLS, NULLS] });
  const result = await usageLiveCheck({ ...r.opts, maxMs: 120_000, now: () => (clock += 50_000) });
  assert.equal(result.ok, false);
  assert.deepEqual(r.seen.halted, [controlOf(r.into)]);
  assert.match(result.text, /FAILED: the harness was still running after 2 min/);
});

test('the service that cannot start: nothing is spawned and the error leaves', async (t) => {
  const r = rig(t, { answers: [NULLS, NULLS] });
  await assert.rejects(
    usageLiveCheck({
      ...r.opts,
      startService: async () => {
        throw new Error('no service');
      },
    }),
    /no service/,
  );
  assert.equal(r.seen.spawned.length, 0);
});

test('it refuses a scratch folder that already exists, and the real spawn under the test runner', async (t) => {
  const r = rig(t, { answers: [NULLS, NULLS] });
  mkdirSync(r.into, { recursive: true });
  const result = await usageLiveCheck(r.opts);
  assert.equal(result.ok, false);
  assert.equal(result.text, `usage-live-check: FAILED: ${r.into} already exists; remove it first (rm -rf ${r.into})`);
  assert.equal(r.seen.spawned.length, 0);
  assert.equal(r.seen.service.length, 0);

  const { spawn, ...rest } = rig(t, { answers: [NULLS, NULLS] }).opts;
  await assert.rejects(usageLiveCheck({ ...rest, env: { NODE_TEST_CONTEXT: 'child-v8' } }), /refusing to start real sessions under the test runner/);
  await assert.rejects(usageLiveCheck({ ...rest, into: undefined }), /refusing|no scratch folder/);
});

test('the real service on the scratch home serves what a run writes there, and is closed afterwards', async (t) => {
  const into = scratch(t);
  const pirHome = join(into, 'plans', FIXTURE, '.parallel', 'pir-home');
  const usageFile = join(pirHome, '.pir', 'usage.json');
  const t1 = Date.now() - 2000;
  const t2 = t1 + 1000;
  const save = (at, five) => writeFileSync(usageFile, serializeReading(readingFromEvent(event(five, 0.11), at)));
  const child = new EventEmitter();
  child.kill = () => {};
  let sleeps = 0;
  const result = await usageLiveCheck({
    into,
    // A scratch home read from PIR_HOME, so the inherited NODE_TEST_CONTEXT does not refuse the service.
    env: { ...process.env },
    signals: new EventEmitter(),
    spawn: () => {
      writeLogs(into, { 'T01-implement-1.ndjson': [entry(t1, 0.2, 0.11), entry(t2, 1.4, 0.11)] });
      save(t1, 0.2);
      return child;
    },
    // The fake run does its next step between two polls.
    sleep: async () => {
      sleeps += 1;
      if (sleeps === 1) save(t2, 1.4);
      if (sleeps === 2) child.emit('exit', 0, null);
    },
  });
  assert.equal(result.ok, true, result.text);
  assert.equal(result.distinct, 2);
  // Utilization above 1 is served as 100 %.
  assert.deepEqual(result.api, { version: 1, observed_at: t2, rate_limits: { five_hour: { used_percentage: 100, resets_at: R5 }, seven_day: { used_percentage: 11, resets_at: R7 } } });
  assert.equal(existsSync(join(pirHome, '.pir', 'api.json')), false, 'closed: its api.json is removed');
});

test('usageEvents: oldest first across files, torn lines skipped, a missing folder is no events', (t) => {
  const into = scratch(t);
  assert.deepEqual(usageEvents(join(controlOf(into), 'conversations')), { files: 0, events: [] });
  writeLogs(into, {
    'b.ndjson': [entry(300, 0.3, 0.1), '{"t":400,"dir":"in","event":{"type":"rate_limit_ev'],
    'a.ndjson': [entry(200, 0.2, 0.1), { t: 'soon', dir: 'in', event: event(0.9, 0.9) }, { t: 250, dir: 'out', event: event(0.9, 0.9) }],
  });
  const { files, events } = usageEvents(join(controlOf(into), 'conversations'));
  assert.equal(files, 2);
  assert.deepEqual(events.map((e) => [e.t, e.file]), [[200, 'a.ndjson'], [300, 'b.ndjson']]);
});

test('expectedBody: a percentage to two decimals, an invalid window null', () => {
  assert.deepEqual(expectedBody(entry(5, 0.11, 0.123456)).rate_limits, {
    five_hour: { used_percentage: 11, resets_at: R5 },
    seven_day: { used_percentage: 12.35, resets_at: R7 },
  });
  const half = { t: 5, event: { type: 'rate_limit_event', rate_limit_info: { unifiedWindows: { five_hour: { utilization: '0.5', resetsAt: R5 }, seven_day: { utilization: 0.5, resetsAt: R7 } } } } };
  assert.deepEqual(expectedBody(half).rate_limits, { five_hour: null, seven_day: { used_percentage: 50, resets_at: R7 } });
});

test('main: prints the text and exits 0 or 1; without --into it prints the usage line', async () => {
  const run = async (argv, check) => {
    const lines = [];
    const code = await main(argv, { check, write: (l) => lines.push(l) });
    return { code, lines };
  };
  const seen = [];
  const pass = await run(['--into', '/tmp/x'], async (o) => {
    seen.push(o.into);
    o.log('progress');
    return { ok: true, text: 'fine' };
  });
  assert.deepEqual(pass, { code: 0, lines: ['progress', 'fine'] });
  assert.deepEqual(seen, ['/tmp/x']);
  assert.deepEqual(await run(['--into', '/tmp/x'], async () => ({ ok: false, text: 'bad' })), { code: 1, lines: ['bad'] });
  assert.deepEqual(
    await run(['--into', '/tmp/x'], async () => {
      throw new Error('refused');
    }),
    { code: 1, lines: ['usage-live-check: refused'] },
  );
  const none = await run([], async () => assert.fail('not called'));
  assert.equal(none.code, 1);
  assert.match(none.lines[0], /^usage: node src\/shell\/harness\/usage-live-check\.mjs --into /);
});
