// buildConflictPrompt, tested without a terminal (DESIGN §2.8, §4). The prompt is what the person copies
// and pastes to a parked worker when the run's own merge conflicts, so what it does and does NOT say is a
// rule a person relies on: it must name the worker, the branch to merge in and the files, and it must
// leave the keep-which-side choice to the worker, who asks when it is a judgement — never bake a resolution in.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildConflictPrompt } from './conflict.mjs';

const WORKER = 'plan-implement-review / non-agentic-coordinator / T02 / greet / review';

const base = {
  task: 'T02',
  slug: 'greet',
  workerName: WORKER,
  taskBranch: 'pir/demo-T02',
  featureBranch: 'pir/demo',
  files: ['greeting.txt', 'src/app.mjs'],
};

test('the prompt names the worker to attach to, the feature branch to merge in, and every conflicting file', () => {
  const p = buildConflictPrompt(base);
  assert.match(p, /claude agents/, 'it tells the person to attach in `claude agents`');
  assert.ok(p.includes(WORKER), 'it names the exact worker session to attach to (§2.9)');
  assert.match(p, /git merge pir\/demo/, 'it tells the worker to merge the feature branch into its branch');
  assert.ok(p.includes('greeting.txt'), 'it lists the first conflicting file');
  assert.ok(p.includes('src/app.mjs'), 'it lists the second conflicting file');
  assert.ok(p.includes('pir/demo-T02'), 'it names the task branch');
  assert.match(p, /T02 greet/, 'it labels the task by number and slug');
});

test('it leaves the side to the worker, who asks when it is a judgement, and bakes in NO resolution (user 2026-09-24)', () => {
  const p = buildConflictPrompt(base);
  assert.doesNotMatch(p, /KEEP:/, 'no blank for the person to fill in before pasting');
  assert.match(p, /needs a\s+judgement, ask me/, 'the worker is told to ask when the side is a judgement');
  // The whole point of parking for a person: the prompt must not decide the merge. It may name a file
  // path, but it never states which side wins or supplies resolved content.
  assert.ok(!/keep the (feature|task|worker|mine|theirs) side/i.test(p), 'no side is chosen for the person');
  assert.ok(!/resolved:/i.test(p), 'no resolved content is baked in');
});

test('it ends with the finish steps: commit, the plan\'s test command, then re-signal done (a live worker)', () => {
  const p = buildConflictPrompt(base);
  assert.match(p, /commit/i, 'it tells the worker to commit the resolution');
  assert.match(p, /test command in plans\/[^/]+\/DESIGN\.md/, 'it tells the worker to run the plan\'s own tests');
  assert.doesNotMatch(p, /npm test/, 'never a fixed npm test — the project may not be Node');
  assert.match(p, /[Ss]ignal done again/, 'it tells the worker to re-signal done so the run can merge it');
});

test('with no live worker (restart-reconcile) it names the branch to check out instead of a worker to attach to', () => {
  const p = buildConflictPrompt({ ...base, workerName: null });
  assert.doesNotMatch(p, /claude agents/, 'there is no live worker to attach to');
  assert.match(p, /git checkout pir\/demo-T02/, 'it tells the person to check the task branch out by hand');
  assert.match(p, /git merge pir\/demo/, 'the git scaffold to merge the feature branch is still there');
  assert.match(p, /ask me before you resolve it/, 'the ask-when-unsure line is still there');
  assert.match(p, /land this branch yourself/i, 'with no worker to re-signal, the person lands the branch');
});

test('it is delimited so the person can select exactly what to paste, with plain-ASCII markers', () => {
  const p = buildConflictPrompt(base);
  const lines = p.split('\n');
  const start = lines.findIndex((l) => l.startsWith('-----') && /copy/.test(l));
  const end = lines.findIndex((l) => l.startsWith('-----') && /end/.test(l));
  assert.ok(start >= 0 && end > start, 'the pasteable block is bracketed by copy/end markers');
  const block = lines.slice(start + 1, end).join('\n');
  assert.match(block, /git merge pir\/demo/, 'the git steps are inside the pasteable block');
  assert.match(block, /ask me before you resolve it/, 'the ask-when-unsure line is inside the pasteable block');
  // The markers must be plain ASCII, or they would be copied into the worker as box-drawing noise.
  assert.ok(/^-+ .* -+$/.test(lines[start].trim()) || lines[start].startsWith('-----'), 'the markers are plain dashes');
});

test('empty file list degrades to naming the feature branch rather than an empty list', () => {
  const p = buildConflictPrompt({ ...base, files: [] });
  assert.match(p, /Conflicting file\(s\):/, 'it still has a files section');
  assert.match(p, /the feature branch/, 'with no file names it says the clash is on the feature branch');
});

test('the test step names the PLAN folder, never the task slug (declared-test-command T05, 2026-09-24)', () => {
  const p = buildConflictPrompt({ ...base, plan: 'demo' });
  assert.match(p, /test command in plans\/demo\/DESIGN\.md/);
  assert.ok(!p.includes('plans/greet/'), 'the task slug is not a plan folder');
});
