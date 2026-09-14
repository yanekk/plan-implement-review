// run.mjs, proven WITHOUT a live agent (DESIGN §4.1, §5.2, T17 build-half acceptance). The launch argv
// and seatbelt env are asserted directly; the timeout→HALT and teardown-on-exit paths each have a test;
// and runScenario is driven end to end with an injected `claude` runner, git runner, capture and
// teardown platform — install → launch → capture → wait → seal → checkScenario — so everything short of
// a real coordinator spawning is proven here. Actually spawning real paid workers is the `you` half a
// person launches; this file never does (the seatbelt).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  coordinatorLaunchArgv,
  seatbeltEnv,
  controlDirFor,
  touchHalt,
  runOutcome,
  teardownScenario,
  runScenario,
  parseSurfaceTask,
  scriptedAnswerFor,
  captureFinalFiles,
} from './run.mjs';

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'pir-t17-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// --- coordinatorLaunchArgv (DESIGN §2.8) ---------------------------------------------------------

test('coordinatorLaunchArgv builds --bg -n <name> and the positional /pir-coordinate turn', () => {
  const argv = coordinatorLaunchArgv({ name: 'repo · single', slug: 'single' });
  assert.deepEqual(argv, ['--bg', '-n', 'repo · single', '/pir-coordinate single']);
  // The opening turn is POSITIONAL, never -p (`--bg`+`--print` conflict, FINDINGS 2026-09-07).
  assert.ok(!argv.includes('-p') && !argv.includes('--print'));
});

test('coordinatorLaunchArgv throws without a name or a slug', () => {
  assert.throws(() => coordinatorLaunchArgv({ slug: 'single' }), /no coordinator name/);
  assert.throws(() => coordinatorLaunchArgv({ name: 'r · s' }), /no slug/);
});

// --- seatbeltEnv (DESIGN §5.2) -------------------------------------------------------------------

test('seatbeltEnv sets PARALLEL_LIVE and the ceiling, and ALLOW_HERE only when asked', () => {
  assert.deepEqual(seatbeltEnv({ ceiling: 2 }), { PARALLEL_LIVE: '1', PARALLEL_MAX_WORKERS: '2' });
  assert.deepEqual(seatbeltEnv({ ceiling: 1, allowHere: true }), {
    PARALLEL_LIVE: '1',
    PARALLEL_MAX_WORKERS: '1',
    PARALLEL_ALLOW_HERE: '1',
  });
  // No ceiling → no cap key (the coordinator falls back to its own default of 4).
  assert.deepEqual(seatbeltEnv({}), { PARALLEL_LIVE: '1' });
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

// --- scripted decision injection (DESIGN §4.1, T28) ----------------------------------------------

test('parseSurfaceTask reads the task of a `surface Txx` flow line, else null', () => {
  assert.equal(parseSurfaceTask('2026-01-01T00:00:00Z surface T02'), 'T02');
  assert.equal(parseSurfaceTask('2026-01-01T00:00:00Z merge T02'), null);
  assert.equal(parseSurfaceTask('2026-01-01T00:00:00Z surface pir/scratch'), null);
  assert.equal(parseSurfaceTask('surface'), null);
});

test('scriptedAnswerFor routes an un-tasked decision to whatever task surfaced, once', () => {
  const scriptedAnswer = { text: 'keep hello there' };
  const flowText = '2026-01-01T00:00:00Z surface T02\n';
  const answered = new Set();
  const a = scriptedAnswerFor({ flowText, scriptedAnswer, answered });
  assert.deepEqual(a, { task: 'T02', text: 'keep hello there' });
  answered.add('T02');
  assert.equal(scriptedAnswerFor({ flowText, scriptedAnswer, answered }), null, 'not fed twice for the same task');
});

test('scriptedAnswerFor honours a decision that names a specific task, and is null without a surface', () => {
  const scriptedAnswer = { task: 'T01', text: 'use Hello, world!' };
  assert.equal(scriptedAnswerFor({ flowText: '2026-01-01T00:00:00Z surface T02\n', scriptedAnswer, answered: new Set() }), null);
  assert.deepEqual(
    scriptedAnswerFor({ flowText: '2026-01-01T00:00:00Z surface T01\n', scriptedAnswer, answered: new Set() }),
    { task: 'T01', text: 'use Hello, world!' },
  );
  assert.equal(scriptedAnswerFor({ flowText: 'nothing surfaced\n', scriptedAnswer: { text: 'x' }, answered: new Set() }), null);
});

test('captureFinalFiles reads `git show main:<file>` and omits a file git cannot show', () => {
  const gitRun = (args) => (args[1] === 'main:greeting.txt' ? { ok: true, stdout: 'hello there\n' } : { ok: false, stdout: '' });
  assert.deepEqual(captureFinalFiles({ repoDir: '/x', gitRun, files: ['greeting.txt', 'gone.txt'] }), { 'greeting.txt': 'hello there\n' });
});

// --- runOutcome (DESIGN §4.1: the two durable terminal markers) ----------------------------------

test('runOutcome reports promoted on a flow `promote` line', () => {
  const flow = '2026-01-01T00:00:00Z open-feature pir/single\n2026-01-01T00:01:00Z promote pir/single\n';
  assert.deepEqual(runOutcome({ flowText: flow }), { over: true, reason: 'promoted' });
});

test('runOutcome reports halted on a halt-close line', () => {
  assert.deepEqual(
    runOutcome({ flowText: '2026-01-01T00:00:00Z halt-close T01\n' }),
    { over: true, reason: 'halted' },
  );
});

// T29: the HALT flag's mere presence is NOT terminal — only the coordinator's own halt-close is. The
// flag precedes the coordinator's reaction, so sealing on its presence beat the coordinator to its own
// evidence (T23 2026-09-14). Mutation check: reverting to `if (haltPresent) return halted` reds the
// first assertion here.
test('runOutcome is still active on the HALT flag alone, before the coordinator confirms halt-close', () => {
  assert.deepEqual(runOutcome({ flowText: '', haltPresent: true }), { over: false, reason: 'active' });
  // Even a busy flow with the flag present but no halt-close yet stays active.
  assert.deepEqual(
    runOutcome({ flowText: '2026-01-01T00:00:00Z ceiling full\n', haltPresent: true }),
    { over: false, reason: 'active' },
  );
  // Once the coordinator writes halt-close, it is terminal regardless of the flag argument.
  assert.deepEqual(
    runOutcome({ flowText: '2026-01-01T00:00:00Z halt-close T01\n', haltPresent: true }),
    { over: true, reason: 'halted' },
  );
});

test('runOutcome reports active when no terminal marker is present', () => {
  const flow = '2026-01-01T00:00:00Z spawn T01\n2026-01-01T00:00:01Z hello T01\n';
  assert.deepEqual(runOutcome({ flowText: flow }), { over: false, reason: 'active' });
  // A task named "promotion-notes" must not be mistaken for the `promote` action (word-boundary).
  assert.deepEqual(runOutcome({ flowText: '2026-01-01T00:00:00Z spawn promoted-later\n' }), {
    over: false,
    reason: 'active',
  });
});

// --- teardownScenario: no worker and no coordinator is orphaned (DESIGN §2.3, §5.2) --------------

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

test('teardownScenario touches HALT, closes every worker (via teardownRun) and the coordinator', () => {
  const ws = workspace();
  try {
    const repo = 'scratchrepo';
    const slug = 'single';
    const control = controlDirFor(ws.dir, slug);
    const agents = [
      { id: 'w1', name: `${repo} · ${slug} · T01 · implement` },
      { id: 'w2', name: `${repo} · ${slug} · T02 · review` },
      { id: 'coord', name: `${repo} · ${slug}` },
      { id: 'foreign', name: 'someone-else · other · T09 · implement' },
    ];
    const platform = fakePlatform({ agents });
    const r = teardownScenario({ platform, worktree: fakeWorktree, repo, slug, controlDir: control });

    // Both workers of THIS run are closed; the foreign agent is left alone.
    assert.ok(platform.closed.includes('w1') && platform.closed.includes('w2'));
    assert.ok(!platform.closed.includes('foreign'));
    // The coordinator session is closed too (teardownRun deliberately skips it; teardownScenario adds it).
    assert.ok(platform.closed.includes('coord'), 'coordinator session closed');
    assert.equal(r.coordinatorClosed, true);
    // The kill switch was wired.
    assert.ok(existsSync(join(control, 'HALT')), 'HALT flag written by teardown');
  } finally {
    ws.cleanup();
  }
});

// --- runScenario end to end, with fakes (the whole build half) -----------------------------------
//
// A fake `install` lays a tiny scratch repo and pre-writes the coordinator flow log with a `promote`
// line, so the wait loop terminates on the first poll exactly as a real promoted run would. A fake
// `claude` runner answers the launch and the capture's `agents --json`; a fake git runner answers the
// capture's git log. No real agent, no real git — the run is proven end to end offline.

function installFake({ into, controlLog, slug = 'single' }) {
  return () => {
    mkdirSync(into, { recursive: true });
    const control = controlDirFor(into, slug);
    mkdirSync(control, { recursive: true });
    writeFileSync(join(control, 'log'), controlLog);
  };
}

test('runScenario installs, launches under the convention name, captures, seals and checks', async () => {
  const ws = workspace();
  try {
    const into = join(ws.dir, 'scratch-repo');
    const projects = join(ws.dir, 'projects');
    mkdirSync(projects, { recursive: true });

    const claudeCalls = [];
    const claudeRun = (args, opts = {}) => {
      claudeCalls.push({ args, env: opts.env });
      if (args[0] === '--bg') return { ok: true, stdout: 'coord-session-id\n' }; // the launch
      if (args.includes('--all')) return { ok: true, stdout: '[]' };
      if (args[0] === 'agents') return { ok: true, stdout: '[]' }; // no live workers → promote wins first
      return { ok: true, stdout: '' };
    };
    const gitRun = () => ({ ok: true, stdout: '* abc123 promote' });

    // Teardown platform: no live sessions to close (the run already promoted).
    const platform = fakePlatform({ agents: [] });

    const result = await runScenario({
      fixtureId: 'single',
      scratchDir: into,
      install: installFake({ into, controlLog: '2026-01-01T00:00:00Z promote pir/single\n' }),
      claudeRun,
      gitRun,
      platform,
      worktree: fakeWorktree,
      projectsDir: projects,
      pollMs: 1,
    });

    // The launch happened under the convention name with the seatbelt env (§2.8, §5.2). The repo name
    // is the scratch dir's basename (scratch-repo), so the coordinator name is "scratch-repo · single".
    const launch = claudeCalls.find((c) => c.args[0] === '--bg');
    assert.ok(launch, 'a coordinator was launched');
    assert.deepEqual(launch.args, ['--bg', '-n', 'scratch-repo · single', '/pir-coordinate single']);
    assert.equal(launch.env.PARALLEL_LIVE, '1');
    assert.equal(launch.env.PARALLEL_MAX_WORKERS, '1'); // the single fixture's ceiling

    // It reached the promoted terminal and produced a real, dated bundle with the flow copied in.
    assert.equal(result.reason, 'promoted');
    assert.ok(result.bundleDir && existsSync(result.bundleDir), 'a bundle dir exists');
    assert.ok(existsSync(join(result.bundleDir, 'flow.log')), 'the flow log was captured');
    assert.ok(existsSync(join(result.bundleDir, 'manifest.json')), 'the transcript manifest was sealed');

    // checkScenario ran the single fixture's declared facts (a report with those fact ids came back).
    const ids = result.report.facts.map((f) => f.id);
    assert.deepEqual(ids, ['no-hello-ever', 'by-name-addressing', 'no-close-before-idle', 'one-merge-to-main']);
    // With no real transcripts the facts do not pass; the point here is the WIRING produced the verdict.
    assert.equal(typeof result.ok, 'boolean');
  } finally {
    ws.cleanup();
  }
});

test('runScenario auto-touches HALT on the wall-clock timeout and reports timeout', async () => {
  const ws = workspace();
  try {
    const into = join(ws.dir, 'scratch-repo');
    const projects = join(ws.dir, 'projects');
    mkdirSync(projects, { recursive: true });
    const control = controlDirFor(into, 'single');

    // A worker that stays live forever and a flow log with no terminal marker → the run never finishes
    // on its own, so only the wall-clock timeout can end it.
    const liveWorker = { id: 'w1', sessionId: 's1', name: 'scratch-repo · single · T01 · implement', cwd: into, status: 'busy', state: 'working', pid: 1 };
    const claudeRun = (args) => {
      if (args[0] === '--bg') return { ok: true, stdout: 'coord\n' };
      if (args.includes('--all')) return { ok: true, stdout: '[]' };
      if (args[0] === 'agents') return { ok: true, stdout: JSON.stringify([liveWorker]) };
      return { ok: true, stdout: '' };
    };

    const platform = fakePlatform({ agents: [liveWorker] });

    const result = await runScenario({
      fixtureId: 'single',
      scratchDir: into,
      install: installFake({ into, controlLog: '2026-01-01T00:00:00Z spawn T01\n' }),
      claudeRun,
      gitRun: () => ({ ok: true, stdout: '' }),
      platform,
      worktree: fakeWorktree,
      projectsDir: projects,
      pollMs: 2,
      timeoutMs: 5, // fire the wall-clock cap almost immediately
      stallGrace: 1000, // never let a stall pre-empt the timeout in this test
    });

    // The backstop half of T29: the timeout auto-touches HALT, but the fake coordinator never writes a
    // halt-close, so the flag is present with no confirmation. The run must still END (via the wall-clock
    // timeout) rather than poll forever waiting for a halt-close that never comes.
    assert.equal(result.reason, 'timeout');
    assert.equal(result.ok, false, 'a timed-out run never passes');
    assert.ok(existsSync(join(control, 'HALT')), 'the timeout auto-touched HALT (seatbelt §5.2)');
    // The exit path tore the still-live worker (and coordinator, absent here) down — no orphan.
    assert.ok(platform.closed.includes('w1'), 'the live worker was closed on exit');
  } finally {
    ws.cleanup();
  }
});

test('runScenario declares a stall when no worker is ever live and nothing promotes', async () => {
  const ws = workspace();
  try {
    const into = join(ws.dir, 'scratch-repo');
    const projects = join(ws.dir, 'projects');
    mkdirSync(projects, { recursive: true });

    const claudeRun = (args) => {
      if (args[0] === '--bg') return { ok: true, stdout: 'coord\n' };
      return { ok: true, stdout: '[]' }; // never any live worker, no promote line
    };

    // The coordinator opened the feature branch but never spawned a worker: after the startup budget
    // with nothing ever live, that is a genuine "nothing to do" stall (§4.1). startupGrace governs the
    // pre-first-worker window, so it is what ends this run, not stallGrace.
    const result = await runScenario({
      fixtureId: 'single',
      scratchDir: into,
      install: installFake({ into, controlLog: '2026-01-01T00:00:00Z open-feature pir/single\n' }),
      claudeRun,
      gitRun: () => ({ ok: true, stdout: '' }),
      platform: fakePlatform({ agents: [] }),
      worktree: fakeWorktree,
      projectsDir: projects,
      pollMs: 1,
      startupGrace: 2,
    });

    assert.equal(result.reason, 'stalled');
  } finally {
    ws.cleanup();
  }
});

// The regression this review fixed (T17 review): quiet polls BEFORE the first worker appears must NOT be
// counted toward the (short) stall grace — a real coordinator takes many seconds to boot and spawn, so
// counting stall from poll 1 would tear every live run down before it began. Here two empty polls precede
// the worker; with the old logic and stallGrace 2 the run would already be 'stalled' at poll 2. With the
// startup grace in place the run survives to see the worker and then the promote line.
test('runScenario does not stall while the coordinator is still booting (before the first worker)', async () => {
  const ws = workspace();
  try {
    const into = join(ws.dir, 'scratch-repo');
    const projects = join(ws.dir, 'projects');
    mkdirSync(projects, { recursive: true });
    const flowPath = join(controlDirFor(into, 'single'), 'log');

    const worker = { id: 'w1', sessionId: 's1', name: 'scratch-repo · single · T01 · implement', cwd: into, status: 'busy', state: 'working', pid: 1 };
    let agentsCalls = 0;
    const claudeRun = (args) => {
      if (args[0] === '--bg') return { ok: true, stdout: 'coord\n' };
      if (args.includes('--all')) return { ok: true, stdout: '[]' };
      if (args[0] === 'agents') {
        agentsCalls += 1;
        if (agentsCalls <= 2) return { ok: true, stdout: '[]' }; // still booting — no worker yet
        // The worker has spawned; write the promote line so this same poll's flow read terminates the run.
        writeFileSync(flowPath, '2026-01-01T00:00:00Z open-feature pir/single\n2026-01-01T00:01:00Z promote pir/single\n');
        return { ok: true, stdout: JSON.stringify([worker]) };
      }
      return { ok: true, stdout: '' };
    };

    const result = await runScenario({
      fixtureId: 'single',
      scratchDir: into,
      install: installFake({ into, controlLog: '2026-01-01T00:00:00Z open-feature pir/single\n' }),
      claudeRun,
      gitRun: () => ({ ok: true, stdout: '' }),
      platform: fakePlatform({ agents: [] }),
      worktree: fakeWorktree,
      projectsDir: projects,
      pollMs: 1,
      stallGrace: 2, // short: the OLD code would have false-stalled at poll 2, before the worker at poll 3
      startupGrace: 100, // ample startup budget — the fix under test
    });

    // It survived the boot window, saw the worker, and reached the real terminal — never a premature stall.
    assert.equal(result.reason, 'promoted');
    assert.ok(agentsCalls >= 3, 'the run polled past the two empty boot samples to the worker');
  } finally {
    ws.cleanup();
  }
});

// The regression from the first real single run (T17 live run 2026-09-12): after the last worker closes,
// the coordinator runs one more pass to promote to main. The old logic counted a stall on worker-absence
// alone and HALTed the coordinator ~5s later, before it promoted, so nothing reached main. The coordinator
// session is still live and working through that window, so the run must NOT be called stalled while it is.
test('runScenario does not stall after the last worker closes while the coordinator is still promoting', async () => {
  const ws = workspace();
  try {
    const into = join(ws.dir, 'scratch-repo');
    const projects = join(ws.dir, 'projects');
    mkdirSync(projects, { recursive: true });
    const flowPath = join(controlDirFor(into, 'single'), 'log');

    const coord = { id: 'c', sessionId: 'sc', name: 'scratch-repo · single', cwd: into, status: 'busy', state: 'working', pid: 2 };
    const worker = { id: 'w1', sessionId: 's1', name: 'scratch-repo · single · T01 · implement', cwd: into, status: 'busy', state: 'working', pid: 1 };
    let n = 0;
    const claudeRun = (args) => {
      if (args[0] === '--bg') return { ok: true, stdout: 'coord\n' };
      if (args.includes('--all')) return { ok: true, stdout: '[]' };
      if (args[0] === 'agents') {
        n += 1;
        // poll 1: worker + coordinator live. polls 2+: worker gone, coordinator still working (promoting).
        const live = n === 1 ? [coord, worker] : [coord];
        // The promote lands only on poll 4 — well after the old worker-absence stallGrace of 2 would have
        // (wrongly) declared a stall at poll 3.
        if (n >= 4) writeFileSync(flowPath, '2026-01-01T00:00:00Z open-feature pir/single\n2026-01-01T00:04:00Z promote pir/single\n');
        return { ok: true, stdout: JSON.stringify(live) };
      }
      return { ok: true, stdout: '' };
    };

    const result = await runScenario({
      fixtureId: 'single',
      scratchDir: into,
      install: installFake({ into, controlLog: '2026-01-01T00:00:00Z open-feature pir/single\n' }),
      claudeRun,
      gitRun: () => ({ ok: true, stdout: '' }),
      platform: fakePlatform({ agents: [] }),
      worktree: fakeWorktree,
      projectsDir: projects,
      pollMs: 1,
      stallGrace: 2, // short: worker-absence alone would have stalled at poll 3, before the poll-4 promote
    });

    assert.equal(result.reason, 'promoted');
    assert.ok(n >= 4, 'the run kept polling past the last worker while the coordinator was still live');
  } finally {
    ws.cleanup();
  }
});

// T29: the kill-switch capture race. The operator (or the timeout) creates the HALT flag BEFORE the
// coordinator reacts, so the run must NOT seal on the flag's presence — it waits for the coordinator's
// own `halt-close` line and a short grace, so the sealed flow.log actually contains halt-close. In the
// T23 live run (2026-09-14) the old code sealed ~4s before halt-close, omitting it, and
// killSwitchStoppedAll failed on a run whose kill switch had worked. Here the flag appears at poll 2 but
// halt-close only at poll 4; with the old `haltPresent`-is-terminal logic the run would have sealed at
// poll 2, before halt-close.
test('runScenario seals a HALT run only after halt-close (not on the bare flag), and captures it', async () => {
  const ws = workspace();
  try {
    const into = join(ws.dir, 'scratch-repo');
    const projects = join(ws.dir, 'projects');
    mkdirSync(projects, { recursive: true });
    const control = controlDirFor(into, 'parallel');
    const flowPath = join(control, 'log');
    const haltPath = join(control, 'HALT');

    const coord = { id: 'c', sessionId: 'sc', name: 'scratch-repo · parallel', cwd: into, status: 'busy', state: 'working', pid: 2 };
    const worker = { id: 'w1', sessionId: 's1', name: 'scratch-repo · parallel · T01 · implement', cwd: into, status: 'busy', state: 'working', pid: 1 };
    let n = 0;
    const claudeRun = (args) => {
      if (args[0] === '--bg') return { ok: true, stdout: 'coord\n' };
      if (args.includes('--all')) return { ok: true, stdout: '[]' };
      if (args[0] === 'agents') {
        n += 1;
        if (n === 2) {
          // The operator touches HALT mid-run: the flag is present, but the coordinator has NOT yet
          // written halt-close. The run must NOT seal here (the T23 bug).
          writeFileSync(haltPath, 'operator HALT\n');
        }
        if (n >= 4) {
          // The coordinator reacts and confirms the kill switch. Only now is the run terminal.
          writeFileSync(
            flowPath,
            '2026-01-01T00:00:00Z open-feature pir/parallel\n2026-01-01T00:04:00Z halt-close T01\n2026-01-01T00:04:01Z halt-close T02\n',
          );
          return { ok: true, stdout: '[]' }; // workers torn down
        }
        return { ok: true, stdout: JSON.stringify([coord, worker]) };
      }
      return { ok: true, stdout: '' };
    };

    const result = await runScenario({
      fixtureId: 'parallel',
      scratchDir: into,
      install: installFake({ into, controlLog: '2026-01-01T00:00:00Z open-feature pir/parallel\n', slug: 'parallel' }),
      claudeRun,
      gitRun: () => ({ ok: true, stdout: '' }),
      platform: fakePlatform({ agents: [] }),
      worktree: fakeWorktree,
      projectsDir: projects,
      pollMs: 1,
      haltGrace: 2,
      stallGrace: 1000, // never let a stall pre-empt this test
      startupGrace: 1000,
    });

    assert.equal(result.reason, 'halted');
    assert.ok(n >= 4, 'the run kept polling past the bare HALT flag until halt-close appeared');
    // The captured flow.log contains halt-close — the whole point of T29 (the old seal omitted it).
    const capturedFlow = readFileSync(join(result.bundleDir, 'flow.log'), 'utf8');
    assert.ok(capturedFlow.includes('halt-close'), 'the sealed bundle captured the coordinator halt-close');
  } finally {
    ws.cleanup();
  }
});
