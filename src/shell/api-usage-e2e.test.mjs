// api-service T08 — the parts meet (DESIGN §1 success criteria, §2.4, §4). T04 proves the run-side writer
// and T05 the service, each with the other half injected; here a session held through startWorker writes
// readings and the service PROGRAM, a child process found through its home's api.json, serves exactly
// those numbers. The last tests start a build run and a planning run the way `pir` starts them, with fake
// sessions, and pass no reporter anywhere: the file appearing is the proof that the default in
// worker-proc.mjs is wired.
//
// Every home here is a temp folder, so the service binds an OS-chosen port and nothing reaches the
// person's ~/.pir (homeKind, DESIGN §2.8); the last test checks that from the outside. Run this file
// through `node --test` only: run directly, a worker session's own PIR_RUN=1 would not be stopped by
// NODE_TEST_CONTEXT (FINDINGS 2026-09-30).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startWorker } from './worker-proc.mjs';
import { usageReporterFromEnv } from './usage-report.mjs';
import { fakeClaudeSpawner, initEvent, resultEvent } from './fake/claude-stream.mjs';
import { writeClaudeShim } from './fake/claude-shim.mjs';
import { IMPLEMENT_MATCH, workerScripts } from './fake/sessions.mjs';
import { USAGE_RESETS, usageEvent, withUsageEvent } from './plan-rig.mjs';
import { BRIEF, ndjson, rigWithTeardown, until } from './plan-rig-helpers.mjs';
import { startPlanRun } from './launch.mjs';
import { controlDirFor, runScenario } from './harness/run.mjs';
import { parseReading } from '../core/usage.mjs';

const SERVICE = fileURLToPath(new URL('./api-service.mjs', import.meta.url));
const SESSION = '22222222-2222-4222-8222-222222222222';
const NAME = 'plan-implement-review / api-service / T08 / usage-e2e / implement';

// The person's real usage file, as it was before any test here ran (the last test compares).
const REAL_USAGE = join(userInfo().homedir, '.pir', 'usage.json');
function realUsage() {
  try {
    const s = statSync(REAL_USAGE);
    return { mtimeMs: s.mtimeMs, ino: s.ino, size: s.size, text: readFileSync(REAL_USAGE, 'utf8') };
  } catch {
    return null;
  }
}
const REAL_BEFORE = realUsage();

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
};

// The `rate_limit_event` entries of a conversation log, in the order the worker heard them.
const usageEntries = (entries) => entries.filter((e) => e.dir === 'in' && e.event?.type === 'rate_limit_event');

// What the API must say for a fake event heard at `t` (DESIGN §2.1: utilization × 100, resets as given).
const bodyFor = (t, five, seven) => ({
  version: 1,
  observed_at: t,
  rate_limits: {
    five_hour: { used_percentage: five, resets_at: USAGE_RESETS.fiveHour },
    seven_day: { used_percentage: seven, resets_at: USAGE_RESETS.sevenDay },
  },
});

// startService(home) → { child, pid, url, stop() }: `node api-service.mjs` on that home, up once api.json
// names this child. stop() is launchd's bootout: SIGTERM, then the exit code.
async function startService(home) {
  const discovery = join(home, '.pir', 'api.json');
  const child = nodeSpawn(process.execPath, [SERVICE], { env: { ...process.env, PIR_HOME: home }, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  let gone = false;
  exited.then(() => (gone = true));
  let record;
  try {
    record = await until(() => {
      if (gone) throw new Error(`the service exited before it was up: ${stderr}`);
      const r = readJson(discovery);
      return r?.pid === child.pid ? r : null;
    }, 'api.json naming the service');
  } catch (err) {
    // Nobody holds this child yet, so no teardown would stop it: left alone it outlives the suite, keeps
    // the test process from exiting (its stderr pipe), and rewrites api.json every 30 s, which recreates
    // the temp home after it was removed.
    if (!gone) child.kill('SIGKILL');
    await exited;
    throw err;
  }
  return {
    child,
    pid: child.pid,
    url: record.url,
    discovery,
    async stop() {
      if (!gone) child.kill('SIGTERM');
      return exited;
    },
  };
}

async function getUsage(service) {
  // Discovery as a reader does it: the url from api.json, never an assumed port (DESIGN §2.1).
  const res = await fetch(`${readJson(service.discovery).url}/v1/usage`);
  return { status: res.status, body: await res.json() };
}

// A scratch home with the service beside it and, on demand, a session held through startWorker whose fake
// `claude` runs `script`. The reporter is the one a run process builds: usageReporterFromEnv with PIR_RUN=1
// and this home. The teardown stops the session before the home is removed: a reading written afterwards
// would recreate the folder (FINDINGS 2026-09-30).
async function world(t) {
  const root = mkdtempSync(join(tmpdir(), 'pir-usage-e2e-'));
  const home = join(root, 'home');
  mkdirSync(home);
  const w = { root, home, usageFile: join(home, '.pir', 'usage.json'), service: null, worker: null };
  t.after(async () => {
    if (w.worker) await w.worker.close({ graceMs: 100, killMs: 300 });
    if (w.service) await w.service.stop();
    rmSync(root, { recursive: true, force: true });
  });
  w.service = await startService(home);
  w.startSession = (script) => {
    const scriptPath = join(root, 'script.json');
    writeFileSync(scriptPath, JSON.stringify(script));
    // A clock that never repeats, so "observed_at moved forward" cannot fail on two entries logged within
    // one millisecond. It stays within a few ms of the real one, far inside the service's 60 s limit.
    let last = 0;
    const now = () => (last = Math.max(last + 1, Date.now()));
    w.logPath = join(root, 'conversations', 'T08-implement-1.ndjson');
    w.worker = startWorker({
      cwd: root,
      sessionId: SESSION,
      name: NAME,
      logPath: w.logPath,
      claudePath: '/nonexistent/claude', // never launched: the fake spawner ignores the command
      spawnProcess: fakeClaudeSpawner({ script: scriptPath }),
      now,
      reportUsage: usageReporterFromEnv({ PIR_RUN: '1', PIR_HOME: home }),
    });
    return w.worker;
  };
  // Send one message and wait until the session has heard `n` usage events in all. The reporter runs in
  // the same tick as the log entry, so by then the file is written.
  w.hear = async (text, n) => {
    w.worker.send(text);
    await until(() => usageEntries(w.worker.entries()).length >= n, `usage event ${n}`);
    return usageEntries(ndjson(w.logPath))[n - 1];
  };
  return w;
}

const SECOND = { fiveHour: 0.35, sevenDay: 0.12, uuid: '00000000-0000-4000-8000-0000000000ab' };
const TWO_EVENTS = [
  { await: 'user' },
  { emit: initEvent() },
  { emit: usageEvent() },
  { emit: resultEvent('success', 'one') },
  { await: 'user' },
  { emit: usageEvent(SECOND) },
  { emit: resultEvent('success', 'two') },
];

test('service up, nothing written → 200 with nulls', async (t) => {
  const w = await world(t);
  assert.equal(existsSync(w.usageFile), false);
  assert.deepEqual(await getUsage(w.service), { status: 200, body: { version: 1, observed_at: null, rate_limits: null } });
});

test('a session held through startWorker hears a usage event → /v1/usage serves 20 and 11, observed at the log entry\'s t', async (t) => {
  const w = await world(t);
  w.startSession(TWO_EVENTS);
  const entry = await w.hear('go', 1);
  assert.equal(typeof entry.t, 'number');
  assert.deepEqual(await getUsage(w.service), { status: 200, body: bodyFor(entry.t, 20, 11) });
});

test('a second event with other numbers → the API serves the second, and observed_at moved forward', async (t) => {
  const w = await world(t);
  w.startSession(TWO_EVENTS);
  const first = await w.hear('go', 1);
  // Asked between the two, so the service has the first reading cached when the file is replaced.
  assert.equal((await getUsage(w.service)).body.observed_at, first.t);
  const second = await w.hear('again', 2);
  assert.ok(second.t > first.t, `${second.t} > ${first.t}`);
  assert.deepEqual(await getUsage(w.service), { status: 200, body: bodyFor(second.t, 35, 12) });
});

test('SIGTERM the service and start it again → the same reading and observed_at, a new pid in api.json', async (t) => {
  const w = await world(t);
  w.startSession(TWO_EVENTS);
  const entry = await w.hear('go', 1);
  const before = await getUsage(w.service);
  assert.deepEqual(before.body, bodyFor(entry.t, 20, 11));
  const old = w.service;
  assert.deepEqual(await old.stop(), { code: 0, signal: null });
  assert.equal(existsSync(old.discovery), false, 'a clean exit removes api.json');

  w.service = await startService(w.home);
  assert.notEqual(w.service.pid, old.pid);
  assert.equal(readJson(w.service.discovery).pid, w.service.pid);
  assert.deepEqual(await getUsage(w.service), before);
});

// ---- The two run kinds, started as `pir` starts them. No reportUsage is passed anywhere below. ----

// The reading a run left in its home, checked against the run's own conversation logs.
function assertRunReading(usageFile, conversationsDir) {
  const text = readFileSync(usageFile, 'utf8');
  const reading = parseReading(text, Date.now());
  assert.ok(reading, `usage.json parses as a reading: ${text}`);
  assert.deepEqual(reading.fiveHour, { utilization: 0.2, resetsAt: USAGE_RESETS.fiveHour });
  assert.deepEqual(reading.sevenDay, { utilization: 0.11, resetsAt: USAGE_RESETS.sevenDay });
  const heard = readdirSync(conversationsDir).flatMap((f) => usageEntries(ndjson(join(conversationsDir, f)))).map((e) => e.t);
  assert.ok(heard.includes(reading.observedAt), `observed_at ${reading.observedAt} is the t of a logged event (${heard.join(', ')})`);
}

// The harness run of a `statusSnapshots` scenario: runScenario launches the real coordinator with PIR_RUN=1
// and a scratch PIR_HOME under the plan's .parallel/, which is where T10's live check looks too. The
// fixture is `real-asking` only because it is a statusSnapshots scenario with no coordinator agent; its
// task docs are written for real sessions and the stock fake workers ignore them, so its facts are not
// what this test reads. The fake implementer emits the event as it starts.
test('a build run started by the harness as pir starts it writes {pirHome}/.pir/usage.json', { timeout: 150_000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pir-usage-e2e-build-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  const bin = join(root, 'bin');
  const repoDir = join(root, 'repo');
  mkdirSync(home);
  mkdirSync(bin);
  // A scratch HOME has no git identity, and the coordinator's merges need one.
  writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = pir e2e\n\temail = e2e@pir.invalid\n');
  const scriptsFile = join(bin, 'fake-scripts.json');
  writeFileSync(scriptsFile, JSON.stringify(withUsageEvent(workerScripts({ mergeArgs: '-X ours' }), IMPLEMENT_MATCH)));
  writeClaudeShim(bin, { scriptsFile, received: join(bin, 'fake-received.ndjson') });
  // runScenario takes no base environment, so the fake `claude` and the scratch HOME go in through its
  // injected spawn. PIR_RUN and PIR_HOME are the harness's own and are left as it set them.
  const spawn = (cmd, argv, opts) => {
    const env = { ...opts.env, PATH: `${bin}:${opts.env.PATH}`, HOME: home, FORCE_COLOR: '0', NO_COLOR: '1' };
    for (const k of ['PARALLEL_ALLOW_HERE', 'PIR_FAKE_CLAUDE_SCRIPT', 'PIR_FAKE_CLAUDE_SCRIPTS', 'PIR_FAKE_CLAUDE_RECEIVED', 'NODE_TEST_CONTEXT']) delete env[k];
    assert.equal(env.PIR_RUN, '1');
    return nodeSpawn(cmd, argv, { ...opts, env });
  };

  const lines = [];
  const r = await runScenario({ fixtureId: 'real-asking', scratchDir: repoDir, spawn, pollMs: 250, timeoutMs: 120_000, log: (l) => lines.push(l) });
  const why = `${r.reason}\n--- log\n${lines.join('\n')}`;
  assert.equal(r.reason, 'completed', why);

  const controlDir = controlDirFor(repoDir, 'real-asking');
  const pirHome = join(controlDir, '..', 'pir-home');
  assertRunReading(join(pirHome, '.pir', 'usage.json'), join(controlDir, 'conversations'));
  assert.equal(existsSync(join(home, '.pir', 'usage.json')), false, 'PIR_HOME wins over HOME');
});

test('a planning run started as `pir plan` starts it writes the rig home\'s .pir/usage.json', async (t) => {
  const rig = rigWithTeardown(t, { scripts: 'usage' });
  const started = startPlanRun(BRIEF, { cwd: rig.repoDir, env: rig.env });
  assert.equal(started.started, true, JSON.stringify(started));
  const usageFile = join(rig.home, '.pir', 'usage.json');
  await until(() => existsSync(usageFile), 'the planning run to write usage.json');
  assertRunReading(usageFile, join(started.controlDir, 'conversations'));
});

// Last in the file, after every session above has been started and stopped. A plain before-and-after
// comparison would fail whenever a real pir run is alive on this machine, which writes that file every few
// seconds once this feature is installed, and a build's workers run the suite during exactly such a run.
// So a change is allowed, and what is refused is a change to one of this file's fake readings: their
// five-hour reset time is fixed and in the past, which no real reading has.
test('the suite leaves none of its fake readings in the person\'s real ~/.pir/usage.json', () => {
  const after = realUsage();
  if (after === null) {
    // Absent now. Nothing here deletes it, so it was absent before or a person removed it; either way
    // the suite did not create it.
    return;
  }
  const unchanged = REAL_BEFORE !== null && REAL_BEFORE.mtimeMs === after.mtimeMs && REAL_BEFORE.ino === after.ino && REAL_BEFORE.text === after.text;
  let fiveHourReset = null;
  try {
    fiveHourReset = JSON.parse(after.text)?.five_hour?.resets_at ?? null;
  } catch {
    // Not JSON: not one of ours, which are always whole (temp-then-rename).
  }
  assert.notEqual(fiveHourReset, USAGE_RESETS.fiveHour, `${REAL_USAGE} holds a fake reading (${unchanged ? 'it did before the suite too' : 'written while the suite ran'}): ${after.text}`);
});
