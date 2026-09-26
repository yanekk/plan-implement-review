// run.mjs, proven WITHOUT a live agent (DESIGN §4.1, §5.2, §2.1, T17/T05 build-half acceptance). The
// launch argv and seatbelt env are asserted directly; the coordinator is spawned through an injected
// process `spawn` so the whole launch → capture → exit-detection → seal → checkScenario flow is driven
// with a fake child (no real process); the timeout→HALT and teardown-on-exit paths each have a test; and
// the crash-and-restart runner is driven end to end with a fake spawn that hands out two children and an
// injected kill. Actually spawning a real coordinator + real workers is the live half a person launches
// (T09); this file never does (the seatbelt).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, writeSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  coordinatorLaunchArgv,
  seatbeltEnv,
  spawnCoordinator,
  coordinatorOutPath,
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
import { reapRecorded } from '../reap.mjs';

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

// declared-test-command T10: the coordinator's stdout, which carries its printed hand-off, is written to
// the given file (created with its folder), appended to rather than truncated so a restart's second
// coordinator keeps the first one's output. Without stdoutPath the stdio stays ignored.
test('spawnCoordinator writes the child stdout to stdoutPath when given', () => {
  const ws = workspace();
  try {
    const out = join(ws.dir, 'plans', 'single', '.parallel', 'control', 'coordinator.out');
    // The fake child "prints" through the descriptor it was handed, as a real child's stdout would.
    const spawn = (cmd, argv, opts) => {
      const [, stdout, stderr] = opts.stdio;
      writeSync(stdout, 'git merge pir/single\n');
      writeSync(stderr, 'a warning\n');
      return fakeSpawner()(cmd, argv, opts);
    };
    spawnCoordinator({ argv: ['x'], cwd: ws.dir, spawn, stdoutPath: out });
    spawnCoordinator({ argv: ['x'], cwd: ws.dir, spawn, stdoutPath: out });
    assert.equal(readFileSync(out, 'utf8'), 'git merge pir/single\na warning\n'.repeat(2));

    const quiet = fakeSpawner();
    spawnCoordinator({ argv: ['x'], cwd: ws.dir, spawn: quiet });
    assert.equal(quiet.children[0].opts.stdio, 'ignore');
  } finally {
    ws.cleanup();
  }
});

test('coordinatorOutPath names coordinator.out in the control dir', () => {
  assert.equal(coordinatorOutPath('/scratch/plans/single/.parallel/control'), '/scratch/plans/single/.parallel/control/coordinator.out');
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

// --- teardownScenario: no worker is orphaned; the recorded pids are reaped (live-workers T16) --------

// Fake pid probes and signals: `live` is the set of running pids; SIGTERM or SIGKILL ends one. The start
// time of every pid is 'Mon 1' unless `starts` says otherwise (a reused pid).
function fakeProcs(alive = [], starts = {}) {
  const live = new Set(alive);
  const kills = [];
  return {
    live,
    kills,
    isAlive: (pid) => live.has(pid),
    startTimeOf: (pid) => starts[pid] ?? 'Mon 1',
    kill: (pid, sig) => {
      kills.push([pid, sig]);
      if (sig === 'SIGTERM' || sig === 'SIGKILL') live.delete(pid);
    },
  };
}
const rec = (id, task, role, pid, startTime = 'Mon 1') => ({ id, task, role, pid, startTime });
function writeWorkersJson(control, workers) {
  mkdirSync(control, { recursive: true });
  writeFileSync(join(control, 'workers.json'), JSON.stringify(workers));
}
const reapWith = (p) => (dir) => reapRecorded(dir, { isAlive: p.isAlive, startTimeOf: p.startTimeOf, kill: p.kill });

test('teardownScenario touches HALT and reaps every recorded worker still running; none is left alive', async () => {
  const ws = workspace();
  try {
    const control = controlDirFor(ws.dir, 'single');
    // 7001 and 7002 are live workers; 7003 has exited; 7004's number now belongs to another process.
    writeWorkersJson(control, [
      rec('a', 'T01', 'implement', 7001),
      rec('b', 'T02', 'review', 7002),
      rec('c', 'T03', 'implement', 7003),
      rec('d', 'T04', 'implement', 7004),
    ]);
    const p = fakeProcs([7001, 7002, 7004], { 7004: 'Tue 9' });
    const r = await teardownScenario({ controlDir: control, reap: reapWith(p) });

    assert.deepEqual(r.closed.sort(), [7001, 7002]);
    assert.ok(!p.live.has(7001) && !p.live.has(7002), 'no recorded worker is left alive');
    assert.ok(p.live.has(7004), 'a reused pid is never signalled');
    assert.ok(!p.kills.some(([pid]) => pid === 7003 || pid === 7004));
    assert.ok(existsSync(join(control, 'HALT')), 'HALT flag written by teardown');
  } finally {
    ws.cleanup();
  }
});

test('teardownScenario with no workers.json reaps nothing and still touches HALT', async () => {
  const ws = workspace();
  try {
    const control = controlDirFor(ws.dir, 'single');
    const p = fakeProcs();
    const r = await teardownScenario({ controlDir: control, reap: reapWith(p) });
    assert.deepEqual(r.closed, []);
    assert.ok(existsSync(join(control, 'HALT')));
  } finally {
    ws.cleanup();
  }
});

// --- runScenario end to end, with fakes (the whole build half) -----------------------------------
//
// A fake `install` lays a tiny scratch repo and pre-writes the coordinator flow log (and, where a test
// needs them, a conversation log and workers.json). A fake process `spawn` hands out the coordinator
// child; a fake workers.json reader answers the capture's ticks and drives the child to exit (the
// hand-off) after a poll; fake pid probes stand in for the workers. No real process, agent or git.

function installFake({ into, controlLog, slug = 'single', conversations = {}, workers = null }) {
  return () => {
    mkdirSync(into, { recursive: true });
    const control = controlDirFor(into, slug);
    mkdirSync(join(control, 'conversations'), { recursive: true });
    writeFileSync(join(control, 'log'), controlLog);
    for (const [file, entries] of Object.entries(conversations)) {
      writeFileSync(join(control, 'conversations', file), entries.map((e) => JSON.stringify(e) + '\n').join(''));
    }
    if (workers) writeFileSync(join(control, 'workers.json'), JSON.stringify(workers));
  };
}

test('runScenario installs, launches the coordinator process, captures, seals on its exit, and checks', async () => {
  const ws = workspace();
  try {
    const into = join(ws.dir, 'scratch-repo');
    const spawn = fakeSpawner();
    const worker = rec('s1', 'T01', 'implement', 6001);
    const p = fakeProcs([6001]);
    let polls = 0;
    const readWorkers = () => {
      polls += 1;
      if (polls === 1) return [worker];
      // The coordinator has done its hand-off and exits; its worker has exited too.
      p.live.delete(6001);
      spawn.children[0].exit(0);
      return [];
    };
    const log = [
      { t: 1, dir: 'out', from: 'pir', kind: 'message', text: 'pir-implement T01' },
      { t: 2, dir: 'in', event: { type: 'system', subtype: 'init', session_id: 's1' } },
      { t: 3, dir: 'in', event: { type: 'result', subtype: 'success', session_id: 's1' } },
    ];

    const result = await runScenario({
      fixtureId: 'single',
      scratchDir: into,
      install: installFake({
        into,
        controlLog: '2026-01-01T00:00:00Z spawn T01\n2026-01-01T00:01:00Z merge T01\n',
        conversations: { 'T01-implement-1.ndjson': log },
      }),
      spawn,
      readWorkers,
      procs: p,
      gitRun: () => ({ ok: true, stdout: '* abc123 T01' }),
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
    // The worker's conversation log is in the bundle, and the timeline sampled the worker from workers.json.
    assert.equal(
      readFileSync(join(result.bundleDir, 'conversations', 'T01-implement-1.ndjson'), 'utf8').split('\n').filter(Boolean).length,
      3,
    );
    const manifest = JSON.parse(readFileSync(join(result.bundleDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest['T01-implement-1.ndjson'].sessionId, 's1');
    const timeline = readFileSync(join(result.bundleDir, 'timeline.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.deepEqual(timeline[0].workers.map((w) => [w.id, w.status, w.log]), [['s1', 'idle', 'T01-implement-1.ndjson']]);

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
    const control = controlDirFor(into, 'single');

    // The coordinator process never exits and a worker stays live forever → only the wall-clock timeout
    // can end the run. The fake child is never told to exit.
    const spawn = fakeSpawner();
    const live = rec('s1', 'T01', 'implement', 6001);
    const p = fakeProcs([6001]);

    const result = await runScenario({
      fixtureId: 'single',
      scratchDir: into,
      install: installFake({ into, controlLog: '2026-01-01T00:00:00Z spawn T01\n', workers: [live] }),
      spawn,
      procs: p,
      gitRun: () => ({ ok: true, stdout: '' }),
      pollMs: 2,
      timeoutMs: 5, // fire the wall-clock cap almost immediately
      haltGrace: 2, // a short grace, then give up on the hung process
    });

    assert.equal(result.reason, 'timeout');
    assert.equal(result.ok, false, 'a timed-out run never passes');
    assert.ok(existsSync(join(control, 'HALT')), 'the timeout auto-touched HALT (seatbelt §5.2)');
    // The exit path SIGTERMs the coordinator process and reaps the still-live worker — no orphan.
    assert.deepEqual(spawn.children[0].kills, ['SIGTERM'], 'the coordinator process was SIGTERMed on exit');
    assert.deepEqual(p.kills, [[6001, 'SIGTERM']], 'the recorded worker was reaped on exit');
    assert.ok(!p.live.has(6001));
  } finally {
    ws.cleanup();
  }
});

// --- the kill-switch drill: HALT is touched mid-run, after the first spawn (T11, DESIGN §4.1) -----
//
// The `parallel` fixture declares `killSwitchDrill: true`. The fake coordinator reacts to HALT exactly as
// the real one does — it writes `halt-close` ONLY once it sees the flag — so scoring the run `halted`
// proves runScenario touched HALT mid-run (before any timeout; the 10-min wall-clock is never reached).

// A per-poll fake coordinator over the workers.json reader: first poll a worker is up; after that it
// writes halt-close only if HALT exists, then exits.
function haltReactingCoordinator({ spawn, control, p }) {
  const flowPath = join(control, 'log');
  let polls = 0;
  return () => {
    polls += 1;
    if (polls === 1) return [rec('s1', 'T01', 'implement', 6001)];
    if (existsSync(join(control, 'HALT'))) {
      writeFileSync(flowPath, '2026-01-01T00:00:00Z spawn T01\n2026-01-01T00:01:00Z halt-close T01\n');
    }
    p.live.delete(6001);
    spawn.children[0].exit(0);
    return [];
  };
}

test('runScenario fires the kill-switch drill: after the first spawn it touches HALT, and the run is scored on halt-close', async () => {
  const ws = workspace();
  try {
    const into = join(ws.dir, 'scratch-repo');
    const control = controlDirFor(into, 'parallel');
    const spawn = fakeSpawner();
    const p = fakeProcs([6001]);

    const result = await runScenario({
      fixtureId: 'parallel',
      scratchDir: into,
      install: installFake({ into, controlLog: '2026-01-01T00:00:00Z spawn T01\n', slug: 'parallel' }),
      spawn,
      readWorkers: haltReactingCoordinator({ spawn, control, p }),
      procs: p,
      gitRun: () => ({ ok: true, stdout: '' }),
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
    const control = controlDirFor(into, 'single');
    const spawn = fakeSpawner();
    const p = fakeProcs([6001]);

    // The same HALT-reacting coordinator. `single` declares no drill, so HALT is never touched mid-run,
    // so no halt-close is ever written and the run hands off `completed`.
    const result = await runScenario({
      fixtureId: 'single',
      scratchDir: into,
      install: installFake({ into, controlLog: '2026-01-01T00:00:00Z spawn T01\n', slug: 'single' }),
      spawn,
      readWorkers: haltReactingCoordinator({ spawn, control, p }),
      procs: p,
      gitRun: () => ({ ok: true, stdout: '' }),
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

    // The parked worker of T01 stays live every poll; the coordinator process never exits (the park never
    // resolves), so only the wall-clock timeout can end the run.
    const spawn = fakeSpawner();
    const parked = rec('s1', 'T01', 'implement', 6001);
    const p = fakeProcs([6001]);
    // The flow the coordinator would have written: T01 surfaced a question and parked; the independent T02
    // merged past it. Early timestamps so the live capture ticks (real `now`) sort at/after the surface.
    const controlLog = '2026-01-01T00:00:00Z surface T01\n2026-01-01T00:00:30Z merge T02\n';

    const result = await runScenario({
      fixtureId: 'human-decision',
      scratchDir: into,
      install: installFake({ into, controlLog, slug: 'human-decision', workers: [parked] }),
      spawn,
      procs: p,
      gitRun: () => ({ ok: true, stdout: '' }),
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

// --- answerPending: the person's stand-in ticks while the coordinator runs (T18) -------------------

test('runScenario builds the answerer for an answerPending fixture and ticks it on every poll', async () => {
  const ws = workspace();
  try {
    const into = join(ws.dir, 'scratch-repo');
    const spawn = fakeSpawner();
    const p = fakeProcs([]);
    let polls = 0;
    const readWorkers = () => {
      polls += 1;
      if (polls === 3) spawn.children[0].exit(0);
      return [];
    };
    const made = [];
    let ticks = 0;
    const makeAnswerer = (opts) => {
      made.push(opts);
      return { tick: () => (ticks += 1) };
    };
    await runScenario({
      fixtureId: 'live-workers-demo',
      scratchDir: into,
      install: installFake({ into, controlLog: '2026-01-01T00:00:00Z spawn T01\n', slug: 'live-workers-demo' }),
      spawn,
      readWorkers,
      procs: p,
      gitRun: () => ({ ok: true, stdout: '' }),
      makeAnswerer,
      pollMs: 1,
    });
    assert.equal(made.length, 1);
    assert.equal(made[0].controlDir, controlDirFor(into, 'live-workers-demo'));
    assert.ok(ticks >= 2, `ticked ${ticks} times while the coordinator ran`);
  } finally {
    ws.cleanup();
  }
});

test('runScenario builds no answerer for a fixture that does not declare answerPending', async () => {
  const ws = workspace();
  try {
    const into = join(ws.dir, 'scratch-repo');
    const spawn = fakeSpawner();
    let made = 0;
    await runScenario({
      fixtureId: 'single',
      scratchDir: into,
      install: installFake({ into, controlLog: '2026-01-01T00:00:00Z spawn T01\n' }),
      spawn,
      readWorkers: () => (spawn.children[0].exit(0), []),
      procs: fakeProcs([]),
      gitRun: () => ({ ok: true, stdout: '' }),
      makeAnswerer: () => ((made += 1), { tick() {} }),
      pollMs: 1,
    });
    assert.equal(made, 0);
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

test('restartTargetReached on a commit point: reached once a task-branch commit carries the subject', () => {
  const waitFor = { task: 'T01', commit: 'T01: part 1' };
  assert.equal(restartTargetReached({ branchCommits: [], waitFor }), false);
  assert.equal(restartTargetReached({ branchCommits: ['T01: scaffolding'], waitFor }), false);
  assert.equal(restartTargetReached({ branchCommits: ['T01: part 2', 'T01: part 1'], waitFor }), true);
  // A commit point ignores the glyph and the review line — it is a mid-implement point.
  assert.equal(restartTargetReached({ branchState: '🔍', flowText: '2026-01-01T00:00:08Z review T01\n', waitFor }), false);
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
// the two coordinator children (crash then restart); a fake workers.json reader answers the capture ticks; a fake
// worktree's taskBranchState reports 🔍 after two polls (the crash point); the first child is SIGKILLed
// at the crash point, and once the second launch is live the reader exits it so the wait
// terminates. So install-once, launch/kill/relaunch, the stale-feed seeding and the two-launch-spanning
// bundle are all proven with no live agent — the live crash-and-restart over real agents is T09.
test('runRestartScenario installs once, launches, SIGKILLs the process at 🔍, relaunches on the same scratch, and spans both', async () => {
  const ws = workspace();
  try {
    const into = join(ws.dir, 'scratch-repo');
    const control = controlDirFor(into, 'restart');
    const flowPath = join(control, 'log');

    const firstFlow = '2026-01-01T00:00:00Z restart\n2026-01-01T00:00:05Z merge T01\n2026-01-01T00:00:08Z review T02\n';
    const resumedFlow = firstFlow + '2026-01-01T00:00:10Z restart\n2026-01-01T00:00:12Z merge T02\n';

    const spawn = fakeSpawner();
    const p = fakeProcs([6002]);
    const readWorkers = () => {
      if (spawn.children.length >= 2) {
        // The resumed run: write its flow, then exit the second coordinator so the wait terminates.
        writeFileSync(flowPath, resumedFlow);
        spawn.children[1].exit(0);
        return [];
      }
      return [rec('i2', 'T02', 'implement', 6002)];
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
      readWorkers,
      procs: p,
      gitRun: () => ({ ok: true, stdout: '' }),
      worktree,
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
