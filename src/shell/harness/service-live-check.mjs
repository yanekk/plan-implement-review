#!/usr/bin/env node
// The one check of the api-service plan that runs the real launchd (DESIGN §1 third success criterion,
// §5.1, §5.2, §5.3 `worker` row; T09). The suite never runs launchctl: every test injects a fake. What
// that cannot show is launchd starting this checkout's api-service.mjs, bringing it back when it is
// killed, and stopping it on bootout. This shows exactly that, under a scratch label.
//
// Everything lives in one temp folder: the home, the plist, the service's api.json. The plist is
// bootstrapped straight from that folder, so nothing is written where launchd would find it again at
// the next login, and the scratch label cannot collide with the real login item. The plist sets
// PIR_HOME to the folder, which makes the service's home a scratch one: it binds an OS-chosen port,
// never the fixed one, and the port is found only through that folder's api.json (§2.8).
//
//   node src/shell/harness/service-live-check.mjs      prints each line, exits 0 or 1
//
// The way back, if the process is cut off before its teardown: the `remove it with` line below.

import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { apiFiles } from '../../core/api.mjs';
import { httpGet, realLaunchctl, serviceOff, serviceOn, serviceRefresh } from '../service-ctl.mjs';

export const CHECK_LABEL = 'com.pir.api-service.check';

// launchd restarts a killed job at once only when it had been up for its 10 s minimum runtime;
// before that the restart is held back to the 10 s mark (measured, FINDINGS 2026-09-30). One second
// over, so step 2 measures the fast restart and not a throttled one that happened to be close.
const MIN_UP_MS = 11_000;
const FAST_RESTART_MS = 5_000;
const THROTTLED_RESTART_MS = 15_000;
// How long the refreshed service, the removal and the teardown may each take to show.
const SETTLE_MS = 5_000;
const POLL_MS = 100;

const SERVICE_SCRIPT = fileURLToPath(new URL('../api-service.mjs', import.meta.url));

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const realKill = (pid) => process.kill(pid, 'SIGKILL');
const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;
const firstLine = (text) => String(text ?? '').split('\n')[0];

function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// serviceLiveCheck({ launchctl, get, kill, sleep, now, tmp, uid, env, log }) → { ok, lines, dir }.
// `lines` is what was printed, in order; `dir` is where the temp folder was (null when the check
// refused to start), so a caller can see it is gone. It never rejects for a failed step: the step's
// line says what failed, the later steps are skipped and the teardown runs whatever happened.
export async function serviceLiveCheck({
  launchctl = realLaunchctl,
  get = httpGet,
  kill = realKill,
  sleep = realSleep,
  now = Date.now,
  tmp = tmpdir(),
  uid = process.getuid?.(),
  env = process.env,
  log = () => {},
} = {}) {
  // A test that forgot its fake would register a real launchd job (DESIGN §1: no test does).
  // `node --test` sets this in every test process and children inherit it.
  if (launchctl === realLaunchctl && env.NODE_TEST_CONTEXT !== undefined) {
    throw new Error('refusing to run the real launchctl under the test runner');
  }

  const lines = [];
  const say = (line) => {
    lines.push(line);
    log(line);
  };
  const target = `gui/${uid}/${CHECK_LABEL}`;
  const loaded = () => launchctl(['print', target]).status === 0;

  // Before anything is created: a loaded label is another check still running, or one that was cut
  // off. Booting it out here could pull the job from under a live check, so the person is told how.
  if (loaded()) {
    say(`refused: ${CHECK_LABEL} is already loaded (another check is running, or one was cut off)`);
    say(`remove it with: launchctl bootout ${target}`);
    return { ok: false, lines, dir: null };
  }

  const dir = mkdtempSync(join(tmp, 'pir-service-check-'));
  const { discovery } = apiFiles(join(dir, '.pir'));
  const opts = {
    scratchItem: true,
    label: CHECK_LABEL,
    plistPath: join(dir, `${CHECK_LABEL}.plist`),
    plistEnv: { PIR_HOME: dir },
    // service-ctl's own view of the home: where it reads api.json and writes the off marker.
    env: { PIR_HOME: dir },
    scriptPath: SERVICE_SCRIPT,
    launchctl,
    get,
    sleep,
    now,
    uid,
  };

  const record = () => {
    const value = existsSync(discovery) ? parse(readFileSync(discovery, 'utf8')) : null;
    return Number.isInteger(value?.pid) && value.pid > 0 && typeof value.url === 'string' ? value : null;
  };
  const body = (answer) => (answer && answer.status === 200 ? parse(answer.body) : null);
  // The service named by api.json, only when the process answering there says it is that pid. A file
  // left by the killed instance names a dead pid on a closed port, and reads as null.
  const answering = async () => {
    const rec = record();
    if (!rec) return null;
    const health = body(await get(`${rec.url}/health`, { timeoutMs: 1000 }));
    return health?.version === 1 && health.status === 'ok' && health.pid === rec.pid ? rec : null;
  };
  const until = async (limitMs, failure, probe) => {
    const start = now();
    for (;;) {
      const found = await probe();
      if (found) return { found, ms: now() - start };
      if (now() - start >= limitMs) throw new Error(failure);
      await sleep(POLL_MS);
    }
  };
  const newPid = (oldPid, limitMs) =>
    until(limitMs, `no new pid answering within ${secs(limitMs)}`, async () => {
      const rec = await answering();
      return rec && rec.pid !== oldPid ? rec : null;
    });

  let current = null;
  let upSince = 0;

  const killAndReturn = async (limitMs) => {
    // Only a pid whose own /health has just named it is killed: api.json alone could be stale, and its
    // number could by then belong to some other process.
    const live = await answering();
    if (!live || live.pid !== current.pid) throw new Error(`pid ${current.pid} is no longer the service answering`);
    kill(live.pid);
    const { found, ms } = await newPid(live.pid, limitMs);
    current = found;
    upSince = now();
    return `pid ${live.pid} → ${found.pid}, answering after ${secs(ms)}`;
  };

  const steps = [
    ['1 on', async () => {
      const start = now();
      const on = await serviceOn(opts);
      if (on.code !== 0) throw new Error(firstLine(on.text));
      const live = await answering();
      if (!live) throw new Error('api.json names no service that answers /health with its own pid');
      const usage = body(await get(`${live.url}/v1/usage`, { timeoutMs: 1000 }));
      if (usage?.version !== 1 || usage.observed_at !== null || usage.rate_limits !== null) {
        throw new Error('GET /v1/usage did not answer 200 with nulls');
      }
      current = live;
      // Counted from here, not from the launch a moment earlier, so the wait in step 2 errs long.
      upSince = now();
      return `api.json written, ${live.url} answers /health as pid ${live.pid}, /v1/usage 200 with nulls, after ${secs(now() - start)}`;
    }],
    ['2 kill -9 after 11 s up', async () => {
      const wait = MIN_UP_MS - (now() - upSince);
      if (wait > 0) await sleep(wait);
      return killAndReturn(FAST_RESTART_MS);
    }],
    // At once: the instance is seconds old, so launchd holds the restart back (the throttle).
    ['3 kill -9 again at once', () => killAndReturn(THROTTLED_RESTART_MS)],
    ['4 refresh', async () => {
      const start = now();
      const before = current.pid;
      const refreshed = await serviceRefresh(opts);
      if (refreshed.code !== 0) throw new Error(firstLine(refreshed.text));
      const { found } = await newPid(before, SETTLE_MS);
      current = found;
      return `pid ${before} → ${found.pid}, answering after ${secs(now() - start)}`;
    }],
    ['5 off', async () => {
      const start = now();
      const off = await serviceOff(opts);
      if (off.code !== 0) throw new Error(firstLine(off.text));
      await until(SETTLE_MS, `api.json or the label still there after ${secs(SETTLE_MS)}`, async () => !existsSync(discovery) && !loaded());
      return `api.json gone, launchctl print fails, after ${secs(now() - start)}`;
    }],
  ];

  let ok = true;
  try {
    for (const [name, run] of steps) {
      if (!ok) {
        say(`${name}: skipped`);
        continue;
      }
      try {
        say(`${name}: ${await run()}`);
      } catch (err) {
        ok = false;
        say(`${name}: FAILED: ${err?.message ?? err}`);
      }
    }
  } finally {
    // Whatever happened. The folder goes only after the job has: a service still alive rewrites its
    // api.json every 30 s and would bring the folder back (writeFileAtomic creates folders).
    let gone = false;
    try {
      launchctl(['bootout', target]);
      let waited = 0;
      while (loaded() && waited < SETTLE_MS) {
        await sleep(POLL_MS);
        waited += POLL_MS;
      }
      gone = !loaded();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    if (gone) {
      say(`teardown: ${CHECK_LABEL} not loaded, temp folder removed`);
    } else {
      ok = false;
      say(`teardown: FAILED: ${CHECK_LABEL} is still loaded; remove it with: launchctl bootout ${target}`);
    }
  }
  say(ok ? 'service-live-check: passed' : 'service-live-check: FAILED');
  return { ok, lines, dir };
}

// main({ check, write }) → the exit code: 0 when every step and the teardown passed, else 1.
export async function main({ check = serviceLiveCheck, write = (line) => process.stdout.write(`${line}\n`) } = {}) {
  try {
    const { ok } = await check({ log: write });
    return ok ? 0 : 1;
  } catch (err) {
    write(`service-live-check: ${err?.message ?? err}`);
    return 1;
  }
}

// Compared as real paths: a worktree may be reached through a symlink, and Node resolves symlinks
// for a module's own URL but leaves argv[1] as typed.
function isMain() {
  try {
    return pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isMain()) process.exitCode = await main();
