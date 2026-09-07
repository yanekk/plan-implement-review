import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeParallelism } from './parallelism.mjs';

// Compact builder: a task is its number, its deps and its runs marker — the three fields
// analyzeParallelism reads. Everything else parseProgress carries is irrelevant here.
const task = (num, { deps = [], runs = 'auto' } = {}) => ({ num, deps, runs });

test('a single chain T00→T01→T02 gives criticalPathLength 3, maxWidth 1', () => {
  const tasks = [task('T00'), task('T01', { deps: ['T00'] }), task('T02', { deps: ['T01'] })];
  const r = analyzeParallelism(tasks);
  assert.equal(r.criticalPathLength, 3);
  assert.equal(r.maxWidth, 1);
});

test('three independent tasks give criticalPathLength 1, maxWidth 3', () => {
  const tasks = [task('T00'), task('T01'), task('T02')];
  const r = analyzeParallelism(tasks);
  assert.equal(r.criticalPathLength, 1);
  assert.equal(r.maxWidth, 3);
});

test('a diamond (A; B,C on A; D on B,C) gives criticalPathLength 3, maxWidth 2', () => {
  const tasks = [
    task('T00'),
    task('T01', { deps: ['T00'] }),
    task('T02', { deps: ['T00'] }),
    task('T03', { deps: ['T01', 'T02'] }),
  ];
  const r = analyzeParallelism(tasks);
  assert.equal(r.criticalPathLength, 3);
  assert.equal(r.maxWidth, 2);
});

test('auto/you counts match the markers; totalTasks is the list length', () => {
  const tasks = [
    task('T00', { runs: 'auto' }),
    task('T01', { runs: 'you' }),
    task('T02', { runs: 'auto' }),
    task('T03', { runs: 'you' }),
    task('T04', { runs: 'you' }),
  ];
  const r = analyzeParallelism(tasks);
  assert.equal(r.autonomousCount, 2);
  assert.equal(r.humanCount, 3);
  assert.equal(r.totalTasks, 5);
});

test('a task with an unknown dependency is reported, not silently treated as a root', () => {
  // T01 names T99, which is not in the list. It must be reported, and T01 must not be given
  // a spurious depth as though the missing dep did not exist — it stays a root at depth 1.
  const tasks = [task('T00'), task('T01', { deps: ['T99'] })];
  const r = analyzeParallelism(tasks);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /T01/);
  assert.match(r.errors[0], /T99/);
  // Both are roots (T01's only dep is unknown), so the widest layer holds both.
  assert.equal(r.criticalPathLength, 1);
  assert.equal(r.maxWidth, 2);
});

test('an empty task list yields zeroes without throwing', () => {
  const r = analyzeParallelism([]);
  assert.deepEqual(r, {
    criticalPathLength: 0,
    maxWidth: 0,
    autonomousCount: 0,
    humanCount: 0,
    totalTasks: 0,
    errors: [],
  });
});

test('an unknown dep shared by two tasks is reported once per naming task, not per resolution', () => {
  const tasks = [task('T00', { deps: ['T99'] }), task('T01', { deps: ['T99'] })];
  const r = analyzeParallelism(tasks);
  assert.equal(r.errors.length, 2);
});

test('a dependency cycle is reported rather than recursing for ever', () => {
  const tasks = [task('T00', { deps: ['T01'] }), task('T01', { deps: ['T00'] })];
  const r = analyzeParallelism(tasks);
  assert.ok(r.errors.some((e) => /cycle/.test(e)));
  // The numbers are still finite and returned.
  assert.equal(r.totalTasks, 2);
  assert.equal(typeof r.criticalPathLength, 'number');
});

test('a task depending on a partially-unknown set still counts the known dep for depth', () => {
  // T02 depends on a real T00 and a missing T99; its depth follows the real chain.
  const tasks = [task('T00'), task('T02', { deps: ['T00', 'T99'] })];
  const r = analyzeParallelism(tasks);
  assert.equal(r.criticalPathLength, 2);
  assert.equal(r.errors.length, 1);
});
