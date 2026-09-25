import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  rmSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { stopRun, removeRun } from './control-run.mjs';
import { writeRecord, listRecords, recordPath } from './index-store.mjs';
import { snapshotPath } from './snapshot-store.mjs';
import { reapRecorded } from './reap.mjs';

// --- stopRun: a fake coordinator process the timeline is driven against -------------------------
//
// A `kill` that models one process plus a fake clock the injected now/sleep share, so a whole grace
// period plays out in microseconds. sig 0 is the aliveness probe (throws ESRCH when dead, like the
// kernel); SIGTERM optionally schedules death `termDeathAfterMs` into the future (a coordinator that
// shuts down after its own cleanup); SIGKILL is immediate and unconditional. `startDead` models a
// coordinator that already exited before stop was ever called.
function esrch() {
  const e = new Error('ESRCH');
  e.code = 'ESRCH';
  throw e;
}

function makeProcess({ termDeathAfterMs = null, startDead = false } = {}) {
  const clock = { t: 0 };
  const proc = { signals: [], hardKilled: startDead, termDeathAt: null };
  const dead = () => proc.hardKilled || (proc.termDeathAt != null && clock.t >= proc.termDeathAt);
  const kill = (pid, sig) => {
    if (sig === 0) {
      if (dead()) esrch();
      return;
    }
    proc.signals.push(sig);
    if (sig === 'SIGKILL') proc.hardKilled = true;
    if (sig === 'SIGTERM' && termDeathAfterMs != null) proc.termDeathAt = clock.t + termDeathAfterMs;
  };
  return {
    proc,
    kill,
    now: () => clock.t,
    sleep: async (ms) => {
      clock.t += ms;
    },
    clock,
  };
}

// A record carries only what stop reads: the pid to signal, and the control folder whose workers.json
// the reap reads. The rest of the index-record fields are irrelevant to stop and left off.
function stopRecord(overrides = {}) {
  return { pid: 4242, repo: 'myrepo', slug: 'myplan', controlDir: '/ctl', ...overrides };
}

// A reap that records when it ran, and whether the coordinator was already dead at that moment, so a
// test can prove stop reaps only after the coordinator is gone (DESIGN §2.12).
function spyReap(proc) {
  const calls = [];
  const reap = async (controlDir) => {
    calls.push({ controlDir, coordinatorSignals: [...proc.signals] });
    return { reaped: [], skipped: [] };
  };
  return { reap, calls };
}

test('stop: coordinator exits within grace → one SIGTERM, no SIGKILL, escalated:false, then the reap', async () => {
  // It dies 300 ms after SIGTERM — well inside the 4 s grace, after a few poll passes.
  const { proc, kill, now, sleep } = makeProcess({ termDeathAfterMs: 300 });
  const { reap, calls } = spyReap(proc);

  const result = await stopRun(stopRecord(), { kill, now, sleep, reap });

  assert.deepEqual(result, { stopped: true, escalated: false });
  assert.deepEqual(proc.signals, ['SIGTERM'], 'exactly one SIGTERM, and no SIGKILL');
  assert.deepEqual(calls, [{ controlDir: '/ctl', coordinatorSignals: ['SIGTERM'] }], 'workers.json reaped once, after the exit');
});

test('stop: coordinator still alive after grace → SIGKILL, then the recorded workers are reaped, escalated:true', async () => {
  const { proc, kill, now, sleep, clock } = makeProcess({ termDeathAfterMs: null }); // never dies on TERM
  const { reap, calls } = spyReap(proc);

  const result = await stopRun(stopRecord(), { kill, now, sleep, reap });

  assert.deepEqual(result, { stopped: true, escalated: true });
  assert.deepEqual(proc.signals, ['SIGTERM', 'SIGKILL'], 'TERM first, then KILL after the grace');
  assert.ok(clock.t >= 4000, 'the SIGKILL waited out the 4 s grace');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].coordinatorSignals, ['SIGTERM', 'SIGKILL'], 'the reap ran after the coordinator was killed');
});

test('stop on a coordinator already gone → no signal, stopped, and its orphans are still reaped', async () => {
  const { proc, kill, now, sleep } = makeProcess({ startDead: true });
  const { reap, calls } = spyReap(proc);

  const result = await stopRun(stopRecord(), { kill, now, sleep, reap });

  assert.deepEqual(result, { stopped: true, escalated: false });
  assert.deepEqual(proc.signals, [], 'a dead pid is never signalled');
  assert.equal(calls.length, 1, 'a crashed coordinator leaves workers.json behind; stop reaps it');
});

test('stop with the default reap reads workers.json: a matching live worker is killed, the coordinator first', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pir-stop-'));
  try {
    // One process table on one clock: the coordinator (4242) ignores SIGTERM, worker 777 leaves on it,
    // and worker 888 is alive but was recorded with no start time, so it can never be verified and is
    // never signalled.
    const clock = { t: 0 };
    const signals = [];
    const dead = new Set();
    const kill = (pid, sig) => {
      if (sig === 0) {
        if (dead.has(pid)) esrch();
        return;
      }
      signals.push([pid, sig]);
      if (sig === 'SIGKILL' || pid === 777) dead.add(pid);
    };
    writeFileSync(
      join(dir, 'workers.json'),
      JSON.stringify([
        { id: 'a', task: 'T01', role: 'implement', pid: 777, startTime: 'launch-777' },
        { id: 'b', task: 'T02', role: 'review', pid: 888, startTime: null },
      ]),
    );
    const result = await stopRun(stopRecord({ controlDir: dir }), {
      kill,
      now: () => clock.t,
      sleep: async (ms) => {
        clock.t += ms;
      },
      reap: (controlDir) =>
        reapRecorded(controlDir, {
          kill,
          startTimeOf: (pid) => `launch-${pid}`,
          now: () => clock.t,
          wait: async (ms) => {
            clock.t += ms;
          },
        }),
    });
    assert.equal(result.escalated, true);
    assert.deepEqual(signals, [
      [4242, 'SIGTERM'],
      [4242, 'SIGKILL'],
      [777, 'SIGTERM'],
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('stop without a control folder skips the reap and still stops', async () => {
  const { kill, now, sleep } = makeProcess({ termDeathAfterMs: 0 });
  const result = await stopRun(stopRecord({ controlDir: undefined }), {
    kill,
    now,
    sleep,
    reap: () => {
      throw new Error('no control folder, nothing to reap');
    },
  });
  assert.deepEqual(result, { stopped: true, escalated: false });
});

test('the stop path lists no `claude agents` session: control-run.mjs has no platform', () => {
  const src = readFileSync(new URL('./control-run.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /platform|claude agents|isWorkerOf/);
});

// --- removeRun: real scratch dirs, proving the plan is never touched ----------------------------
//
// A full valid index record (runrecord.mjs format) so writeRecord/listRecords round-trip it; the repo
// and slug pick the index filename and the worker names, controlDir is where the snapshot lives.
function makeRecord(controlDir, overrides = {}) {
  return {
    version: 1,
    slug: 'demo',
    repo: 'plan-implement-review',
    repoPath: '/Users/x/src/pir',
    controlDir,
    pid: 4242,
    startTime: 'Tue Sep 22 08:27:37 2026',
    startedAt: '2026-09-22T08:27:37.000Z',
    branch: 'pir/demo',
    finalState: 'finished',
    updatedAt: '2026-09-22T08:30:00.000Z',
    ...overrides,
  };
}

// Stands up a run's on-disk world: a scratch index dir, and a scratch plan folder with real plan
// documents plus a control folder holding a status.json. Returns everything a removeRun test needs.
function scaffold() {
  const home = mkdtempSync(join(tmpdir(), 'pir-home-'));
  const repoRoot = mkdtempSync(join(tmpdir(), 'pir-repo-'));
  const runsDir = join(home, '.pir', 'runs');
  const planDir = join(repoRoot, 'plans', 'demo');
  const controlDir = join(planDir, '.parallel', 'control');
  mkdirSync(controlDir, { recursive: true });
  mkdirSync(join(planDir, 'tasks'), { recursive: true });
  // The plan documents remove must never touch.
  const planFiles = ['PLAN.md', 'PROGRESS.md', 'FINDINGS.md', 'DESIGN.md'];
  for (const f of planFiles) writeFileSync(join(planDir, f), `# ${f}\n`);
  writeFileSync(join(planDir, 'tasks', 'T01-demo.md'), '# T01\n');
  // The live snapshot remove is meant to delete.
  writeFileSync(snapshotPath(controlDir), '{}');

  const record = makeRecord(controlDir);
  writeRecord(record, { dir: runsDir });

  return { home, repoRoot, runsDir, planDir, controlDir, record, planFiles };
}

function cleanup(...dirs) {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

test('remove deletes the index entry and the snapshot, and returns removed', () => {
  const s = scaffold();
  try {
    assert.ok(existsSync(recordPath(s.record.repo, s.record.slug, { dir: s.runsDir })), 'entry present first');
    assert.ok(existsSync(snapshotPath(s.controlDir)), 'snapshot present first');

    const result = removeRun(s.record, { dir: s.runsDir });

    assert.deepEqual(result, { removed: true });
    assert.equal(listRecords({ dir: s.runsDir }).length, 0, 'the index entry is gone');
    assert.ok(!existsSync(snapshotPath(s.controlDir)), 'the snapshot is gone');
  } finally {
    cleanup(s.home, s.repoRoot);
  }
});

test('remove leaves the plan documents under plans/{slug}/ untouched', () => {
  const s = scaffold();
  try {
    removeRun(s.record, { dir: s.runsDir });

    for (const f of s.planFiles) {
      assert.ok(existsSync(join(s.planDir, f)), `${f} still present after remove`);
    }
    assert.ok(existsSync(join(s.planDir, 'tasks', 'T01-demo.md')), 'the task doc still present');
  } finally {
    cleanup(s.home, s.repoRoot);
  }
});

test('remove tolerates an absent snapshot (a run that never wrote one)', () => {
  const s = scaffold();
  try {
    rmSync(snapshotPath(s.controlDir)); // the run stopped before its first coordinator pass
    assert.doesNotThrow(() => removeRun(s.record, { dir: s.runsDir }));
    assert.equal(listRecords({ dir: s.runsDir }).length, 0, 'the entry is still cleared');
  } finally {
    cleanup(s.home, s.repoRoot);
  }
});

test('remove of an already-removed run does not throw and returns removed (idempotent)', () => {
  const s = scaffold();
  try {
    removeRun(s.record, { dir: s.runsDir });
    let result;
    assert.doesNotThrow(() => {
      result = removeRun(s.record, { dir: s.runsDir });
    });
    assert.deepEqual(result, { removed: true });
  } finally {
    cleanup(s.home, s.repoRoot);
  }
});

test('remove deletes conversations/ and leaves every other file in the control folder alone', () => {
  const s = scaffold();
  try {
    const conv = join(s.controlDir, 'conversations');
    mkdirSync(conv, { recursive: true });
    writeFileSync(join(conv, 'T01-implement-1.ndjson'), '{}\n');
    writeFileSync(join(conv, 'T01-review-1.ndjson'), '{}\n');
    for (const f of ['log', 'workers.json', 'HALT']) writeFileSync(join(s.controlDir, f), 'keep');
    mkdirSync(join(s.controlDir, 'reports'));
    writeFileSync(join(s.controlDir, 'reports', '1.json'), '{}');

    removeRun(s.record, { dir: s.runsDir });

    assert.ok(!existsSync(conv), 'the conversations folder is gone');
    assert.deepEqual(readdirSync(s.controlDir).sort(), ['HALT', 'log', 'reports', 'workers.json']);
    for (const f of ['log', 'workers.json', 'HALT']) assert.equal(readFileSync(join(s.controlDir, f), 'utf8'), 'keep');
    assert.deepEqual(readdirSync(join(s.controlDir, 'reports')), ['1.json']);
  } finally {
    cleanup(s.home, s.repoRoot);
  }
});
