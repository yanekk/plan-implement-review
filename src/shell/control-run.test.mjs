import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { stopRun, removeRun } from './control-run.mjs';
import { writeRecord, listRecords, recordPath } from './index-store.mjs';
import { snapshotPath } from './snapshot-store.mjs';
import { workerName } from '../core/naming.mjs';

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

// A record carries only what stop reads: the pid to signal, and the repo+slug that name this run's
// workers. The rest of the index-record fields are irrelevant to stop and left off.
function stopRecord(overrides = {}) {
  return { pid: 4242, repo: 'myrepo', slug: 'myplan', ...overrides };
}

// A platform whose every method throws — passed where stop must never touch it (the clean paths), so a
// stray reap on a non-escalated stop fails loudly rather than passing silently.
const explodingPlatform = {
  list: () => {
    throw new Error('platform.list must not be called on a clean stop');
  },
  close: () => {
    throw new Error('platform.close must not be called on a clean stop');
  },
};

test('stop: coordinator exits within grace → one SIGTERM, no SIGKILL, escalated:false', async () => {
  // It dies 300 ms after SIGTERM — well inside the 4 s grace, after a few poll passes.
  const { proc, kill, now, sleep } = makeProcess({ termDeathAfterMs: 300 });

  const result = await stopRun(stopRecord(), { kill, now, sleep, platform: explodingPlatform });

  assert.deepEqual(result, { stopped: true, escalated: false });
  assert.deepEqual(proc.signals, ['SIGTERM'], 'exactly one SIGTERM, and no SIGKILL');
});

test('stop: coordinator still alive after grace → SIGKILL + workers reaped, escalated:true', async () => {
  const { proc, kill, now, sleep } = makeProcess({ termDeathAfterMs: null }); // never dies on TERM
  const closed = [];
  const worker = workerName({ repo: 'myrepo', plan: 'myplan', task: 'T01', slug: 'foo', role: 'implement' });
  const platform = {
    list: () => [{ id: 'sess-1', name: worker }],
    close: (id) => {
      closed.push(id);
      return { ok: true };
    },
  };

  const result = await stopRun(stopRecord(), { kill, now, sleep, platform });

  assert.deepEqual(result, { stopped: true, escalated: true });
  assert.deepEqual(proc.signals, ['SIGTERM', 'SIGKILL'], 'TERM first, then KILL after the grace');
  assert.deepEqual(closed, ['sess-1'], 'the run’s worker was closed');
});

test('stop on a coordinator already gone → no signal, stopped (idempotent)', async () => {
  const { proc, kill, now, sleep } = makeProcess({ startDead: true });

  const result = await stopRun(stopRecord(), { kill, now, sleep, platform: explodingPlatform });

  assert.deepEqual(result, { stopped: true, escalated: false });
  assert.deepEqual(proc.signals, [], 'a dead pid is never signalled');
});

test('stop never removes worktrees — only sessions are closed, on the escalated path', async () => {
  const { kill, now, sleep } = makeProcess({ termDeathAfterMs: null });
  const worker = workerName({ repo: 'myrepo', plan: 'myplan', task: 'T01', slug: 'foo', role: 'review' });
  let worktreeRemovals = 0;
  let sessionRemovals = 0;
  const platform = {
    list: () => [{ id: 'sess-1', name: worker }],
    close: () => ({ ok: true }),
    // The two teardown surfaces stop must never reach: a worktree removal, and the claude-agents
    // record removal (`platform.remove`). Step 3 closes sessions and nothing else (§2.6).
    removeWorktree: () => {
      worktreeRemovals += 1;
    },
    remove: () => {
      sessionRemovals += 1;
    },
  };

  const result = await stopRun(stopRecord(), { kill, now, sleep, platform });

  assert.equal(result.escalated, true);
  assert.equal(worktreeRemovals, 0, 'no worktree is ever torn down by a stop');
  assert.equal(sessionRemovals, 0, 'stop closes sessions, it does not remove their agent records');
});

test('escalated reap closes only THIS run’s workers, not another plan’s or a foreign agent', async () => {
  const { kill, now, sleep } = makeProcess({ termDeathAfterMs: null });
  const closed = [];
  const mineImpl = workerName({ repo: 'myrepo', plan: 'myplan', task: 'T01', slug: 'a', role: 'implement' });
  const mineRev = workerName({ repo: 'myrepo', plan: 'myplan', task: 'T02', slug: 'b', role: 'review' });
  // Same repo, different plan — shares the git dir and so appears in the same list, but is not ours.
  const sibling = workerName({ repo: 'myrepo', plan: 'otherplan', task: 'T01', slug: 'c', role: 'implement' });
  const foreign = 'some unrelated agent';
  const platform = {
    list: () => [
      { id: 'mine-1', name: mineImpl },
      { id: 'sibling-1', name: sibling },
      { id: 'foreign-1', name: foreign },
      { id: 'mine-2', name: mineRev },
    ],
    close: (id) => {
      closed.push(id);
      return { ok: true };
    },
  };

  const result = await stopRun(stopRecord(), { kill, now, sleep, platform });

  assert.equal(result.escalated, true);
  assert.deepEqual(closed.sort(), ['mine-1', 'mine-2'], 'only this run’s two workers are reaped');
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
