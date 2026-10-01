// The dashboard notices a reinstall under it (createEngineCheck) and says so on the list and the build's
// live view (2026-10-01: a dashboard older than the finisher showed its run as `ready to merge`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildListFrame, buildWatchFrame, createEngineCheck, ENGINE_CHECK_MS, ENGINE_UPDATED_NOTE } from './pir-tui.mjs';
import { buildDashboard, initialUi } from '../core/dashboard.mjs';

const frameText = (frame) => frame.map((l) => l.map((s) => s.text).join('')).join('\n');
const statOf = (ino, mtimeMs) => () => ({ ino, mtimeMs });

test('engine check: the same file reads not updated; a new inode or mtime reads updated, and stays so', () => {
  let cur = { ino: 1, mtimeMs: 100 };
  const check = createEngineCheck({ path: 'x', stat: () => cur });
  assert.equal(check(0), false);
  cur = { ino: 2, mtimeMs: 100 };
  assert.equal(check(ENGINE_CHECK_MS), true, 'a reinstall replaces the file: new inode');
  cur = { ino: 1, mtimeMs: 100 };
  assert.equal(check(2 * ENGINE_CHECK_MS), true, 'a yes is final');

  let cur2 = { ino: 1, mtimeMs: 100 };
  const touched = createEngineCheck({ path: 'x', stat: () => cur2 });
  cur2 = { ino: 1, mtimeMs: 200 };
  assert.equal(touched(0), true, 'a new mtime on the same inode counts too');
});

test('engine check: asks at most once per interval', () => {
  let calls = 0;
  let cur = { ino: 1, mtimeMs: 100 };
  const check = createEngineCheck({ path: 'x', stat: () => (calls++, cur) });
  check(0);
  cur = { ino: 2, mtimeMs: 100 };
  assert.equal(check(ENGINE_CHECK_MS - 1), false, 'not asked again inside the interval');
  assert.equal(calls, 2, 'the start, then the first check');
  assert.equal(check(2 * ENGINE_CHECK_MS), true);
});

test('engine check: a failed stat never claims an update', () => {
  const missing = createEngineCheck({ path: 'x', stat: () => { throw new Error('ENOENT'); } });
  assert.equal(missing(0), false, 'no first reading: never updated');

  let fail = false;
  const check = createEngineCheck({ path: 'x', stat: () => { if (fail) throw new Error('ENOENT'); return { ino: 1, mtimeMs: 1 }; } });
  fail = true;
  assert.equal(check(0), false, 'mid-install the file may be gone for a moment');
  fail = false;
  assert.equal(check(ENGINE_CHECK_MS), false, 'back as it was');
});

test('engine check: a real file deleted and copied afresh, as install.sh does, reads updated', () => {
  const dir = mkdtempSync(join(tmpdir(), 'engine-check-'));
  try {
    const file = join(dir, 'pir-tui.mjs');
    writeFileSync(file, 'old');
    const check = createEngineCheck({ path: file, intervalMs: 0 });
    assert.equal(check(1), false);
    rmSync(file);
    writeFileSync(join(dir, 'other'), 'keep the old inode taken');
    writeFileSync(file, 'new');
    assert.equal(check(2), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the list title carries the notice, amber, only when the engine was updated', () => {
  const rows = [{ slug: 'alpha', state: 'running', repo: 'r', progress: { done: 1, total: 2 }, workers: 1 }];
  assert.ok(!frameText(buildListFrame(buildDashboard(rows), initialUi())).includes(ENGINE_UPDATED_NOTE));
  const frame = buildListFrame({ ...buildDashboard(rows), updated: true }, initialUi());
  assert.match(frame[0].map((s) => s.text).join(''), /^pir {2}runs on this machine {2}· pir was updated · quit and reopen pir to use it$/);
  assert.equal(frame[0].at(-1).style, 'your-go');
  const boxed = buildListFrame({ ...buildDashboard(rows), updated: true }, initialUi(), { rows: 20 });
  assert.ok(frameText(boxed).includes(ENGINE_UPDATED_NOTE), 'the list above the box too');
});

test('a build\'s live view shows the notice under its header only when the engine was updated', () => {
  const view = { slug: 'alpha', state: 'running', repo: 'r', snap: null, record: { pid: 1 } };
  assert.ok(!frameText(buildWatchFrame(view, { now: 0 })).includes(ENGINE_UPDATED_NOTE));
  const frame = buildWatchFrame(view, { now: 0, updated: true });
  assert.equal(frame[1].map((s) => s.text).join(''), ENGINE_UPDATED_NOTE);
  assert.equal(frame[1][0].style, 'your-go');
});
