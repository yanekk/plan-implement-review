import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProgress, reconcileTaskRow } from './progress.mjs';

// A small, realistic PROGRESS.md: the reviewed gate, a header with the Runs column, an
// empty-notes row, a multi-dependency row, and the coordinator-managed lines the reconcile
// must never touch. Kept minimal so a diff in a test failure is readable.
const SAMPLE = `# Progress

**Plan reviewed:** 2026-09-07 — 4 fixed, 3 decided with the user
**Next \`pir-work\` will:** implement T02.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented · ✅ done · ⛔ blocked.

| # | Task | Runs | Depends on | State | Notes |
|---|---|---|---|---|---|
| T00 | Platform spike | you | — | ✅ | Verified by agent. |
| T01 | Scaffold and test command | auto | — | ✅ | Reviewed clean. |
| T02 | Parse PROGRESS.md | auto | T01 | ⬜ | |
| T06 | Worktree lifecycle | auto | T03, T05 | ⬜ | Hand-verified half. |

**Review queue:** empty
`;

// A classic plan with no Runs column, to prove the marker defaults to auto (DESIGN §2.6).
const CLASSIC = `# Progress

**Plan reviewed:** not yet — run \`/pir-review-plan\` before the first \`/pir-work\`

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T01 | First task | — | ✅ | done |
| T02 | Second task | T01 | ⬜ | |
`;

test('depends-on: — yields no deps, a comma list yields each task', () => {
  const { tasks } = parseProgress(SAMPLE);
  const byNum = Object.fromEntries(tasks.map((t) => [t.num, t]));
  assert.deepEqual(byNum.T00.deps, []);
  assert.deepEqual(byNum.T01.deps, []);
  assert.deepEqual(byNum.T02.deps, ['T01']);
  assert.deepEqual(byNum.T06.deps, ['T03', 'T05']);
});

test('Runs column is read as auto/you', () => {
  const { tasks } = parseProgress(SAMPLE);
  const byNum = Object.fromEntries(tasks.map((t) => [t.num, t]));
  assert.equal(byNum.T00.runs, 'you');
  assert.equal(byNum.T01.runs, 'auto');
});

test('a table with no Runs column defaults every task to auto', () => {
  const { tasks, errors } = parseProgress(CLASSIC);
  assert.equal(errors.length, 0);
  assert.equal(tasks.length, 2);
  assert.ok(tasks.every((t) => t.runs === 'auto'));
});

test('reviewed gate: dated verdict reads as reviewed', () => {
  const { planReviewed } = parseProgress(SAMPLE);
  assert.equal(planReviewed.reviewed, true);
  assert.match(planReviewed.note, /2026-09-07/);
});

test('reviewed gate: "not yet" reads as not reviewed', () => {
  const { planReviewed } = parseProgress(CLASSIC);
  assert.equal(planReviewed.reviewed, false);
  assert.match(planReviewed.note, /^not yet/);
});

test('reviewed gate: a missing line is treated as not reviewed', () => {
  const { planReviewed } = parseProgress('# Progress\n\nno gate line here\n');
  assert.equal(planReviewed.reviewed, false);
  assert.equal(planReviewed.note, '');
});

test('reviewed gate: a present-but-empty note is treated as not reviewed', () => {
  // A blank gate is an unreviewed-looking gate; the coordinator must refuse (DESIGN §2.1),
  // not read the absence of "not yet" as a positive verdict.
  const { planReviewed } = parseProgress('# Progress\n\n**Plan reviewed:**\n');
  assert.equal(planReviewed.reviewed, false);
  assert.equal(planReviewed.note, '');
});

test('an unknown state glyph is surfaced as an error, not dropped', () => {
  const bad = SAMPLE.replace('| T02 | Parse PROGRESS.md | auto | T01 | ⬜ |', '| T02 | Parse PROGRESS.md | auto | T01 | ❓ |');
  const { tasks, errors } = parseProgress(bad);
  assert.ok(!tasks.some((t) => t.num === 'T02'), 'the unreadable row is not in tasks');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /T02/);
  assert.match(errors[0], /unknown state/i);
});

test('a malformed row (wrong cell count) is surfaced as an error', () => {
  const bad = SAMPLE.replace('| T02 | Parse PROGRESS.md | auto | T01 | ⬜ | |', '| T02 | Parse PROGRESS.md | auto | ⬜ |');
  const { tasks, errors } = parseProgress(bad);
  assert.ok(!tasks.some((t) => t.num === 'T02'));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /malformed/i);
});

test('the legend is not treated as a task', () => {
  const { tasks } = parseProgress(SAMPLE);
  assert.deepEqual(
    tasks.map((t) => t.num),
    ['T00', 'T01', 'T02', 'T06'],
  );
});

test('a file with no table yields an empty task list and no errors', () => {
  const { tasks, errors } = parseProgress('# Progress\n\nJust prose, no table at all.\n');
  assert.deepEqual(tasks, []);
  assert.deepEqual(errors, []);
});

test('reconcileTaskRow changes only the target State and Notes cells', () => {
  const out = reconcileTaskRow(SAMPLE, { num: 'T02', state: '🔍', notes: 'parseProgress + reconcileTaskRow, 12 tests.' });
  const before = SAMPLE.split('\n');
  const after = out.split('\n');
  assert.equal(before.length, after.length);
  const changed = before.map((line, i) => (line === after[i] ? null : i)).filter((i) => i !== null);
  assert.equal(changed.length, 1, 'exactly one line changed');
  // On that one line, only the State and Notes cells differ.
  assert.match(after[changed[0]], /🔍/);
  assert.match(after[changed[0]], /12 tests/);
});

test('reconcileTaskRow leaves the Status, Next-pir-work and Review-queue lines identical', () => {
  const out = reconcileTaskRow(SAMPLE, { num: 'T02', state: '🟡', notes: 'in progress' });
  assert.ok(out.includes('**Next `pir-work` will:** implement T02.'));
  assert.ok(out.includes('**Review queue:** empty'));
  assert.ok(out.includes('**Plan reviewed:** 2026-09-07 — 4 fixed, 3 decided with the user'));
});

test('reconcileTaskRow errors on an unknown task number', () => {
  assert.throws(() => reconcileTaskRow(SAMPLE, { num: 'T99', state: '✅', notes: '' }), /no task row for T99/);
});

test('reconcileTaskRow errors on over-budget notes rather than truncating', () => {
  const tooLong = Array.from({ length: 61 }, (_, i) => `w${i}`).join(' ');
  assert.throws(() => reconcileTaskRow(SAMPLE, { num: 'T02', state: '🔍', notes: tooLong }), /over the 60-word budget/);
  // Exactly 60 words is allowed.
  const sixty = Array.from({ length: 60 }, (_, i) => `w${i}`).join(' ');
  assert.doesNotThrow(() => reconcileTaskRow(SAMPLE, { num: 'T02', state: '🔍', notes: sixty }));
});

test('reconcileTaskRow errors on an unknown state glyph', () => {
  assert.throws(() => reconcileTaskRow(SAMPLE, { num: 'T02', state: '❓', notes: '' }), /not a known glyph/);
});

test('a reconciled row re-parses with the new state', () => {
  const out = reconcileTaskRow(SAMPLE, { num: 'T02', state: '🔍', notes: 'implemented' });
  const { tasks, errors } = parseProgress(out);
  assert.deepEqual(errors, []);
  const t02 = tasks.find((t) => t.num === 'T02');
  assert.equal(t02.state, '🔍');
  assert.equal(t02.deps.join(','), 'T01', 'the untouched Depends-on cell still parses');
});

test('two reconciles of different tasks compose without undoing each other', () => {
  const once = reconcileTaskRow(SAMPLE, { num: 'T02', state: '🔍', notes: 'built' });
  const twice = reconcileTaskRow(once, { num: 'T06', state: '🟡', notes: 'started' });
  const { tasks } = parseProgress(twice);
  const byNum = Object.fromEntries(tasks.map((t) => [t.num, t]));
  assert.equal(byNum.T02.state, '🔍');
  assert.equal(byNum.T06.state, '🟡');
});

test('reconcileTaskRow on an empty-notes row writes a single-space Notes cell', () => {
  // Setting notes to '' should leave the canonical `| |` empty-cell shape, not `|  |`.
  const out = reconcileTaskRow(SAMPLE, { num: 'T02', state: '🟡', notes: '' });
  assert.ok(out.includes('| T02 | Parse PROGRESS.md | auto | T01 | 🟡 | |'));
});
