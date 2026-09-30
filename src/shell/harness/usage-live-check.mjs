#!/usr/bin/env node
// The one check of the api-service plan that uses real Claude sessions (DESIGN §1 first two success
// criteria, §2.3, §5.1, §5.3 `worker` row; T10). T08 proves the chain with a fake session sending a
// made-up event. What that cannot show is that real sessions on this login send `rate_limit_event`s
// with `unifiedWindows`, and that the numbers the service answers are the ones those sessions heard.
//
// It runs the `usage-live` harness scenario (two trivial tasks, four real sessions, a scratch repo and
// a scratch PIR_HOME) as a child, with this checkout's API service on that scratch home beside it, and
// polls GET /v1/usage while the run works. When the run has ended it reads the run's conversation logs,
// takes the newest `rate_limit_event` and compares it with the last answer.
//
//   node src/shell/harness/usage-live-check.mjs --into /tmp/usage-live     prints the result, exits 0 or 1
//
// The scratch home makes the service bind an OS-chosen port and write its own api.json, never the real
// ones (§2.8). `--into` must not exist yet: a folder left by an earlier run would bring its logs along.
// The folder is left in place afterwards, with the harness's bundle in it, for whoever reads the result;
// removing it is the caller's (T10 § Environment).

import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { startApiService } from '../api-service.mjs';
import { httpGet } from '../service-ctl.mjs';
import { controlDirFor, teardownScenario, touchHalt } from './run.mjs';

export const FIXTURE = 'usage-live';

const POLL_MS = 5_000;
// The scenario halts itself after 20 minutes (its own seatbelt) and then tears down. This is the bound
// on the harness process as a whole, for a harness that hangs instead.
const MAX_MS = 25 * 60 * 1000;
// After HALT, how long the harness gets to stop its run and seal its bundle before it is killed.
const HALT_GRACE_MS = 60_000;

const RUN_SCRIPT = fileURLToPath(new URL('./run.mjs', import.meta.url));

// Node's default for these ends the process at once and skips every `finally`: the service would die
// with it, but the harness child and its paid sessions would run on (the same trap as T09's check).
const INTERRUPTS = ['SIGINT', 'SIGTERM', 'SIGHUP'];

const realSleep = (ms, { signal } = {}) => delay(ms, undefined, { signal });

function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// usageEvents(conversationsDir) → { files, events }: every `rate_limit_event` a session of the run
// heard, as its log entry `{ t, event }`, oldest first. A missing folder is a run that held no session.
// A line that does not parse is skipped: a worker killed mid-write leaves a torn last line.
export function usageEvents(conversationsDir) {
  let names = [];
  try {
    names = readdirSync(conversationsDir).filter((n) => n.endsWith('.ndjson')).sort();
  } catch {
    // no folder: no session was ever held
  }
  const events = [];
  for (const name of names) {
    for (const line of readFileSync(join(conversationsDir, name), 'utf8').split('\n')) {
      const entry = line ? parse(line) : null;
      if (entry?.dir === 'in' && entry.event?.type === 'rate_limit_event' && Number.isFinite(entry.t)) {
        events.push({ t: entry.t, file: name, event: entry.event });
      }
    }
  }
  events.sort((a, b) => a.t - b.t);
  return { files: names.length, events };
}

// What the API must answer for one window of an event (§2.3), worked out here rather than through
// src/core/usage.mjs: the service answers through that module, and a check that used it too would
// agree with it whatever it did.
function expectedWindow(raw) {
  if (!isObject(raw)) return null;
  const { utilization, resetsAt } = raw;
  if (!Number.isFinite(utilization) || utilization < 0) return null;
  if (!Number.isFinite(resetsAt) || resetsAt <= 0) return null;
  return { used_percentage: Math.round(Math.min(utilization, 1) * 10000) / 100, resets_at: resetsAt };
}

const windowsOf = (event) => (isObject(event?.rate_limit_info?.unifiedWindows) ? event.rate_limit_info.unifiedWindows : null);

// expectedBody(entry) → the /v1/usage body the service owes for that log entry.
export function expectedBody({ t, event }) {
  const windows = windowsOf(event);
  return {
    version: 1,
    observed_at: t,
    rate_limits: { five_hour: expectedWindow(windows?.five_hour), seven_day: expectedWindow(windows?.seven_day) },
  };
}

const showWindow = (name, w) => (w ? `${name} ${w.used_percentage} % resets ${w.resets_at}` : `${name} null`);
const showBody = (body) =>
  body
    ? `observed_at ${body.observed_at}, ${showWindow('five_hour', body.rate_limits?.five_hour)}, ${showWindow('seven_day', body.rate_limits?.seven_day)}`
    : 'no answer';

// usageLiveCheck(opts) → { ok, polls, distinct, api, newest, events, withWindows, run, text }.
//
//   into          — the scratch repo the harness installs into. Must not exist yet.
//   spawn         — node:child_process spawn; a test passes a fake child.
//   get           — (url, { timeoutMs }) → { status, body } | null.
//   now           — the clock, ms.
//   log           — progress lines while the run works; `text` is the result.
//   sleep, startService, teardown, halt, signals, env — the rest of what it touches, injected for tests.
//
// `polls` counts every GET, the one after the run included. `distinct` is how many different
// `observed_at` values were answered. `api` is the last answer and `newest` the expected body of the
// newest event. It rejects only when it refuses to start; a failed run or a mismatch is `ok: false`.
export async function usageLiveCheck({
  into,
  spawn = nodeSpawn,
  get = httpGet,
  now = Date.now,
  log = () => {},
  sleep = realSleep,
  startService = startApiService,
  teardown = teardownScenario,
  halt = touchHalt,
  signals = process,
  env = process.env,
  pollMs = POLL_MS,
  maxMs = MAX_MS,
  haltGraceMs = HALT_GRACE_MS,
} = {}) {
  // A test that forgot its fake would start real paid sessions (DESIGN §5.2). `node --test` sets this
  // in every test process and children inherit it.
  if (spawn === nodeSpawn && env.NODE_TEST_CONTEXT !== undefined) {
    throw new Error('refusing to start real sessions under the test runner');
  }
  if (!into) throw new Error('usage-live-check: no scratch folder (--into <dir>)');
  if (existsSync(into)) {
    return { ok: false, polls: 0, distinct: 0, api: null, newest: null, events: 0, withWindows: 0, run: null, text: `usage-live-check: FAILED: ${into} already exists; remove it first (rm -rf ${into})` };
  }

  const controlDir = controlDirFor(into, FIXTURE);
  // Where run.mjs puts the scratch home of a `statusSnapshots` scenario.
  const pirHome = join(controlDir, '..', 'pir-home');

  let interruptedBy = null;
  let onInterrupt;
  const interrupted = new Promise((resolve) => {
    onInterrupt = resolve;
  });
  const onSignal = (name) => {
    interruptedBy ??= name;
    onInterrupt();
  };
  for (const name of INTERRUPTS) signals.on(name, onSignal);

  let service = null;
  let child = null;
  let exit = null;
  let exited = null;
  let polls = 0;
  let api = null;
  const seen = new Set();
  let failure = null;

  const poll = async () => {
    polls += 1;
    const answer = await get(`${service.url}/v1/usage`, { timeoutMs: 2000 });
    const body = answer?.status === 200 ? parse(answer.body) : null;
    if (Number.isFinite(body?.observed_at) && !seen.has(body.observed_at)) {
      seen.add(body.observed_at);
      log(`poll ${polls}: ${showBody(body)}`);
    }
    return body;
  };

  try {
    // Up before the run, so the first reading is already served. PIR_HOME is what makes the home a
    // scratch one: an OS-chosen port and an api.json of its own.
    service = await startService({ env: { ...env, PIR_HOME: pirHome }, now });
    log(`service at ${service.url} on ${pirHome}`);

    child = spawn(process.execPath, [RUN_SCRIPT, FIXTURE, '--into', into], { env, stdio: ['ignore', 'inherit', 'inherit'] });
    exited = new Promise((resolve) => {
      child.on('exit', (code, signal) => resolve({ code, signal }));
      // The program could not be started at all.
      child.on('error', (err) => resolve({ code: null, signal: null, error: err }));
    });
    exited.then((value) => {
      exit = value;
    });

    const start = now();
    while (!exit && !interruptedBy) {
      if (now() - start >= maxMs) {
        failure = `the harness was still running after ${Math.round(maxMs / 60000)} min`;
        break;
      }
      await poll();
      // Ended by the run's exit or a signal, not only by the timer, so neither waits out the 5 s.
      const wait = new AbortController();
      await Promise.race([exited, interrupted, sleep(pollMs, { signal: wait.signal }).catch(() => {})]);
      wait.abort();
    }
    if (interruptedBy) failure = `interrupted by ${interruptedBy}`;
    // The answer that is compared: asked after the run has exited, so no reading can follow it.
    if (exit) api = await poll();
  } finally {
    try {
      if (child && !exit) {
        // The harness has no signal handler: killed outright it would leave its coordinator and the
        // paid sessions running. HALT is its kill switch, so it stops the run and seals its bundle
        // itself; only a harness that ignores that is killed, and its recorded workers reaped.
        try {
          halt(controlDir);
        } catch {
          // the reap below still ends the workers
        }
        const grace = new AbortController();
        await Promise.race([exited, sleep(haltGraceMs, { signal: grace.signal }).catch(() => {})]);
        grace.abort();
        if (!exit) {
          child.kill('SIGTERM');
          await teardown({ controlDir });
        }
      }
    } finally {
      // Closed last and whatever happened: a service left alive rewrites its api.json every 30 s and
      // would bring the scratch folder back after it is removed.
      try {
        await service?.close();
      } finally {
        for (const name of INTERRUPTS) signals.off(name, onSignal);
      }
    }
  }

  const { files, events } = usageEvents(join(controlDir, 'conversations'));
  const withWindows = events.filter((e) => windowsOf(e.event)).length;
  // Several sessions live in one run process, so two entries can carry the same millisecond; the file
  // then holds whichever was written last (§2.4). Any of them is a correct answer.
  const newestT = events.length ? events[events.length - 1].t : null;
  const candidates = events.filter((e) => e.t === newestT).map(expectedBody);
  const newest = candidates.find((body) => isDeepStrictEqual(body, api)) ?? candidates[candidates.length - 1] ?? null;
  const runOk = exit?.code === 0;
  const run = exit ? (exit.error ? `could not start: ${exit.error.message}` : exit.signal ? `killed by ${exit.signal}` : `exit ${exit.code}`) : 'did not finish';

  const problems = [];
  if (failure) problems.push(failure);
  if (!runOk && exit) problems.push(`the harness run failed (${run})`);
  if (!events.length) {
    problems.push('no rate_limit_event in any conversation log: this login sends none. Check it with: claude auth status (expect loggedIn true, authMethod claude.ai)');
  } else if (!api) {
    problems.push('GET /v1/usage did not answer after the run');
  } else if (api.observed_at !== newest.observed_at) {
    problems.push(`the API's observed_at ${api.observed_at} is not the newest event's t ${newest.observed_at}`);
  } else if (!isDeepStrictEqual(api, newest)) {
    problems.push('the API\'s windows are not the newest event\'s unifiedWindows');
  }
  if (seen.size < 2) problems.push(`observed_at did not move: ${seen.size} distinct value${seen.size === 1 ? '' : 's'} over ${polls} polls`);

  const ok = problems.length === 0;
  const text = [
    `harness run: ${runOk ? 'passed' : 'FAILED'} (${run})`,
    `polls: ${polls}, distinct observed_at: ${seen.size}`,
    `events: ${events.length} rate_limit_event in ${files} conversation log${files === 1 ? '' : 's'}, ${withWindows} with unifiedWindows`,
    `newest event: ${newest ? showBody(newest) : 'none'}`,
    `api:          ${showBody(api)}`,
    ok ? 'usage-live-check: passed' : `usage-live-check: FAILED: ${problems.join('; ')}`,
  ].join('\n');

  return { ok, polls, distinct: seen.size, api, newest, events: events.length, withWindows, run, text };
}

// main(argv, { check, write }) → the exit code: 0 when the check passed, else 1.
export async function main(argv, { check = usageLiveCheck, write = (line) => process.stdout.write(`${line}\n`) } = {}) {
  const i = argv.indexOf('--into');
  const into = i >= 0 ? argv[i + 1] : undefined;
  if (!into) {
    write('usage: node src/shell/harness/usage-live-check.mjs --into <scratch dir that does not exist yet>');
    return 1;
  }
  try {
    const { ok, text } = await check({ into, log: write });
    write(text);
    return ok ? 0 : 1;
  } catch (err) {
    write(`usage-live-check: ${err?.message ?? err}`);
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

if (isMain()) process.exitCode = await main(process.argv.slice(2));
