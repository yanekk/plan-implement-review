import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideDispatch } from './dispatch.mjs';

// Compact builders so each test reads as its case, not its scaffolding.
const task = (num, state, { deps = [], runs = 'auto' } = {}) => ({ num, name: num, deps, runs, state });
const asg = (workerId, taskId, phase, live = true) => ({ workerId, task: taskId, phase, live });

const MAX = 4;
const call = (over) => decideDispatch({ tasks: [], assignments: [], maxWorkers: MAX, halted: false, ...over });

test('spawns only ⬜ tasks whose deps are all ✅; a 🔍 or ⬜ dependency blocks it', () => {
  const tasks = [
    task('T01', '✅'),
    task('T02', '🔍'),
    task('T03', '⬜', { deps: ['T01'] }), // dep ✅ → ready
    task('T04', '⬜', { deps: ['T02'] }), // dep 🔍 → blocked
    task('T05', '⬜', { deps: ['T03'] }), // dep ⬜ → blocked
  ];
  const { spawn } = call({ tasks });
  assert.deepEqual(
    spawn.map((s) => s.num),
    ['T03'],
  );
});

test('each spawn entry carries its runs marker', () => {
  const tasks = [task('T01', '⬜', { runs: 'auto' }), task('T02', '⬜', { runs: 'you' })];
  const { spawn } = call({ tasks });
  assert.deepEqual(spawn, [
    { num: 'T01', runs: 'auto' },
    { num: 'T02', runs: 'you' },
  ]);
});

test('a ready you task is spawned and competes for slots by task number', () => {
  // One free slot; the you task is lower-numbered, so it wins the slot over the auto task.
  const tasks = [task('T01', '⬜', { runs: 'you' }), task('T02', '⬜', { runs: 'auto' })];
  const assignments = [asg('w-a', 'T09', 'implementing'), asg('w-b', 'T10', 'implementing'), asg('w-c', 'T11', 'implementing')];
  const { spawn } = call({ tasks, assignments }); // 3 live, max 4 → 1 slot
  assert.deepEqual(spawn, [{ num: 'T01', runs: 'you' }]);
});

test('never exceeds the ceiling: 3 live, max 4 → at most 1 spawned', () => {
  const tasks = [task('T01', '⬜'), task('T02', '⬜'), task('T03', '⬜')];
  const assignments = [asg('w-a', 'T07', 'implementing'), asg('w-b', 'T08', 'reviewing'), asg('w-c', 'T09', 'awaiting-answer')];
  const { spawn } = call({ tasks, assignments });
  assert.equal(spawn.length, 1);
});

test('lowest task number first when more are ready than the ceiling allows', () => {
  const tasks = [task('T01', '⬜'), task('T02', '⬜'), task('T03', '⬜'), task('T04', '⬜'), task('T05', '⬜')];
  const { spawn } = call({ tasks }); // 0 live, max 4 → 4 spawned, lowest four
  assert.deepEqual(
    spawn.map((s) => s.num),
    ['T01', 'T02', 'T03', 'T04'],
  );
});

test('a review-ready worker appears in review; not spawned again or merged', () => {
  const tasks = [task('T01', '🔍')];
  const assignments = [asg('w1', 'T01', 'review-ready')];
  const { review, spawn, merge } = call({ tasks, assignments });
  assert.deepEqual(review, ['w1']);
  assert.deepEqual(spawn, []);
  assert.deepEqual(merge, []);
});

test('the implement session of a review-ready task is closed as its reviewer spawns', () => {
  const tasks = [task('T01', '🔍')];
  const assignments = [asg('w1', 'T01', 'review-ready')];
  const { review, close } = call({ tasks, assignments });
  assert.deepEqual(review, ['w1']);
  assert.deepEqual(close, ['w1']); // one slot, not two
});

test('a you worker that reports done goes to merge/close, never to review', () => {
  const tasks = [task('T01', '✅', { runs: 'you' })];
  const assignments = [asg('w1', 'T01', 'done')];
  const { review, merge, close } = call({ tasks, assignments });
  assert.deepEqual(review, []);
  assert.deepEqual(merge, ['w1']);
  assert.deepEqual(close, ['w1']);
});

test('merge is at most one task branch per pass even when two workers are done', () => {
  const tasks = [task('T01', '✅'), task('T02', '✅')];
  const assignments = [asg('w2', 'T02', 'done'), asg('w1', 'T01', 'done')];
  const { merge, close } = call({ tasks, assignments });
  assert.equal(merge.length, 1);
  assert.deepEqual(merge, ['w1']); // lowest task number merges first
  assert.ok(close.includes('w1')); // the merged worker is closed
  assert.ok(!close.includes('w2')); // the other done worker waits, not closed
});

test('promoteToMain is false while any task is not ✅', () => {
  const tasks = [task('T01', '✅'), task('T02', '⬜')];
  assert.equal(call({ tasks }).promoteToMain, false);
});

test('promoteToMain is false while any worker is live, even with all ✅', () => {
  const tasks = [task('T01', '✅')];
  const assignments = [asg('w1', 'T01', 'done')];
  assert.equal(call({ tasks, assignments }).promoteToMain, false);
});

test('promoteToMain is true only when all ✅ and none live', () => {
  const tasks = [task('T01', '✅'), task('T02', '✅')];
  assert.equal(call({ tasks, assignments: [] }).promoteToMain, true);
});

test('an empty plan never promotes', () => {
  assert.equal(call({ tasks: [] }).promoteToMain, false);
});

test('a dead worker is closed and its slot freed for a spawn this pass', () => {
  const tasks = [task('T02', '⬜')];
  // Four assignments but one is dead (live=false): 3 live, so max 4 leaves a slot.
  const assignments = [
    asg('w-a', 'T07', 'implementing'),
    asg('w-b', 'T08', 'implementing'),
    asg('w-c', 'T09', 'implementing'),
    asg('w-dead', 'T10', 'implementing', false),
  ];
  const { close, spawn } = call({ tasks, assignments });
  assert.deepEqual(close, ['w-dead']);
  assert.deepEqual(spawn, [{ num: 'T02', runs: 'auto' }]); // the dead worker's slot is free
});

test('a phase "dead" worker is also treated as dead and closed', () => {
  const assignments = [asg('w1', 'T01', 'dead')];
  const { close } = call({ tasks: [], assignments });
  assert.deepEqual(close, ['w1']);
});

test('halted=true empties spawn/review/merge and closes every worker', () => {
  const tasks = [task('T01', '⬜'), task('T02', '🔍'), task('T03', '✅')];
  const assignments = [asg('w1', 'T02', 'review-ready'), asg('w2', 'T03', 'done')];
  const r = decideDispatch({ tasks, assignments, maxWorkers: MAX, halted: true });
  assert.deepEqual(r.spawn, []);
  assert.deepEqual(r.review, []);
  assert.deepEqual(r.merge, []);
  assert.equal(r.promoteToMain, false);
  assert.deepEqual(r.close, ['w1', 'w2']);
});

test('a task already assigned to a live worker is not spawned again', () => {
  const tasks = [task('T01', '⬜')];
  const assignments = [asg('w1', 'T01', 'implementing')];
  const { spawn } = call({ tasks, assignments });
  assert.deepEqual(spawn, []);
});
