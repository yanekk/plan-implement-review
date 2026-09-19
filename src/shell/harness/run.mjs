// The live-scenario harness's runner + bin (DESIGN §4.1, §5.2, §2.1, T17/T05). It ties the other three
// harness layers together and drives one scenario for real: install a fixture into a fresh scratch repo
// (T16), launch the REAL coordinator (§2.1), capture the run (T14), let the coordinator drive to its
// hand-off / a Ctrl-C / a stall, then seal the bundle and check it against the scenario's declared facts
// (T15). It prints a fact-by-fact report and exits non-zero on any failed fact — the verdict is data.
//
// WHY THE COORDINATOR IS A PLAIN CHILD PROCESS, NOT A SESSION (DESIGN §2.1, §2.6, §2.9). The coordinator
// is `node src/shell/coordinate.mjs {slug}`, a foreground process — no `claude` session, no agent name,
// so it never appears in `claude agents`. The runner SPAWNS that process, holds its pid, and detects the
// run finishing by the process EXITING (it prints the hand-off and returns). This is the property the
// whole design rests on: a plain process has a stable pid, so the runner can crash it with a real signal
// and prove kill-and-rebuild (§2.6) — which an agentic coordinator, whose background session rotates its
// process pool each turn, never could (coordinator-restart-resume T07). The message relay, the
// down-channel `answers` file, and the `you`/hands-on driving are all gone with the agentic half (§2.2,
// §2.5); the person answers a blocked worker directly and the runner routes nothing.
//
// THE ORCHESTRATION IS FULLY TESTABLE (T17 acceptance). Everything platform-shaped is injected: the
// process `spawn` (launch + crash), the `claude` runner (capture ticks + worker teardown), the git
// runner (fixture seed + capture git log), the timers and the clock. So the launch, the exit-detection,
// the timeout→HALT path, the crash-and-relaunch, teardown-on-exit and the checkScenario wiring are all
// proven with NO live agent (DESIGN §5.2 dry-run seatbelt). Only actually spawning a real coordinator +
// real workers needs a person — the live half (T09).
//
// SEATBELTS ON EVERY LIVE RUN (DESIGN §5.2): a scratch plan in a scratch repo; the scenario's own low
// ceiling (passed as PARALLEL_MAX_WORKERS); the kill switch wired (the coordinator's HALT flag); and a
// per-scenario wall-clock timeout that auto-touches HALT so a hung real worker cannot run — or cost —
// unboundedly. The runner tears every worker down on any exit (reusing the coordinator's teardownRun
// orphan-guard, T12 P6) and kills the coordinator process too.

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execFileSync, spawn as nodeSpawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { isWorkerOf } from '../../core/naming.mjs';
import { getFixture, installFixture } from './fixtures.mjs';
import { createCapture, bundleDirFor } from './capture.mjs';
import { checkScenario, loadTranscripts, loadFinalFiles, loadControlFeeds, formatReport } from './assertions.mjs';
import { teardownRun } from '../coordinate.mjs';
import { createPlatform } from '../platform.mjs';
import { createWorktree } from '../worktree.mjs';

// --- Pure wiring pieces (each unit-tested with no live agent, T17 acceptance) --------------------

// coordinatorLaunchArgv({ slug }) → the argv passed to `node` to run the coordinator as a plain
// foreground process (DESIGN §2.1): `node src/shell/coordinate.mjs {slug}`. The script path is relative
// to the scratch repo cwd, which carries src/ (fixtures.carrySource), so it resolves there. There is no
// name and no `claude` — the coordinator is a process, not a session (§2.9).
export function coordinatorLaunchArgv({ slug }) {
  if (!slug) throw new Error('coordinatorLaunchArgv: no slug');
  return ['src/shell/coordinate.mjs', slug];
}

// seatbeltEnv({ ceiling, allowHere }) → the env the launched coordinator inherits (DESIGN §5.2). The
// live path only runs with PARALLEL_LIVE=1; the ceiling is the scenario's own low cap; PARALLEL_ALLOW
// _HERE lets a same-named scratch clone through the canonical-repo branch-safety guard (coordinate.mjs
// canPromoteHere) — a scratch repo built by installFixture is named for its temp dir, not the canonical
// repo, so it is normally not needed, but a scenario may opt in. Values are strings (an env is strings).
export function seatbeltEnv({ ceiling, allowHere = false } = {}) {
  const env = { PARALLEL_LIVE: '1' };
  if (ceiling != null) env.PARALLEL_MAX_WORKERS = String(ceiling);
  if (allowHere) env.PARALLEL_ALLOW_HERE = '1';
  return env;
}

// spawnCoordinator({ argv, cwd, env, spawn }) → a handle over the launched child process:
//   { pid, kill(signal), exited }  where `exited` is a Promise resolving { code, signal } once the
// process ends. spawn is injected (default node:child_process spawn) so a test drives a fake child with
// no real process. The child inherits the parent env plus the seatbelt env (so PATH etc. resolve), and
// its stdio is ignored — the runner reads the run from the flow log and `claude agents`, never the
// coordinator's stdout.
export function spawnCoordinator({ argv, cwd, env = {}, spawn = nodeSpawn } = {}) {
  const child = spawn('node', argv, { cwd, env: { ...process.env, ...env }, stdio: 'ignore' });
  let resolveExit;
  const exited = new Promise((resolve) => {
    resolveExit = resolve;
  });
  child.on('exit', (code, signal) => resolveExit({ code, signal }));
  return {
    pid: child.pid ?? null,
    kill: (signal = 'SIGTERM') => {
      try {
        child.kill(signal);
      } catch {
        /* the process may already be gone; the caller's teardown still sweeps workers */
      }
    },
    exited,
  };
}

// controlDirFor(scratchDir, slug) → where the coordinator writes its flow log and the HALT flag lives
// (coordinate.mjs fileControl, DESIGN §3.5). The runner touches HALT here on timeout and reads the flow
// log here to know what the run did.
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

// runOutcome({ flowText, exited }) → { over, reason }. In the foreground-process model the run is over
// when the coordinator PROCESS EXITS — it prints the hand-off and returns (DESIGN §2.1); there is no
// `promote` flow marker any more (§2.4, T01). So `over` is driven by the process exit, not the flow log.
// While the process is alive the run is `active`. Once it has exited, the flow log says WHICH terminal
// it was: a `halt-close` line means the kill switch fired (§2.4), so the run `halted`; otherwise it ran
// to its hand-off (or a stall) and `completed`. The FACTS decide pass/fail; `reason` is the human label.
// Pure, so it is tested against canned flow text and an exit flag.
export function runOutcome({ flowText = '', exited = false } = {}) {
  if (!exited) return { over: false, reason: 'active' };
  const hasHaltClose = String(flowText)
    .split('\n')
    .some((l) => {
      const body = l.slice(l.indexOf(' ') + 1);
      return body === 'halt-close' || body.startsWith('halt-close ');
    });
  return { over: true, reason: hasHaltClose ? 'halted' : 'completed' };
}

// captureFinalFiles({ repoDir, gitRun, files }) → { path: content } read from `git show pir/{slug}:path`
// (the feature branch the run hands off, DESIGN §2.4 — the run never merges to main, so the decided
// content lives on the feature branch). Run at seal, while the feature branch still exists (teardown
// removes only worker worktrees), so a fact can prove which side a resolved merge-conflict shipped. A
// file git cannot show is omitted, so the fact reports "no captured final content" from data rather than
// throwing. `ref` is the branch to read from (the caller passes `pir/{slug}`).
export function captureFinalFiles({ repoDir, gitRun = defaultRunGit, files = [], ref = 'main' } = {}) {
  const out = {};
  for (const f of files) {
    const r = gitRun(['show', `${ref}:${f}`], { cwd: repoDir });
    if (r.ok) out[f] = r.stdout;
  }
  return out;
}

// --- Restart-mode pure wiring (DESIGN §2.6, §4, T05) ---------------------------------------------

// restartTargetReached({ flowText, branchState, waitFor }) → has the deterministic crash point been
// reached? The point is a task branch having COMMITTED the target glyph (waitFor = { task, glyph }), the
// mid-review state a restart must adopt (§2.6) — never a timer. The primary signal is a taskBranchState
// read (T02): the committed glyph on the task's own branch, passed in as branchState. The fallback, for a
// 🔍 target, is a `review {task}` flow line — the coordinator wrote it the moment it saw the committed 🔍
// and handed the branch to a reviewer (loop.mjs review handoff), the same mid-review window. Pure, so the
// wait loop's stop condition is unit-tested against canned inputs with no live coordinator.
export function restartTargetReached({ flowText = '', branchState = null, waitFor } = {}) {
  if (!waitFor || !waitFor.task || !waitFor.glyph) return false;
  const { task, glyph } = waitFor;
  if (branchState != null && branchState === glyph) return true;
  if (glyph === '🔍') {
    return String(flowText)
      .split('\n')
      .some((l) => {
        const body = l.slice(l.indexOf(' ') + 1);
        return body === `review ${task}` || body.startsWith(`review ${task} `);
      });
  }
  return false;
}

// seedStaleFeeds(controlDir, sentinel) → write a stale sentinel into the one transient control feed that
// survives across a run: `reports/`, the worker up-channel (DESIGN §3.5). The down-channel feeds
// (answers/outbox/surfaced) were removed with the relay (§2.2), so reports/ is all a crashed run can
// strand. The runner seeds it in the gap AFTER the crash and BEFORE the relaunch, so nothing drains it
// and the relaunched coordinator's startup hygiene is what must clear it; feedsCleared then proves it
// did. Best-effort, fs injected so the write is testable.
export function seedStaleFeeds(controlDir, sentinel, { fs = { mkdirSync, writeFileSync } } = {}) {
  const reportsDir = join(controlDir, 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  fs.writeFileSync(join(reportsDir, `${sentinel}.json`), `${JSON.stringify({ stale: sentinel })}\n`);
  return { seeded: ['reports/'] };
}

// snapshotControlFeeds(controlDir) → the transient feed's contents at seal, for the bundle's
// control-feeds.json (T05). reports/ is read as its list of *.json names. feedsCleared checks the seeded
// sentinel is absent from it. A missing feed reads as empty rather than throwing, fs injected for the test.
export function snapshotControlFeeds(controlDir, { fs = { existsSync, readdirSync } } = {}) {
  const feeds = {};
  const reportsDir = join(controlDir, 'reports');
  try {
    feeds.reports = fs.existsSync(reportsDir) ? fs.readdirSync(reportsDir).filter((n) => n.endsWith('.json')) : [];
  } catch {
    feeds.reports = [];
  }
  return feeds;
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

// --- Teardown-on-exit: no paid worker is ever orphaned (DESIGN §2.3, §2.6, §5.2) -----------------
//
// Reuses the coordinator's own teardownRun orphan-guard (T12 P6) for the workers — SIGTERM each, since
// `claude stop` alone only interrupts (FINDINGS 2026-09-09). There is no coordinator session to close:
// the coordinator is a plain process the runner kills by its pid (runScenario's finally). Touching HALT
// first tells a still-running coordinator to stop dispatching and close its own workers, so this races
// nothing. Everything is injected, so the whole path is provable with a fake platform in the tests.
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
  return { closed };
}

// --- The runner ----------------------------------------------------------------------------------

// runScenario(opts) → { scenario, ok, reason, bundleDir, report }. Install → launch → capture → wait →
// seal → check, with teardown guaranteed on every exit. Async because the wait loop and the timeout use
// timers. The whole orchestration is exercised end-to-end with fakes (no live agent); the live half is a
// person launching this bin on a scratch harness (T09 "Needs a person").
//
//   fixtureId    — which fixture to run (fixtures.mjs). Its scenario spec carries the facts.
//   scratchDir   — the scratch repo root to install into (a throwaway temp dir, NEVER the real project;
//                  a seatbelt, DESIGN §5.2). Defaults to a fresh mkdtemp dir.
//   allowHere    — pass PARALLEL_ALLOW_HERE=1 to the coordinator (a same-named scratch clone). Default off.
//   pollMs       — the wait-loop cadence; each poll samples agents (capture.tick) and checks the process.
//   haltGrace    — after the wall-clock timeout auto-HALTs, how many extra polls to wait for the
//                  coordinator to react and exit before giving up and reporting 'timeout' (§5.2).
//   timeoutMs    — the wall-clock cap; on expiry the runner auto-touches HALT (§5.2). Defaults to the
//                  scenario's own seatbelt timeout.
//   spawn        — node:child_process spawn, injected so a test drives a fake child (no real process).
//   claudeRun    — (args,{cwd,env}) => { ok, stdout } for the capture ticks and worker teardown.
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
  haltGrace = 5,
  timeoutMs,
  spawn = nodeSpawn,
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
            /* the teardown in `finally` still kills the process and its workers */
          }
        }, timeout)
      : null;
  if (timeoutHandle && typeof timeoutHandle.unref === 'function') timeoutHandle.unref();

  let reason = 'error';
  let bundle = null;
  let child = null;
  try {
    // Launch the coordinator as a plain child process with the seatbelt env (§2.1, §5.2).
    const argv = coordinatorLaunchArgv({ slug });
    const env = seatbeltEnv({ ceiling, allowHere });
    log(`launching coordinator process: node ${argv.join(' ')}  (ceiling ${ceiling}, timeout ${timeout}ms)`);
    child = spawnCoordinator({ argv, cwd: repoDir, env, spawn });

    // Wait for the run to reach a terminal: the coordinator process exits (hand-off or stall or halt), or
    // the wall-clock timeout fires. Each poll samples the agent list into the bundle (capture.tick).
    reason = await waitForCompletion({
      cap,
      controlDir,
      child,
      pollMs,
      haltGrace,
      timers,
      isTimedOut: () => timedOut,
      log,
    });
    log(`run reached: ${reason}`);
  } finally {
    if (timeoutHandle) timers.clearTimeout(timeoutHandle);
    // Kill the coordinator process (its own SIGTERM handler closes its workers); then seal and sweep any
    // worker it did not, so no paid session is orphaned (DESIGN §2.3, §2.6). Idempotent and best-effort.
    if (child) child.kill('SIGTERM');
    try {
      bundle = cap.seal();
    } catch (e) {
      log(`capture seal failed: ${e.message}`);
    }
    try {
      const t = teardownScenario({ platform: teardownPlatform, worktree: teardownWorktree, repo, slug, controlDir });
      if (t.closed.length) log(`teardown: closed ${t.closed.length} worker(s)`);
    } catch (e) {
      log(`teardown failed: ${e.message}`);
    }
  }

  // Capture the handed-off content of any file the fixture declares a decided outcome for, from the
  // feature branch pir/{slug} (the run never merges to main, §2.4), while it still exists (teardown
  // removed only worker worktrees). Persist it into the bundle as final-files.json so an offline re-check
  // (loadFinalFiles) sees the same evidence.
  if (fixture.finalContent && bundle?.dir) {
    try {
      const finals = captureFinalFiles({ repoDir, gitRun, files: [fixture.finalContent.file], ref: `pir/${slug}` });
      writeFileSync(join(bundle.dir, 'final-files.json'), `${JSON.stringify(finals, null, 2)}\n`);
    } catch (e) {
      log(`final-content capture failed: ${e.message}`);
    }
  }

  // Check the sealed bundle against the scenario's declared facts (T15). loadTranscripts and
  // loadFinalFiles are the assertion layer's loaders (its only I/O); every fact is then pure.
  const report = checkScenario(spec, loadFinalFiles(loadTranscripts(bundle)));
  const ok = report.pass && !timedOut;
  return { scenario: spec.id, ok, reason: timedOut ? 'timeout' : reason, bundleDir: bundle?.dir ?? null, report };
}

// --- The restart runner (DESIGN §2.6, §4, §5.2, T05) ---------------------------------------------

// runRestartScenario(opts) → the same shape as runScenario, but it drives the coordinator through a crash
// and a restart on ONE scratch repo so kill-and-rebuild can be checked (the live half is T09). The
// sequence (fixture.restart declares the crash point): install ONCE → launch → wait until the target task
// branch has committed the crash-point glyph → SIGKILL the coordinator PROCESS (leaving its workers and
// the git state — a real crash, no clean teardown) → seed a stale control-feed leftover → relaunch on the
// SAME scratch WITHOUT reinstalling, so it reconciles from git → wait for the resumed process to exit →
// seal, snapshot the feed, check. ONE capture instance spans both launches, so the bundle's flow log and
// timeline cover the whole run. Everything platform-shaped is injected exactly as runScenario injects it,
// so the whole orchestration is proven against the fakes with no live agent (§5.2). Only the fixture
// declaring a `restart` spec runs this; the bin dispatches on it.
export async function runRestartScenario({
  fixtureId,
  scratchDir,
  allowHere = false,
  pollMs = 2000,
  haltGrace = 5,
  startupGrace = 45,
  timeoutMs,
  spawn = nodeSpawn,
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
  const fixture = getFixture(fixtureId);
  const spec = fixture.scenario;
  const slug = fixture.slug;
  const restartSpec = fixture.restart;
  if (!restartSpec || !restartSpec.waitFor) {
    throw new Error(`runRestartScenario: fixture "${fixtureId}" declares no restart.waitFor crash point`);
  }
  const waitFor = restartSpec.waitFor;
  const seatbelts = spec.seatbelts ?? {};
  const ceiling = seatbelts.ceiling;
  const timeout = timeoutMs ?? seatbelts.timeoutMs;

  const repoDir = scratchDir ?? mkdtempSync(join(tmpdir(), `pir-t05-${fixtureId}-`));
  const repo = basename(repoDir);
  const controlDir = controlDirFor(repoDir, slug);

  const teardownPlatform = platform ?? createPlatform({ root: repoDir, runClaude: claudeRun });
  const teardownWorktree = worktree ?? createWorktree({ root: repoDir });

  log(`installing fixture "${fixtureId}" into ${repoDir} (once — the relaunch must not reinstall)`);
  install(fixtureId, { into: repoDir, runGit: gitRun });

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

  // One wall-clock timeout over the WHOLE restart run (both launches), auto-HALT on expiry (§5.2).
  let timedOut = false;
  const timeoutHandle =
    timeout != null
      ? timers.setTimeout(() => {
          timedOut = true;
          try {
            touchHalt(controlDir);
            log(`\n=== timeout after ${timeout}ms — auto-touched HALT (seatbelt §5.2) ===`);
          } catch {
            /* the teardown in `finally` still kills the process and its workers */
          }
        }, timeout)
      : null;
  if (timeoutHandle && typeof timeoutHandle.unref === 'function') timeoutHandle.unref();

  // A stale sentinel the crash leaves in the transient reports feed, seeded between the kill and the
  // relaunch so only the resumed coordinator's hygiene can clear it (feedsCleared reads it back).
  const sentinel = `STALE-${now().toISOString().replace(/[:.]/g, '-')}-restart`;
  let seededFeeds = false;

  const argv = coordinatorLaunchArgv({ slug });
  const env = seatbeltEnv({ ceiling, allowHere });

  let reason = 'error';
  let bundle = null;
  let child1 = null;
  let child2 = null;
  try {
    // Launch 1: the run that will crash. Seatbelted exactly as a normal live run (§2.1, §5.2).
    log(`launching coordinator process: node ${argv.join(' ')}  (ceiling ${ceiling}, timeout ${timeout}ms)`);
    child1 = spawnCoordinator({ argv, cwd: repoDir, env, spawn });

    // Wait for the deterministic crash point: the target task branch has committed the crash-point glyph.
    const target = await waitForTarget({
      cap,
      controlDir,
      repo,
      slug,
      waitFor,
      worktree: teardownWorktree,
      child: child1,
      pollMs,
      startupGrace,
      timers,
      isTimedOut: () => timedOut,
      log,
    });

    if (target.reason !== 'target') {
      // The run never reached the crash point (timed out, or the process exited early). Seal what there
      // is — the facts will fail (no restart), which is the honest verdict.
      reason = target.reason;
      log(`did not reach the ${waitFor.glyph} crash point: ${reason}`);
    } else {
      log(`reached the ${waitFor.glyph} crash point on ${waitFor.task}`);
      // Crash: SIGKILL the coordinator PROCESS. Its workers and the git state are left on disk — the real
      // crash reconciliation must handle them (§2.6). SIGKILL, not SIGTERM: the coordinator catches
      // SIGTERM and tears its workers down cleanly, which would erase the in-flight state the drill exists
      // to reconcile (FINDINGS 2026-09-17).
      if (child1.pid != null) {
        child1.kill('SIGKILL');
        log(`crashed the coordinator (pid ${child1.pid}, SIGKILL) — workers and git state left on disk`);
      } else {
        log('no coordinator pid — cannot crash; relaunching anyway');
      }

      // Seed the stale control-feed leftover now, while nothing is draining it (the coordinator is dead).
      try {
        seedStaleFeeds(controlDir, sentinel);
        seededFeeds = true;
        log('seeded a stale control-feed leftover (reports/)');
      } catch (e) {
        log(`could not seed stale feeds: ${e.message}`);
      }

      // Relaunch on the SAME scratch — NO installFixture. Git already holds the in-flight branches, so the
      // resumed coordinator reconciles from them; reinstalling would wipe exactly what it must resume.
      log('relaunching the coordinator on the same scratch (no reinstall)');
      child2 = spawnCoordinator({ argv, cwd: repoDir, env, spawn });

      // Wait for the resumed process to exit, still capturing into the same bundle.
      reason = await waitForCompletion({
        cap,
        controlDir,
        child: child2,
        pollMs,
        haltGrace,
        timers,
        isTimedOut: () => timedOut,
        log,
      });
      log(`resumed run reached: ${reason}`);
    }
  } finally {
    if (timeoutHandle) timers.clearTimeout(timeoutHandle);
    // Make sure neither coordinator process is left alive, then seal and sweep workers.
    if (child1) child1.kill('SIGKILL');
    if (child2) child2.kill('SIGTERM');
    try {
      bundle = cap.seal();
    } catch (e) {
      log(`capture seal failed: ${e.message}`);
    }
    try {
      const t = teardownScenario({ platform: teardownPlatform, worktree: teardownWorktree, repo, slug, controlDir });
      if (t.closed.length) log(`teardown: closed ${t.closed.length} worker(s)`);
    } catch (e) {
      log(`teardown failed: ${e.message}`);
    }
  }

  // Snapshot the transient control feed into the bundle so feedsCleared can prove the seeded leftover was
  // cleared by the restart hygiene (§2.7). Written after seal, then read back by loadControlFeeds — the
  // same after-seal pattern final-files.json uses.
  if (bundle?.dir) {
    try {
      const feeds = snapshotControlFeeds(controlDir);
      writeFileSync(
        join(bundle.dir, 'control-feeds.json'),
        `${JSON.stringify({ seeded: seededFeeds, sentinel, feeds }, null, 2)}\n`,
      );
    } catch (e) {
      log(`control-feeds capture failed: ${e.message}`);
    }
  }

  // Capture any decided final content the fixture declares (parity with runScenario; the restart fixture
  // declares none, so this is a no-op there).
  if (fixture.finalContent && bundle?.dir) {
    try {
      const finals = captureFinalFiles({ repoDir, gitRun, files: [fixture.finalContent.file], ref: `pir/${slug}` });
      writeFileSync(join(bundle.dir, 'final-files.json'), `${JSON.stringify(finals, null, 2)}\n`);
    } catch (e) {
      log(`final-content capture failed: ${e.message}`);
    }
  }

  const report = checkScenario(spec, loadControlFeeds(loadFinalFiles(loadTranscripts(bundle))));
  const ok = report.pass && !timedOut;
  return { scenario: spec.id, ok, reason: timedOut ? 'timeout' : reason, bundleDir: bundle?.dir ?? null, report };
}

// waitForTarget(...) → { reason }. Polls the injected timers, ticking the capture each poll, until the
// restart crash point is reached ('target'), the wall-clock timeout fires ('timeout'), or the coordinator
// process exits before the target ('exited'). The crash point is a taskBranchState read (T02) of the
// target task returning the crash-point glyph, or the flow fallback (restartTargetReached); it is NOT a
// timer (§2.6). The runner already holds the coordinator's pid (child), so it kills it directly — no need
// to find it in the agent list. startupGrace bounds a coordinator that dies before ever reaching the
// target: if the process has exited and quiet polls accumulate, the run stalled.
async function waitForTarget({ cap, controlDir, repo, slug, waitFor, worktree, child, pollMs, startupGrace, timers, isTimedOut, log = () => {} }) {
  const flowPath = join(controlDir, 'log');
  let exited = false;
  child.exited.then(() => {
    exited = true;
  });
  let quiet = 0;
  for (;;) {
    const snap = cap.tick();
    const flowText = existsSync(flowPath) ? safeRead(flowPath) : '';
    let branchState = null;
    try {
      branchState = worktree?.taskBranchState ? worktree.taskBranchState(slug, waitFor.task) : null;
    } catch {
      branchState = null; // a read failure is not the target; keep polling
    }
    if (restartTargetReached({ flowText, branchState, waitFor })) {
      return { reason: 'target' };
    }
    if (isTimedOut()) return { reason: 'timeout' };

    // Bound a coordinator that dies before the target: once its process has exited and no worker of this
    // run is live, count quiet polls and stall past the startup budget.
    const agents = snap.agents ?? [];
    const anyWorkerLive = agents.some((a) => isWorkerOf(a.name, { repo, plan: slug }));
    if (!exited || anyWorkerLive) {
      quiet = 0;
    } else {
      quiet += 1;
      if (quiet >= startupGrace) {
        log('the coordinator exited before reaching the crash point — stalled');
        return { reason: 'exited' };
      }
    }
    await delay(timers, pollMs);
  }
}

// waitForCompletion(...) → the terminal reason ('completed' | 'halted' | 'timeout'). Polls on the injected
// timers: each tick samples the agent list into the capture bundle and watches the coordinator process.
// The run is over when the process EXITS — it prints the hand-off and returns (§2.1); the flow log then
// says whether it was a clean hand-off ('completed') or the kill switch ('halted', a `halt-close` line).
// There is no `promote` marker any more (§2.4), and no stall detection here: the coordinator detects its
// own stall and exits, so the process exit is the single terminal. The wall-clock timeout is the backstop
// for a coordinator that hangs without exiting: it auto-touches HALT, and after a bounded haltGrace of
// further polls with no exit, the run ends 'timeout' and the finally kills the process.
async function waitForCompletion({ cap, controlDir, child, pollMs, haltGrace = 5, timers, isTimedOut, log = () => {} }) {
  const flowPath = join(controlDir, 'log');
  let exited = false;
  child.exited.then(() => {
    exited = true;
  });
  let graceAfterTimeout = 0;
  for (;;) {
    cap.tick(); // one sampled `agents --json`, recorded into the bundle
    const flowText = existsSync(flowPath) ? safeRead(flowPath) : '';

    const outcome = runOutcome({ flowText, exited });
    if (outcome.over) return outcome.reason;

    if (isTimedOut()) {
      // The wall-clock timeout auto-touched HALT; give the coordinator a bounded grace to react and exit
      // (so a `halt-close` is captured), then give up rather than polling forever on a hung process.
      graceAfterTimeout += 1;
      if (graceAfterTimeout === 1) log(`timeout — waiting up to ${haltGrace} grace poll(s) for the coordinator to react`);
      if (graceAfterTimeout > haltGrace) return 'timeout';
    }

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

// A promise that resolves after ms on the INJECTED timers (never the global clock), so a test drives the
// wait loop deterministically with a fake setTimeout.
function delay(timers, ms) {
  return new Promise((resolve) => timers.setTimeout(resolve, ms));
}

// --- The `run {fixtureId}` bin entry -------------------------------------------------------------
//
// The live launcher (T09 "Needs a person"): the user starts this on the scratch harness, it spawns a real
// coordinator process + real workers under the seatbelts, and prints the fact report. It refuses to run
// inside the canonical project unless PARALLEL_ALLOW_HERE=1 — the same guard coordinate.mjs applies —
// because a scenario spawns real paid agents and cuts real branches.
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
        `cuts real branches. It installs into a throwaway temp scratch repo by default, so this guard\n` +
        `only trips if you meant to. Pass --into <dir> to name a scratch repo, or set\n` +
        `PARALLEL_ALLOW_HERE=1 if you know what you are doing.`,
    );
    process.exit(1);
  }

  // A fixture that declares a `restart` crash point runs the crash-and-restart drill (T05); every other
  // fixture runs the straight-through scenario. Both take the same options and return the same shape.
  const isRestart = !!getFixture(fixtureId).restart;
  console.log(
    `=== live ${isRestart ? 'restart ' : ''}scenario: ${fixtureId} (real paid workers; seatbelted §5.2) ===`,
  );
  const runner = isRestart ? runRestartScenario : runScenario;
  const result = await runner({ fixtureId, scratchDir, allowHere, log: (m) => console.log(m) });

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
