import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildablePlan } from './buildable.mjs';

// box-commands DESIGN §2.3: offered only when reviewed, with a valid test block, and unfinished.

const DESIGN = '---\nsetup: none\ntest:\n  - npm test\n---\n# Design\n';

function progress(states, reviewed = '2026-09-28 — 1 fixed') {
  const rows = states.map((s, i) => `| T0${i + 1} | task-${i + 1} | — | ${s} | |`).join('\n');
  return (
    `# Progress\n\n**Plan reviewed:** ${reviewed}\n\n## Tasks\n\n` +
    `| # | Task | Depends on | State | Notes |\n|---|---|---|---|---|\n${rows}\n`
  );
}

test('buildablePlan: an unreviewed plan is not offered', () => {
  assert.equal(buildablePlan({ progress: progress(['⬜'], 'not yet'), design: DESIGN }), null);
  assert.equal(buildablePlan({ progress: progress(['⬜'], ''), design: DESIGN }), null);
  assert.equal(buildablePlan({ progress: '# Progress\n', design: DESIGN }), null, 'no gate line');
});

test('buildablePlan: no DESIGN.md or an invalid test block is not offered', () => {
  assert.equal(buildablePlan({ progress: progress(['⬜']), design: null }), null);
  assert.equal(buildablePlan({ progress: progress(['⬜']), design: '# Design\nno block\n' }), null);
  assert.equal(buildablePlan({ progress: progress(['⬜']), design: '---\nsetup: none\n---\n' }), null, 'no test key');
});

test('buildablePlan: a missing PROGRESS.md or no arguments is not offered', () => {
  assert.equal(buildablePlan({ progress: null, design: DESIGN }), null);
  assert.equal(buildablePlan(), null);
});

test('buildablePlan: a finished plan is not offered', () => {
  assert.equal(buildablePlan({ progress: progress(['✅', '✅']), design: DESIGN }), null);
});

test('buildablePlan: a plan with no tasks is not offered', () => {
  assert.equal(buildablePlan({ progress: progress([]), design: DESIGN }), null);
});

test('buildablePlan: done counts only ✅ rows, total counts every row', () => {
  assert.deepEqual(buildablePlan({ progress: progress(['✅', '⬜', '🟡', '🔍', '⛔', '✅']), design: DESIGN }), {
    done: 2,
    total: 6,
  });
  assert.deepEqual(buildablePlan({ progress: progress(['⬜']), design: DESIGN }), { done: 0, total: 1 });
  assert.deepEqual(buildablePlan({ progress: progress(['🔍', '✅']), design: DESIGN }), { done: 1, total: 2 });
});
