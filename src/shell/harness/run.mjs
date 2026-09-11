// The live-scenario harness's runner + bin (DESIGN §4.1, §5.2, T17). It ties the other three harness
// layers together and drives one scenario for real: install a fixture into a fresh scratch repo (T16),
// launch a REAL coordinator session under its convention name (DESIGN §2.8), capture the run (T14), let
// the coordinator drive to promotion / halt / stall, then seal the bundle and check it against the
// scenario's declared facts (T15). It prints a fact-by-fact report and exits non-zero on any failed
// fact — the verdict is data, not a person's recollection.
//
// It folds in T10 (the full multi-worker + kill-switch drill) and T13's live half (the comms proof):
// each is one scenario here, run with captured data.
//
// WHY THE COORDINATOR IS A SEPARATE SESSION, NOT IN-PROCESS. The coordinator must hold a SendMessage
// inbox and address workers by name (DESIGN §2.2, §2.8), and a Node process cannot — SendMessage is an
// agent tool (coordinate.mjs header). So the runner LAUNCHES the coordinator as a real `claude -n`
// session whose opening turn is `/pir-coordinate {slug}` (DESIGN §2.8), and orchestrates AROUND it:
// install, capture, wait, seal, check — and, on every exit, teardown so no paid worker is orphaned.
//
// THE BUILD HALF IS `auto` AND FULLY TESTABLE (T17 acceptance). Everything platform-shaped is injected
// exactly as the coordinator's own tests inject it: the `claude` runner (launch + capture ticks + the
// teardown platform), the git runner (fixture seed + capture git log), the timers and the clock. So
// fixture install, launch-argv/env construction, capture start/seal, the timeout→HALT path,
// teardown-on-exit and the checkScenario wiring are all proven with NO live agent (DESIGN §5.2 dry-run
// seatbelt). Only actually spawning a real coordinator + real workers needs a person — the `you` half.
//
// SEATBELTS ON EVERY LIVE RUN (DESIGN §5.2): a scratch plan in a scratch repo; the scenario's own low
// ceiling (passed as PARALLEL_MAX_WORKERS); the kill switch wired (the coordinator's HALT flag); and a
// per-scenario wall-clock timeout that auto-touches HALT so a hung real worker cannot run — or cost —
// unboundedly. The runner tears every worker down on any exit (reusing the coordinator's teardownRun
// orphan-guard, T12 P6).

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { coordinatorName, isWorkerOf } from '../../core/naming.mjs';
import { getFixture, installFixture } from './fixtures.mjs';
import { createCapture, bundleDirFor } from './capture.mjs';
import { checkScenario, loadTranscripts, formatReport } from './assertions.mjs';
import { teardownRun } from '../coordinate.mjs';
import { createPlatform } from '../platform.mjs';
import { createWorktree } from '../worktree.mjs';

// --- Pure wiring pieces (each unit-tested with no live agent, T17 acceptance) --------------------

// coordinatorLaunchArgv({ name, slug }) → the `claude` argv that starts the coordinator SESSION under
// its convention name (DESIGN §2.8). It mirrors platform.spawnArgv for a worker: `--bg` runs it
// headless and prints the new session id, `-n <name>` sets the addressable name workers message
// (§2.8), and the opening turn — passed POSITIONALLY, never `-p` (`--bg`+`--print` conflict, FINDINGS
// 2026-09-07) — is `/pir-coordinate {slug}`, which drives the loop and holds the inbox. execFile passes
// each element as one argument, so the spaces in the name and the `·` separator never need quoting.
export function coordinatorLaunchArgv({ name, slug }) {
  if (!name) throw new Error('coordinatorLaunchArgv: no coordinator name');
  if (!slug) throw new Error('coordinatorLaunchArgv: no slug');
  return ['--bg', '-n', name, `/pir-coordinate ${slug}`];
}

// seatbeltEnv({ ceiling, allowHere }) → the env the launched coordinator inherits (DESIGN §5.2). The
// live path only runs with PARALLEL_LIVE=1; the ceiling is the scenario's own low cap; PARALLEL_ALLOW
// _HERE lets a same-named scratch clone through the canonical-repo promotion guard (coordinate.mjs
// canPromoteHere) — a scratch repo built by installFixture is named for its temp dir, not the canonical
// repo, so it is normally not needed, but a scenario may opt in. Values are strings (an env is strings).
export function seatbeltEnv({ ceiling, allowHere = false } = {}) {
  const env = { PARALLEL_LIVE: '1' };
  if (ceiling != null) env.PARALLEL_MAX_WORKERS = String(ceiling);
  if (allowHere) env.PARALLEL_ALLOW_HERE = '1';
  return env;
}

// controlDirFor(scratchDir, slug) → where the coordinator writes its flow log and the HALT flag lives
// (coordinate.mjs fileControl, DESIGN §3.5). The runner touches HALT here on timeout and reads the flow
// log here to know when the run is over.
export function controlDirFor(scratchDir, slug) {
  return join(scratchDir, 'plans', slug, '.parallel', 'control');
}

// touchHalt(controlDir) → wire the kill switch: create the HALT flag file the coordinator polls (DESIGN
// §2.4). Idempotent; creates the control dir if the coordinator has not yet. Returns the flag path.
export function touchHalt(controlDir, { fs = { mkdirSync, writeFileSync } } = {}) {
  fs.mkdirSync(controlDir, { recursive: true });
  const flag = join(controlDir, 'HALT');
  fs.writeFileSync(flag, `${new Date().toISOString()} harness timeout auto-HALT\n`);
  return flag;
}

// runOutcome({ flowText, haltPresent }) → { over, reason }. Reads the two DURABLE terminal markers the
// coordinator writes (DESIGN §4.1: the flow log is the coordinator's own record): a `promote` line is a
// clean landing on main (§2.9), and the HALT flag (its own `halt-close` line follows) is the kill
// switch. A stall — every worker parked or nothing left to do — leaves no terminal flow marker and the
// coordinator session stays idle, so the wait loop detects that separately by counting quiet polls; this
// predicate only reports the two hard terminals. Pure, so it is tested against canned flow text.
export function runOutcome({ flowText = '', haltPresent = false } = {}) {
  const hasType = (type) =>
    flowText
      .split('\n')
      .some((l) => {
        const body = l.slice(l.indexOf(' ') + 1);
        return body === type || body.startsWith(`${type} `);
      });
  if (hasType('promote')) return { over: true, reason: 'promoted' };
  if (haltPresent || hasType('halt-close')) return { over: true, reason: 'halted' };
  return { over: false, reason: 'active' };
}

// --- The default injected effects (mirroring platform.mjs / capture.mjs) -------------------------

function defaultRunClaude(args, { cwd, env } = {}) {
  try {
    const stdout = execFileSync('claude', args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { ok: true, stdout, stderr: '' };
  } catch (e) {
    return { ok: false, stdout: e.stdout ?? '', stderr: e.stderr ?? String(e) };
  }
}

function defaultRunGit(args, { cwd, env } = {}) {
  try {
    const stdout = execFileSync('git', args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { ok: true, stdout, stderr: '' };
  } catch (e) {
    return { ok: false, stdout: e.stdout ?? '', stderr: e.stderr ?? String(e) };
  }
}

// --- Teardown-on-exit: no paid worker (or coordinator) is ever orphaned (DESIGN §2.3, §5.2) -------
//
// Reuses the coordinator's own teardownRun orphan-guard (T12 P6) for the workers — SIGTERM each, since
// `claude stop` alone only interrupts (FINDINGS 2026-09-09) — and then closes the coordinator SESSION
// too, which teardownRun deliberately skips (it filters to isWorkerOf, so the coordinator's own session
// survives its worker-teardown). Touching HALT first tells a still-running coordinator to stop
// dispatching and close its own workers, so this races nothing. Everything is injected, so the whole
// path is provable with a fake platform in the tests.
export function teardownScenario({ platform, worktree, repo, slug, controlDir, control } = {}) {
  // Wire the kill switch first: a live coordinator sees HALT and halts its own dispatch (§2.4).
  if (controlDir) {
    try {
      touchHalt(controlDir);
    } catch {
      /* best-effort; the direct SIGTERM below is what actually ends the sessions */
    }
  }
  // Close this run's workers with the coordinator's own guard (empty state → it lists them by name).
  const { closed } = teardownRun({ platform, worktree, state: { tasks: {} }, repo, slug, control });
  // Then the coordinator session itself, found by its convention name (§2.8).
  const coordName = coordinatorName({ repo, plan: slug });
  let coordinatorClosed = false;
  try {
    const live = platform.list();
    const coord = live.find((a) => a.name === coordName);
    if (coord?.id) {
      platform.close(coord.id);
      coordinatorClosed = true;
      control?.log?.(`teardown: closed coordinator ${coordName} (${coord.id})`);
    }
  } catch {
    /* the list or close failing must not stop the run from exiting */
  }
  return { closed, coordinatorClosed };
}

// --- The runner ----------------------------------------------------------------------------------

// runScenario(opts) → { scenario, ok, reason, bundleDir, report }. Install → launch → capture → wait →
// seal → check, with teardown guaranteed on every exit. Async because the wait loop and the timeout use
// timers. The build half is exercised end-to-end with fakes (no live agent); the live half is a person
// launching this bin on a scratch harness (T17 "Needs a person").
//
//   fixtureId    — which of the six fixtures to run (fixtures.mjs). Its scenario spec carries the facts.
//   scratchDir   — the scratch repo root to install into (a throwaway temp dir, NEVER the real project;
//                  a seatbelt, DESIGN §5.2). Defaults to a fresh mkdtemp dir.
//   allowHere    — pass PARALLEL_ALLOW_HERE=1 to the coordinator (a same-named scratch clone). Default off.
//   pollMs       — the wait-loop cadence; each poll samples agents (capture.tick) and reads the flow log.
//   stallGrace   — consecutive quiet polls (no live worker, coordinator idle) before a stall is declared.
//   timeoutMs    — the wall-clock cap; on expiry the runner auto-touches HALT (§5.2). Defaults to the
//                  scenario's own seatbelt timeout.
//   claudeRun    — (args,{cwd,env}) => { ok, stdout } for the launch, the capture ticks and teardown.
//   gitRun       — (args,{cwd}) => { ok, stdout } for the fixture seed and the capture git log.
//   platform / worktree — injected for teardown; defaults build the real ones over claudeRun/gitRun.
//   install      — installFixture (injectable so a test need not re-seed real git every case).
//   capture      — a createCapture instance (injectable); default is built from the injected runners.
//   timers, now  — injected clock/timers so a test drives time (DESIGN §3.1: the shell owns the clock).
//   log          — where the runner prints progress (default console.log); the fact report is returned.
export async function runScenario({
  fixtureId,
  scratchDir,
  allowHere = false,
  pollMs = 2000,
  stallGrace = 3,
  timeoutMs,
  claudeRun = defaultRunClaude,
  gitRun = defaultRunGit,
  platform,
  worktree,
  install = installFixture,
  capture,
  projectsDir,
  timers = { setTimeout, clearTimeout },
  now = () => new Date(),
  log = () => {},
} = {}) {
  const fixture = getFixture(fixtureId); // throws loudly on a typo, naming the known ids
  const spec = fixture.scenario;
  const slug = fixture.slug;
  const seatbelts = spec.seatbelts ?? {};
  const ceiling = seatbelts.ceiling;
  const timeout = timeoutMs ?? seatbelts.timeoutMs;

  // A fresh scratch repo, never the real project (the seatbelt). mkdtemp when the caller gives none.
  const repoDir = scratchDir ?? mkdtempSync(join(tmpdir(), `pir-t17-${fixtureId}-`));
  const repo = basename(repoDir);
  const controlDir = controlDirFor(repoDir, slug);

  // Real teardown effects unless a test injected fakes. createPlatform needs no transport for
  // list/close (teardown never sends), and createWorktree needs only the root.
  const teardownPlatform = platform ?? createPlatform({ root: repoDir, runClaude: claudeRun });
  const teardownWorktree = worktree ?? createWorktree({ root: repoDir });

  log(`installing fixture "${fixtureId}" into ${repoDir}`);
  install(fixtureId, { into: repoDir, runGit: gitRun });

  // The capture bundle for this run, dated so it can be re-examined long after teardown (DESIGN §4.1).
  const cap =
    capture ??
    createCapture({
      repo,
      slug,
      dir: bundleDirFor(controlDir, now()),
      controlDir,
      repoDir,
      runClaude: claudeRun,
      runGit: gitRun,
      projectsDir,
      now,
    });

  // Arm the wall-clock timeout: on expiry, auto-HALT (§5.2). Cancelled if the run finishes first.
  let timedOut = false;
  const timeoutHandle =
    timeout != null
      ? timers.setTimeout(() => {
          timedOut = true;
          try {
            touchHalt(controlDir);
            log(`\n=== timeout after ${timeout}ms — auto-touched HALT (seatbelt §5.2) ===`);
          } catch {
            /* the teardown in `finally` still SIGTERMs every session */
          }
        }, timeout)
      : null;
  if (timeoutHandle && typeof timeoutHandle.unref === 'function') timeoutHandle.unref();

  let reason = 'error';
  let bundle = null;
  try {
    // Launch the coordinator SESSION under its convention name with the seatbelt env (§2.8, §5.2).
    const name = coordinatorName({ repo, plan: slug });
    const argv = coordinatorLaunchArgv({ name, slug });
    const env = seatbeltEnv({ ceiling, allowHere });
    log(`launching coordinator "${name}"  (ceiling ${ceiling}, timeout ${timeout}ms)`);
    const launched = claudeRun(argv, { cwd: repoDir, env });
    if (!launched.ok) throw new Error(`could not launch coordinator: ${launched.stderr || launched.stdout}`);

    // Wait for the run to reach a terminal: a `promote` line, the HALT flag, or a stall (quiet polls
    // with nothing live). Each poll samples the agent list into the bundle (capture.tick) and reads the
    // coordinator's flow log. The wall-clock timeout is the hard backstop; timers are injected.
    reason = await waitForCompletion({
      cap,
      controlDir,
      repo,
      slug,
      pollMs,
      stallGrace,
      timers,
      isTimedOut: () => timedOut,
    });
    log(`run reached: ${reason}`);
  } finally {
    if (timeoutHandle) timers.clearTimeout(timeoutHandle);
    // Seal the bundle whatever happened — a failed or halted run is still evidence (DESIGN §4.1).
    try {
      bundle = cap.seal();
    } catch (e) {
      log(`capture seal failed: ${e.message}`);
    }
    // Teardown last: HALT + SIGTERM every worker and the coordinator, so no paid session is orphaned
    // (DESIGN §2.3, §5.2; the T12 P6 orphan-guard). Idempotent and best-effort.
    try {
      const t = teardownScenario({ platform: teardownPlatform, worktree: teardownWorktree, repo, slug, controlDir });
      if (t.closed.length || t.coordinatorClosed) {
        log(`teardown: closed ${t.closed.length} worker(s)${t.coordinatorClosed ? ' + the coordinator' : ''}`);
      }
    } catch (e) {
      log(`teardown failed: ${e.message}`);
    }
  }

  // Check the sealed bundle against the scenario's declared facts (T15). loadTranscripts is the one I/O
  // the assertion layer does; every fact is then pure over the loaded bundle.
  const withTranscripts = loadTranscripts(bundle);
  const report = checkScenario(spec, withTranscripts);
  const ok = report.pass && !timedOut;
  return { scenario: spec.id, ok, reason: timedOut ? 'timeout' : reason, bundleDir: bundle?.dir ?? null, report };
}

// waitForCompletion(...) → the terminal reason ('promoted' | 'halted' | 'stalled' | 'timeout'). Polls on
// the injected timers: each tick samples the agent list into the capture bundle and reads the flow log,
// then asks runOutcome for a hard terminal (promote / HALT). A stall — no live worker of this run and no
// hard terminal — is counted; after stallGrace consecutive quiet polls the run is declared stalled (the
// coordinator is idle with nothing to do or everything parked, DESIGN §4.1 "promotion / halt / stall").
async function waitForCompletion({ cap, controlDir, repo, slug, pollMs, stallGrace, timers, isTimedOut }) {
  const flagPath = join(controlDir, 'HALT');
  const flowPath = join(controlDir, 'log');
  let quiet = 0;
  for (;;) {
    const snap = cap.tick(); // one sampled `agents --json`, recorded into the bundle
    const flowText = existsSync(flowPath) ? safeRead(flowPath) : '';
    const haltPresent = existsSync(flagPath);

    const outcome = runOutcome({ flowText, haltPresent });
    if (outcome.over) return outcome.reason;
    if (isTimedOut()) return 'timeout';

    // A quiet poll: none of this run's workers is live. Persisted quiet is a stall (§4.1). A live
    // worker (busy or idle, e.g. parked on a decision) resets the counter — the run is still going.
    const liveWorkers = (snap.agents ?? []).filter((a) => isWorkerOf(a.name, { repo, plan: slug }));
    quiet = liveWorkers.length === 0 ? quiet + 1 : 0;
    if (quiet >= stallGrace) return 'stalled';

    await delay(timers, pollMs);
  }
}

function safeRead(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

// A promise that resolves after ms on the INJECTED timers (never the global clock), so a test drives
// the wait loop deterministically with a fake setTimeout.
function delay(timers, ms) {
  return new Promise((resolve) => timers.setTimeout(resolve, ms));
}

// --- The `run {fixtureId}` bin entry -------------------------------------------------------------
//
// The `you` launcher (T17 "Needs a person"): the user starts this on the scratch harness, it spawns a
// real coordinator + real workers under the seatbelts, and prints the fact report. It refuses to run
// inside the canonical project unless PARALLEL_ALLOW_HERE=1 — the same guard coordinate.mjs applies —
// because a scenario spawns real paid agents and mutates a real main.
const CANONICAL_REPO = 'plan-implement-review';

async function main(argv) {
  const fixtureId = argv[0];
  if (!fixtureId) {
    console.error(`usage: node src/shell/harness/run.mjs {fixtureId}\n  fixtures: (see fixtures.mjs listFixtures)`);
    process.exit(2);
  }

  // A caller may point at an existing scratch repo (--into <dir>); otherwise a temp dir is used.
  const intoFlag = argv.indexOf('--into');
  const scratchDir = intoFlag !== -1 ? argv[intoFlag + 1] : undefined;
  const allowHere = process.env.PARALLEL_ALLOW_HERE === '1';

  // Seatbelt: never run a scenario that spawns real agents inside the canonical project by accident.
  if (basename(process.cwd()) === CANONICAL_REPO && !scratchDir && !allowHere) {
    console.error(
      `Refusing to run a live scenario inside "${CANONICAL_REPO}" — it spawns real paid workers and\n` +
        `mutates a real main. It installs into a throwaway temp scratch repo by default, so this guard\n` +
        `only trips if you meant to. Pass --into <dir> to name a scratch repo, or set\n` +
        `PARALLEL_ALLOW_HERE=1 if you know what you are doing.`,
    );
    process.exit(1);
  }

  console.log(`=== live scenario: ${fixtureId} (real paid workers; seatbelted §5.2) ===`);
  const result = await runScenario({ fixtureId, scratchDir, allowHere, log: (m) => console.log(m) });

  console.log(`\nbundle: ${result.bundleDir}`);
  console.log(formatReport(result.report));
  console.log(`\n${result.ok ? 'PASS' : 'FAIL'} — scenario ${result.scenario} (${result.reason})`);
  process.exit(result.ok ? 0 : 1);
}

// Only run the bin when invoked directly, never on import (the tests import the functions above).
if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
