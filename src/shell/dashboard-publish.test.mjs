// The dashboard state file's writer: nothing without PIR_DASHBOARD_STATE, a write only when what the file
// says changes, removal on close, and a failure that is swallowed and reported once.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDashboardPublisher } from './dashboard-publish.mjs';
import { initialUi } from '../core/dashboard.mjs';

const run = { key: 'shop__search', slug: 'search', repo: 'shop', state: 'running', record: { slug: 'search', repo: 'shop', repoPath: '/src/shop', branch: 'pir/search' } };
const sink = () => {
  const out = [];
  return { write: (s) => out.push(s), out };
};

test('unset or empty PIR_DASHBOARD_STATE: no publisher at all', () => {
  assert.equal(createDashboardPublisher({ env: {} }), null);
  assert.equal(createDashboardPublisher({ env: { PIR_DASHBOARD_STATE: '' } }), null);
});

test('writes on the first update and on a change of view, not on a repeat, and removes the file on close', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pir-dash-'));
  const path = join(dir, 'state.json');
  let clock = 1000;
  const p = createDashboardPublisher({ env: { PIR_DASHBOARD_STATE: path }, pid: 42, now: () => clock, mainWorktree: () => '/src/shop' });

  p.update(initialUi(), [run]);
  const first = JSON.parse(readFileSync(path, 'utf8'));
  assert.deepEqual(first, { version: 1, pid: 42, view: 'list', run: null, worker: null, updatedAt: new Date(1000).toISOString() });

  clock = 2000;
  p.update({ ...initialUi(), sel: 3 }, [run]); // a cursor move says nothing new
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).updatedAt, new Date(1000).toISOString());

  p.update({ ...initialUi(), view: 'watch', openKey: 'shop__search' }, [run]);
  const opened = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(opened.view, 'run');
  assert.equal(opened.run.key, 'shop__search');
  assert.equal(opened.updatedAt, new Date(2000).toISOString());
  assert.deepEqual(readdirSync(dir), ['state.json'], 'no temp file is left beside it');

  p.close();
  assert.ok(!existsSync(path));
  const err = sink();
  p.report(err);
  assert.deepEqual(err.out, []);
});

test('a failed write never throws, is retried, and is reported once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pir-dash-'));
  const blocker = join(dir, 'file');
  writeFileSync(blocker, '');
  const path = join(blocker, 'state.json'); // a path under a regular file cannot be written
  const p = createDashboardPublisher({ env: { PIR_DASHBOARD_STATE: path }, mainWorktree: () => null });
  p.update(initialUi(), []);
  p.update({ ...initialUi(), view: 'watch', openKey: 'x' }, []);
  p.close();
  const err = sink();
  p.report(err);
  assert.equal(err.out.length, 1);
  assert.match(err.out[0], /^pir: could not write the dashboard state to .*state\.json/);
});

test('a relative path publishes nothing and says so once', () => {
  const p = createDashboardPublisher({ env: { PIR_DASHBOARD_STATE: 'state.json' } });
  p.update(initialUi(), []);
  p.close();
  assert.ok(!existsSync('state.json'));
  const err = sink();
  p.report(err);
  assert.match(err.out.join(''), /must be an absolute path/);
});
