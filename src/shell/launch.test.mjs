import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';

import { planPreflight, resumeRun, singleRunPath, startPlanRun, startRun, startSingleRun } from './launch.mjs';
import { indexDir, listRecords, recordPath, writeRecord } from './index-store.mjs';
import { initialPlanState } from '../core/planflow.mjs';
import { initialSingleState } from '../core/singleflow.mjs';

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

// scratchRepo is not a git repo, so the tests that start from it inject the run's base (base-branch T06);
// the base resolution itself is tested against real git below.
const stubBase = () => ({ ok: true, base: 'main', baseSha: null, existing: true });

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
      resolveBase: stubBase,
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
    const r = startRun('demo', { cwd: root, spawn, exec: execAlive, kill: () => {}, fs, now: fixedNow, env: { PIR_HOME: home }, resolveBase: stubBase });
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
    const r = startRun('demo', { cwd: root, spawn, exec: execAlive, kill: () => {}, fs, now: fixedNow, env: { PIR_HOME: home }, resolveBase: stubBase });
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
    startRun('demo', { cwd: root, spawn, exec: execAlive, kill: () => {}, fs, now: fixedNow, env: { PIR_HOME: home }, resolveBase: stubBase });
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

// ---- Planning runs (pir-plan-command T08) ----
//
// Real git in a scratch repo (the pre-flight and openPlanBranch are git questions), a scratch $PIR_HOME
// for the index, and an injected spawn so no planning program or caffeinate is ever started. The real
// fs writes brief.md, state.json and an empty run.log inside the scratch repo.

function g(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// A repo named `name` with one commit on `branch`, under a realpath'd temp dir so paths compare equal
// to what git reports (/var → /private/var on macOS). The commit carries .pir/settings.json naming
// `base` (default: `branch`), as every repo pir plans in now needs (base-branch DESIGN §2.1); `base:
// null` leaves the file out. $PIR_HOME and $HOME point into the scratch dir, so the user settings file
// read is never the person's real one (base-branch DESIGN §5.2).
function gitRepo(t, { name = 'proj', branch = 'main', base: baseName = branch } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'pir-planlaunch-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = join(dir, name);
  mkdirSync(root);
  g(root, 'init', '-q', '-b', branch);
  g(root, 'config', 'user.email', 't08@test.local');
  g(root, 'config', 'user.name', 'T08');
  g(root, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(root, 'README.md'), 'x\n');
  if (baseName !== null) {
    mkdirSync(join(root, '.pir'));
    writeFileSync(join(root, '.pir', 'settings.json'), JSON.stringify({ baseBranch: baseName }) + '\n');
  }
  g(root, 'add', '-A');
  g(root, 'commit', '-q', '-m', 'init');
  const home = join(dir, 'home');
  mkdirSync(home);
  return { base: dir, root, home, env: { PIR_HOME: home, HOME: home, KEEP: 'yes' } };
}

// The person's own settings file for this scratch repo (base-branch DESIGN §2.1), under its PIR_HOME.
function userBase(s, base) {
  const dir = join(s.home, '.pir', basename(s.root));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ baseBranch: base }));
}

const branchesOf = (root) => g(root, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').trim().split('\n').sort();

// Everything a start could have created: branches, worktrees, a plans/ folder, index entries.
function footprint(s) {
  return {
    branches: branchesOf(s.root),
    worktrees: g(s.root, 'worktree', 'list', '--porcelain'),
    plans: existsSync(join(s.root, 'plans')),
    index: listRecords({ dir: join(s.home, '.pir', 'runs') }).length,
  };
}

// A random source that yields the given hex4 values in order.
function seq(...values) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

// A bare repository beside the scratch repo, registered as its `origin`: the remote every git test uses
// instead of the network (base-branch DESIGN §4).
function addBareRemote(s, name = 'origin') {
  const bare = join(s.base, `${name}.git`);
  g(s.base, 'init', '-q', '--bare', bare);
  g(s.root, 'remote', 'add', name, bare);
  return bare;
}

// Commit one file on `branch` of the bare remote, through a throwaway clone, so the remote is ahead.
function pushAhead(s, bare, branch, file = 'ahead.txt') {
  const clone = join(s.base, `clone-${file}`);
  g(s.base, 'clone', '-q', '-b', branch, bare, clone);
  for (const [k, v] of [['user.email', 't05@test.local'], ['user.name', 'T05'], ['commit.gpgsign', 'false']]) g(clone, 'config', k, v);
  writeFileSync(join(clone, file), 'ahead\n');
  g(clone, 'add', '-A');
  g(clone, 'commit', '-q', '-m', `ahead: ${file}`);
  g(clone, 'push', '-q', 'origin', branch);
  return g(clone, 'rev-parse', 'HEAD').trim();
}

for (const [label, setup, reason, opts = {}] of [
  ['outside a git repo', (s) => ({ cwd: s.base }), 'not-a-repo'],
  ['an empty brief', () => ({ brief: '  \n\t ' }), 'empty-brief'],
  ['a repo with no settings, even with main', () => ({}), 'no-base-setting', { base: null }],
  ['a settings file that is not JSON', (s) => { writeFileSync(join(s.root, '.pir', 'settings.json'), '{oops'); return {}; }, 'bad-settings'],
  ['a user settings file naming a bad branch', (s) => {
    mkdirSync(join(s.home, '.pir', 'proj'), { recursive: true });
    writeFileSync(join(s.home, '.pir', 'proj', 'settings.json'), '{"baseBranch": "a..b"}');
    return {};
  }, 'bad-settings'],
  ['a base branch that exists nowhere, no remote', () => ({}), 'no-base-branch', { base: 'dev' }],
  ['a base branch missing locally and on the remote', (s) => { addBareRemote(s); return {}; }, 'no-base-branch', { base: 'dev' }],
  ['an unreachable remote', (s) => { g(s.root, 'remote', 'add', 'origin', join(s.base, 'gone.git')); return {}; }, 'fetch-failed'],
  ['a local base split from the remote', (s) => {
    const bare = addBareRemote(s);
    g(s.root, 'push', '-q', 'origin', 'main');
    pushAhead(s, bare, 'main');
    writeFileSync(join(s.root, 'local.txt'), 'local\n');
    g(s.root, 'add', '-A');
    g(s.root, 'commit', '-q', '-m', 'local only');
    return {};
  }, 'diverged'],
]) {
  test(`startPlanRun pre-flight: ${label} → ${reason}, nothing created`, (t) => {
    const s = gitRepo(t, opts);
    const extra = setup(s);
    const before = footprint(s);
    const { spawn, calls } = makeSpawn();
    const r = startPlanRun(extra.brief ?? 'a brief', { cwd: extra.cwd ?? s.root, spawn, exec: execAlive, env: s.env, random: seq('abcd') });
    assert.equal(r.started, false);
    assert.equal(r.reason, reason);
    if (!['not-a-repo', 'empty-brief'].includes(reason)) assert.match(r.message, /^pir: /, 'a base refusal carries the §2.9 text');
    assert.equal(calls.length, 0, 'nothing spawned');
    assert.deepEqual(footprint(s), before, 'no branch, worktree, folder or index entry');
  });
}

test('startPlanRun refusal texts name the cause and the fix (§2.9)', (t) => {
  const none = gitRepo(t, { base: null });
  const r1 = startPlanRun('b', { cwd: none.root, spawn: makeSpawn().spawn, env: none.env });
  assert.equal(r1.message, 'pir: no base branch is set for proj. Add .pir/settings.json with {"baseBranch": "<branch>"} (committed, for everyone), or ~/.pir/proj/settings.json (this machine only).');
  const nodev = gitRepo(t, { base: 'dev' });
  const r2 = startPlanRun('b', { cwd: nodev.root, spawn: makeSpawn().spawn, env: nodev.env });
  assert.equal(r2.message, 'pir: the base branch dev (set in .pir/settings.json) does not exist locally, and this repo has no remote.');
  assert.equal(r2.base, 'dev');
  const gone = gitRepo(t);
  g(gone.root, 'remote', 'add', 'origin', join(gone.base, 'gone.git'));
  const r3 = startPlanRun('b', { cwd: gone.root, spawn: makeSpawn().spawn, env: gone.env });
  assert.match(r3.message, /^pir: could not fetch main from origin: .+\. Nothing was created; try again when origin is reachable\.$/);
  assert.equal(r3.remote, 'origin');
});

test('startPlanRun in a dev-only repo whose remote dev is ahead: cut at the remote sha, pirBase and baseBranch dev', (t) => {
  const s = gitRepo(t, { branch: 'dev' });
  const bare = addBareRemote(s);
  g(s.root, 'push', '-q', 'origin', 'dev');
  const ahead = pushAhead(s, bare, 'dev');
  assert.notEqual(g(s.root, 'rev-parse', 'dev').trim(), ahead, 'the local dev is behind before the start');

  const { spawn } = makeSpawn();
  const r = startPlanRun('a brief', { cwd: s.root, spawn, exec: execAlive, env: s.env, now: fixedNow, random: seq('d0d0') });
  assert.equal(r.started, true);
  assert.equal(g(s.root, 'rev-parse', 'pir/plan-d0d0').trim(), ahead, 'cut from the remote newest dev');
  assert.equal(g(s.root, 'config', '--get', 'branch.pir/plan-d0d0.pirBase').trim(), 'dev');
  assert.equal(r.record.baseBranch, 'dev');
  assert.equal(listRecords({ dir: join(s.home, '.pir', 'runs') })[0].baseBranch, 'dev');
  // dev is checked out and clean in the person's checkout, so it moved forward (§2.3).
  assert.equal(g(s.root, 'rev-parse', 'dev').trim(), ahead);
  assert.equal(g(s.root, 'symbolic-ref', '--short', 'HEAD').trim(), 'dev', 'the person stays on their branch');
});

test('startPlanRun in a repo with no remote and a local dev plans from the local dev, no fetch', (t) => {
  const s = gitRepo(t, { branch: 'dev' });
  const head = g(s.root, 'rev-parse', 'dev').trim();
  const r = startPlanRun('a brief', { cwd: s.root, spawn: makeSpawn().spawn, exec: execAlive, env: s.env, random: seq('e0e0') });
  assert.equal(r.started, true);
  assert.equal(g(s.root, 'rev-parse', 'pir/plan-e0e0').trim(), head);
  assert.equal(r.record.baseBranch, 'dev');
  assert.deepEqual(g(s.root, 'for-each-ref', '--format=%(refname)', 'refs/remotes').trim(), '', 'nothing fetched');
});

test('startPlanRun: the user settings file overrides the repo file (§2.1)', (t) => {
  const s = gitRepo(t);
  g(s.root, 'branch', 'dev');
  mkdirSync(join(s.home, '.pir', 'proj'), { recursive: true });
  writeFileSync(join(s.home, '.pir', 'proj', 'settings.json'), '{"baseBranch": "dev"}');
  const r = startPlanRun('a brief', { cwd: s.root, spawn: makeSpawn().spawn, exec: execAlive, env: s.env, random: seq('f0f0') });
  assert.equal(r.record.baseBranch, 'dev');
  assert.equal(g(s.root, 'config', '--get', 'branch.pir/plan-f0f0.pirBase').trim(), 'dev');
});

// Replaces the old canonical-repo refusal test: that guard is gone (dashboard-plan-box DESIGN §2.8).
test('startPlanRun: a checkout named plan-implement-review starts with no environment flag', (t) => {
  const s = gitRepo(t, { name: 'plan-implement-review' });
  const env = { ...s.env };
  delete env.PARALLEL_ALLOW_HERE;
  const { spawn, calls } = makeSpawn();
  const r = startPlanRun('a brief', { cwd: s.root, spawn, exec: execAlive, env, random: seq('abcd') });
  assert.equal(r.started, true, 'no repo-name refusal');
  assert.equal(calls.length > 0, true, 'the planning program was spawned');
  const pre = planPreflight({ cwd: s.root, env: s.env });
  assert.deepEqual([pre.ok, pre.root, pre.repo, pre.base], [true, s.root, 'plan-implement-review', 'main']);
});

test('startPlanRun pre-flight order: not-a-repo before an empty brief; checks run before the brief', (t) => {
  const s = gitRepo(t);
  const { spawn } = makeSpawn();
  assert.equal(startPlanRun('', { cwd: s.base, spawn, env: s.env }).reason, 'not-a-repo');
  g(s.root, 'branch', '-m', 'main', 'trunk');
  assert.equal(startPlanRun('', { cwd: s.root, spawn, env: s.env }).reason, 'no-base-branch');
});

test('startPlanRun: a clean start creates branch, worktree, control folder, index record, and spawns', (t) => {
  const s = gitRepo(t);
  const mainHead = g(s.root, 'rev-parse', 'HEAD').trim();
  const { spawn, calls, unrefs } = makeSpawn();
  const brief = 'A daily screen budget with a warning before it runs out\nsecond line';
  const r = startPlanRun(brief, { cwd: s.root, spawn, exec: execAlive, env: s.env, now: fixedNow, random: seq('3f9a') });

  assert.equal(r.started, true);
  assert.equal(r.runId, 'plan-3f9a');
  assert.equal(r.pid, CHILD_PID);

  // Branch cut from main, checked out in its own worktree; the main checkout stays on main.
  assert.equal(g(s.root, 'rev-parse', 'pir/plan-3f9a').trim(), mainHead);
  const wt = join(s.root, '.claude', 'worktrees', 'pir-plan-3f9a');
  assert.equal(g(wt, 'symbolic-ref', '--short', 'HEAD').trim(), 'pir/plan-3f9a');
  assert.equal(g(s.root, 'symbolic-ref', '--short', 'HEAD').trim(), 'main');

  // Control folder under plans/{runId}/, not .git, holding the brief and a fresh state.json.
  const controlDir = join(s.root, 'plans', 'plan-3f9a', '.parallel', 'plan');
  assert.equal(r.controlDir, controlDir);
  assert.equal(readFileSync(join(controlDir, 'brief.md'), 'utf8'), brief);
  assert.deepEqual(JSON.parse(readFileSync(join(controlDir, 'state.json'), 'utf8')), initialPlanState({ id: 'plan-3f9a' }));
  assert.ok(existsSync(join(controlDir, 'run.log')), 'run.log opened for the program output');
  assert.deepEqual(readdirSync(controlDir).filter((n) => n.endsWith('.tmp')), [], 'no temp left behind');

  // The planning program, detached, with its control folder; PIR_RUN on, the caller's env carried.
  const prog = calls[0];
  assert.equal(prog.cmd, 'node');
  assert.ok(prog.args[0].endsWith(join('src', 'shell', 'plan-run.mjs')), prog.args[0]);
  assert.deepEqual(prog.args.slice(1), ['--control', controlDir]);
  assert.equal(prog.opts.cwd, s.root);
  assert.equal(prog.opts.detached, true);
  assert.equal(prog.opts.stdio[0], 'ignore');
  assert.equal(typeof prog.opts.stdio[1], 'number');
  assert.equal(prog.opts.stdio[1], prog.opts.stdio[2], 'stdout and stderr share run.log');
  assert.equal(prog.opts.env.PIR_RUN, '1');
  assert.equal(prog.opts.env.KEEP, 'yes');
  assert.equal(prog.opts.env.PARALLEL_LIVE, undefined, 'a planning run is not a live build');

  // Keep-awake tied to the program's pid.
  assert.equal(calls.length, 2);
  assert.equal(calls[1].cmd, 'caffeinate');
  assert.deepEqual(calls[1].args, ['-i', '-w', String(CHILD_PID)]);
  assert.equal(calls[1].opts.detached, true);
  assert.equal(unrefs(), 2);

  // Index record kind 'plan', keyed by run id, labelled from the brief's first line.
  const dir = join(s.home, '.pir', 'runs');
  const records = listRecords({ dir });
  assert.equal(records.length, 1);
  assert.ok(existsSync(recordPath('proj', 'plan-3f9a', { dir })));
  assert.deepEqual(records[0], {
    version: 1,
    kind: 'plan',
    label: 'A daily screen budget w…',
    go: null,
    slug: 'plan-3f9a',
    repo: 'proj',
    repoPath: s.root,
    controlDir,
    pid: CHILD_PID,
    startTime: LSTART,
    startedAt: '2026-09-22T08:27:37.000Z',
    branch: 'pir/plan-3f9a',
    baseBranch: 'main',
    finalState: null,
    updatedAt: null,
  });
  assert.deepEqual(r.record, records[0]);
  assert.equal(g(s.root, 'config', '--get', 'branch.pir/plan-3f9a.pirBase').trim(), 'main', 'pirBase recorded');

  // Nothing tracked changed in the person's checkout.
  assert.equal(g(s.root, 'status', '--porcelain', '--untracked-files=no'), '');
});

test('startPlanRun from a subfolder and from a linked worktree: root is the main worktree', (t) => {
  const s = gitRepo(t);
  mkdirSync(join(s.root, 'deep', 'er'), { recursive: true });
  const linked = join(s.base, 'linked');
  g(s.root, 'worktree', 'add', '-q', '-b', 'side', linked);

  for (const [cwd, hex] of [[join(s.root, 'deep', 'er'), 'aaa1'], [linked, 'aaa2']]) {
    const pre = planPreflight({ cwd, env: s.env });
    assert.deepEqual([pre.ok, pre.root, pre.repo, pre.base, pre.remote], [true, s.root, 'proj', 'main', null]);
    assert.equal(pre.baseSha, g(s.root, 'rev-parse', 'main').trim());
    const { spawn, calls } = makeSpawn();
    const r = startPlanRun('brief', { cwd, spawn, exec: execAlive, env: s.env, random: seq(hex) });
    assert.equal(r.record.repoPath, s.root);
    assert.equal(r.record.repo, 'proj');
    assert.equal(r.controlDir, join(s.root, 'plans', `plan-${hex}`, '.parallel', 'plan'));
    assert.equal(calls[0].opts.cwd, s.root);
    assert.ok(existsSync(join(s.root, '.claude', 'worktrees', `pir-plan-${hex}`)));
  }
});

test('startPlanRun: a run id taken by a branch, an index entry or a plans/ folder is drawn again', (t) => {
  const s = gitRepo(t);
  const dir = join(s.home, '.pir', 'runs');
  g(s.root, 'branch', 'pir/plan-0001');
  writeRecord({ version: 1, slug: 'plan-0002', repo: 'proj', repoPath: s.root, controlDir: '/x', pid: 1, startTime: LSTART, branch: 'pir/plan-0002' }, { dir });
  mkdirSync(join(s.root, 'plans', 'plan-0003'), { recursive: true });

  const { spawn } = makeSpawn();
  const drawn = [];
  const random = () => {
    const v = ['0001', '0002', '0003', '0004'][drawn.length];
    drawn.push(v);
    return v;
  };
  const r = startPlanRun('brief', { cwd: s.root, spawn, exec: execAlive, env: s.env, random });
  assert.equal(r.runId, 'plan-0004');
  assert.deepEqual(drawn, ['0001', '0002', '0003', '0004']);
  // The taken ones were left exactly as they were.
  assert.equal(g(s.root, 'rev-parse', 'pir/plan-0001').trim(), g(s.root, 'rev-parse', 'main').trim());
  assert.equal(listRecords({ dir }).find((x) => x.slug === 'plan-0002').controlDir, '/x');
});

function planRecord(s, overrides = {}) {
  return {
    version: 1,
    kind: 'plan',
    label: 'a brief',
    go: null,
    slug: 'plan-3f9a',
    repo: 'proj',
    repoPath: s.root,
    controlDir: join(s.root, 'plans', 'plan-3f9a', '.parallel', 'plan'),
    pid: 9001,
    startTime: 'Mon Sep 21 10:00:00 2026',
    startedAt: '2026-09-21T10:00:00.000Z',
    branch: 'pir/plan-3f9a',
    finalState: 'stopped',
    updatedAt: '2026-09-21T11:00:00.000Z',
    ...overrides,
  };
}

const dead = () => { const e = new Error('no such process'); e.code = 'ESRCH'; throw e; };

test('resumeRun on a plan record: plan-run.mjs --resume on its control folder; index pid and start time updated', (t) => {
  const s = gitRepo(t);
  const dir = join(s.home, '.pir', 'runs');
  for (const finalState of ['stopped', null, 'finished']) {
    const rec = planRecord(s, { finalState });
    writeRecord(rec, { dir });
    const { spawn, calls } = makeSpawn();
    const r = resumeRun(rec, { spawn, exec: execAlive, kill: dead, env: { ...s.env, KEEP: 'yes' } });
    assert.deepEqual(r, { resumed: true, pid: CHILD_PID }, `from finalState ${finalState}`);
    assert.equal(calls[0].cmd, 'node');
    assert.ok(calls[0].args[0].endsWith(join('src', 'shell', 'plan-run.mjs')));
    assert.deepEqual(calls[0].args.slice(1), ['--control', rec.controlDir, '--resume']);
    assert.equal(calls[0].opts.cwd, s.root);
    assert.equal(calls[0].opts.detached, true);
    assert.equal(calls[0].opts.env.PIR_RUN, '1');
    assert.equal(calls[0].opts.env.KEEP, 'yes');
    assert.ok(existsSync(join(rec.controlDir, 'run.log')));
    assert.equal(calls[1].cmd, 'caffeinate');
    assert.deepEqual(calls[1].args, ['-i', '-w', String(CHILD_PID)]);

    const after = listRecords({ dir });
    assert.equal(after.length, 1);
    assert.deepEqual(after[0], { ...rec, pid: CHILD_PID, startTime: LSTART, finalState: null, updatedAt: null });
  }
});

test('resumeRun on a work record calls startRun (pir start {slug})', (t) => {
  const s = gitRepo(t);
  userBase(s, 'main');
  mkdirSync(join(s.root, 'plans', 'demo'), { recursive: true });
  writeFileSync(join(s.root, 'plans', 'demo', 'PROGRESS.md'), REVIEWED);
  writeFileSync(join(s.root, 'plans', 'demo', 'DESIGN.md'), VALID_DESIGN);
  const rec = planRecord(s, {
    kind: 'work',
    label: null,
    slug: 'demo',
    branch: 'pir/demo',
    controlDir: join(s.root, 'plans', 'demo', '.parallel', 'control'),
    finalState: null,
  });
  const { fs } = makeFs();
  const { spawn, calls } = makeSpawn();
  const r = resumeRun(rec, { spawn, exec: execAlive, kill: dead, fs, env: s.env });
  assert.deepEqual(r, { resumed: true, pid: CHILD_PID });
  assert.ok(calls[0].args[0].endsWith('coordinate.mjs'), 'the coordinator, not the planning program');
  assert.equal(calls[0].args[1], 'demo');
  assert.equal(calls[0].opts.cwd, s.root);
  assert.equal(calls[0].opts.env.PARALLEL_LIVE, '1');

  // startRun's own refusal comes back as the reason.
  writeFileSync(join(s.root, 'plans', 'demo', 'PROGRESS.md'), UNREVIEWED);
  const refused = resumeRun(rec, { spawn: makeSpawn().spawn, exec: execAlive, kill: dead, fs, env: s.env });
  assert.deepEqual(refused, { resumed: false, reason: 'not-reviewed' });
});

test('resumeRun on a running record refuses already-running, for either kind, nothing spawned', (t) => {
  const s = gitRepo(t);
  for (const kind of ['plan', 'work']) {
    const rec = planRecord(s, { kind, finalState: null, startTime: LSTART });
    const { spawn, calls } = makeSpawn();
    const r = resumeRun(rec, { spawn, exec: execAlive, kill: () => {}, env: s.env });
    assert.deepEqual(r, { resumed: false, reason: 'already-running' });
    assert.equal(calls.length, 0);
  }
});

test('startRun on a branch-home unreviewed plan → not-reviewed with where: branch', (t) => {
  const s = gitRepo(t);
  g(s.root, 'checkout', '-q', '-b', 'pir/demo');
  mkdirSync(join(s.root, 'plans', 'demo'), { recursive: true });
  writeFileSync(join(s.root, 'plans', 'demo', 'PROGRESS.md'), UNREVIEWED);
  writeFileSync(join(s.root, 'plans', 'demo', 'DESIGN.md'), VALID_DESIGN);
  g(s.root, 'add', '-A');
  g(s.root, 'commit', '-q', '-m', 'plan');
  g(s.root, 'checkout', '-q', 'main');
  assert.ok(!existsSync(join(s.root, 'plans', 'demo')), 'the plan is only on the branch');

  const { spawn, calls } = makeSpawn();
  const r = startRun('demo', { cwd: s.root, spawn, exec: execAlive, kill: () => {}, env: s.env });
  assert.deepEqual(r, { started: false, reason: 'not-reviewed', where: 'branch' });
  assert.equal(calls.length, 0);

  // Its planning run live (being reviewed): `pir start` opens it rather than naming resume (user, T14).
  writeRecord(
    { version: 1, kind: 'plan', label: null, go: null, slug: 'demo', repo: basename(s.root), repoPath: s.root,
      controlDir: join(s.root, 'plans', 'demo', '.parallel', 'plan'), pid: 9001, startTime: LSTART,
      startedAt: '2026-09-26T08:00:00.000Z', branch: 'pir/demo', finalState: null, updatedAt: null },
    { dir: indexDir({ env: s.env }) },
  );
  assert.deepEqual(startRun('demo', { cwd: s.root, spawn, exec: execAlive, kill: () => {}, env: s.env }), { started: false, reason: 'already-running', alreadyRunning: true });
  // Stopped, it is refused naming resume again.
  const dead = () => { throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' }); };
  assert.deepEqual(startRun('demo', { cwd: s.root, spawn, exec: execAlive, kill: dead, env: s.env }), { started: false, reason: 'not-reviewed', where: 'branch' });
  assert.equal(calls.length, 0);
});

// --- --no-coordinator (pir-coordinator T04, DESIGN §2.1) ---------------------------------------------

test('startRun coordinator: false → PARALLEL_COORDINATOR=0 for the child and coordinator: false in the index record', () => {
  const root = scratchRepo('demo', REVIEWED);
  const home = scratchHome();
  const { fs } = makeFs();
  try {
    const off = makeSpawn();
    const r = startRun('demo', { cwd: root, spawn: off.spawn, exec: execAlive, kill: () => {}, fs, now: fixedNow, env: { PIR_HOME: home }, coordinator: false, resolveBase: stubBase });
    assert.equal(off.calls[0].opts.env.PARALLEL_COORDINATOR, '0');
    assert.equal(r.record.coordinator, false);
    const [stored] = listRecords({ dir: indexDir({ env: { PIR_HOME: home } }) });
    assert.equal(stored.coordinator, false, 'kept in the index entry on disk');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('startRun by default → no PARALLEL_COORDINATOR set by pir, and no coordinator field in the record', () => {
  const root = scratchRepo('demo', REVIEWED);
  const home = scratchHome();
  const { fs } = makeFs();
  try {
    const on = makeSpawn();
    const r = startRun('demo', { cwd: root, spawn: on.spawn, exec: execAlive, kill: () => {}, fs, now: fixedNow, env: { PIR_HOME: home }, resolveBase: stubBase });
    assert.equal(on.calls[0].opts.env.PARALLEL_COORDINATOR, undefined);
    assert.equal('coordinator' in r.record, false);
    const [stored] = listRecords({ dir: indexDir({ env: { PIR_HOME: home } }) });
    assert.equal('coordinator' in stored, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('resumeRun keeps a work record\'s --no-coordinator choice', (t) => {
  const s = gitRepo(t);
  userBase(s, 'main');
  mkdirSync(join(s.root, 'plans', 'demo'), { recursive: true });
  writeFileSync(join(s.root, 'plans', 'demo', 'PROGRESS.md'), REVIEWED);
  writeFileSync(join(s.root, 'plans', 'demo', 'DESIGN.md'), VALID_DESIGN);
  const base = { kind: 'work', label: null, slug: 'demo', branch: 'pir/demo', controlDir: join(s.root, 'plans', 'demo', '.parallel', 'control'), finalState: 'stopped' };
  const { fs } = makeFs();

  const off = makeSpawn();
  assert.deepEqual(resumeRun(planRecord(s, { ...base, coordinator: false }), { spawn: off.spawn, exec: execAlive, kill: dead, fs, env: s.env }), { resumed: true, pid: CHILD_PID });
  assert.equal(off.calls[0].opts.env.PARALLEL_COORDINATOR, '0');
  const [stored] = listRecords({ dir: indexDir({ env: s.env }) }).filter((r) => r.slug === 'demo');
  assert.equal(stored.coordinator, false, 'the resumed run records the choice again');

  const on = makeSpawn();
  resumeRun(planRecord(s, base), { spawn: on.spawn, exec: execAlive, kill: dead, fs, env: s.env });
  assert.equal(on.calls[0].opts.env.PARALLEL_COORDINATOR, undefined);
});

// --- The build's base branch (base-branch T06, DESIGN §2.5, §2.7) -------------------------------------
//
// Real git: a scratch repo whose only branch is `dev`, and a local bare repository as its remote, so the
// fetch, the ancestry check and the cut run for real without touching the network.

const idArgs = ['-c', 'user.name=t06', '-c', 'user.email=t06@test.local', '-c', 'commit.gpgsign=false'];
const gi = (cwd, ...args) => g(cwd, ...idArgs, ...args).trim();

// {base}/remote.git (bare, dev), {base}/other (pushes to it), and s.root: a clone on `dev` holding a
// reviewed hand-made plan on dev, whose .pir/settings.json names `dev`.
function devWorld(t, { settings = { baseBranch: 'dev' } } = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'pir-t06-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const remote = join(base, 'remote.git');
  const other = join(base, 'other');
  const root = join(base, 'proj');
  const home = join(base, 'home');
  mkdirSync(home);
  gi(base, 'init', '-q', '--bare', '-b', 'dev', remote);
  gi(base, 'init', '-q', '-b', 'dev', other);
  mkdirSync(join(other, 'plans', 'demo'), { recursive: true });
  writeFileSync(join(other, 'plans', 'demo', 'PROGRESS.md'), REVIEWED);
  writeFileSync(join(other, 'plans', 'demo', 'DESIGN.md'), VALID_DESIGN);
  if (settings) {
    mkdirSync(join(other, '.pir'));
    writeFileSync(join(other, '.pir', 'settings.json'), JSON.stringify(settings));
  }
  gi(other, 'add', '-A');
  gi(other, 'commit', '-q', '-m', 'plan');
  gi(other, 'remote', 'add', 'origin', remote);
  gi(other, 'push', '-q', 'origin', 'dev');
  gi(base, 'clone', '-q', remote, root);
  const push = (name) => {
    writeFileSync(join(other, name), name);
    gi(other, 'add', '-A');
    gi(other, 'commit', '-q', '-m', name);
    gi(other, 'push', '-q', 'origin', 'dev');
    return gi(other, 'rev-parse', 'HEAD');
  };
  return { base, root, home, remote, env: { ...process.env, PIR_HOME: home }, push };
}

const startDev = (s, spawn, extra = {}) =>
  startRun('demo', { cwd: s.root, spawn, exec: execAlive, kill: dead, fs: makeFs().fs, now: fixedNow, env: s.env, ...extra });
const pirBaseOf = (root, branch = 'pir/demo') => {
  try {
    return gi(root, 'config', '--get', `branch.${branch}.pirBase`);
  } catch {
    return null;
  }
};

test('pir start of a hand-made plan in a dev repo with the remote ahead: feature cut from the remote sha, pirBase=dev', (t) => {
  const s = devWorld(t);
  const ahead = s.push('b.txt');
  assert.notEqual(gi(s.root, 'rev-parse', 'dev'), ahead, 'the local dev is behind the remote');
  const { spawn, calls } = makeSpawn();
  const r = startDev(s, spawn);
  assert.equal(r.started, true, JSON.stringify(r));
  assert.equal(gi(s.root, 'rev-parse', 'pir/demo'), ahead, 'cut from the newest remote commit');
  assert.equal(pirBaseOf(s.root), 'dev');
  assert.deepEqual(calls[0].args.slice(1), ['demo', '--base', 'dev', '--base-sha', ahead], 'the coordinator is told its base');
  assert.equal(r.record.baseBranch, 'dev');
  const [stored] = listRecords({ dir: indexDir({ env: s.env }) });
  assert.equal(stored.baseBranch, 'dev', 'the index record carries a copy of the base');
});

test('an existing pir/{slug} with pirBase=dev keeps dev though the settings now say stage, and nothing is fetched', (t) => {
  const s = devWorld(t);
  gi(s.root, 'branch', 'pir/demo', 'dev');
  gi(s.root, 'config', 'branch.pir/demo.pirBase', 'dev');
  const tip = gi(s.root, 'rev-parse', 'pir/demo');
  writeFileSync(join(s.root, '.pir', 'settings.json'), JSON.stringify({ baseBranch: 'stage' }));
  // A fetch would now fail: the remote is gone. A start that fetched would be refused fetch-failed.
  rmSync(s.remote, { recursive: true, force: true });
  const { spawn, calls } = makeSpawn();
  const r = startDev(s, spawn);
  assert.equal(r.started, true, JSON.stringify(r));
  assert.deepEqual(calls[0].args.slice(1), ['demo', '--base', 'dev'], 'no --base-sha: the branch is already cut');
  assert.equal(r.record.baseBranch, 'dev');
  assert.equal(gi(s.root, 'rev-parse', 'pir/demo'), tip, 'the branch is not moved');
  assert.equal(pirBaseOf(s.root), 'dev');
});

test('an existing pir/{slug} without pirBase takes its base from the settings and records it, without a fetch', (t) => {
  const s = devWorld(t);
  gi(s.root, 'branch', 'pir/demo', 'dev');
  rmSync(s.remote, { recursive: true, force: true });
  const { spawn, calls } = makeSpawn();
  const r = startDev(s, spawn);
  assert.equal(r.started, true, JSON.stringify(r));
  assert.equal(pirBaseOf(s.root), 'dev', 'pirBase recorded now');
  assert.deepEqual(calls[0].args.slice(1), ['demo', '--base', 'dev']);
});

test('no settings and no pir/{slug}: refused with the §2.9 text, nothing created, nothing spawned', (t) => {
  const s = devWorld(t, { settings: null });
  const before = g(s.root, 'for-each-ref', '--format=%(refname) %(objectname)');
  const { spawn, calls } = makeSpawn();
  const r = startDev(s, spawn);
  assert.equal(r.started, false);
  assert.equal(r.reason, 'no-base-setting');
  assert.equal(
    r.message,
    'pir: no base branch is set for proj. Add .pir/settings.json with {"baseBranch": "<branch>"} (committed, for everyone), or ~/.pir/proj/settings.json (this machine only).',
  );
  assert.equal(calls.length, 0, 'no process spawned');
  assert.equal(g(s.root, 'for-each-ref', '--format=%(refname) %(objectname)'), before, 'no branch created or moved');
  assert.equal(listRecords({ dir: indexDir({ env: s.env }) }).length, 0, 'no index record');
});

test('an unreachable remote on a fresh start: refused fetch-failed, no pir/{slug}, nothing spawned', (t) => {
  const s = devWorld(t);
  rmSync(s.remote, { recursive: true, force: true });
  const { spawn, calls } = makeSpawn();
  const r = startDev(s, spawn);
  assert.equal(r.reason, 'fetch-failed');
  assert.match(r.message, /^pir: could not fetch dev from origin: .*Nothing was created; try again when origin is reachable\.$/);
  assert.equal(calls.length, 0);
  assert.equal(pirBaseOf(s.root), null);
  assert.throws(() => gi(s.root, 'rev-parse', '--verify', '--quiet', 'refs/heads/pir/demo'), 'no feature branch cut');
});

test('resumeRun of a work record keeps its base, whatever the settings say now', (t) => {
  const s = devWorld(t);
  const { spawn } = makeSpawn();
  assert.equal(startDev(s, spawn).started, true);
  writeFileSync(join(s.root, '.pir', 'settings.json'), JSON.stringify({ baseBranch: 'stage' }));
  const [rec] = listRecords({ dir: indexDir({ env: s.env }) });
  const again = makeSpawn();
  const r = resumeRun({ ...rec, finalState: 'stopped' }, { spawn: again.spawn, exec: execAlive, kill: dead, fs: makeFs().fs, env: s.env });
  assert.deepEqual(r, { resumed: true, pid: CHILD_PID });
  assert.deepEqual(again.calls[0].args.slice(1), ['demo', '--base', 'dev']);
  assert.equal(pirBaseOf(s.root), 'dev');
});

test('resumeRun passes a base-branch refusal on with its message', (t) => {
  const s = devWorld(t, { settings: null });
  const rec = { version: 1, kind: 'work', slug: 'demo', repo: 'proj', repoPath: s.root, controlDir: join(s.root, 'plans', 'demo', '.parallel', 'control'),
    pid: 9001, startTime: LSTART, startedAt: '2026-09-29T00:00:00.000Z', branch: 'pir/demo', finalState: 'stopped', updatedAt: null };
  const r = resumeRun(rec, { spawn: makeSpawn().spawn, exec: execAlive, kill: dead, fs: makeFs().fs, env: s.env });
  assert.equal(r.resumed, false);
  assert.equal(r.reason, 'no-base-setting');
  assert.match(r.message, /no base branch is set for proj/);
});

// ---- Single runs (single-runs T05, DESIGN §2.3, §2.11) ----
//
// Real git in a scratch repo, a scratch $PIR_HOME, an injected spawn: no single program and no caffeinate
// is ever started. The repo's committed settings name the base and both command lists unless a test
// rewrites them.

const COMMANDS = { setup: ['npm ci'], test: ['npm test', 'npm run lint'] };

// Rewrite the scratch repo's own settings file in the working tree (it is read from there, not from a
// commit) and return the scratch.
function repoSettings(s, settings) {
  writeFileSync(join(s.root, '.pir', 'settings.json'), JSON.stringify(settings));
  return s;
}

function singleRepo(t, opts = {}) {
  return repoSettings(gitRepo(t, opts), { baseBranch: opts.branch ?? 'main', ...COMMANDS });
}

function userSettings(s, settings) {
  const dir = join(s.home, '.pir', basename(s.root));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'settings.json'), typeof settings === 'string' ? settings : JSON.stringify(settings));
}

const startSingle = (s, prompt, extra = {}) => {
  const { spawn, calls, unrefs } = makeSpawn();
  const r = startSingleRun(prompt, { cwd: s.root, spawn, exec: execAlive, env: s.env, now: fixedNow, random: seq('3f9a'), ...extra });
  return { r, calls, unrefs };
};

for (const [label, arrange, reason, check = () => {}] of [
  ['outside a git repo', (s) => ({ cwd: s.base }), 'not-a-repo'],
  ['no base branch set', (s) => { repoSettings(s, COMMANDS); return {}; }, 'no-base-setting', (r) => assert.match(r.message, /^pir: no base branch is set for proj\./)],
  ['a base branch that does not exist', (s) => { repoSettings(s, { baseBranch: 'dev', ...COMMANDS }); return {}; }, 'no-base-branch', (r) => assert.match(r.message, /^pir: the base branch dev /)],
  ['a settings file that is not JSON', (s) => { writeFileSync(join(s.root, '.pir', 'settings.json'), '{oops'); return {}; }, 'bad-settings', (r) => assert.match(r.message, /\.pir\/settings\.json.*not valid JSON/)],
  ['a test key of the wrong shape, though the user file has a good one', (s) => {
    repoSettings(s, { baseBranch: 'main', setup: [], test: 'npm test' });
    userSettings(s, { test: ['npm test'] });
    return {};
  }, 'bad-settings', (r) => assert.match(r.message, /\.pir\/settings\.json.*"test" must be a non-empty list of commands/)],
  ['a user file with an empty test list', (s) => { userSettings(s, { test: [] }); return {}; }, 'bad-settings', (r, s) => assert.ok(r.message.includes(join(s.home, '.pir', 'proj', 'settings.json')), r.message)],
  ['no commands in either file', (s) => { repoSettings(s, { baseBranch: 'main' }); return {}; }, 'no-commands', (r, s) => assert.equal(
    r.message,
    `proj has no setup/test commands for a single run. Add to .pir/settings.json (or ${join(s.home, '.pir', 'proj', 'settings.json')}): "setup": ["<install command>"], "test": ["<test command>"]`,
  )],
  ['setup set but no test', (s) => { repoSettings(s, { baseBranch: 'main', setup: [] }); return {}; }, 'no-commands', (r) => assert.match(r.message, /^proj has no test commands for a single run\. Add to \.pir\/settings\.json \(or .+\): "test": \["<test command>"\]$/)],
  ['an empty prompt', () => ({ prompt: ' \n\t ' }), 'empty-prompt'],
  ['a prompt that is not text', () => ({ prompt: null }), 'empty-prompt'],
]) {
  test(`startSingleRun refuses ${label} → ${reason}, nothing created`, (t) => {
    const s = singleRepo(t);
    const extra = arrange(s);
    const before = footprint(s);
    const { r, calls } = startSingle(s, 'prompt' in extra ? extra.prompt : 'fix the typo', extra.cwd ? { cwd: extra.cwd } : {});
    assert.equal(r.started, false);
    assert.equal(r.reason, reason);
    check(r, s);
    assert.equal(calls.length, 0, 'nothing spawned');
    assert.deepEqual(footprint(s), before, 'no branch, worktree, folder or index entry');
  });
}

test('startSingleRun refusal order: repo, then base, then settings, then commands, then the prompt (§2.3)', (t) => {
  const s = gitRepo(t, { base: null });
  mkdirSync(join(s.root, '.pir'));
  const before = footprint(s);
  const reasonOf = (cwd = s.root) => startSingleRun('', { cwd, spawn: makeSpawn().spawn, env: s.env }).reason;
  // Everything is wrong at once: no repo at cwd, no settings, no commands, no prompt.
  assert.equal(reasonOf(s.base), 'not-a-repo');
  assert.equal(reasonOf(), 'no-base-setting');
  repoSettings(s, { baseBranch: 'dev' });
  assert.equal(reasonOf(), 'no-base-branch');
  repoSettings(s, { baseBranch: 'main' });
  assert.equal(reasonOf(), 'no-commands');
  repoSettings(s, { baseBranch: 'main', ...COMMANDS });
  assert.equal(reasonOf(), 'empty-prompt');
  assert.deepEqual(footprint(s), before);
});

test('startSingleRun: a settings file broken after the pre-flight read it still refuses bad-settings, nothing created', (t) => {
  const s = singleRepo(t);
  const before = footprint(s);
  const sha = g(s.root, 'rev-parse', 'main').trim();
  // The base resolved from a good file; the file is broken by the time the commands are read.
  const prepareBase = () => {
    repoSettings(s, { baseBranch: 'main', setup: 'npm ci', test: ['npm test'] });
    return { ok: true, sha, remote: null };
  };
  const { r, calls } = startSingle(s, 'a change', { prepareBase });
  assert.deepEqual(r, { started: false, reason: 'bad-settings', message: '.pir/settings.json: "setup" must be a list of commands' });
  assert.equal(calls.length, 0);
  assert.deepEqual(footprint(s), before);
});

test('startSingleRun: a clean start creates branch, worktree, control folder, index record, and spawns', (t) => {
  const s = singleRepo(t);
  const mainHead = g(s.root, 'rev-parse', 'HEAD').trim();
  const prompt = 'Fix the typo in the README heading\n\nIt says "teh".';
  const { r, calls, unrefs } = startSingle(s, prompt);

  assert.equal(r.started, true);
  assert.equal(r.runId, 'single-3f9a');
  assert.equal(r.pid, CHILD_PID);

  // Branch cut from the base commit, in its own worktree; the person's checkout stays on main.
  assert.equal(g(s.root, 'rev-parse', 'pir/single-3f9a').trim(), mainHead);
  const wt = join(s.root, '.claude', 'worktrees', 'pir-single-3f9a');
  assert.equal(g(wt, 'symbolic-ref', '--short', 'HEAD').trim(), 'pir/single-3f9a');
  assert.equal(g(s.root, 'symbolic-ref', '--short', 'HEAD').trim(), 'main');
  assert.equal(g(s.root, 'config', '--get', 'branch.pir/single-3f9a.pirBase').trim(), 'main', 'pirBase recorded');

  // Control folder under plans/{runId}/.parallel/single, holding the prompt as sent and a fresh state.
  const controlDir = join(s.root, 'plans', 'single-3f9a', '.parallel', 'single');
  assert.equal(r.controlDir, controlDir);
  assert.equal(readFileSync(join(controlDir, 'prompt.md'), 'utf8'), prompt);
  const state = JSON.parse(readFileSync(join(controlDir, 'state.json'), 'utf8'));
  assert.deepEqual(state, initialSingleState({ id: 'single-3f9a', base: 'main', baseSha: mainHead, commands: COMMANDS }));
  assert.deepEqual(state.commands, COMMANDS, 'the commands are stored with the run');
  assert.ok(existsSync(join(controlDir, 'run.log')), 'run.log opened for the program output');
  assert.deepEqual(readdirSync(controlDir).filter((n) => n.endsWith('.tmp')), [], 'no temp left behind');

  // The single program, detached, with its control folder; PIR_RUN on, the caller's env carried.
  const prog = calls[0];
  assert.equal(prog.cmd, 'node');
  assert.equal(prog.args[0], singleRunPath());
  assert.ok(singleRunPath().endsWith(join('src', 'shell', 'single-run.mjs')), singleRunPath());
  assert.deepEqual(prog.args.slice(1), ['--control', controlDir]);
  assert.equal(prog.opts.cwd, s.root);
  assert.equal(prog.opts.detached, true);
  assert.equal(prog.opts.stdio[0], 'ignore');
  assert.equal(typeof prog.opts.stdio[1], 'number');
  assert.equal(prog.opts.stdio[1], prog.opts.stdio[2], 'stdout and stderr share run.log');
  assert.equal(prog.opts.env.PIR_RUN, '1');
  assert.equal(prog.opts.env.KEEP, 'yes');
  assert.equal(prog.opts.env.PARALLEL_LIVE, undefined, 'a single run is not a live build');

  // Keep-awake tied to the program's pid.
  assert.equal(calls.length, 2);
  assert.equal(calls[1].cmd, 'caffeinate');
  assert.deepEqual(calls[1].args, ['-i', '-w', String(CHILD_PID)]);
  assert.equal(calls[1].opts.detached, true);
  assert.equal(unrefs(), 2);

  // Index record kind 'single', keyed by run id, labelled from the prompt's first line.
  const dir = join(s.home, '.pir', 'runs');
  const records = listRecords({ dir });
  assert.equal(records.length, 1);
  assert.ok(existsSync(recordPath('proj', 'single-3f9a', { dir })));
  assert.deepEqual(records[0], {
    version: 1,
    kind: 'single',
    label: 'Fix the typo in the REA…',
    go: null,
    slug: 'single-3f9a',
    repo: 'proj',
    repoPath: s.root,
    controlDir,
    pid: CHILD_PID,
    startTime: LSTART,
    startedAt: '2026-09-22T08:27:37.000Z',
    branch: 'pir/single-3f9a',
    baseBranch: 'main',
    finalState: null,
    updatedAt: null,
  });
  assert.deepEqual(r.record, records[0]);

  // Nothing tracked changed in the person's checkout.
  assert.equal(g(s.root, 'status', '--porcelain', '--untracked-files=no'), ' M .pir/settings.json\n', 'only the settings this test rewrote');
});

test('startSingleRun: commands merge key by key, the user file winning, and the base is the remote newest commit', (t) => {
  const s = singleRepo(t, { branch: 'dev' });
  const bare = addBareRemote(s);
  g(s.root, 'push', '-q', 'origin', 'dev');
  const ahead = pushAhead(s, bare, 'dev');
  userSettings(s, { test: ['make check'], setup: [] });

  const { r } = startSingle(s, 'a change', { random: seq('d0d0') });
  assert.equal(r.started, true);
  assert.equal(g(s.root, 'rev-parse', 'pir/single-d0d0').trim(), ahead, 'cut from the commit the pre-flight chose');
  const state = JSON.parse(readFileSync(join(r.controlDir, 'state.json'), 'utf8'));
  assert.deepEqual(state.commands, { setup: [], test: ['make check'] });
  assert.deepEqual([state.base, state.baseSha], ['dev', ahead]);
  assert.equal(r.record.baseBranch, 'dev');
});

test('startSingleRun from a linked worktree: root is the main worktree', (t) => {
  const s = singleRepo(t);
  const linked = join(s.base, 'linked');
  g(s.root, 'worktree', 'add', '-q', '-b', 'side', linked);
  const { r, calls } = startSingle(s, 'a change', { cwd: linked });
  assert.equal(r.record.repoPath, s.root);
  assert.equal(r.controlDir, join(s.root, 'plans', 'single-3f9a', '.parallel', 'single'));
  assert.equal(calls[0].opts.cwd, s.root);
});

test('startSingleRun: a run id taken by a branch, an index entry or a plans/ folder is drawn again', (t) => {
  const s = singleRepo(t);
  const dir = join(s.home, '.pir', 'runs');
  g(s.root, 'branch', 'pir/single-0001');
  writeRecord({ version: 1, kind: 'single', slug: 'single-0002', repo: 'proj', repoPath: s.root, controlDir: '/x', pid: 1, startTime: LSTART, branch: 'pir/single-0002' }, { dir });
  mkdirSync(join(s.root, 'plans', 'single-0003'), { recursive: true });
  // A planning run's id does not take a single run's: the two are different names.
  g(s.root, 'branch', 'pir/plan-0004');

  const drawn = [];
  const random = () => {
    const v = ['0001', '0002', '0003', '0004'][drawn.length];
    drawn.push(v);
    return v;
  };
  const { r } = startSingle(s, 'a change', { random });
  assert.equal(r.runId, 'single-0004');
  assert.deepEqual(drawn, ['0001', '0002', '0003', '0004']);
  // The taken ones were left exactly as they were.
  assert.equal(g(s.root, 'rev-parse', 'pir/single-0001').trim(), g(s.root, 'rev-parse', 'main').trim());
  assert.equal(listRecords({ dir }).find((x) => x.slug === 'single-0002').controlDir, '/x');
  assert.deepEqual(readdirSync(join(s.root, 'plans', 'single-0003')), []);
});

test('startSingleRun: a random source that never yields a free id throws rather than loop', (t) => {
  const s = singleRepo(t);
  g(s.root, 'branch', 'pir/single-0001');
  assert.throws(() => startSingle(s, 'a change', { random: seq('0001') }), /startSingleRun: no free run id after 64 tries/);
});

function singleRecord(s, overrides = {}) {
  return planRecord(s, {
    kind: 'single',
    label: 'fix the typo',
    slug: 'fix-typo',
    branch: 'pir/fix-typo',
    baseBranch: 'main',
    controlDir: join(s.root, 'plans', 'fix-typo', '.parallel', 'single'),
    ...overrides,
  });
}

test('resumeRun on a single record: single-run.mjs --resume on its control folder; finalState cleared', (t) => {
  const s = gitRepo(t);
  const dir = join(s.home, '.pir', 'runs');
  // stopped, and crashed (no final status, the process gone).
  for (const finalState of ['stopped', null]) {
    const rec = singleRecord(s, { finalState });
    writeRecord(rec, { dir });
    const { spawn, calls } = makeSpawn();
    const r = resumeRun(rec, { spawn, exec: execAlive, kill: dead, env: s.env });
    assert.deepEqual(r, { resumed: true, pid: CHILD_PID }, `from finalState ${finalState}`);
    assert.equal(calls[0].cmd, 'node');
    assert.deepEqual(calls[0].args, [singleRunPath(), '--control', rec.controlDir, '--resume']);
    assert.equal(calls[0].opts.cwd, s.root);
    assert.equal(calls[0].opts.detached, true);
    assert.equal(calls[0].opts.env.PIR_RUN, '1');
    assert.equal(calls[0].opts.env.PARALLEL_LIVE, undefined);
    assert.ok(existsSync(join(rec.controlDir, 'run.log')));
    assert.equal(calls[1].cmd, 'caffeinate');
    assert.deepEqual(calls[1].args, ['-i', '-w', String(CHILD_PID)]);
    assert.equal(calls.length, 2);

    const after = listRecords({ dir });
    assert.equal(after.length, 1);
    assert.deepEqual(after[0], { ...rec, pid: CHILD_PID, startTime: LSTART, finalState: null, updatedAt: null });
  }
});

test('resumeRun on a running single record refuses already-running, nothing spawned', (t) => {
  const s = gitRepo(t);
  const rec = singleRecord(s, { finalState: null, startTime: LSTART });
  const { spawn, calls } = makeSpawn();
  assert.deepEqual(resumeRun(rec, { spawn, exec: execAlive, kill: () => {}, env: s.env }), { resumed: false, reason: 'already-running' });
  assert.equal(calls.length, 0);
});
