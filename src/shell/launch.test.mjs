import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';

import { startRun } from './launch.mjs';
import { writeRecord } from './index-store.mjs';

// The launch tests never touch a real coordinator, a real caffeinate, the real ~/.pir, or the real
// Mac's power state. Only readReviewGate reads the real filesystem, so each test builds a scratch repo
// with a real plans/{slug}/PROGRESS.md; everything else — spawn, exec (ps), kill, and the run.log fd —
// is injected. The index lives in a second scratch dir pointed at by $PIR_HOME.

const LSTART = 'Tue Sep 22 08:27:37 2026'; // the shape `ps -o lstart` returns (FINDINGS 2026-09-22).
const CHILD_PID = 4242;
const FAKE_FD = 77;

// A reviewed PROGRESS.md is one whose "Plan reviewed:" line carries a positive note (matches the gate
// parseProgress applies — see coordinate.mjs readReviewGate).
const REVIEWED = '# Progress\n\n**Plan reviewed:** 2026-09-22 — looks good\n';
const UNREVIEWED = '# Progress\n\n**Plan reviewed:** not yet\n';

// A DESIGN.md with a valid setup/test block (declared-test-command DESIGN §2.1), which start requires.
const VALID_DESIGN = '---\nsetup: none\ntest:\n  - npm test\n---\n# Design\n';

// A scratch repo with a plans/{slug}/ folder; `progress` is written as PROGRESS.md when given, and
// omitted entirely to exercise the no-plan (missing) case. `design` is written as DESIGN.md unless null.
function scratchRepo(slug, progress, design = VALID_DESIGN) {
  const root = mkdtempSync(join(tmpdir(), 'pir-launch-repo-'));
  if (progress !== undefined) {
    const planDir = join(root, 'plans', slug);
    mkdirSync(planDir, { recursive: true });
    writeFileSync(join(planDir, 'PROGRESS.md'), progress);
    if (design !== null) writeFileSync(join(planDir, 'DESIGN.md'), design);
  }
  return root;
}

function scratchHome() {
  return mkdtempSync(join(tmpdir(), 'pir-launch-home-'));
}

// A fake spawn that records every call and returns a child whose pid is fixed and whose unref is a spy.
// The coordinator spawn is the first call, caffeinate the second; both get the same shape.
function makeSpawn() {
  const calls = [];
  let unrefCount = 0;
  const spawn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return { pid: CHILD_PID, unref: () => { unrefCount += 1; } };
  };
  return { spawn, calls, unrefs: () => unrefCount };
}

// A fake exec for identity.startTimeOf/resolveLiveness: `ps -o lstart` returns LSTART for any pid.
const execAlive = () => ({ ok: true, stdout: `${LSTART}\n` });

// A fake fs for the run.log: records the mkdir and open, returns a sentinel fd.
function makeFs() {
  const calls = { mkdir: [], open: [] };
  const fs = {
    mkdirSync: (path, opts) => { calls.mkdir.push({ path, opts }); },
    openSync: (path, flags) => { calls.open.push({ path, flags }); return FAKE_FD; },
  };
  return { fs, calls };
}

const fixedNow = () => new Date('2026-09-22T08:27:37.000Z');

test('pre-flight: an absent plan → no-plan, and nothing is spawned', () => {
  const root = scratchRepo('demo', undefined); // no PROGRESS.md at all → readReviewGate reports missing
  const home = scratchHome();
  const { spawn, calls } = makeSpawn();
  try {
    const r = startRun('demo', { cwd: root, spawn, exec: execAlive, kill: () => {}, env: { PIR_HOME: home } });
    assert.deepEqual(r, { started: false, reason: 'no-plan' });
    assert.equal(calls.length, 0, 'no spawn on a failed pre-flight');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('pre-flight: an unreviewed plan → not-reviewed, and nothing is spawned', () => {
  const root = scratchRepo('demo', UNREVIEWED);
  const home = scratchHome();
  const { spawn, calls } = makeSpawn();
  try {
    const r = startRun('demo', { cwd: root, spawn, exec: execAlive, kill: () => {}, env: { PIR_HOME: home } });
    assert.deepEqual(r, { started: false, reason: 'not-reviewed' });
    assert.equal(calls.length, 0, 'no spawn on an unreviewed plan');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('pre-flight: an unreviewed plan without a test block still reports not-reviewed first', () => {
  const root = scratchRepo('demo', UNREVIEWED, null);
  const home = scratchHome();
  const { spawn, calls } = makeSpawn();
  try {
    const r = startRun('demo', { cwd: root, spawn, exec: execAlive, kill: () => {}, env: { PIR_HOME: home } });
    assert.deepEqual(r, { started: false, reason: 'not-reviewed' });
    assert.equal(calls.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

for (const [label, design, detail] of [
  ['no DESIGN.md', null, 'no DESIGN.md'],
  ['a DESIGN.md with no block', '# Design\n\nRun `npm test`.\n', 'no front-matter block'],
  ['a malformed block', '---\nsetup: none\n---\n# Design\n', 'no test key'],
]) {
  test(`pre-flight: a reviewed plan with ${label} → no-test-block with the parser's reason, nothing spawned`, () => {
    const root = scratchRepo('demo', REVIEWED, design);
    const home = scratchHome();
    const { spawn, calls } = makeSpawn();
    try {
      const r = startRun('demo', { cwd: root, spawn, exec: execAlive, kill: () => {}, env: { PIR_HOME: home } });
      assert.deepEqual(r, { started: false, reason: 'no-test-block', detail });
      assert.equal(calls.length, 0, 'no spawn on a plan without a valid block');
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
}

test('pre-flight: a slug already running → already-running, alreadyRunning:true, nothing spawned', () => {
  const root = scratchRepo('demo', REVIEWED);
  const home = scratchHome();
  const dir = join(home, '.pir', 'runs');
  const { spawn, calls } = makeSpawn();
  try {
    // An index entry whose recorded start time will match the live one, with the process faked alive:
    // classifyRun → running.
    writeRecord(
      {
        version: 1,
        slug: 'demo',
        repo: basename(root),
        repoPath: root,
        controlDir: join(root, 'plans', 'demo', '.parallel', 'control'),
        pid: 9001,
        startTime: LSTART,
        startedAt: '2026-09-22T08:27:37.000Z',
        branch: 'pir/demo',
        finalState: null,
        updatedAt: null,
      },
      { dir },
    );
    const r = startRun('demo', {
      cwd: root,
      spawn,
      exec: execAlive, // live start time == recorded start time
      kill: () => {}, // kill(pid,0) does not throw → alive
      env: { PIR_HOME: home },
    });
    assert.deepEqual(r, { started: false, reason: 'already-running', alreadyRunning: true });
    assert.equal(calls.length, 0, 'no second run is spawned for a live slug');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('pre-flight: a finished existing run does NOT block a start (re-running resumes)', () => {
  const root = scratchRepo('demo', REVIEWED);
  const home = scratchHome();
  const dir = join(home, '.pir', 'runs');
  const { fs } = makeFs();
  const { spawn, calls } = makeSpawn();
  try {
    // An entry with a clean final status classifies as finished regardless of what is alive now, so a
    // start proceeds.
    writeRecord(
      {
        version: 1,
        slug: 'demo',
        repo: basename(root),
        repoPath: root,
        controlDir: join(root, 'plans', 'demo', '.parallel', 'control'),
        pid: 9001,
        startTime: LSTART,
        startedAt: '2026-09-22T08:27:37.000Z',
        branch: 'pir/demo',
        finalState: 'finished',
        updatedAt: null,
      },
      { dir },
    );
    const r = startRun('demo', {
      cwd: root,
      spawn,
      exec: execAlive,
      kill: () => {}, // even faked alive, a finished final status wins → not running
      fs,
      now: fixedNow,
      env: { PIR_HOME: home },
    });
    assert.equal(r.started, true);
    assert.equal(calls.length, 2, 'the coordinator and caffeinate are both spawned');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('happy path: coordinator spawned detached, PIR_RUN/PARALLEL_LIVE set, stdio to run.log, unref called', () => {
  const root = scratchRepo('demo', REVIEWED);
  const home = scratchHome();
  const { fs, calls: fsCalls } = makeFs();
  const { spawn, calls, unrefs } = makeSpawn();
  try {
    const r = startRun('demo', { cwd: root, spawn, exec: execAlive, kill: () => {}, fs, now: fixedNow, env: { PIR_HOME: home } });
    assert.equal(r.started, true);
    assert.equal(r.pid, CHILD_PID);

    const coord = calls[0];
    assert.equal(coord.cmd, 'node');
    assert.ok(coord.args[0].endsWith('coordinate.mjs'), 'the engine\'s own coordinate.mjs is the target');
    assert.equal(coord.args[1], 'demo', 'the slug is passed to the coordinator');
    assert.equal(coord.opts.cwd, root, 'the coordinator runs with the target repo as cwd');
    assert.equal(coord.opts.detached, true);
    assert.equal(coord.opts.env.PIR_RUN, '1');
    assert.equal(coord.opts.env.PARALLEL_LIVE, '1');
    assert.deepEqual(coord.opts.stdio, ['ignore', FAKE_FD, FAKE_FD], 'stdout+stderr go to the run.log fd');

    // The run.log was opened for append in the control folder.
    assert.equal(fsCalls.open.length, 1);
    assert.equal(fsCalls.open[0].path, join(root, 'plans', 'demo', '.parallel', 'control', 'run.log'));
    assert.equal(fsCalls.open[0].flags, 'a');

    assert.ok(unrefs() >= 1, 'the coordinator child is unref\'d so pir can exit into the TUI');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('the index entry written carries the child pid and the captured start time', () => {
  const root = scratchRepo('demo', REVIEWED);
  const home = scratchHome();
  const { fs } = makeFs();
  const { spawn } = makeSpawn();
  try {
    const r = startRun('demo', { cwd: root, spawn, exec: execAlive, kill: () => {}, fs, now: fixedNow, env: { PIR_HOME: home } });
    assert.equal(r.record.pid, CHILD_PID);
    assert.equal(r.record.startTime, LSTART);
    assert.equal(r.record.repo, basename(root));
    assert.equal(r.record.repoPath, root);
    assert.equal(r.record.controlDir, join(root, 'plans', 'demo', '.parallel', 'control'));
    assert.equal(r.record.branch, 'pir/demo');
    assert.equal(r.record.finalState, null);
    assert.equal(r.record.startedAt, '2026-09-22T08:27:37.000Z');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('keep-awake: caffeinate -i -w {pid} spawned detached and unref\'d', () => {
  const root = scratchRepo('demo', REVIEWED);
  const home = scratchHome();
  const { fs } = makeFs();
  const { spawn, calls, unrefs } = makeSpawn();
  try {
    startRun('demo', { cwd: root, spawn, exec: execAlive, kill: () => {}, fs, now: fixedNow, env: { PIR_HOME: home } });
    const caff = calls[1];
    assert.equal(caff.cmd, 'caffeinate');
    assert.deepEqual(caff.args, ['-i', '-w', String(CHILD_PID)]);
    assert.equal(caff.opts.detached, true);
    assert.equal(caff.opts.stdio, 'ignore');
    assert.ok(unrefs() >= 2, 'both the coordinator and caffeinate children are unref\'d');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});
