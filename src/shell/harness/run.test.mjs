// run.mjs, proven WITHOUT a live agent (DESIGN §4.1, §5.2, §2.1, T17/T05 build-half acceptance). The
// launch argv and seatbelt env are asserted directly; the coordinator is spawned through an injected
// process `spawn` so the whole launch → capture → exit-detection → seal → checkScenario flow is driven
// with a fake child (no real process); the timeout→HALT and teardown-on-exit paths each have a test; and
// the crash-and-restart runner is driven end to end with a fake spawn that hands out two children and an
// injected kill. Actually spawning a real coordinator + real workers is the live half a person launches
// (T09); this file never does (the seatbelt).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  coordinatorLaunchArgv,
  seatbeltEnv,
  spawnCoordinator,
  controlDirFor,
  touchHalt,
  runOutcome,
  reachedExpectedTerminal,
  teardownScenario,
  runScenario,
  captureFinalFiles,
  restartTargetReached,
  seedStaleFeeds,
  snapshotControlFeeds,
  runRestartScenario,
} from './run.mjs';

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'pir-t17-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// A fake process spawner: each call returns a controllable child (pid, .on('exit'), .kill), recorded so a
// test can inspect the argv/env and drive the child's exit and kills. spawnCoordinator wraps it.
function fakeSpawner({ startPid = 5000 } = {}) {
  const children = [];
  const spawn = (cmd, argv, opts) => {
    let onExit = null;
    const child = {
      cmd,
      argv,
      opts,
      pid: startPid + children.length,
      kills: [],
      on: (ev, cb) => {
        if (ev === 'exit') onExit = cb;
      },
      kill: (sig) => {
        child.kills.push(sig);
      },
      exit: (code = 0, signal = null) => {
        if (onExit) onExit(code, signal);
      },
    };
    children.push(child);
    return child;
  };
  spawn.children = children;
  return spawn;
}

// --- coordinatorLaunchArgv (DESIGN §2.1: a plain node process, no session) -----------------------

test('coordinatorLaunchArgv builds the node argv `src/shell/coordinate.mjs {slug}` — no session, no name', () => {
  assert.deepEqual(coordinatorLaunchArgv({ slug: 'single' }), ['src/shell/coordinate.mjs', 'single']);
  // No `--bg`, no `-n <name>`, no `/pir-coordinate` — the coordinator is a process, not a `claude` session.
  const argv = coordinatorLaunchArgv({ slug: 'single' });
  assert.ok(!argv.includes('--bg') && !argv.includes('-n'));
});

test('coordinatorLaunchArgv throws without a slug', () => {
  assert.throws(() => coordinatorLaunchArgv({}), /no slug/);
});

// --- seatbeltEnv (DESIGN §5.2) -------------------------------------------------------------------

test('seatbeltEnv sets PARALLEL_LIVE and the ceiling, and ALLOW_HERE only when asked', () => {
  assert.deepEqual(seatbeltEnv({ ceiling: 2 }), { PARALLEL_LIVE: '1', PARALLEL_MAX_WORKERS: '2' });
  assert.deepEqual(seatbeltEnv({ ceiling: 1, allowHere: true }), {
    PARALLEL_LIVE: '1',
    PARALLEL_MAX_WORKERS: '1',
    PARALLEL_ALLOW_HERE: '1',
  });
  assert.deepEqual(seatbeltEnv({}), { PARALLEL_LIVE: '1' });
});

// --- spawnCoordinator wraps the injected spawn (pid, kill, exited) -------------------------------

test('spawnCoordinator runs node with the argv/cwd/env and exposes pid, kill and an exited promise', async () => {
  const spawn = fakeSpawner();
  const handle = spawnCoordinator({ argv: ['src/shell/coordinate.mjs', 'single'], cwd: '/scratch', env: { PARALLEL_LIVE: '1' }, spawn });
  const child = spawn.children[0];
  assert.equal(child.cmd, 'node');
  assert.deepEqual(child.argv, ['src/shell/coordinate.mjs', 'single']);
  assert.equal(child.opts.cwd, '/scratch');
  assert.equal(child.opts.env.PARALLEL_LIVE, '1');
  assert.equal(handle.pid, child.pid);
  handle.kill('SIGTERM');
  assert.deepEqual(child.kills, ['SIGTERM']);
  // The exited promise resolves when the child exits.
  let resolved = null;
  handle.exited.then((info) => (resolved = info));
  child.exit(0, null);
  await Promise.resolve();
  assert.deepEqual(resolved, { code: 0, signal: null });
});

// --- controlDirFor + touchHalt (DESIGN §2.4, §3.5) ----------------------------------------------

test('controlDirFor points at the coordinator control dir under the scratch plan', () => {
  assert.equal(controlDirFor('/scratch', 'single'), '/scratch/plans/single/.parallel/control');
});

test('touchHalt wires the kill switch: it creates the HALT flag, mkdiring the control dir', () => {
  const ws = workspace();
  try {
    const control = join(ws.dir, 'plans', 'single', '.parallel', 'control');
    const flag = touchHalt(control);
    assert.equal(flag, join(control, 'HALT'));
    assert.ok(existsSync(flag), 'HALT flag exists after touchHalt');
  } finally {
    ws.cleanup();
  }
});

// --- runOutcome (DESIGN §2.1: the process exit is the terminal; §2.4: halt-close means the kill switch)

test('runOutcome is active while the process has not exited', () => {
  assert.deepEqual(runOutcome({ flowText: '2026-01-01T00:00:00Z spawn T01\n', exited: false }), { over: false, reason: 'active' });
});

test('runOutcome reports completed once the process exits with no halt-close in the flow', () => {
  assert.deepEqual(runOutcome({ flowText: '2026-01-01T00:00:00Z merge T01\n', exited: true }), { over: true, reason: 'completed' });
});

test('runOutcome reports halted when the exited process left a halt-close line', () => {
  assert.deepEqual(runOutcome({ flowText: '2026-01-01T00:00:00Z halt-close T01\n', exited: true }), { over: true, reason: 'halted' });
});

// T17: a coordinator that DIED (non-zero or signalled exit) with no halt-close is a crash, not a clean
// completed. On the live merge-conflict run an unhandled fs.watch `error` killed the process ~2.4s in and
// the harness scored it `completed`, hiding the failure (FINDINGS 2026-09-21).
test('runOutcome reports crashed for a non-zero exit with no halt-close (was silently `completed`)', () => {
  assert.deepEqual(
    runOutcome({ flowText: '2026-01-01T00:00:00Z spawn T01\n', exited: true, exitCode: 1 }),
    { over: true, reason: 'crashed' },
  );
});

test('runOutcome reports crashed for a signalled exit (e.g. SIGSEGV) with no halt-close', () => {
  assert.deepEqual(
    runOutcome({ flowText: '2026-01-01T00:00:00Z spawn T01\n', exited: true, exitCode: null, signal: 'SIGSEGV' }),
    { over: true, reason: 'crashed' },
  );
});

test('runOutcome: a crash under HALT is still `halted` — the kill switch wins over the exit code', () => {
  assert.deepEqual(
    runOutcome({ flowText: '2026-01-01T00:00:00Z halt-close T01\n', exited: true, exitCode: 1 }),
    { over: true, reason: 'halted' },
  );
});

test('runOutcome: a clean exit (code 0, or no captured status) is completed as before', () => {
  assert.deepEqual(runOutcome({ flowText: '2026-01-01T00:00:00Z merge T01\n', exited: true, exitCode: 0 }), { over: true, reason: 'completed' });
  // No exit descriptor passed → reads as a clean exit, the pre-T17 behaviour every existing caller relied on.
  assert.deepEqual(runOutcome({ flowText: '2026-01-01T00:00:00Z merge T01\n', exited: true }), { over: true, reason: 'completed' });
});

// --- reachedExpectedTerminal (T11: a `parked` fixture's timed-out park is its correct end, not a FAIL) --

test('reachedExpectedTerminal: completed passes only when the run did not time out', () => {
  assert.equal(reachedExpectedTerminal({ expectedTerminal: 'completed', timedOut: false }), true);
  assert.equal(reachedExpectedTerminal({ expectedTerminal: 'completed', timedOut: true }), false);
  // Default terminal is completed, so the blanket timeout guard is unchanged for every non-declaring fixture.
  assert.equal(reachedExpectedTerminal({ timedOut: false }), true);
  assert.equal(reachedExpectedTerminal({ timedOut: true }), false);
});

test('reachedExpectedTerminal: parked passes exactly when the run timed out (the park never resolved)', () => {
  assert.equal(reachedExpectedTerminal({ expectedTerminal: 'parked', timedOut: true }), true);
  // A `parked` run that somehow ended without the wall-clock firing did NOT hold its park — not the terminal.
  assert.equal(reachedExpectedTerminal({ expectedTerminal: 'parked', timedOut: false }), false);
});

test('reachedExpectedTerminal: a crashed run is never the expected terminal, whatever was expected (T17)', () => {
  // A crash with no timeout would otherwise sail through the completed branch — this is what made the live
  // failure read as a green-shaped `completed`. It must FAIL under every expectedTerminal.
  assert.equal(reachedExpectedTerminal({ expectedTerminal: 'completed', timedOut: false, reason: 'crashed' }), false);
  assert.equal(reachedExpectedTerminal({ expectedTerminal: 'parked', timedOut: true, reason: 'crashed' }), false);
  // A non-crash reason still follows the timeout rules unchanged.
  assert.equal(reachedExpectedTerminal({ expectedTerminal: 'completed', timedOut: false, reason: 'completed' }), true);
});

// --- captureFinalFiles reads the feature branch (DESIGN §2.4: the run hands off, never merges to main)

test('captureFinalFiles reads `git show {ref}:<file>` and omits a file git cannot show', () => {
  const gitRun = (args) => (args[1] === 'pir/mc:greeting.txt' ? { ok: true, stdout: 'hello there\n' } : { ok: false, stdout: '' });
  assert.deepEqual(
    captureFinalFiles({ repoDir: '/x', gitRun, files: ['greeting.txt', 'gone.txt'], ref: 'pir/mc' }),
    { 'greeting.txt': 'hello there\n' },
  );
});

// --- teardownScenario: no worker is orphaned; there is no coordinator session to close ------------

function fakePlatform({ agents = [] } = {}) {
  const closed = [];
  return {
    closed,
    list: () => agents,
    close: (id) => {
      closed.push(id);
      return { ok: true };
    },
  };
}
const fakeWorktree = { remove: () => {} };

test('teardownScenario touches HALT and closes every worker of this run (via teardownRun), foreign left alone', () => {
  const ws = workspace();
  try {
    const repo = 'scratchrepo';
    const slug = 'single';
    const control = controlDirFor(ws.dir, slug);
    const agents = [
      { id: 'w1', name: `${repo} / ${slug} / T01 / work / implement` },
      { id: 'w2', name: `${repo} / ${slug} / T02 / work / review` },
      { id: 'foreign', name: 'someone-else / other / T09 / work / implement' },
    ];
    const platform = fakePlatform({ agents });
    const r = teardownScenario({ platform, worktree: fakeWorktree, repo, slug, controlDir: control });

    assert.ok(platform.closed.includes('w1') && platform.closed.includes('w2'));
    assert.ok(!platform.closed.includes('foreign'));
    assert.equal(r.closed.length, 2);
    assert.ok(existsSync(join(control, 'HALT')), 'HALT flag written by teardown');
  } finally {
    ws.cleanup();
  }
});

// --- runScenario end to end, with fakes (the whole build half) -----------------------------------
//
// A fake `install` lays a tiny scratch repo and pre-writes the coordinator flow log. A fake process
// `spawn` hands out the coordinator child; a fake `claude` runner answers the capture's `agents --json`
// and drives the child to exit (the hand-off) after a poll. No real process, no real agent, no real git.

function installFake({ into, controlLog, slug = 'single' }) {
  return () => {
    mkdirSync(into, { recursive: true });
    const control = controlDirFor(into, slug);
    mkdirSync(control, { recursive: true });
    writeFileSync(join(control, 'log'), controlLog);
  };
}

test('runScenario installs, launches the coordinator process, captures, seals on its exit, and checks', async () => {
  const ws = workspace();
  try {
    const into = join(ws.dir, 'scratch-repo');
    const projects = join(ws.dir, 'projects');
    mkdirSync(projects, { recursive: true });

    const spawn = fakeSpawner();
    const worker = { id: 'w1', sessionId: 's1', name: 'scratch-repo / single / T01 / work / implement', cwd: into, status: 'busy', state: 'working', pid: 1 };
    let polls = 0;
    const claudeRun = (args) => {
      if (args.includes('--all')) return { ok: true, stdout: '[]' };
      if (args[0] === 'agents') {
        polls += 1;
        if (polls === 1) return { ok: true, stdout: JSON.stringify([worker]) };
        // The coordinator has done its hand-off and exits; the worker is gone from the list.
        spawn.children[0].exit(0);
        return { ok: true, stdout: '[]' };
      }
      return { ok: true, stdout: '' };
    };
    const gitRun = () => ({ ok: true, stdout: '* abc123 T01' });
    const platform = fakePlatform({ agents: [] });

    const result = await runScenario({
      fixtureId: 'single',
      scratchDir: into,
      install: installFake({ into, controlLog: '2026-01-01T00:00:00Z spawn T01\n2026-01-01T00:01:00Z merge T01\n' }),
      spawn,
      claudeRun,
      gitRun,
      platform,
      worktree: fakeWorktree,
      projectsDir: projects,
      pollMs: 1,
    });

    // The coordinator was launched as a plain node process with the seatbelt env (§2.1, §5.2).
    assert.equal(spawn.children.length, 1, 'one coordinator process was spawned');
    const child = spawn.children[0];
    assert.equal(child.cmd, 'node');
    assert.deepEqual(child.argv, ['src/shell/coordinate.mjs', 'single']);
    assert.equal(child.opts.cwd, into);
    assert.equal(child.opts.env.PARALLEL_LIVE, '1');
    assert.equal(child.opts.env.PARALLEL_MAX_WORKERS, '1'); // the single fixture's ceiling

    // It reached the completed terminal (the process exited) and produced a real, dated bundle.
    assert.equal(result.reason, 'completed');
    assert.ok(result.bundleDir && existsSync(result.bundleDir), 'a bundle dir exists');
    assert.ok(existsSync(join(result.bundleDir, 'flow.log')), 'the flow log was captured');
    assert.ok(existsSync(join(result.bundleDir, 'manifest.json')), 'the transcript manifest was sealed');

    // checkScenario ran the single fixture's declared facts (a report with those fact ids came back).
    const ids = result.report.facts.map((f) => f.id);
    assert.deepEqual(ids, ['no-hello-ever', 'no-close-before-idle', 'handed-off-green-branch']);
    assert.equal(typeof result.ok, 'boolean');
  } finally {
    ws.cleanup();
  }
});

test('runScenario auto-touches HALT on the wall-clock timeout and reports timeout when the process never exits', async () => {
  const ws = workspace();
  try {
    const into = join(ws.dir, 'scratch-repo');
    const projects = join(ws.dir, 'projects');
    mkdirSync(projects, { recursive: true });
    const control = controlDirFor(into, 'single');

    // The coordinator process never exits and a worker stays live forever → only the wall-clock timeout
    // can end the run. The fake child is never told to exit.
    const spawn = fakeSpawner();
    const liveWorker = { id: 'w1', sessionId: 's1', name: 'scratch-repo / single / T01 / work / implement', cwd: into, status: 'busy', state: 'working', pid: 1 };
    const claudeRun = (args) => {
      if (args.includes('--all')) return { ok: true, stdout: '[]' };
      if (args[0] === 'agents') return { ok: true, stdout: JSON.stringify([liveWorker]) };
      return { ok: true, stdout: '' };
    };
    const platform = fakePlatform({ agents: [liveWorker] });

    const result = await runScenario({
      fixtureId: 'single',
      scratchDir: into,
      install: installFake({ into, controlLog: '2026-01-01T00:00:00Z spawn T01\n' }),
      spawn,
      claudeRun,
      gitRun: () => ({ ok: true, stdout: '' }),
      platform,
      worktree: fakeWorktree,
      projectsDir: projects,
      pollMs: 2,
      timeoutMs: 5, // fire the wall-clock cap almost immediately
      haltGrace: 2, // a short grace, then give up on the hung process
    });

    assert.equal(result.reason, 'timeout');
    assert.equal(result.ok, false, 'a timed-out run never passes');
    assert.ok(existsSync(join(control, 'HALT')), 'the timeout auto-touched HALT (seatbelt §5.2)');
    // The exit path SIGTERMs the coordinator process and sweeps the still-live worker — no orphan.
    assert.deepEqual(spawn.children[0].kills, ['SIGTERM'], 'the coordinator process was SIGTERMed on exit');
    assert.ok(platform.closed.includes('w1'), 'the live worker was closed on exit');
  } finally {
    ws.cleanup();
  }
});

// --- the kill-switch drill: HALT is touched mid-run, after the first spawn (T11, DESIGN §4.1) -----
//
// The `parallel` fixture declares `killSwitchDrill: true`. The fake coordinator reacts to HALT exactly as
// the real one does — it writes `halt-close` ONLY once it sees the flag — so scoring the run `halted`
// proves runScenario touched HALT mid-run (before any timeout; the 10-min wall-clock is never reached).

test('runScenario fires the kill-switch drill: after the first spawn it touches HALT, and the run is scored on halt-close', async () => {
  const ws = workspace();
  try {
    const into = join(ws.dir, 'scratch-repo');
    const projects = join(ws.dir, 'projects');
    mkdirSync(projects, { recursive: true });
    const control = controlDirFor(into, 'parallel');
    const flowPath = join(control, 'log');

    const worker = { id: 'w1', sessionId: 's1', name: 'scratch-repo / parallel / T01 / work / implement', cwd: into, status: 'busy', state: 'working', pid: 1 };
    const spawn = fakeSpawner();
    let polls = 0;
    const claudeRun = (args) => {
      if (args.includes('--all')) return { ok: true, stdout: '[]' };
      if (args[0] === 'agents') {
        polls += 1;
        if (polls === 1) return { ok: true, stdout: JSON.stringify([worker]) }; // first spawn is up
        // The coordinator reacts to HALT like the real one: it only writes halt-close if it saw the flag.
        // So halt-close (→ reason 'halted') can only appear if the drill touched HALT mid-run.
        if (existsSync(join(control, 'HALT'))) {
          writeFileSync(flowPath, '2026-01-01T00:00:00Z spawn T01\n2026-01-01T00:01:00Z halt-close T01\n');
        }
        spawn.children[0].exit(0);
        return { ok: true, stdout: '[]' };
      }
      return { ok: true, stdout: '' };
    };

    const result = await runScenario({
      fixtureId: 'parallel',
      scratchDir: into,
      install: installFake({ into, controlLog: '2026-01-01T00:00:00Z spawn T01\n', slug: 'parallel' }),
      spawn,
      claudeRun,
      gitRun: () => ({ ok: true, stdout: '' }),
      platform: fakePlatform({ agents: [] }),
      worktree: fakeWorktree,
      projectsDir: projects,
      pollMs: 1,
    });

    assert.ok(existsSync(join(control, 'HALT')), 'the drill touched HALT');
    // Scored on the halt-close the drill provoked — not the 10-min timeout (never reached), so not a runaway.
    assert.equal(result.reason, 'halted', 'the kill switch fired mid-run and the run was scored on halt-close');
  } finally {
    ws.cleanup();
  }
});

test('a fixture with no drill flag is not touched mid-run — the timeout guard is the only HALT path', async () => {
  const ws = workspace();
  try {
    const into = join(ws.dir, 'scratch-repo');
    const projects = join(ws.dir, 'projects');
    mkdirSync(projects, { recursive: true });
    const control = controlDirFor(into, 'single');
    const flowPath = join(control, 'log');

    const worker = { id: 'w1', sessionId: 's1', name: 'scratch-repo / single / T01 / work / implement', cwd: into, status: 'busy', state: 'working', pid: 1 };
    const spawn = fakeSpawner();
    let polls = 0;
    // The same HALT-reacting coordinator. `single` declares no drill, so HALT is never touched mid-run,
    // so no halt-close is ever written and the run hands off `completed`.
    const claudeRun = (args) => {
      if (args.includes('--all')) return { ok: true, stdout: '[]' };
      if (args[0] === 'agents') {
        polls += 1;
        if (polls === 1) return { ok: true, stdout: JSON.stringify([worker]) };
        if (existsSync(join(control, 'HALT'))) {
          writeFileSync(flowPath, '2026-01-01T00:00:00Z spawn T01\n2026-01-01T00:01:00Z halt-close T01\n');
        }
        spawn.children[0].exit(0);
        return { ok: true, stdout: '[]' };
      }
      return { ok: true, stdout: '' };
    };

    const result = await runScenario({
      fixtureId: 'single',
      scratchDir: into,
      install: installFake({ into, controlLog: '2026-01-01T00:00:00Z spawn T01\n', slug: 'single' }),
      spawn,
      claudeRun,
      gitRun: () => ({ ok: true, stdout: '' }),
      platform: fakePlatform({ agents: [] }),
      worktree: fakeWorktree,
      projectsDir: projects,
      pollMs: 1,
    });

    assert.equal(result.reason, 'completed', 'no drill → HALT untouched mid-run → no halt-close → a clean hand-off');
  } finally {
    ws.cleanup();
  }
});

// --- the `parked` terminal: a designed park times out, yet passes on its facts (T11) --------------
//
// The `human-decision` fixture declares `expectedTerminal: 'parked'`. Its worker parks forever (§2.2 routes
// nothing down), so the coordinator never exits and the wall-clock must HALT it. The fact
// parkedWorkerHoldsSlot passes; the old `ok = pass && !timedOut` would still FAIL it. The declared terminal
// is what lets a timed-out park score ok:true.

test('runScenario: a parked fixture whose facts pass and which times out scores ok:true', async () => {
  const ws = workspace();
  try {
    const into = join(ws.dir, 'scratch-repo');
    const projects = join(ws.dir, 'projects');
    mkdirSync(projects, { recursive: true });

    // The parked worker of T01 stays live every poll; the coordinator process never exits (the park never
    // resolves), so only the wall-clock timeout can end the run.
    const spawn = fakeSpawner();
    const parked = { id: 'w1', sessionId: 's1', name: 'scratch-repo / human-decision / T01 / work / implement', cwd: into, status: 'busy', state: 'working', pid: 1 };
    const claudeRun = (args) => {
      if (args.includes('--all')) return { ok: true, stdout: '[]' };
      if (args[0] === 'agents') return { ok: true, stdout: JSON.stringify([parked]) };
      return { ok: true, stdout: '' };
    };
    // The flow the coordinator would have written: T01 surfaced a question and parked; the independent T02
    // merged past it. Early timestamps so the live capture ticks (real `now`) sort at/after the surface.
    const controlLog = '2026-01-01T00:00:00Z surface T01\n2026-01-01T00:00:30Z merge T02\n';

    const result = await runScenario({
      fixtureId: 'human-decision',
      scratchDir: into,
      install: installFake({ into, controlLog, slug: 'human-decision' }),
      spawn,
      claudeRun,
      gitRun: () => ({ ok: true, stdout: '' }),
      platform: fakePlatform({ agents: [parked] }),
      worktree: fakeWorktree,
      projectsDir: projects,
      pollMs: 2,
      timeoutMs: 5, // fire the wall-clock cap almost immediately — the park cannot resolve
      haltGrace: 2,
    });

    // The one fact (parkedWorkerHoldsSlot T01) passed on the captured park, and the declared `parked`
    // terminal turns the (correct, designed) timeout into a PASS rather than the blanket timeout-FAIL.
    assert.equal(result.report.facts.length, 1);
    assert.equal(result.report.facts[0].id, 'parked-worker-holds-slot:T01');
    assert.equal(result.report.facts[0].pass, true, 'the park fact passed');
    assert.equal(result.ok, true, 'a passing park that timed out is a PASS under the parked terminal');
    assert.equal(result.reason, 'parked', 'the report labels the terminal a park, not a bare timeout');
  } finally {
    ws.cleanup();
  }
});

// --- restart-mode pure wiring (T05) --------------------------------------------------------------

test('restartTargetReached is true on the branch-glyph read, and on the review-line fallback for 🔍', () => {
  const waitFor = { task: 'T02', glyph: '🔍' };
  assert.equal(restartTargetReached({ branchState: '🔍', waitFor }), true);
  assert.equal(restartTargetReached({ branchState: '🟡', waitFor }), false);
  assert.equal(restartTargetReached({ flowText: '2026-01-01T00:00:08Z review T02\n', waitFor }), true);
  assert.equal(restartTargetReached({ flowText: '2026-01-01T00:00:08Z review T03\n', waitFor }), false);
  assert.equal(restartTargetReached({ flowText: '2026-01-01T00:00:00Z spawn T02\n', waitFor }), false);
  assert.equal(restartTargetReached({ branchState: '🔍' }), false);
});

test('seedStaleFeeds writes a leftover into the reports feed; snapshotControlFeeds reads it back, and a clear', () => {
  const ws = workspace();
  try {
    const control = controlDirFor(ws.dir, 'restart');
    seedStaleFeeds(control, 'STALE-1');
    const feeds = snapshotControlFeeds(control);
    assert.deepEqual(feeds.reports, ['STALE-1.json'], 'the stale report is present');
    // After the hygiene truncates it (what the real coordinator does), the snapshot is empty of the sentinel.
    rmSync(join(control, 'reports', 'STALE-1.json'));
    assert.deepEqual(snapshotControlFeeds(control).reports, []);
  } finally {
    ws.cleanup();
  }
});

// --- runRestartScenario end to end, with fakes (the whole crash-and-restart orchestration) --------
//
// A fake install lays the scratch and pre-writes the first run's flow. A fake process `spawn` hands out
// the two coordinator children (crash then restart); a fake `claude` answers the capture ticks; a fake
// worktree's taskBranchState reports 🔍 after two polls (the crash point); the first child is SIGKILLed
// at the crash point, and once the second launch is live the agents handler exits it so the wait
// terminates. So install-once, launch/kill/relaunch, the stale-feed seeding and the two-launch-spanning
// bundle are all proven with no live agent — the live crash-and-restart over real agents is T09.
test('runRestartScenario installs once, launches, SIGKILLs the process at 🔍, relaunches on the same scratch, and spans both', async () => {
  const ws = workspace();
  try {
    const into = join(ws.dir, 'scratch-repo');
    const projects = join(ws.dir, 'projects');
    mkdirSync(projects, { recursive: true });
    const control = controlDirFor(into, 'restart');
    const flowPath = join(control, 'log');

    const w2 = { id: 'w2', sessionId: 'i2', name: 'scratch-repo / restart / T02 / work / implement', cwd: into, status: 'busy', state: 'working', pid: 5001 };

    const firstFlow = '2026-01-01T00:00:00Z restart\n2026-01-01T00:00:05Z merge T01\n2026-01-01T00:00:08Z review T02\n';
    const resumedFlow = firstFlow + '2026-01-01T00:00:10Z restart\n2026-01-01T00:00:12Z merge T02\n';

    const spawn = fakeSpawner();
    const claudeRun = (args) => {
      if (args.includes('--all')) return { ok: true, stdout: '[]' };
      if (args[0] === 'agents') {
        if (spawn.children.length >= 2) {
          // The resumed run: write its flow, then exit the second coordinator so the wait terminates.
          writeFileSync(flowPath, resumedFlow);
          spawn.children[1].exit(0);
          return { ok: true, stdout: '[]' };
        }
        return { ok: true, stdout: JSON.stringify([w2]) };
      }
      return { ok: true, stdout: '' };
    };

    let installs = 0;
    const install = () => {
      installs += 1;
      mkdirSync(control, { recursive: true });
      writeFileSync(flowPath, firstFlow);
    };

    let tbsCalls = 0;
    const worktree = { remove: () => {}, taskBranchState: () => (++tbsCalls >= 2 ? '🔍' : null) };

    const result = await runRestartScenario({
      fixtureId: 'restart',
      scratchDir: into,
      install,
      spawn,
      claudeRun,
      gitRun: () => ({ ok: true, stdout: '' }),
      platform: fakePlatform({ agents: [] }),
      worktree,
      projectsDir: projects,
      pollMs: 1,
      startupGrace: 100,
    });

    // Installed exactly once — the relaunch must NOT reinstall (git holds the branches to resume).
    assert.equal(installs, 1, 'the fixture was installed exactly once');
    // Two coordinator processes were spawned (crash then restart), both `node coordinate.mjs restart`.
    assert.equal(spawn.children.length, 2, 'the coordinator was launched twice');
    for (const c of spawn.children) {
      assert.deepEqual(c.argv, ['src/shell/coordinate.mjs', 'restart']);
      assert.equal(c.opts.env.PARALLEL_MAX_WORKERS, '1');
    }
    // The crash was a SIGKILL of the FIRST coordinator process.
    assert.ok(spawn.children[0].kills.includes('SIGKILL'), 'the first coordinator was SIGKILLed at the crash point');
    // The resumed run completed.
    assert.equal(result.reason, 'completed');
    // The bundle spans both launches: its flow.log carries the first run's merge AND the resumed merge.
    const capturedFlow = readFileSync(join(result.bundleDir, 'flow.log'), 'utf8');
    assert.ok(capturedFlow.includes('merge T01') && capturedFlow.includes('merge T02'), 'the sealed flow spans both launches');
    // The stale-feed leftover was seeded and captured for feedsCleared (control-feeds.json).
    const cf = JSON.parse(readFileSync(join(result.bundleDir, 'control-feeds.json'), 'utf8'));
    assert.equal(cf.seeded, true);
    assert.ok(cf.sentinel && cf.feeds, 'the control-feeds snapshot records the sentinel and the feeds');
    // The report ran the restart scenario's declared facts (the wiring produced a verdict).
    const ids = result.report.facts.map((f) => f.id);
    assert.deepEqual(ids, ['resumed-not-rebuilt:T02', 'no-rebuild-from:T01', 'feeds-cleared', 'leftover-sessions-reaped:1']);
  } finally {
    ws.cleanup();
  }
});
