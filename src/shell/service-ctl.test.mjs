// service-ctl against a fake launchctl that records its calls, a fake `get`, and a temp folder that
// stands for the home (plans/api-service T06). The "real machine" here is simulated: `osHome` is the
// temp folder and the injected `env` names it as HOME with no NODE_TEST_CONTEXT, so homeKind reads
// `real` while nothing can reach the person's home. No test runs the real launchctl (DESIGN §5.2).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { serviceOn, serviceOff, serviceRefresh, serviceStatus, resolveNodePath, httpGet, main } from './service-ctl.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolvePath(HERE, '..');
const MODULE = join(HERE, 'service-ctl.mjs');
const LABEL = 'com.pir.api-service';
const UID = 501;
const TARGET = `gui/${UID}/${LABEL}`;
const REAL_URL = 'http://127.0.0.1:47717';

const HEALTH = { status: 200, body: JSON.stringify({ version: 1, status: 'ok', pid: 4711 }) };
const USAGE = {
  status: 200,
  body: JSON.stringify({
    version: 1,
    observed_at: 1_000_000,
    rate_limits: {
      five_hour: { used_percentage: 97, resets_at: 1790673000 },
      seven_day: { used_percentage: 77, resets_at: 1790830800 },
    },
  }),
};
const NOW = 1_000_000 + 2 * 60_000;
const RETRY_HINT = 'try: pir service off, then pir service on';

// A fake launchd. `loaded` follows bootstrap and bootout the way the real one does; `bootstrapFails`
// is how many bootstraps fail with code 5 before one succeeds; `printOut` is what `print` says.
function fakeLaunchctl({ loaded = false, bootstrapFails = 0, printOut = 'state = running\n', stderr = 'Bootstrap failed: 5: Input/output error\nTry re-running the command as root for richer errors.\n' } = {}) {
  const calls = [];
  const state = { loaded, failsLeft: bootstrapFails };
  const launchctl = (args) => {
    calls.push(args);
    const [verb] = args;
    if (verb === 'print') {
      return state.loaded ? { status: 0, stdout: printOut, stderr: '' } : { status: 113, stdout: '', stderr: 'Could not find service' };
    }
    if (verb === 'bootout') {
      if (!state.loaded) return { status: 3, stdout: '', stderr: 'Boot-out failed: 3: No such process' };
      state.loaded = false;
      return { status: 0, stdout: '', stderr: '' };
    }
    if (verb === 'bootstrap') {
      if (state.failsLeft > 0) {
        state.failsLeft -= 1;
        return { status: 5, stdout: '', stderr };
      }
      state.loaded = true;
      return { status: 0, stdout: '', stderr: '' };
    }
    throw new Error(`fake launchctl: unexpected ${args.join(' ')}`);
  };
  return { launchctl, calls, state, verbs: () => calls.map((c) => c[0]).filter((v) => v !== 'print') };
}

// A fake `get` from a table of url → answer (or a function of the call count). Unlisted urls get null.
function fakeGet(table = {}) {
  const calls = [];
  const get = async (url, options) => {
    calls.push({ url, options });
    const answer = table[url];
    return typeof answer === 'function' ? answer(calls.length) : (answer ?? null);
  };
  return { get, calls };
}

const UP = { [`${REAL_URL}/health`]: HEALTH, [`${REAL_URL}/v1/usage`]: USAGE };

// One simulated machine: a temp home that is "the real one", the installed engine's script path, a
// clock that only the fake sleep moves.
function machine(t, { launchd = {}, answers = UP, env, ...over } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'pir-service-ctl-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const fake = fakeLaunchctl(launchd);
  const http = fakeGet(answers);
  const clock = { t: NOW };
  const sleeps = [];
  const opts = {
    env: env ? env(home) : { HOME: home },
    osHome: home,
    platform: 'darwin',
    launchctl: fake.launchctl,
    get: http.get,
    scriptPath: `${home}/.claude/pir-engine/src/shell/api-service.mjs`,
    nodePath: '/opt/fake/bin/node',
    uid: UID,
    now: () => clock.t,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock.t += ms;
    },
    ...over,
  };
  return {
    home,
    opts,
    fake,
    http,
    sleeps,
    plist: join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`),
    marker: join(home, '.pir', 'api-service.off'),
    discovery: join(home, '.pir', 'api.json'),
  };
}

// Every file under a folder, as sorted relative paths: "wrote no file" is asserted on the whole home.
function filesUnder(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const path = join(d, entry.name);
      if (entry.isDirectory()) walk(path);
      else out.push(relative(dir, path));
    }
  };
  walk(dir);
  return out.sort();
}

function writeMarker(m) {
  mkdirSync(dirname(m.marker), { recursive: true });
  writeFileSync(m.marker, '');
}

const RUNNING_TEXT = `pir service: running at ${REAL_URL} (pid 4711)\nlast usage reading 2 min ago: 5-hour 97%, weekly 77%`;

// ── on ──────────────────────────────────────────────────────────────────────────────────────────

test('on, not loaded: writes a plist plutil accepts, bootstraps it, removes the marker', async (t) => {
  const m = machine(t);
  writeMarker(m);
  const result = await serviceOn(m.opts);

  assert.deepEqual(result, { text: RUNNING_TEXT, code: 0 });
  assert.deepEqual(m.fake.verbs(), ['bootstrap']);
  assert.deepEqual(m.fake.calls.find((c) => c[0] === 'bootstrap'), ['bootstrap', `gui/${UID}`, m.plist]);
  assert.equal(existsSync(m.marker), false);

  const plist = readFileSync(m.plist, 'utf8');
  assert.match(plist, /<string>\/opt\/fake\/bin\/node<\/string>/);
  assert.ok(plist.includes(`<string>${m.opts.scriptPath}</string>`));
  assert.ok(plist.includes(`<string>${LABEL}</string>`));
  if (process.platform === 'darwin') {
    const lint = spawnSync('/usr/bin/plutil', ['-lint', m.plist], { encoding: 'utf8' });
    assert.equal(lint.status, 0, lint.stdout + lint.stderr);
  }
  // No temp file is left beside the plist: launchd loads every plist-looking file in that folder.
  assert.deepEqual(readdirSync(dirname(m.plist)), [`${LABEL}.plist`]);
});

test('on, already loaded: bootout first, then bootstrap, and the plist is written before either', async (t) => {
  const m = machine(t, { launchd: { loaded: true } });
  let plistAtBootout = null;
  const inner = m.opts.launchctl;
  m.opts.launchctl = (args) => {
    if (args[0] === 'bootout') plistAtBootout = existsSync(m.plist);
    return inner(args);
  };
  const result = await serviceOn(m.opts);

  assert.equal(result.code, 0);
  assert.deepEqual(m.fake.verbs(), ['bootout', 'bootstrap']);
  assert.deepEqual(m.fake.calls.find((c) => c[0] === 'bootout'), ['bootout', TARGET]);
  assert.equal(plistAtBootout, true);
});

test('bootstrap failing twice with status 5 then succeeding: three calls, 300 ms apart, success', async (t) => {
  const m = machine(t, { launchd: { bootstrapFails: 2 } });
  const result = await serviceOn(m.opts);

  assert.deepEqual(result, { text: RUNNING_TEXT, code: 0 });
  assert.equal(m.fake.calls.filter((c) => c[0] === 'bootstrap').length, 3);
  assert.deepEqual(m.sleeps, [300, 300]);
});

test('bootstrap failing ten times: code 1 and the "would not register" text with the first stderr line', async (t) => {
  const m = machine(t, { launchd: { bootstrapFails: 99 } });
  const result = await serviceOn(m.opts);

  assert.deepEqual(result, {
    text: `pir service: macOS would not register it: Bootstrap failed: 5: Input/output error\n${RETRY_HINT}`,
    code: 1,
  });
  assert.equal(m.fake.calls.filter((c) => c[0] === 'bootstrap').length, 10);
  assert.deepEqual(m.sleeps, Array(9).fill(300));
  // The plan ended there: nothing waited for an answer.
  assert.equal(m.http.calls.length, 0);
});

test('on waits for the answer: polls /health until the service is up, then reports it', async (t) => {
  const m = machine(t, {
    answers: { [`${REAL_URL}/health`]: (n) => (n >= 4 ? HEALTH : null), [`${REAL_URL}/v1/usage`]: USAGE },
  });
  const result = await serviceOn(m.opts);

  assert.equal(result.code, 0);
  assert.match(result.text, /^pir service: running at /);
  assert.deepEqual(m.sleeps, [200, 200, 200]);
});

test('on gives up waiting after 5 s and says registered but not answering', async (t) => {
  const m = machine(t, { answers: {}, launchd: { printOut: 'state = spawn scheduled\n\tlast exit code = 1\n' } });
  const result = await serviceOn(m.opts);

  assert.deepEqual(result, {
    text: `pir service: registered but not answering (last exit code 1)\n${RETRY_HINT}`,
    code: 1,
  });
  assert.equal(m.sleeps.reduce((a, b) => a + b, 0), 5000);
});

// ── off ─────────────────────────────────────────────────────────────────────────────────────────

test('off: bootout, plist removed, marker written, code 0', async (t) => {
  const m = machine(t, { launchd: { loaded: true } });
  mkdirSync(dirname(m.plist), { recursive: true });
  writeFileSync(m.plist, 'old');
  const result = await serviceOff(m.opts);

  assert.deepEqual(result, { text: 'pir service: off', code: 0 });
  assert.deepEqual(m.fake.verbs(), ['bootout']);
  assert.equal(existsSync(m.plist), false);
  assert.equal(readFileSync(m.marker, 'utf8'), '');
});

test('off: a bootout answering status 3 is not an error', async (t) => {
  const m = machine(t, { launchd: { loaded: true } });
  const inner = m.opts.launchctl;
  // Loaded when asked, gone by the time bootout runs: the race the tolerance exists for.
  m.opts.launchctl = (args) => {
    const res = inner(args);
    return args[0] === 'bootout' ? { status: 3, stdout: '', stderr: 'Boot-out failed: 3: No such process' } : res;
  };
  const result = await serviceOff(m.opts);

  assert.deepEqual(result, { text: 'pir service: off', code: 0 });
  assert.equal(existsSync(m.marker), true);
});

test('off when nothing is loaded makes no bootout call and still leaves the marker', async (t) => {
  const m = machine(t);
  const result = await serviceOff(m.opts);

  assert.deepEqual(result, { text: 'pir service: off', code: 0 });
  assert.deepEqual(m.fake.verbs(), []);
  assert.equal(existsSync(m.marker), true);
});

test('off removes an api.json whose pid is dead and keeps one whose pid is alive', async (t) => {
  const dead = spawnSync(process.execPath, ['-e', '']).pid;
  assert.ok(Number.isInteger(dead) && dead > 0);

  const stale = machine(t, { launchd: { loaded: true } });
  mkdirSync(dirname(stale.discovery), { recursive: true });
  writeFileSync(stale.discovery, JSON.stringify({ version: 1, url: REAL_URL, pid: dead }));
  await serviceOff(stale.opts);
  assert.equal(existsSync(stale.discovery), false);

  const live = machine(t, { launchd: { loaded: true } });
  mkdirSync(dirname(live.discovery), { recursive: true });
  writeFileSync(live.discovery, JSON.stringify({ version: 1, url: REAL_URL, pid: process.pid }));
  await serviceOff(live.opts);
  assert.equal(existsSync(live.discovery), true);
});

test('off removes an api.json that names no pid at all', async (t) => {
  for (const text of ['{ not json', JSON.stringify({ version: 1, url: REAL_URL, pid: 0 })]) {
    const m = machine(t);
    mkdirSync(dirname(m.discovery), { recursive: true });
    writeFileSync(m.discovery, text);
    await serviceOff(m.opts);
    assert.equal(existsSync(m.discovery), false, text);
  }
});

// ── refresh ─────────────────────────────────────────────────────────────────────────────────────

test('refresh with the marker present: no launchctl call, the "is off" message, code 0', async (t) => {
  const m = machine(t, { launchd: { loaded: true } });
  writeMarker(m);
  const result = await serviceRefresh(m.opts);

  assert.deepEqual(result, { text: 'the API service is off (pir service on turns it on)', code: 0 });
  assert.deepEqual(m.fake.calls, []);
  assert.equal(existsSync(m.plist), false);
});

test('refresh without the marker: plist rewritten, bootout then bootstrap', async (t) => {
  const m = machine(t, { launchd: { loaded: true } });
  mkdirSync(dirname(m.plist), { recursive: true });
  writeFileSync(m.plist, 'a plist naming a node that has moved');
  const result = await serviceRefresh(m.opts);

  assert.deepEqual(result, { text: RUNNING_TEXT, code: 0 });
  assert.deepEqual(m.fake.verbs(), ['bootout', 'bootstrap']);
  assert.match(readFileSync(m.plist, 'utf8'), /<string>\/opt\/fake\/bin\/node<\/string>/);
  assert.equal(existsSync(m.marker), false);
});

// ── the refusals ────────────────────────────────────────────────────────────────────────────────

test('scratch home, and the real home under NODE_TEST_CONTEXT: no launchctl call and no file written', async (t) => {
  const homes = {
    scratch: (home) => ({ HOME: '/somewhere/else', PIR_HOME: join(home, 'scratch') }),
    'test-real': (home) => ({ HOME: home, NODE_TEST_CONTEXT: 'child-v8' }),
  };
  for (const [kind, env] of Object.entries(homes)) {
    for (const action of [serviceOn, serviceOff, serviceRefresh]) {
      const m = machine(t, { env, launchd: { loaded: true } });
      const result = await action(m.opts);
      assert.deepEqual(result, { text: 'skipped the API service (not the real home)', code: 0 }, `${kind} ${action.name}`);
      assert.deepEqual(m.fake.calls, [], `${kind} ${action.name}`);
      assert.deepEqual(filesUnder(m.home), [], `${kind} ${action.name}`);
    }
  }
});

test('scriptPath outside the installed engine: on and refresh refuse with code 1 and change nothing', async (t) => {
  for (const action of [serviceOn, serviceRefresh]) {
    const m = machine(t, { scriptPath: MODULE.replace('service-ctl.mjs', 'api-service.mjs'), launchd: { loaded: true } });
    const result = await action(m.opts);
    assert.deepEqual(result, { text: 'pir service: run the installed pir (./install.sh first)', code: 1 }, action.name);
    assert.deepEqual(m.fake.calls, []);
    assert.deepEqual(filesUnder(m.home), []);
  }
});

test('off works from a copy that is not the installed engine', async (t) => {
  const m = machine(t, { scriptPath: '/some/checkout/src/shell/api-service.mjs', launchd: { loaded: true } });
  const result = await serviceOff(m.opts);
  assert.deepEqual(result, { text: 'pir service: off', code: 0 });
  assert.deepEqual(m.fake.verbs(), ['bootout']);
});

test('platform linux: the macOS message and no call, for every action and for the status check', async (t) => {
  const expected = { [serviceOn.name]: 1, [serviceOff.name]: 1, [serviceRefresh.name]: 0, [serviceStatus.name]: 1 };
  for (const action of [serviceOn, serviceOff, serviceRefresh, serviceStatus]) {
    const m = machine(t, { platform: 'linux', launchd: { loaded: true } });
    const result = await action(m.opts);
    assert.deepEqual(result, { text: 'pir service needs macOS (launchd)', code: expected[action.name] }, action.name);
    assert.deepEqual(m.fake.calls, []);
    assert.equal(m.http.calls.length, 0);
    assert.deepEqual(filesUnder(m.home), []);
  }
});

// ── the node path ───────────────────────────────────────────────────────────────────────────────

test('nodePath is what `command -v node` printed, not its realpath', async (t) => {
  const bin = mkdtempSync(join(tmpdir(), 'pir-service-ctl-bin-'));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  // A symlink, as Homebrew's node is: resolving it would give process.execPath's own path.
  const link = join(bin, 'node');
  spawnSync('/bin/ln', ['-s', process.execPath, link]);
  const seen = [];
  const exec = (file, args) => {
    seen.push([file, args]);
    return `${link}\n`;
  };
  assert.equal(resolveNodePath({ exec }), link);
  assert.deepEqual(seen, [['/bin/sh', ['-c', 'command -v node']]]);

  // Through `on`, with no nodePath given: the plist names the symlink.
  const m = machine(t, { nodePath: undefined, exec });
  await serviceOn(m.opts);
  assert.ok(readFileSync(m.plist, 'utf8').includes(`<string>${link}</string>`));
});

test('nodePath falls back to the running node when the shell finds none', () => {
  assert.equal(resolveNodePath({ exec: () => { throw new Error('exit 1'); } }), process.execPath);
  assert.equal(resolveNodePath({ exec: () => '\n' }), process.execPath);
  // An alias or a function prints a word, not a path; launchd could not run it.
  assert.equal(resolveNodePath({ exec: () => 'node\n' }), process.execPath);
});

// ── the status check ────────────────────────────────────────────────────────────────────────────

test('serviceStatus: off marker → off, without asking launchd', async (t) => {
  const m = machine(t, { launchd: { loaded: true } });
  writeMarker(m);
  assert.deepEqual(await serviceStatus(m.opts), { text: 'pir service: off\nturn it on with: pir service on', code: 1 });
  assert.deepEqual(m.fake.calls, []);
});

test('serviceStatus: not loaded → not installed', async (t) => {
  const m = machine(t);
  assert.deepEqual(await serviceStatus(m.opts), {
    text: 'pir service: not installed\nrun ./install.sh, or: pir service on',
    code: 1,
  });
  assert.deepEqual(m.fake.calls, [['print', TARGET]]);
  assert.equal(m.http.calls.length, 0);
});

test('serviceStatus: a version-1 health answer → running, pid from that body, reading from /v1/usage', async (t) => {
  const m = machine(t, { launchd: { loaded: true } });
  assert.deepEqual(await serviceStatus(m.opts), { text: RUNNING_TEXT, code: 0 });
  assert.deepEqual(m.http.calls.map((c) => c.url), [`${REAL_URL}/health`, `${REAL_URL}/v1/usage`]);
  assert.ok(m.http.calls.every((c) => Number.isFinite(c.options.timeoutMs)));
});

test('serviceStatus: running is decided by /health alone, also when /v1/usage fails', async (t) => {
  const noReading = `pir service: running at ${REAL_URL} (pid 4711)\nno usage reading yet: it arrives with the first pir run on a Claude subscription`;
  const failures = [null, { status: 500, body: '{"version":1,"error":"internal"}' }, { status: 200, body: 'nope' }, { status: 200, body: '{"version":2}' }];
  for (const usage of failures) {
    const m = machine(t, { launchd: { loaded: true }, answers: { [`${REAL_URL}/health`]: HEALTH, [`${REAL_URL}/v1/usage`]: usage } });
    assert.deepEqual(await serviceStatus(m.opts), { text: noReading, code: 0 }, JSON.stringify(usage));
  }
});

test('serviceStatus: /health answered by something else → port held', async (t) => {
  const held = 'pir service: not answering: port 47717 is held by another program\nit retries every 10 seconds and comes up once the port is free';
  const foreign = [
    { status: 200, body: '<html>hello</html>' },
    { status: 404, body: '{"version":1,"error":"not_found"}' },
    { status: 200, body: '{"version":2,"status":"ok","pid":1}' },
    { status: 200, body: '{"version":1,"status":"ok"}' },
  ];
  for (const answer of foreign) {
    const m = machine(t, { launchd: { loaded: true }, answers: { [`${REAL_URL}/health`]: answer } });
    assert.deepEqual(await serviceStatus(m.opts), { text: held, code: 1 }, JSON.stringify(answer));
    // The usage endpoint of a foreign program is never asked.
    assert.equal(m.http.calls.length, 1);
  }
});

test('serviceStatus: no answer, by launchd\'s last exit code', async (t) => {
  const cases = [
    ['\tlast exit code = 47\n', 'pir service: not answering: port 47717 is held by another program\nit retries every 10 seconds and comes up once the port is free'],
    ['\tlast exit code = 78: EX_CONFIG\n', `pir service: registered but not answering (last exit code 78)\n${RETRY_HINT}`],
    ['\tlast exit code = 1\n', `pir service: registered but not answering (last exit code 1)\n${RETRY_HINT}`],
    ['\tstate = running\n', `pir service: registered but not answering\n${RETRY_HINT}`],
    ['\tlast exit code = (never exited)\n', `pir service: registered but not answering\n${RETRY_HINT}`],
  ];
  for (const [printOut, text] of cases) {
    const m = machine(t, { launchd: { loaded: true, printOut }, answers: {} });
    assert.deepEqual(await serviceStatus(m.opts), { text, code: 1 }, printOut);
  }
});

test('serviceStatus on a scratch home: url from that home\'s api.json, no launchctl call', async (t) => {
  const url = 'http://127.0.0.1:51234';
  const m = machine(t, {
    env: (home) => ({ HOME: '/somewhere/else', PIR_HOME: home }),
    // The account's own home is elsewhere, so the temp folder is a scratch home.
    osHome: '/Users/somebody',
    launchd: { loaded: true },
    answers: { [`${url}/health`]: HEALTH, [`${url}/v1/usage`]: USAGE },
  });
  mkdirSync(dirname(m.discovery), { recursive: true });
  writeFileSync(m.discovery, JSON.stringify({ version: 1, url, pid: 4711 }));

  assert.deepEqual(await serviceStatus(m.opts), {
    text: `pir service: running at ${url} (pid 4711)\nlast usage reading 2 min ago: 5-hour 97%, weekly 77%`,
    code: 0,
  });
  assert.deepEqual(m.fake.calls, []);

  rmSync(m.discovery);
  assert.deepEqual(await serviceStatus(m.opts), { text: `pir service: registered but not answering\n${RETRY_HINT}`, code: 1 });
  assert.deepEqual(m.fake.calls, []);
});

// ── the scratch item (T09's mode) ───────────────────────────────────────────────────────────────

test('scratchItem: registers the given label from a scratch home, url read from its api.json on each poll', async (t) => {
  const label = 'com.pir.api-service.check';
  const url = 'http://127.0.0.1:51999';
  const m = machine(t, {
    env: (home) => ({ HOME: '/somewhere/else', PIR_HOME: home, NODE_TEST_CONTEXT: 'child-v8' }),
    scratchItem: true,
    label,
    scriptPath: '/some/checkout/src/shell/api-service.mjs',
    answers: { [`${url}/health`]: HEALTH, [`${url}/v1/usage`]: { status: 200, body: '{"version":1,"observed_at":null,"rate_limits":null}' } },
  });
  const plistPath = join(m.home, 'check.plist');
  m.opts.plistPath = plistPath;
  m.opts.plistEnv = { PIR_HOME: m.home };
  // The service writes api.json only once it is up: here, during the second wait.
  const sleep = m.opts.sleep;
  m.opts.sleep = async (ms) => {
    await sleep(ms);
    if (m.sleeps.length === 2) {
      mkdirSync(dirname(m.discovery), { recursive: true });
      writeFileSync(m.discovery, JSON.stringify({ version: 1, url, pid: 4711 }));
    }
  };

  const on = await serviceOn(m.opts);
  assert.equal(on.code, 0);
  assert.match(on.text, new RegExp(`^pir service: running at ${url} \\(pid 4711\\)\nno usage reading yet`));
  assert.deepEqual(m.fake.calls.filter((c) => c[0] !== 'print'), [['bootstrap', `gui/${UID}`, plistPath]]);
  assert.ok(m.fake.calls.filter((c) => c[0] === 'print').every((c) => c[1] === `gui/${UID}/${label}`));
  const plist = readFileSync(plistPath, 'utf8');
  assert.ok(plist.includes('<key>EnvironmentVariables</key>'));
  assert.ok(plist.includes(`<string>${m.home}</string>`));
  assert.ok(plist.includes('<string>/some/checkout/src/shell/api-service.mjs</string>'));

  const off = await serviceOff(m.opts);
  assert.deepEqual(off, { text: 'pir service: off', code: 0 });
  assert.deepEqual(m.fake.calls.at(-1), ['bootout', `gui/${UID}/${label}`]);
  assert.equal(existsSync(plistPath), false);
  assert.equal(existsSync(m.marker), true);
});

test('scratchItem with the real label, or with no plistPath of its own, is refused before any call or write', async (t) => {
  const own = { label: 'com.pir.api-service.check', plistPath: '/nowhere/check.plist' };
  for (const missing of ['label', 'plistPath']) {
    for (const action of [serviceOn, serviceOff, serviceRefresh, serviceStatus]) {
      const m = machine(t, { scratchItem: true, ...own, [missing]: undefined });
      await assert.rejects(action(m.opts), /a scratch item needs its own label and plistPath/, `${missing} ${action.name}`);
      assert.deepEqual(m.fake.calls, [], `${missing} ${action.name}`);
      assert.deepEqual(filesUnder(m.home), [], `${missing} ${action.name}`);
    }
  }
  // Naming the real label outright is the same mistake as leaving it out.
  const m = machine(t, { scratchItem: true, ...own, label: LABEL });
  await assert.rejects(serviceOn(m.opts), /a scratch item needs its own label and plistPath/);
  assert.deepEqual(m.fake.calls, []);
});

// ── the real get ────────────────────────────────────────────────────────────────────────────────

// A real server on an OS-chosen port of the loopback address; never the fixed one.
async function listen(t, handler) {
  const server = createServer(handler);
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test('httpGet: returns the status and the body, whatever the status', async (t) => {
  const url = await listen(t, (req, res) => {
    res.writeHead(req.url === '/health' ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ path: req.url, method: req.method }));
  });
  assert.deepEqual(await httpGet(`${url}/health`, { timeoutMs: 2000 }), { status: 200, body: '{"path":"/health","method":"GET"}' });
  assert.deepEqual(await httpGet(`${url}/nope`, { timeoutMs: 2000 }), { status: 404, body: '{"path":"/nope","method":"GET"}' });
});

test('httpGet: null when nothing listens, when the answer never completes, and for a url that is not one', async (t) => {
  const closed = await listen(t, () => {});
  // A server that sends its headers and then trickles nothing: the timeout bounds the whole exchange.
  const stalled = await listen(t, (req, res) => {
    res.writeHead(200);
    res.write('{');
  });
  const started = Date.now();
  assert.equal(await httpGet(`${stalled}/health`, { timeoutMs: 150 }), null);
  assert.ok(Date.now() - started < 2000);
  // A handler that never answers at all.
  assert.equal(await httpGet(`${closed}/health`, { timeoutMs: 150 }), null);
  assert.equal(await httpGet('not a url', { timeoutMs: 150 }), null);
  // Port 1 of the loopback address: nothing listens there, the connection is refused.
  assert.equal(await httpGet('http://127.0.0.1:1/health', { timeoutMs: 2000 }), null);
});

// ── the program ─────────────────────────────────────────────────────────────────────────────────

function runCli(args, env) {
  return spawnSync(process.execPath, [MODULE, ...args], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 30_000 });
}

test('the CLI: refresh on a scratch PIR_HOME prints the skipped line and exits 0', (t) => {
  const home = mkdtempSync(join(tmpdir(), 'pir-service-ctl-cli-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const res = runCli(['refresh'], { PIR_HOME: home });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout, 'skipped the API service (not the real home)\n');
  assert.deepEqual(filesUnder(home), []);
});

test('the CLI: an unknown word, no word, or two words exit 2 with the usage on stderr', (t) => {
  const home = mkdtempSync(join(tmpdir(), 'pir-service-ctl-cli-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  for (const args of [['restart'], [], ['on', 'extra'], ['constructor']]) {
    const res = runCli(args, { PIR_HOME: home });
    assert.equal(res.status, 2, args.join(' '));
    assert.equal(res.stdout, '');
    assert.match(res.stderr, /^usage: /);
  }
});

test('main: prints the text and a newline, returns the code; a thrown error is one line and 1', async (t) => {
  const m = machine(t, { launchd: { loaded: true } });
  const sink = () => {
    const chunks = [];
    return { write: (s) => chunks.push(s), text: () => chunks.join('') };
  };
  let out = sink();
  let err = sink();
  assert.equal(await main(['status'], { stdout: out, stderr: err, opts: m.opts }), 0);
  assert.equal(out.text(), `${RUNNING_TEXT}\n`);
  assert.equal(err.text(), '');

  out = sink();
  err = sink();
  const broken = { ...m.opts, launchctl: () => { throw new Error('launchctl exploded'); } };
  assert.equal(await main(['status'], { stdout: out, stderr: err, opts: broken }), 1);
  assert.equal(out.text(), '');
  assert.equal(err.text(), 'pir service: launchctl exploded\n');
});

// ── static ──────────────────────────────────────────────────────────────────────────────────────

// The approach of src/core/boundary.test.mjs: every specifier a source imports or re-exports.
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)(['"])([^'"]+)\1/g;

// SPECIFIER matches prose too (FINDINGS 2026-09-30): the word `from` before a quoted phrase in a
// comment reads as an import, and index-store.mjs has one. A `//` inside a string (a url) follows a
// colon, not whitespace, so it is left alone.
function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}

test('the import graph from service-ctl.mjs holds no bare specifier', () => {
  // install.sh runs this module even when `npm ci` failed (T07), so nothing it reaches may be a package.
  const seen = new Set();
  const queue = [MODULE];
  const bare = [];
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const [, , spec] of withoutComments(readFileSync(file, 'utf8')).matchAll(SPECIFIER)) {
      if (spec.startsWith('node:')) continue;
      if (spec.startsWith('./') || spec.startsWith('../')) queue.push(resolvePath(dirname(file), spec));
      else bare.push(`${relative(SRC, file)}: '${spec}'`);
    }
  }
  assert.deepEqual(bare, []);
  // The walk really followed the graph: the core rules and the shared writer are in it.
  for (const name of ['core/service.mjs', 'core/api.mjs', 'shell/atomic-write.mjs', 'shell/identity.mjs']) {
    assert.ok(seen.has(join(SRC, name)), name);
  }
});

test('the import scan sees a package import and ignores one that is only in a comment', () => {
  const specs = (source) => [...withoutComments(source).matchAll(SPECIFIER)].map((m) => m[2]);
  assert.deepEqual(specs(`import { query } from '@anthropic-ai/claude-agent-sdk';`), ['@anthropic-ai/claude-agent-sdk']);
  assert.deepEqual(specs(`const x = 1; // taken from 'somewhere else'\n/* from "a block" */\nawait import('uqr');`), ['uqr']);
  assert.deepEqual(specs(`const u = 'https://example.test'; export { a } from './a.mjs';`), ['./a.mjs']);
});

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (entry.name.endsWith('.mjs')) out.push(path);
  }
  return out;
}

test('static: the only process call that runs launchctl in src/ is realLaunchctl', () => {
  // Any exec-family call whose program is launchctl, tests and harnesses included: everything else
  // takes `launchctl` as a parameter, which is what lets the suite run with a fake (DESIGN §5.2).
  const RUNS = /\b(?:execFileSync|execFile|execSync|exec|spawnSync|spawn)\(\s*['"`][^'"`\n]*launchctl/g;
  const hits = [];
  for (const file of sourceFiles(SRC)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(RUNS)) hits.push({ file: relative(SRC, file), index: match.index, source });
  }
  assert.deepEqual(hits.map((h) => h.file), ['shell/service-ctl.mjs']);
  const [{ source, index }] = hits;
  const lastFunction = [...source.slice(0, index).matchAll(/\bfunction\s+(\w+)/g)].at(-1)[1];
  assert.equal(lastFunction, 'realLaunchctl');
});
