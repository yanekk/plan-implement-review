import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakePlatform } from './platform.mjs';
import { createFakeWorktree } from './worktree.mjs';
import { workerName } from '../../core/naming.mjs';

const PROGRESS = [
  '# Progress',
  '',
  '**Plan reviewed:** 2026-09-08 — reviewed',
  '',
  '| # | Task | Runs | Depends on | State | Notes |',
  '|---|---|---|---|---|---|',
  '| T01 | one | auto | — | ⬜ | |',
  '',
].join('\n');

// A worker needs a real task worktree to commit into. Stand one up off a scratch feature branch.
function taskWorktree(t) {
  const wt = createFakeWorktree({ progress: PROGRESS });
  t.after(() => wt.cleanup());
  wt.openFeature('demo');
  return { wt, task: wt.createTask('demo', 'T01') };
}

const NAME = workerName({ repo: 'demo-repo', plan: 'demo', task: 'T01' });

test('an implement worker commits its work, then reports implemented; list() is its clock', (t) => {
  const { wt, task } = taskWorktree(t);
  const platform = createFakePlatform();
  platform.spawn({ cwd: task.path, name: NAME, phase: 'implement' });

  assert.deepEqual(platform.inbox(), [], 'nothing reported before the first tick');
  const listed = platform.list(); // one tick: the worker implements
  assert.equal(listed.length, 1);
  assert.equal(listed[0].name, NAME);

  const msgs = platform.inbox();
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].kind, 'implemented');
  assert.equal(msgs[0].task, 'T01');
  assert.ok(wt.fileOn('pir/demo-T01', 'work-T01.txt').ok, 'the worker committed a code file on its branch');
});

test('a review worker marks the row ✅ and reports done; a verify worker does the same with no review', (t) => {
  const { task } = taskWorktree(t);
  const review = createFakePlatform();
  review.spawn({ cwd: task.path, name: NAME, phase: 'review' });
  review.list();
  assert.equal(review.inbox()[0].kind, 'done');

  const verify = createFakePlatform();
  verify.spawn({ cwd: task.path, name: NAME, phase: 'verify' });
  verify.list();
  assert.equal(verify.inbox()[0].kind, 'done');
});

test('a scripted question parks the worker until an answer arrives, then it implements', (t) => {
  const { task } = taskWorktree(t);
  const platform = createFakePlatform({ behaviors: { T01: { question: 'which?' } } });
  const id = platform.spawn({ cwd: task.path, name: NAME, phase: 'implement' });

  platform.list();
  assert.equal(platform.inbox()[0].kind, 'question');
  platform.list();
  assert.deepEqual(platform.inbox(), [], 'still parked, nothing new while waiting');

  platform.send(id, 'answer');
  platform.list();
  assert.equal(platform.inbox()[0].kind, 'implemented', 'the answered worker resumes');
});

test('a crashed worker vanishes from list(); close removes a worker', (t) => {
  const { task } = taskWorktree(t);
  const platform = createFakePlatform({ behaviors: { T01: { crash: true } } });
  const id = platform.spawn({ cwd: task.path, name: NAME, phase: 'implement' });
  // The crash lands on its first tick (advance runs before the snapshot), so it is never listed.
  assert.equal(platform.list().length, 0, 'the crashed worker is gone from the list');
  assert.deepEqual(platform.inbox(), [], 'a crash sends no message; the coordinator infers it from absence');

  const other = createFakePlatform();
  const id2 = other.spawn({ cwd: task.path, name: NAME, phase: 'implement' });
  other.close(id2);
  assert.equal(other.list().length, 0, 'a closed worker is gone');
  assert.ok(other.closed.includes(id2));
  assert.ok(id); // referenced
});
