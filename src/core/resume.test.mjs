import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideResume } from './resume.mjs';

// Compact builders so each test reads as its case, not its scaffolding. A feature task carries
// exactly the shape parseProgress(...).tasks returns; branchStates maps a task number to its
// committed task-branch glyph (or null when the branch is absent), exactly what T02 returns.
const task = (num, state, { deps = [], runs = 'auto' } = {}) => ({ num, name: num, deps, runs, state });
const call = (featureTasks, branchStates = {}) => decideResume({ featureTasks, branchStates });

test('feature ⬜ + branch ✅ → merge; not review, not resume', () => {
  const out = call([task('T01', '⬜')], { T01: '✅' });
  assert.deepEqual(out, { merge: ['T01'], review: [], resume: [] });
});

test('feature ⬜ + branch 🔍 → review; not merge, not resume', () => {
  const out = call([task('T01', '⬜')], { T01: '🔍' });
  assert.deepEqual(out, { merge: [], review: ['T01'], resume: [] });
});

test('feature ⬜ + branch 🟡 → resume', () => {
  const out = call([task('T01', '⬜')], { T01: '🟡' });
  assert.deepEqual(out, { merge: [], review: [], resume: ['T01'] });
});

test('feature ⬜ + branch ⬜ (branch exists, no build committed) → resume', () => {
  const out = call([task('T01', '⬜')], { T01: '⬜' });
  assert.deepEqual(out, { merge: [], review: [], resume: ['T01'] });
});

test('feature ⬜ + branch absent (null) → no entry anywhere', () => {
  const out = call([task('T01', '⬜')], { T01: null });
  assert.deepEqual(out, { merge: [], review: [], resume: [] });
});

test('feature ⬜ + branch missing from the map → no entry anywhere', () => {
  // An absent key is the same signal as an explicit null: no branch to adopt.
  const out = call([task('T01', '⬜')], {});
  assert.deepEqual(out, { merge: [], review: [], resume: [] });
});

test('feature ✅ (already merged) → no entry, whatever the branch glyph', () => {
  // A leftover branch for a merged task is cleaned up in the shell (T03), not decided here.
  const out = call([task('T01', '✅')], { T01: '✅' });
  assert.deepEqual(out, { merge: [], review: [], resume: [] });
});

test('feature ⛔ (deferred) → no entry, whatever the branch glyph', () => {
  const out = call([task('T01', '⛔')], { T01: '🔍' });
  assert.deepEqual(out, { merge: [], review: [], resume: [] });
});

test('a you task, feature ⬜ + branch ✅ → merge (verify folds to ✅ with no 🔍 stage)', () => {
  const out = call([task('T01', '⬜', { runs: 'you' })], { T01: '✅' });
  assert.deepEqual(out, { merge: ['T01'], review: [], resume: [] });
});

test('a ⛔ glyph on a task branch classifies as resume (present, neither ✅ nor 🔍)', () => {
  // A worker never writes ⛔ on its own branch, but if one ever appeared it is not "built",
  // so it must not be adopted — the else clause treats it as half-built.
  const out = call([task('T01', '⬜')], { T01: '⛔' });
  assert.deepEqual(out, { merge: [], review: [], resume: ['T01'] });
});

test('mixed table: each case classifies independently and every list is sorted by task number', () => {
  // Deliberately out of task order in the input to prove the output lists are sorted, not just
  // echoed in input order.
  const tasks = [
    task('T05', '⬜'), // branch 🔍 → review
    task('T02', '⬜'), // branch ✅ → merge
    task('T06', '✅'), // feature ✅ → skip
    task('T01', '⬜'), // branch ✅ → merge
    task('T04', '⬜'), // branch absent → implement (no entry)
    task('T03', '⬜'), // branch 🟡 → resume
    task('T07', '⛔'), // feature ⛔ → skip
    task('T08', '⬜'), // branch ⬜ → resume
  ];
  const branchStates = {
    T05: '🔍',
    T02: '✅',
    T06: '✅',
    T01: '✅',
    T04: null,
    T03: '🟡',
    T07: '🔍',
    T08: '⬜',
  };
  const out = call(tasks, branchStates);
  assert.deepEqual(out, { merge: ['T01', 'T02'], review: ['T05'], resume: ['T03', 'T08'] });
});

test('empty featureTasks → all three lists empty', () => {
  assert.deepEqual(call([]), { merge: [], review: [], resume: [] });
});

// Mutation guard (DESIGN §3.3, §4): the old behaviour treats every ⬜ feature row as a fresh
// implement, ignoring the branch glyph — so it would put nothing in merge or review. These two
// assertions pin the branch glyph as the deciding input: a classifier that read only the feature
// row would return empty merge and review lists here and fail. This is what reddens the regression.
test('mutation guard: the branch glyph, not the feature row, decides merge and review', () => {
  const tasks = [task('T01', '⬜'), task('T02', '⬜')];
  const out = call(tasks, { T01: '✅', T02: '🔍' });
  assert.deepEqual(out.merge, ['T01'], 'a ✅ branch under a ⬜ feature row must merge, not implement');
  assert.deepEqual(out.review, ['T02'], 'a 🔍 branch under a ⬜ feature row must review, not implement');
});
