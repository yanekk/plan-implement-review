// T04 — the shared temp-then-rename writer behind writeRecord, writeSnapshot and writeWorkersFile.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import * as nodeFs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileAtomic, writeJsonAtomic } from './atomic-write.mjs';

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'pir-atomic-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('the whole text goes to a .tmp beside the target, then is renamed over it', (t) => {
  const dir = scratch(t);
  const target = join(dir, 'a', 'file.json');
  const calls = [];
  const fs = {
    mkdirSync: (...a) => (calls.push(['mkdir', a[0]]), nodeFs.mkdirSync(...a)),
    writeFileSync: (p, text) => (calls.push(['write', p, text]), nodeFs.writeFileSync(p, text)),
    renameSync: (from, to) => (calls.push(['rename', from, to]), nodeFs.renameSync(from, to)),
  };
  writeFileAtomic(target, 'whole', { fs });
  assert.equal(calls[0][0], 'mkdir');
  assert.equal(calls[1][0], 'write');
  const temp = calls[1][1];
  assert.ok(temp.startsWith(target + '.') && temp.endsWith('.tmp'), temp);
  assert.equal(calls[1][2], 'whole');
  assert.deepEqual(calls[2], ['rename', temp, target]);
  assert.equal(readFileSync(target, 'utf8'), 'whole');
  assert.deepEqual(readdirSync(join(dir, 'a')), ['file.json']);
});

test('a write that fails before the rename leaves the old file whole', (t) => {
  const dir = scratch(t);
  const target = join(dir, 'file.json');
  writeJsonAtomic(target, { v: 1 });
  const fs = { ...nodeFs, renameSync: () => { throw new Error('crash before rename'); } };
  assert.throws(() => writeJsonAtomic(target, { v: 2 }, { fs }));
  assert.deepEqual(JSON.parse(readFileSync(target, 'utf8')), { v: 1 });
});

test('a fixed tempPath is used as given', (t) => {
  const dir = scratch(t);
  const target = join(dir, 'status.json');
  const tempPath = join(dir, '.status.json.tmp');
  let wrote;
  const fs = { ...nodeFs, writeFileSync: (p, x) => ((wrote = p), nodeFs.writeFileSync(p, x)) };
  writeFileAtomic(target, 'x', { fs, tempPath });
  assert.equal(wrote, tempPath);
  assert.deepEqual(readdirSync(dir), ['status.json']);
});

test('mode is applied to the temp file before the rename, and the target keeps it', (t) => {
  const dir = scratch(t);
  const target = join(dir, 'secret.json');
  let modeAtRename;
  const fs = {
    ...nodeFs,
    renameSync: (from, to) => {
      modeAtRename = nodeFs.statSync(from).mode & 0o777;
      nodeFs.renameSync(from, to);
    },
  };
  writeFileAtomic(target, 'x', { fs, mode: 0o600 });
  assert.equal(modeAtRename, 0o600);
  assert.equal(nodeFs.statSync(target).mode & 0o777, 0o600);
  // A wider mode is also honoured exactly, not narrowed by the umask.
  writeFileAtomic(target, 'y', { mode: 0o644 });
  assert.equal(nodeFs.statSync(target).mode & 0o777, 0o644);
});

test('without mode, the write does not chmod and the file gets the default mode', (t) => {
  const dir = scratch(t);
  const target = join(dir, 'plain.json');
  let chmodded = false;
  const fs = { ...nodeFs, chmodSync: (...a) => ((chmodded = true), nodeFs.chmodSync(...a)) };
  writeFileAtomic(target, 'x', { fs });
  assert.equal(chmodded, false);
  const umask = process.umask();
  assert.equal(nodeFs.statSync(target).mode & 0o777, 0o666 & ~umask);
});
