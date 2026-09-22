// T07 — the atomic write and tolerant read of status.json, exercised against real files in a
// throwaway temp dir (the seatbelt: never a real control folder). The format itself is T03's and
// tested there; here we prove the filesystem contract of DESIGN §2.10 and §3.5 — a reader never
// sees a torn file, an absent or malformed file reads as null, and a second write replaces the
// first in place.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { snapshotPath, writeSnapshot, readSnapshot } from './snapshot-store.mjs';

// A control dir under a fresh temp root. Returns both so a test can inspect the raw directory.
function scratchControlDir() {
  const root = mkdtempSync(join(tmpdir(), 'pir-snapshot-store-'));
  const controlDir = join(root, 'plans', 'demo', '.parallel', 'control');
  mkdirSync(controlDir, { recursive: true });
  return { root, controlDir };
}

// A canonical snapshot (version + finalState already normalised) so a round-trip through T03's
// serialize/parse deep-equals it. The runState is the minimal shape display.mjs consumes.
function sampleSnapshot() {
  return {
    version: 1,
    proc: {
      pid: 4242,
      startTime: 'Tue Sep 22 08:27:37 2026',
      slug: 'demo',
      repo: 'plan-implement-review',
      branch: 'pir/demo',
      startedAt: 1_700_000_000_000,
    },
    finalState: null,
    runState: {
      branch: 'pir/demo',
      ceiling: 6,
      tasks: [
        { id: 'T01', slug: 'run-state', deps: [], done: true, phase: 'done', since: 1_700_000_000_000 },
        { id: 'T02', slug: 'index-record', deps: [], done: false, phase: 'building', since: 1_700_000_050_000 },
      ],
    },
  };
}

test('writeSnapshot then readSnapshot round-trips a snapshot', () => {
  const { root, controlDir } = scratchControlDir();
  try {
    const snap = sampleSnapshot();
    writeSnapshot(controlDir, snap);
    assert.deepEqual(readSnapshot(controlDir), snap);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('readSnapshot of an absent file returns null', () => {
  const { root, controlDir } = scratchControlDir();
  try {
    assert.equal(readSnapshot(controlDir), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('readSnapshot of a malformed file returns null without throwing', () => {
  const { root, controlDir } = scratchControlDir();
  try {
    writeFileSync(snapshotPath(controlDir), '{ this is not json');
    assert.equal(readSnapshot(controlDir), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the write leaves no temp file behind on success', () => {
  const { root, controlDir } = scratchControlDir();
  try {
    writeSnapshot(controlDir, sampleSnapshot());
    const entries = readdirSync(controlDir);
    assert.deepEqual(entries, ['status.json']);
    assert.ok(!entries.some((e) => e.endsWith('.tmp')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a second writeSnapshot replaces the first in place', () => {
  const { root, controlDir } = scratchControlDir();
  try {
    writeSnapshot(controlDir, sampleSnapshot());

    const second = sampleSnapshot();
    second.finalState = 'finished';
    second.runState.ceiling = 99;
    writeSnapshot(controlDir, second);

    // Exactly one live snapshot per run, and it is the second.
    assert.deepEqual(readdirSync(controlDir), ['status.json']);
    assert.deepEqual(readSnapshot(controlDir), second);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the file lands at snapshotPath(controlDir)', () => {
  const { root, controlDir } = scratchControlDir();
  try {
    writeSnapshot(controlDir, sampleSnapshot());
    assert.ok(existsSync(snapshotPath(controlDir)));
    assert.equal(snapshotPath(controlDir), join(controlDir, 'status.json'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('writeSnapshot creates the control folder if it is absent', () => {
  const root = mkdtempSync(join(tmpdir(), 'pir-snapshot-store-'));
  const controlDir = join(root, 'plans', 'fresh', '.parallel', 'control'); // never created
  try {
    assert.ok(!existsSync(controlDir));
    writeSnapshot(controlDir, sampleSnapshot());
    assert.deepEqual(readSnapshot(controlDir), sampleSnapshot());
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
