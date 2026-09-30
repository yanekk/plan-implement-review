// The login item's hands (plans/api-service DESIGN §2.6–§2.9, §5.2): `on`, `off`, `refresh` and the
// status check, carried out against launchd, the plist, the off marker and the service's own answer.
// The rules live in src/core/service.mjs (which steps, which words) and src/core/api.mjs (which home is
// real); this module gathers the facts, runs the steps in the plan's order and returns what to print.
//
// Everything that touches the machine is a parameter: `launchctl`, the HTTP `get`, the clock, the
// sleep. No test runs the real launchctl (§5.2).
//
// This file and everything it imports, transitively, uses only `node:` built-ins and relative paths:
// install.sh runs it even when `npm ci` failed (T07), so a package here would break the install step.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { userInfo } from 'node:os';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { API_PORT, API_VERSION, EXIT_PORT_TAKEN, apiFiles, homeKind } from '../core/api.mjs';
import { SERVICE_LABEL, plistText, servicePlan, statusText } from '../core/service.mjs';
import { writeFileAtomic } from './atomic-write.mjs';
import { isAlive } from './identity.mjs';
import { indexDir } from './index-store.mjs';

// `bootstrap` right after `bootout` fails with code 5 while the old instance is still being torn down
// (measured, §2.9), so it is retried: ten attempts, 300 ms apart.
const BOOTSTRAP_ATTEMPTS = 10;
const BOOTSTRAP_GAP_MS = 300;
// `bootout` of a label that is not loaded (measured). Not an error: the end state is the one wanted.
const BOOTOUT_NOT_LOADED = 3;
// How long `on` and `refresh` wait for the freshly started service to answer (§2.7).
const AWAIT_MS = 5000;
const AWAIT_GAP_MS = 200;
const GET_TIMEOUT_MS = 2000;
// A foreign program on the port may answer with anything, of any length. Nothing we read is larger
// than a usage body, so the rest is dropped rather than buffered.
const MAX_BODY_BYTES = 64 * 1024;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// realLaunchctl(args) → { status, stdout, stderr }. The only place in src/ that runs launchctl (a
// static test holds that). The absolute path, so a PATH entry cannot stand in for it. execFileSync
// throws on a non-zero exit, which for launchctl is an ordinary answer (3: not loaded, 5: still being
// torn down), so the throw is turned back into a result.
export function realLaunchctl(args) {
  try {
    const stdout = execFileSync('/bin/launchctl', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    return {
      // A launchctl that could not be run at all has no status; 1 keeps every caller's `!== 0` true.
      status: Number.isInteger(err?.status) ? err.status : 1,
      stdout: typeof err?.stdout === 'string' ? err.stdout : '',
      stderr: typeof err?.stderr === 'string' && err.stderr !== '' ? err.stderr : String(err?.message ?? ''),
    };
  }
}

// httpGet(url, { timeoutMs }) → Promise<{ status, body } | null>. null for anything that is not a
// complete answer: refused, reset, or slower than the timeout. It never rejects. `timeoutMs` bounds
// the whole exchange, not the idle gap, so a program that holds the port and trickles bytes cannot
// hang `pir service`.
export function httpGet(url, { timeoutMs = GET_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let req = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req?.destroy();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      req = request(url, { method: 'GET', agent: false }, (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size <= MAX_BODY_BYTES) chunks.push(chunk);
        });
        res.on('end', () => finish({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', () => finish(null));
      });
      req.on('error', () => finish(null));
      req.end();
    } catch {
      // A malformed url throws synchronously.
      finish(null);
    }
  });
}

function realExec(file, args) {
  return execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

// resolveNodePath({ exec }) → the absolute `node` the plist names. What `command -v node` prints, NOT
// its realpath: Homebrew's /opt/homebrew/bin/node is a symlink into a Cellar folder that changes with
// every `brew upgrade`, and launchd's own PATH has no node at all (§2.6). Falls back to the node
// running this code when the shell finds none.
export function resolveNodePath({ exec = realExec } = {}) {
  try {
    const found = String(exec('/bin/sh', ['-c', 'command -v node'])).trim();
    if (found.startsWith('/')) return found;
  } catch {
    // no node on PATH, or no shell: fall through
  }
  return process.execPath;
}

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Every option, resolved once. `env` and `osHome` reach homeKind unaltered (FINDINGS 2026-09-30: it
// compares strings, so a normalised home would defeat the test-runner guard).
function resolve(opts = {}) {
  const env = opts.env ?? process.env;
  const osHome = opts.osHome ?? userInfo().homedir;
  const label = opts.label ?? SERVICE_LABEL;
  const scratchItem = opts.scratchItem === true;
  const scriptPath = opts.scriptPath ?? fileURLToPath(new URL('./api-service.mjs', import.meta.url));
  // `scratchItem` switches off both rules that keep a checkout and a test process away from the login
  // item. With the defaults left in place it would register the real label from the real LaunchAgents
  // folder, so it is accepted only with a label and a plist of its own (§5.2).
  if (scratchItem && (label === SERVICE_LABEL || typeof opts.plistPath !== 'string')) {
    throw new Error('a scratch item needs its own label and plistPath');
  }
  return {
    env,
    osHome,
    label,
    scratchItem,
    scriptPath,
    platform: opts.platform ?? process.platform,
    launchctl: opts.launchctl ?? realLaunchctl,
    get: opts.get ?? httpGet,
    plistPath: opts.plistPath ?? `${osHome}/Library/LaunchAgents/${label}.plist`,
    nodePath: opts.nodePath,
    exec: opts.exec ?? realExec,
    plistEnv: opts.plistEnv,
    // getuid does not exist on Windows; the platform check must still get to print its line there.
    uid: opts.uid ?? process.getuid?.(),
    now: opts.now ?? Date.now,
    sleep: opts.sleep ?? realSleep,
    // T09's scratch item is registered for real from a temp home, so the two rules that would refuse
    // it are answered for it; the launchctl calls then go to its own label.
    kind: scratchItem ? 'real' : homeKind(env, osHome),
    installedEngine: scratchItem || scriptPath === `${osHome}/.claude/pir-engine/src/shell/api-service.mjs`,
    files: apiFiles(dirname(indexDir({ env }))),
  };
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function parseBody(answer) {
  if (!answer || answer.status !== 200 || typeof answer.body !== 'string') return null;
  try {
    const value = JSON.parse(answer.body);
    return isObject(value) && value.version === API_VERSION ? value : null;
  } catch {
    return null;
  }
}

// Where the service is asked. The real item has the fixed port. A scratch item, and a scratch home,
// take an OS-chosen port found only through that home's api.json (§2.2), read afresh each time: the
// file appears only once the service is up, and changes with every restart.
function serviceUrl(o) {
  if (o.kind === 'real' && !o.scratchItem) return `http://127.0.0.1:${API_PORT}`;
  const record = readJson(o.files.discovery);
  return isObject(record) && typeof record.url === 'string' ? record.url : null;
}

// launchd's view of the label: is it registered, and what did its last run exit with. The line may
// carry a suffix (`last exit code = 78: EX_CONFIG`, measured) or no number (`(never exited)`).
function launchdState(o) {
  const res = o.launchctl(['print', `gui/${o.uid}/${o.label}`]);
  if (res.status !== 0) return { loaded: false, lastExit: null };
  const m = /last exit code = (\d+)/.exec(String(res.stdout ?? ''));
  return { loaded: true, lastExit: m ? Number(m[1]) : null };
}

async function statusOf(o) {
  const say = (facts) => statusText(facts, o.now());
  if (o.platform !== 'darwin') return say({ state: 'needs-macos' });
  if (existsSync(o.files.off)) return say({ state: 'off' });
  // Off the real machine there is no login item to ask about (§2.8): only the service's own answer.
  let lastExit = null;
  if (o.kind === 'real') {
    const state = launchdState(o);
    if (!state.loaded) return say({ state: 'not-installed' });
    lastExit = state.lastExit;
  }
  const url = serviceUrl(o);
  const answer = url === null ? null : await o.get(`${url}/health`, { timeoutMs: GET_TIMEOUT_MS });
  if (answer) {
    const health = parseBody(answer);
    // Something answered on the port and it is not our service.
    if (!health || health.status !== 'ok' || !Number.isInteger(health.pid)) return say({ state: 'port-held', url });
    // Running is decided by /health alone (§2.7); a failed usage request only changes the second line.
    const usage = parseBody(await o.get(`${url}/v1/usage`, { timeoutMs: GET_TIMEOUT_MS }));
    return say({ state: 'running', url, pid: health.pid, usage });
  }
  if (lastExit === EXIT_PORT_TAKEN) return say({ state: 'port-held', url });
  return say({ state: 'not-answering', lastExit });
}

// A plan with no steps is a refusal and needs no launchctl call, so `loaded` is asked only once the
// other facts have let the plan through. That is what keeps a scratch home, a test process, Linux and
// a checkout from ever reaching launchctl.
function planFor(action, o) {
  const facts = {
    kind: o.kind,
    platform: o.platform,
    installedEngine: o.installedEngine,
    off: existsSync(o.files.off),
    loaded: false,
  };
  const dry = servicePlan(action, facts);
  if (dry.steps.length === 0) return dry;
  return servicePlan(action, { ...facts, loaded: launchdState(o).loaded });
}

async function bootstrap(o) {
  let res = null;
  for (let attempt = 1; attempt <= BOOTSTRAP_ATTEMPTS; attempt += 1) {
    res = o.launchctl(['bootstrap', `gui/${o.uid}`, o.plistPath]);
    if (res.status === 0) return null;
    if (attempt < BOOTSTRAP_ATTEMPTS) await o.sleep(BOOTSTRAP_GAP_MS);
  }
  return statusText({ state: 'register-failed', detail: res.stderr }, o.now());
}

async function awaitAnswer(o) {
  const deadline = o.now() + AWAIT_MS;
  for (;;) {
    const url = serviceUrl(o);
    // Any answer ends the wait: a foreign one will not turn into ours by waiting, and the status
    // check that follows names it.
    if (url !== null && (await o.get(`${url}/health`, { timeoutMs: 1000 }))) return;
    if (o.now() >= deadline) return;
    await o.sleep(AWAIT_GAP_MS);
  }
}

// Only a file left by a crash is removed (§2.9). One whose pid is alive belongs to a service that is
// still shutting down after `bootout`'s SIGTERM and removes it itself. A file with no usable pid names
// no live service, so it goes too; pid 0 or below is never passed to kill, where it means a group.
function removeStaleDiscovery(o) {
  if (!existsSync(o.files.discovery)) return;
  const record = readJson(o.files.discovery);
  const pid = isObject(record) ? record.pid : null;
  if (Number.isInteger(pid) && pid > 0 && isAlive(pid)) return;
  rmSync(o.files.discovery, { force: true });
}

async function runAction(action, opts) {
  const o = resolve(opts);
  const plan = planFor(action, o);
  if (plan.steps.length === 0) return { text: plan.message, code: plan.code };
  for (const step of plan.steps) {
    switch (step.do) {
      case 'remove-off':
        rmSync(o.files.off, { force: true });
        break;
      case 'write-plist':
        writeFileAtomic(
          o.plistPath,
          plistText({ label: o.label, node: o.nodePath ?? resolveNodePath({ exec: o.exec }), script: o.scriptPath, env: o.plistEnv }),
        );
        break;
      case 'bootout':
        // Its result is not acted on: status 3 means it was already gone, and any other failure shows
        // up in the step that follows (`bootstrap` cannot register over it; `off` still leaves the
        // plist gone and the marker written, so nothing starts at the next login).
        o.launchctl(['bootout', `gui/${o.uid}/${o.label}`]);
        break;
      case 'bootstrap': {
        const failed = await bootstrap(o);
        if (failed) return failed;
        break;
      }
      case 'await-answer':
        await awaitAnswer(o);
        return statusOf(o);
      case 'remove-plist':
        rmSync(o.plistPath, { force: true });
        break;
      case 'remove-stale-discovery':
        removeStaleDiscovery(o);
        break;
      case 'write-off':
        writeFileAtomic(o.files.off, '');
        break;
      default:
        throw new Error(`service-ctl: unknown step ${JSON.stringify(step.do)}`);
    }
  }
  // Only `off` ends without a status check. It prints the one line §2.7 gives it, and its code is 0:
  // `pir service off` succeeded, where the status check's `off` state reads 1.
  return { text: 'pir service: off', code: 0 };
}

// serviceOn(opts) → { text, code }: removes the off marker, (re)writes the plist, registers and starts
// the service, waits up to 5 s for it to answer and returns the status check's text.
export async function serviceOn(opts) {
  return runAction('on', opts);
}

// serviceOff(opts) → { text, code }: stops and unregisters the service, removes the plist and a stale
// api.json, and leaves the marker that keeps it off across installs.
export async function serviceOff(opts) {
  return runAction('off', opts);
}

// serviceRefresh(opts) → { text, code }: what install.sh runs. Restarts the service onto the code just
// installed; leaves it alone when the person turned it off.
export async function serviceRefresh(opts) {
  return runAction('refresh', opts);
}

// serviceStatus(opts) → { text, code }: one of the texts of §2.7; code 0 only when the service answers
// /health with a version-1 body.
export async function serviceStatus(opts) {
  return statusOf(resolve(opts));
}

const ACTIONS = { on: serviceOn, off: serviceOff, refresh: serviceRefresh, status: serviceStatus };

// main(argv, { stdout, stderr, opts }) → the exit code. `refresh` is install.sh's word (T07).
export async function main(argv, { stdout = process.stdout, stderr = process.stderr, opts } = {}) {
  const action = argv.length === 1 && Object.hasOwn(ACTIONS, argv[0]) ? ACTIONS[argv[0]] : null;
  if (!action) {
    stderr.write('usage: node service-ctl.mjs on|off|refresh|status\n');
    return 2;
  }
  try {
    const { text, code } = await action(opts);
    stdout.write(`${text}\n`);
    return code;
  } catch (err) {
    stderr.write(`pir service: ${err?.message ?? err}\n`);
    return 1;
  }
}

// Run as a program. Compared through realpath and a file URL rather than as strings: the installed
// engine sits under the person's home, whose path may hold a space or pass through a symlink.
function isMain() {
  try {
    return pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isMain()) {
  // exitCode, not exit(): stdout may be a pipe (install.sh), and exit() can cut a pending write.
  process.exitCode = await main(process.argv.slice(2));
}
