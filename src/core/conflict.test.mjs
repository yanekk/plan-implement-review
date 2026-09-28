// buildConflictPrompt, tested without a terminal (DESIGN §2.8, §4). The 'worker' variant is what pir sends
// a live worker when the run's own merge conflicts; the 'person' variant is printed only when no worker is
// left to send it to. Either way it must name the branch to merge in and the files, and leave the
// keep-which-side choice to whoever resolves, who asks when it is a judgement — never bake a resolution in.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildConflictPrompt } from './conflict.mjs';

const WORKER = 'plan-implement-review / non-agentic-coordinator / T02 / greet / review';

const base = {
  task: 'T02',
  slug: 'greet',
  taskBranch: 'pir/demo-T02',
  featureBranch: 'pir/demo',
  files: ['greeting.txt', 'src/app.mjs'],
};

test('the prompt names the feature branch to merge in, every conflicting file, and the task', () => {
  const p = buildConflictPrompt(base);
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

test('with no live worker it names the branch to check out and has the person land it', () => {
  const p = buildConflictPrompt(base);
  assert.doesNotMatch(p, /claude agents|[Aa]ttach/, 'there is no live worker to attach to');
  assert.match(p, /git checkout pir\/demo-T02/, 'it tells the person to check the task branch out by hand');
  assert.match(p, /commit/i, 'it tells whoever resolves to commit');
  assert.match(p, /`test` lines at the top of plans\/[^/]+\/DESIGN\.md/, 'it runs the plan\'s own tests');
  assert.match(p, /its `setup` lines\s+first if the worktree is not ready/, 'and names setup for a worktree that is not ready');
  assert.doesNotMatch(p, /npm test/, 'never a fixed npm test — the project may not be Node');
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
  assert.match(p, /`test` lines at the top of plans\/demo\/DESIGN\.md/);
  assert.ok(!p.includes('plans/greet/'), 'the task slug is not a plan folder');
});

// --- the worker variant: what pir sends a live worker over its line (live-workers T08, DESIGN §2.10) ---

test('the worker variant names the branches and files, has no copy markers, and tells the worker to ask the person', () => {
  const p = buildConflictPrompt({ ...base, plan: 'demo', audience: 'worker' });
  assert.match(p, /git merge pir\/demo\b/, 'it tells the worker to merge the feature branch in');
  assert.ok(p.includes('pir/demo-T02'), 'it names the task branch');
  assert.ok(p.includes('greeting.txt') && p.includes('src/app.mjs'), 'it lists every conflicting file');
  assert.doesNotMatch(p, /-----/, 'no copy markers: the text IS the message');
  assert.doesNotMatch(p, /claude agents|[Aa]ttach/, 'no attach instructions for a person');
  assert.ok(!p.includes(WORKER), 'it does not name the worker to itself');
  assert.match(p, /judgement, ask the person/, 'a judgement goes to the person');
  assert.match(p, /`test` lines at the top of plans\/demo\/DESIGN\.md/, 'it runs the plan\'s own tests');
  assert.match(p, /commit/i);
  assert.match(p, /[Ss]ignal done again/, 'it re-signals done so the run merges again');
  assert.doesNotMatch(p, /KEEP:|resolved:/, 'no side is baked in');
});

test('the person variant is the default and is unchanged by the audience switch', () => {
  assert.equal(buildConflictPrompt({ ...base, audience: 'person' }), buildConflictPrompt(base));
});

// ---- pir-coordinator T05: the main-sync prompt (DESIGN §3.3) ----
import { MAIN_SYNC_TASK } from './conflict.mjs';

test('main-sync prompt: the in-progress merge of main, the files, the plan\'s test lines, commit and done', () => {
  const text = buildConflictPrompt({ kind: 'main-sync', slug: 'demo', plan: 'demo', files: ['src/a.mjs', 'README.md'], audience: 'worker' });
  assert.match(text, /merged the current `main` into pir\/demo/);
  assert.match(text, /The merge\nis in progress: do not abort it/);
  assert.match(text, / {2}- src\/a\.mjs\n {2}- README\.md/);
  assert.match(text, /the `test` lines at the top of plans\/demo\/DESIGN\.md/);
  assert.match(text, /commit the merge/);
  assert.match(text, new RegExp(`\\[pir:v1 kind=done task=${MAIN_SYNC_TASK}\\]`));
  assert.match(text, /ask the person/);
  assert.doesNotMatch(text, /----- copy/);
});

test('buildConflictPrompt without a kind is the task→feature prompt, unchanged', () => {
  const args = { task: 'T03', slug: 'thing', plan: 'demo', taskBranch: 'pir/demo-T03', featureBranch: 'pir/demo', files: ['x'] };
  assert.equal(buildConflictPrompt({ ...args, kind: 'task' }), buildConflictPrompt(args));
  assert.equal(buildConflictPrompt({ ...args, kind: 'task', audience: 'worker' }), buildConflictPrompt({ ...args, audience: 'worker' }));
});

// ---- pir-coordinator T10: the tests-red prompt ----
import { TESTS_FIX_TASK } from './conflict.mjs';

test('tests-red prompt: the failing branch, the reason and log, fix only the cause, the plan\'s test lines, commit and done', () => {
  const text = buildConflictPrompt({ kind: 'tests-red', slug: 'demo', plan: 'demo', testsReason: 'test exit 1:\n  3 failing', logPath: '/c/tests.log', audience: 'worker' });
  assert.equal(TESTS_FIX_TASK, 'tests-fix');
  assert.match(text, /the plan's test block fails on pir\/demo/);
  assert.match(text, /What failed: test exit 1: 3 failing/);
  assert.match(text, /Full output: \/c\/tests\.log/);
  assert.match(text, /do not change what any task delivered beyond what the fix needs/);
  assert.match(text, /plans\/demo\/DESIGN\.md/);
  assert.match(text, /\[pir:v1 kind=done task=tests-fix\]/);
  assert.match(text, /\[pir:v1 kind=question task=tests-fix\]/);
  assert.match(text, /never merge into main or push/);
  const bare = buildConflictPrompt({ kind: 'tests-red', slug: 'demo', audience: 'worker' });
  assert.doesNotMatch(bare, /What failed|Full output/);
});
