import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { indexDir, recordPath, listRecords, writeRecord, removeRecord } from './index-store.mjs';

// A scratch index directory under the OS temp dir, cleaned up after each test. Nothing here writes to
// the real ~/.pir: every call passes { dir } explicitly, and the indexDir tests pass a fake env.
function scratchDir() {
  return mkdtempSync(join(tmpdir(), 'pir-index-'));
}

// A minimal valid record in the T02 format (runrecord.mjs REQUIRED_STRINGS + pid). Overrides let a
// test vary the repo/slug so two runs land in two files.
function makeRecord(overrides = {}) {
  return {
    version: 1,
    slug: 'demo',
    repo: 'plan-implement-review',
    repoPath: '/Users/x/src/pir',
    controlDir: '/Users/x/src/pir/plans/demo/.parallel/control',
    pid: 4242,
    startTime: 'Tue Sep 22 08:27:37 2026',
    startedAt: '2026-09-22T08:27:37.000Z',
    branch: 'pir/demo',
    finalState: null,
    updatedAt: '2026-09-22T08:30:00.000Z',
    ...overrides,
  };
}

test('writeRecord then listRecords returns the record, at recordPath', () => {
  const dir = scratchDir();
  try {
    const record = makeRecord();
    writeRecord(record, { dir });

    const path = recordPath(record.repo, record.slug, { dir });
    assert.equal(path, join(dir, 'plan-implement-review__demo.json'));
    assert.ok(existsSync(path), 'the entry file exists at recordPath');

    const listed = listRecords({ dir });
    assert.equal(listed.length, 1);
    assert.deepEqual(listed[0], record);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeRecord of an existing repo+slug overwrites in place (one entry per run)', () => {
  const dir = scratchDir();
  try {
    writeRecord(makeRecord({ pid: 100 }), { dir });
    writeRecord(makeRecord({ pid: 200, finalState: 'finished' }), { dir });

    const listed = listRecords({ dir });
    assert.equal(listed.length, 1, 'still one file for the one run');
    assert.equal(listed[0].pid, 200);
    assert.equal(listed[0].finalState, 'finished');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('two different runs are two entries and never collide', () => {
  const dir = scratchDir();
  try {
    // Same slug, different repos: the {repo}__{slug} filename keeps them apart (DESIGN §2.8).
    writeRecord(makeRecord({ repo: 'alpha', slug: 'shared' }), { dir });
    writeRecord(makeRecord({ repo: 'beta', slug: 'shared' }), { dir });

    const repos = listRecords({ dir }).map((r) => r.repo).sort();
    assert.deepEqual(repos, ['alpha', 'beta']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('listRecords skips a malformed file and returns the valid others', () => {
  const dir = scratchDir();
  try {
    writeRecord(makeRecord({ repo: 'good', slug: 'one' }), { dir });
    // A half-written / corrupt pointer: parseRecord returns null, so it drops itself (DESIGN §2.10).
    writeFileSync(join(dir, 'bad__two.json'), '{ this is not json');
    writeRecord(makeRecord({ repo: 'good', slug: 'three' }), { dir });

    const slugs = listRecords({ dir }).map((r) => r.slug).sort();
    assert.deepEqual(slugs, ['one', 'three']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('listRecords on an absent directory returns [] (no throw)', () => {
  const dir = join(tmpdir(), 'pir-index-does-not-exist-' + Math.random().toString(36).slice(2));
  assert.deepEqual(listRecords({ dir }), []);
});

test('removeRecord deletes the entry; a second remove does not throw', () => {
  const dir = scratchDir();
  try {
    const record = makeRecord();
    writeRecord(record, { dir });
    assert.equal(listRecords({ dir }).length, 1);

    removeRecord({ repo: record.repo, slug: record.slug }, { dir });
    assert.equal(listRecords({ dir }).length, 0, 'the entry is gone');
    assert.ok(!existsSync(recordPath(record.repo, record.slug, { dir })));

    // A second remove of the same run is a no-op, not an error (a stop then a remove of a run the
    // dashboard already cleared must not crash).
    assert.doesNotThrow(() => removeRecord({ repo: record.repo, slug: record.slug }, { dir }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('removeRecord of a run that was never indexed does not throw', () => {
  const dir = scratchDir();
  try {
    assert.doesNotThrow(() => removeRecord({ repo: 'never', slug: 'here' }, { dir }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the write is atomic: no temp file is left behind on success', () => {
  const dir = scratchDir();
  try {
    writeRecord(makeRecord(), { dir });
    const names = readdirSync(dir);
    assert.equal(names.length, 1, 'exactly one file');
    assert.ok(names[0].endsWith('.json'), 'and it is the .json entry, not a leftover .tmp');
    assert.ok(names.every((n) => !n.endsWith('.tmp')), 'no temp file remains');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('listRecords ignores a leftover .tmp file from an interrupted write', () => {
  const dir = scratchDir();
  try {
    writeRecord(makeRecord({ repo: 'good', slug: 'one' }), { dir });
    // Simulate a writer that crashed after creating the temp file but before the rename: its content
    // is a valid record, but the name is not `.json`, so the list must not pick it up.
    const record = makeRecord({ repo: 'good', slug: 'two' });
    const leftover = recordPath('good', 'two', { dir }) + '.9999-abc.tmp';
    writeFileSync(leftover, JSON.stringify(record));

    const slugs = listRecords({ dir }).map((r) => r.slug);
    assert.deepEqual(slugs, ['one'], 'the .tmp leftover is ignored');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeRecord creates the index directory if it does not exist', () => {
  const parent = scratchDir();
  try {
    // A nested dir that has never existed: the first run must mkdir -p it (DESIGN §3.5).
    const dir = join(parent, 'a', 'b', 'runs');
    writeRecord(makeRecord(), { dir });
    assert.equal(listRecords({ dir }).length, 1);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test('indexDir honours $PIR_HOME over $HOME', () => {
  assert.equal(
    indexDir({ env: { PIR_HOME: '/scratch/pir-home', HOME: '/Users/real' } }),
    join('/scratch/pir-home', '.pir', 'runs'),
  );
});

test('indexDir falls back to $HOME when $PIR_HOME is unset', () => {
  assert.equal(
    indexDir({ env: { HOME: '/Users/real' } }),
    join('/Users/real', '.pir', 'runs'),
  );
});

test('fs is injectable: writeRecord and listRecords go through the passed fs', () => {
  // A fake fs backed by a plain map, proving the module never reaches a bare node:fs import.
  const files = new Map();
  const dirs = new Set();
  const fs = {
    mkdirSync: (d) => dirs.add(d),
    writeFileSync: (p, data) => files.set(p, data),
    renameSync: (from, to) => {
      files.set(to, files.get(from));
      files.delete(from);
    },
    readdirSync: (d) => {
      const prefix = d.endsWith('/') ? d : d + '/';
      const out = [];
      for (const p of files.keys()) if (p.startsWith(prefix)) out.push(p.slice(prefix.length));
      return out;
    },
    readFileSync: (p) => {
      if (!files.has(p)) {
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      }
      return files.get(p);
    },
    unlinkSync: (p) => {
      if (!files.has(p)) {
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      }
      files.delete(p);
    },
  };

  const dir = '/virtual/runs';
  writeRecord(makeRecord(), { dir, fs });
  assert.ok(dirs.has(dir), 'the injected mkdir was called');

  const listed = listRecords({ dir, fs });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].slug, 'demo');

  removeRecord({ repo: 'plan-implement-review', slug: 'demo' }, { dir, fs });
  assert.equal(listRecords({ dir, fs }).length, 0);
});
