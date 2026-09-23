import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProgress, reconcileTaskRow, adoptNewTaskRows } from './progress.mjs';

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

test('a Runs column present in the table is ignored, not read into a field or an error', () => {
  // The auto/you distinction is gone (DESIGN §2.5); SAMPLE still carries a Runs column (older plans and
  // this plan's own PROGRESS.md do). The column must be tolerated: no `runs` field, no parse error.
  const { tasks, errors } = parseProgress(SAMPLE);
  assert.deepEqual(errors, []);
  assert.ok(
    tasks.every((t) => !('runs' in t)),
    'no task carries a runs field',
  );
});

test('a table with and without a Runs column yield the same task list', () => {
  // WITHOUT (CLASSIC): no Runs column. WITH: the same two tasks plus a Runs column carrying a `you` row.
  const withRuns = `# Progress

| # | Task | Runs | Depends on | State | Notes |
|---|---|---|---|---|---|
| T01 | First task | you | — | ✅ | done |
| T02 | Second task | auto | T01 | ⬜ | |
`;
  const a = parseProgress(CLASSIC);
  const b = parseProgress(withRuns);
  assert.deepEqual(a.errors, []);
  assert.deepEqual(b.errors, []);
  // The Runs column (and the `you` value in it) changes nothing: identical num/name/deps/state.
  assert.deepEqual(a.tasks, b.tasks);
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

// --- adoptNewTaskRows (DESIGN §2.2, §3.3) --------------------------------------------------

// The authoritative feature-branch PROGRESS.md: the reviewed gate, the coordinator-managed
// single-line fields the adopt must never touch, and three tasks (T00 done, T01/T02 queued).
const FEATURE = `# Progress

**Plan reviewed:** 2026-09-21 — 2 fixed, 1 decided with the user

**Status:** building.
**Next \`pir-work\` will:** implement T01.

## Tasks

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | adopt-rule | — | ✅ | done |
| T01 | merge-adopts | T00 | ⬜ | |
| T02 | dispatch-adopted | T01 | ⬜ | |

**Review queue:** empty
`;

// A merging task branch's PROGRESS.md: the same table, with the merging task's own row (T01)
// advanced to ✅, plus whatever extra rows a test appends. `extraRows` is joined with newlines.
function branchWith(...extraRows) {
  return `# Progress

**Plan reviewed:** 2026-09-21 — 2 fixed, 1 decided with the user

**Status:** building.
**Next \`pir-work\` will:** implement T02.

## Tasks

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | adopt-rule | — | ✅ | done |
| T01 | merge-adopts | T00 | ✅ | reviewed clean |
| T02 | dispatch-adopted | T01 | ⬜ | |
${extraRows.join('\n')}
**Review queue:** empty
`;
}

test('adopt: one new row (T03, deps T01) is appended as ⬜ and returned in added', () => {
  const branch = branchWith('| T03 | new-thing | T01 | ⬜ | seed |');
  const { text, added, errors } = adoptNewTaskRows(FEATURE, branch);
  assert.deepEqual(errors, []);
  assert.deepEqual(added, ['T03']);
  const t03 = parseProgress(text).tasks.find((t) => t.num === 'T03');
  assert.deepEqual({ num: t03.num, name: t03.name, deps: t03.deps, state: t03.state }, {
    num: 'T03',
    name: 'new-thing',
    deps: ['T01'],
    state: '⬜',
  });
});

test('adopt: existing rows and the single-line fields are byte-identical', () => {
  const branch = branchWith('| T03 | new-thing | T01 | ⬜ | |');
  const { text } = adoptNewTaskRows(FEATURE, branch);
  // Every line of FEATURE survives verbatim; the only change is the appended T03 row.
  const before = FEATURE.split('\n');
  const after = text.split('\n');
  for (const line of before) {
    assert.ok(after.includes(line), `feature line missing after adopt: ${JSON.stringify(line)}`);
  }
  assert.ok(text.includes('**Status:** building.'));
  assert.ok(text.includes('**Next `pir-work` will:** implement T01.'));
  assert.ok(text.includes('**Review queue:** empty'));
  assert.ok(text.includes('| T00 | adopt-rule | — | ✅ | done |'));
  assert.ok(text.includes('| T01 | merge-adopts | T00 | ⬜ | |'));
  assert.ok(text.includes('| T02 | dispatch-adopted | T01 | ⬜ | |'));
});

test("adopt: the merging task's own row (branch ✅, feature ⬜) is ignored, not adopted or an error", () => {
  // No extra rows: the branch differs from the feature only by T01's glyph.
  const { text, added, errors } = adoptNewTaskRows(FEATURE, branchWith());
  assert.deepEqual(errors, []);
  assert.deepEqual(added, []);
  assert.equal(text, FEATURE, 'nothing to adopt → byte-identical');
});

test('adopt: a new row whose branch glyph is ✅ or 🔍 is forced to ⬜', () => {
  const branch = branchWith(
    '| T03 | built-on-branch | T01 | ✅ | |',
    '| T04 | in-review-on-branch | T01 | 🔍 | |',
  );
  const { text, added, errors } = adoptNewTaskRows(FEATURE, branch);
  assert.deepEqual(errors, []);
  assert.deepEqual(added, ['T03', 'T04']);
  const byNum = Object.fromEntries(parseProgress(text).tasks.map((t) => [t.num, t]));
  assert.equal(byNum.T03.state, '⬜');
  assert.equal(byNum.T04.state, '⬜');
});

test('adopt: a new row depending on a task that exists nowhere is rejected, nothing adopted', () => {
  const branch = branchWith('| T03 | dangling | T09 | ⬜ | |');
  const { text, added, errors } = adoptNewTaskRows(FEATURE, branch);
  assert.deepEqual(added, []);
  assert.equal(text, FEATURE, 'atomic reject → byte-identical');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /T03/);
  assert.match(errors[0], /T09/);
});

test('adopt: a branch row that changes an existing task deps is rejected (add-only)', () => {
  // T02's deps change from T01 to T00 on the branch — a forbidden edit.
  const branch = branchWith().replace(
    '| T02 | dispatch-adopted | T01 | ⬜ | |',
    '| T02 | dispatch-adopted | T00 | ⬜ | |',
  );
  const { text, added, errors } = adoptNewTaskRows(FEATURE, branch);
  assert.deepEqual(added, []);
  assert.equal(text, FEATURE);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /T02/);
  assert.match(errors[0], /add-only/);
});

test('adopt: a branch row that changes an existing task slug is rejected (add-only)', () => {
  const branch = branchWith().replace(
    '| T02 | dispatch-adopted | T01 | ⬜ | |',
    '| T02 | renamed-task | T01 | ⬜ | |',
  );
  const { added, errors } = adoptNewTaskRows(FEATURE, branch);
  assert.deepEqual(added, []);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /T02/);
});

test('adopt: a duplicate number (branch T00 with a different slug) is rejected', () => {
  const branch = branchWith().replace(
    '| T00 | adopt-rule | — | ✅ | done |',
    '| T00 | something-else | — | ✅ | done |',
  );
  const { added, errors } = adoptNewTaskRows(FEATURE, branch);
  assert.deepEqual(added, []);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /T00/);
});

test('adopt: two new rows, the second depending on the first, both adopt', () => {
  const branch = branchWith(
    '| T03 | first-new | T01 | ⬜ | |',
    '| T04 | second-new | T03 | ⬜ | |',
  );
  const { text, added, errors } = adoptNewTaskRows(FEATURE, branch);
  assert.deepEqual(errors, []);
  assert.deepEqual(added, ['T03', 'T04']);
  const byNum = Object.fromEntries(parseProgress(text).tasks.map((t) => [t.num, t]));
  assert.deepEqual(byNum.T04.deps, ['T03'], 'dep on the other new row validates');
});

test('adopt: one good and one bad new row in the same change adopt nothing (atomic)', () => {
  const branch = branchWith(
    '| T03 | good-new | T01 | ⬜ | |',
    '| T04 | bad-new | T99 | ⬜ | |',
  );
  const { text, added, errors } = adoptNewTaskRows(FEATURE, branch);
  assert.deepEqual(added, []);
  assert.equal(text, FEATURE, 'the good row does not half-land');
  assert.ok(errors.some((e) => /T04/.test(e) && /T99/.test(e)));
});

test('adopt: nothing new on the branch → byte-identical, empty added and errors', () => {
  // A branch identical to the feature but for state glyphs (T01 advanced) adopts nothing.
  const { text, added, errors } = adoptNewTaskRows(FEATURE, branchWith());
  assert.equal(text, FEATURE);
  assert.deepEqual(added, []);
  assert.deepEqual(errors, []);
});

test('adopt: the result re-parses and reconcileTaskRow can set the new row state (layout preserved)', () => {
  const branch = branchWith('| T03 | new-thing | T01 | ⬜ | |');
  const { text } = adoptNewTaskRows(FEATURE, branch);
  const { errors } = parseProgress(text);
  assert.deepEqual(errors, [], 'adopted text parses cleanly');
  // reconcile the adopted row the way the coordinator would on a later pass.
  const reconciled = reconcileTaskRow(text, { num: 'T03', state: '🔍', notes: 'built' });
  const t03 = parseProgress(reconciled).tasks.find((t) => t.num === 'T03');
  assert.equal(t03.state, '🔍');
  assert.equal(t03.deps.join(','), 'T01', 'the adopted deps cell still parses');
});

test('adopt: a legacy Runs column in the feature table is preserved and the new row keeps the layout', () => {
  // Older plans (and this project's own) carry a Runs column parseProgress ignores. The
  // appended row must still have the right cell count so it parses and folds.
  const featureRuns = `# Progress

## Tasks

| # | Task | Runs | Depends on | State | Notes |
|---|---|---|---|---|---|
| T00 | adopt-rule | auto | — | ✅ | done |
| T01 | merge-adopts | auto | T00 | ⬜ | |

**Review queue:** empty
`;
  const branchRuns = `# Progress

## Tasks

| # | Task | Runs | Depends on | State | Notes |
|---|---|---|---|---|---|
| T00 | adopt-rule | auto | — | ✅ | done |
| T01 | merge-adopts | auto | T00 | ✅ | done |
| T03 | new-thing | auto | T01 | ⬜ | |

**Review queue:** empty
`;
  const { text, added, errors } = adoptNewTaskRows(featureRuns, branchRuns);
  assert.deepEqual(errors, []);
  assert.deepEqual(added, ['T03']);
  const parsed = parseProgress(text);
  assert.deepEqual(parsed.errors, [], 'appended row has the right cell count');
  const t03 = parsed.tasks.find((t) => t.num === 'T03');
  assert.deepEqual(t03.deps, ['T01']);
  assert.equal(t03.state, '⬜');
});

// --- blocks clause: a new task gating an existing one (docs/task-state.md) --------------------

test('blocks: a `; blocks T02` clause adds the row to T02 deps, and keeps its own cell apart', () => {
  const text = FEATURE.replace('| T02 | dispatch-adopted | T01 | ⬜ | |', '| T02 | dispatch-adopted | T01 | ⬜ | |\n| T03 | wiring | T00; blocks T02 | ⬜ | |');
  const { tasks, errors } = parseProgress(text);
  assert.deepEqual(errors, []);
  const byNum = Object.fromEntries(tasks.map((t) => [t.num, t]));
  assert.deepEqual(byNum.T03.deps, ['T00']);
  assert.deepEqual(byNum.T03.blocks, ['T02']);
  assert.deepEqual(byNum.T02.deps, ['T01', 'T03']);
  assert.deepEqual(byNum.T02.ownDeps, ['T01']);
});

test('blocks: a target not in the table is a parse error, not ignored', () => {
  const text = FEATURE.replace('| T02 | dispatch-adopted | T01 | ⬜ | |', '| T02 | dispatch-adopted | T01 | ⬜ | |\n| T03 | wiring | T00; blocks T09 | ⬜ | |');
  const { errors } = parseProgress(text);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /T03.*T09/);
});

test('adopt: a new row that blocks an unstarted task is adopted and gates it', () => {
  const branch = branchWith('| T03 | wiring | T00; blocks T02 | ⬜ | |');
  const { text, added, errors, blockEdges } = adoptNewTaskRows(FEATURE, branch);
  assert.deepEqual(errors, []);
  assert.deepEqual(blockEdges, [{ task: 'T03', target: 'T02', state: '⬜' }]);
  assert.deepEqual(added, ['T03']);
  assert.ok(text.includes('| T03 | wiring | T00; blocks T02 | ⬜ | |'));
  assert.ok(text.includes('| T02 | dispatch-adopted | T01 | ⬜ | |'), 'the blocked row itself is untouched');
  const t02 = parseProgress(text).tasks.find((t) => t.num === 'T02');
  assert.deepEqual(t02.deps, ['T01', 'T03']);
});

test('adopt: a branch forked before a blocker landed is not an edit of the blocked task', () => {
  const withBlocker = FEATURE.replace('| T02 | dispatch-adopted | T01 | ⬜ | |', '| T02 | dispatch-adopted | T01 | ⬜ | |\n| T03 | wiring | T00; blocks T02 | ⬜ | |');
  // branchWith() has no T03 row, so its T02 reads deps [T01] while the feature's folds to [T01, T03].
  const { errors, text } = adoptNewTaskRows(withBlocker, branchWith());
  assert.deepEqual(errors, []);
  assert.equal(text, withBlocker);
});

test('adopt: adding a blocks clause to an existing row is rejected (add-only)', () => {
  const branch = branchWith().replace('| T01 | merge-adopts | T00 | ✅ |', '| T01 | merge-adopts | T00; blocks T02 | ✅ |');
  const { added, errors } = adoptNewTaskRows(FEATURE, branch);
  assert.deepEqual(added, []);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /T01.*add-only/);
});

test('adopt: a new row blocking a task that exists nowhere is rejected, nothing adopted', () => {
  const branch = branchWith('| T03 | wiring | T00; blocks T09 | ⬜ | |');
  const { text, added, errors } = adoptNewTaskRows(FEATURE, branch);
  assert.deepEqual(added, []);
  assert.equal(text, FEATURE);
  assert.ok(errors.some((e) => /T03/.test(e) && /T09/.test(e)));
});

test('adopt: a new row that blocks its own prerequisite closes a cycle and is rejected', () => {
  const branch = branchWith('| T03 | wiring | T01; blocks T01 | ⬜ | |');
  const { text, added, errors } = adoptNewTaskRows(FEATURE, branch);
  assert.deepEqual(added, []);
  assert.equal(text, FEATURE);
  assert.ok(errors.some((e) => /T03.*cycle/.test(e)));
});

test('adopt: blocking a task already started adopts, and the edge carries its state', () => {
  const started = FEATURE.replace('| T02 | dispatch-adopted | T01 | ⬜ | |', '| T02 | dispatch-adopted | T01 | 🟡 | |');
  const branch = branchWith('| T03 | wiring | T00; blocks T02 | ⬜ | |').replace('| T02 | dispatch-adopted | T01 | ⬜ |', '| T02 | dispatch-adopted | T01 | 🟡 |');
  const { added, errors, blockEdges } = adoptNewTaskRows(started, branch);
  assert.deepEqual(errors, []);
  assert.deepEqual(added, ['T03']);
  assert.deepEqual(blockEdges, [{ task: 'T03', target: 'T02', state: '🟡' }]);
});
