// The pure display model, exercised exhaustively without a terminal (DESIGN §2.3, §4). The in-place
// painting itself is the renderer's and is hand-verified (T09); everything a person reads off a row —
// the kind, the label, the elapsed clock, the counts, the footer — is a rule, and a rule only a person
// can check is a rule that rots. So the vocabulary lives here, tested in milliseconds.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askingCount, buildDisplay, rowEntries } from './display.mjs';

// A base clock, so `now − since` is a round number in the assertions.
const NOW = 1_000_000;

// One task record in the shape the shell hands the model. Overrides win.
const task = (over) => ({
  id: 'T01',
  slug: 'a-thing',
  deps: [],
  done: false,
  phase: null,
  since: null,
  doneMs: null,
  question: null,
  ...over,
});

// --- rows: every kind maps to the right id, slug, label and elapsed -------------------------------

test('buildDisplay maps a task in every kind to the right row (id + slug), label and elapsedMs', () => {
  const tasks = [
    task({ id: 'T01', slug: 'stop-promoting', done: true, doneMs: 6400 }),
    task({ id: 'T02', slug: 'building-one', phase: 'building', since: NOW - 4000 }),
    task({ id: 'T03', slug: 'review-one', phase: 'reviewing', since: NOW - 2000 }),
    task({ id: 'T04', slug: 'merge-one', phase: 'merging', since: NOW - 400 }),
    task({ id: 'T05', slug: 'ask-one', phase: 'asking', since: NOW - 9000, question: 'which format?' }),
    task({ id: 'T06', slug: 'waits-on-05', deps: ['T05'] }),
    task({ id: 'T07', slug: 'ready-one', deps: [] }),
  ];
  // Ceiling 5 with four active workers: not full, so the ready task reads plain `queued`.
  const { rows } = buildDisplay({ branch: 'pir/demo', ceiling: 5, tasks }, { now: NOW });

  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  // id and slug ride through on every row (§2.9: a row is `T01 stop-promoting`).
  assert.deepEqual(rows.map((r) => [r.id, r.slug]).slice(0, 2), [['T01', 'stop-promoting'], ['T02', 'building-one']]);

  assert.deepEqual(by.T01, { id: 'T01', slug: 'stop-promoting', kind: 'done', label: 'merged', elapsedMs: 6400 });
  assert.deepEqual(by.T02, { id: 'T02', slug: 'building-one', kind: 'building', label: 'building', elapsedMs: 4000 });
  assert.deepEqual(by.T03, { id: 'T03', slug: 'review-one', kind: 'reviewing', label: 'reviewing', elapsedMs: 2000 });
  assert.deepEqual(by.T04, { id: 'T04', slug: 'merge-one', kind: 'merging', label: 'merging', elapsedMs: 400 });
  assert.deepEqual(by.T05, { id: 'T05', slug: 'ask-one', kind: 'asking', label: 'asking you · a question', elapsedMs: 9000 });
  // T06 waits on the not-done T05; the label names the unmet dep (§2.3).
  assert.deepEqual(by.T06, { id: 'T06', slug: 'waits-on-05', kind: 'waiting', label: 'needs T05', elapsedMs: null });
  // T07 is ready and, since the ceiling (5) is not full (four active workers), simply queued.
  assert.deepEqual(by.T07, { id: 'T07', slug: 'ready-one', kind: 'queued', label: 'queued', elapsedMs: null });
});

test('an asking task with a stoppedAt shows a stopped clock that does not move with now (user 2026-09-26)', () => {
  const tasks = [task({ id: 'T01', phase: 'asking', since: NOW - 9000, stoppedAt: NOW - 5000 })];
  const at = (now) => buildDisplay({ branch: 'b', ceiling: 2, tasks }, { now }).rows[0].elapsedMs;
  assert.equal(at(NOW), 4000);
  assert.equal(at(NOW + 60_000), 4000);
});

test('a waiting task names every unmet dependency, and a satisfied dependency drops out of the label', () => {
  const tasks = [
    task({ id: 'T01', slug: 'done-dep', done: true }),
    task({ id: 'T02', slug: 'open-dep' }),
    task({ id: 'T03', slug: 'needs-both', deps: ['T01', 'T02'] }),
  ];
  const { rows } = buildDisplay({ ceiling: 4, tasks }, { now: NOW });
  const t03 = rows.find((r) => r.id === 'T03');
  assert.equal(t03.kind, 'waiting');
  assert.equal(t03.label, 'needs T02', 'only the unmet dep is named; the ✅ one drops out');
});

test('an active row with no `since` (or no clock) has a null elapsedMs rather than NaN', () => {
  const tasks = [task({ phase: 'building', since: null })];
  assert.equal(buildDisplay({ ceiling: 4, tasks }, { now: NOW }).rows[0].elapsedMs, null);
  const withSince = [task({ phase: 'building', since: NOW - 1000 })];
  assert.equal(buildDisplay({ ceiling: 4, tasks: withSince }, {}).rows[0].elapsedMs, null, 'no now → null, not NaN');
});

// --- summary: the counts and the ceiling ----------------------------------------------------------

test('summary.ceilingFull is true exactly when running ≥ ceiling; the counts are correct', () => {
  const tasks = [
    task({ id: 'T01', done: true }),
    task({ id: 'T02', phase: 'building', since: NOW }),
    task({ id: 'T03', phase: 'reviewing', since: NOW }),
    task({ id: 'T04', phase: 'asking', since: NOW }),
    task({ id: 'T05', deps: ['T02'] }), // waiting (T02 not done)
    task({ id: 'T06', deps: [] }), // ready → queued
  ];
  const at2 = buildDisplay({ ceiling: 2, tasks }, { now: NOW }).summary;
  assert.equal(at2.running, 3, 'building + reviewing + asking all count as running');
  assert.equal(at2.asking, 1);
  assert.equal(at2.done, 1);
  assert.equal(at2.total, 6);
  assert.equal(at2.waiting, 6 - 1 - 3, 'waiting = total − done − running');
  assert.equal(at2.ceiling, 2);
  assert.equal(at2.ceilingFull, true, 'running 3 ≥ ceiling 2');

  const at4 = buildDisplay({ ceiling: 4, tasks }, { now: NOW }).summary;
  assert.equal(at4.ceilingFull, false, 'running 3 < ceiling 4');
  // With the ceiling not full, the ready task reads plain `queued`; full, it says why.
  assert.equal(buildDisplay({ ceiling: 2, tasks }, { now: NOW }).rows.find((r) => r.id === 'T06').label, 'queued · ceiling full');
  assert.equal(buildDisplay({ ceiling: 4, tasks }, { now: NOW }).rows.find((r) => r.id === 'T06').label, 'queued');
});

test('summary.finished is true when every task is done, or when the pass reports complete', () => {
  const allDone = [task({ id: 'T01', done: true }), task({ id: 'T02', done: true })];
  assert.equal(buildDisplay({ ceiling: 4, tasks: allDone }, { now: NOW }).summary.finished, true);
  const some = [task({ id: 'T01', done: true }), task({ id: 'T02', phase: 'building', since: NOW })];
  assert.equal(buildDisplay({ ceiling: 4, tasks: some }, { now: NOW }).summary.finished, false);
  assert.equal(buildDisplay({ ceiling: 4, complete: true, tasks: some }, { now: NOW }).summary.finished, true);
});

// --- footer: hand-off, red, asking, running, interrupted ------------------------------------------

test('footer is handoff (green), red, asking, running or interrupted per the run state (DESIGN §2.3, §2.4, §2.8)', () => {
  const green = buildDisplay(
    { branch: 'pir/demo', ceiling: 4, complete: true, readyToMerge: true, tasks: [task({ done: true })] },
    { now: NOW },
  ).footer;
  assert.deepEqual(green, { kind: 'handoff', branch: 'pir/demo' });

  const red = buildDisplay(
    { branch: 'pir/demo', ceiling: 4, complete: true, readyToMerge: false, tasks: [task({ done: true })] },
    { now: NOW },
  ).footer;
  assert.deepEqual(red, { kind: 'red', branch: 'pir/demo', reason: null, logPath: null }, 'an old snapshot has no reason');

  const redWhy = buildDisplay(
    {
      branch: 'pir/demo', ceiling: 4, complete: true, readyToMerge: false, tasks: [task({ done: true })],
      testsReason: { reason: 'test `make test` exited 2', logPath: '/x/tests.log' },
    },
    { now: NOW },
  ).footer;
  assert.deepEqual(redWhy, { kind: 'red', branch: 'pir/demo', reason: 'test `make test` exited 2', logPath: '/x/tests.log' });

  const asking = buildDisplay(
    { branch: 'pir/demo', ceiling: 4, tasks: [task({ id: 'T05', slug: 'ask-one', phase: 'asking', since: NOW, question: 'which format?' })] },
    { now: NOW },
  ).footer;
  assert.deepEqual(asking, { kind: 'asking', task: 'T05', slug: 'ask-one', question: 'which format?' });

  const running = buildDisplay({ branch: 'pir/demo', ceiling: 4, tasks: [task({ phase: 'building', since: NOW })] }, { now: NOW }).footer;
  assert.deepEqual(running, { kind: 'running' });

  const interrupted = buildDisplay(
    { branch: 'pir/demo', ceiling: 4, interrupted: true, tasks: [task({ phase: 'building', since: NOW })] },
    { now: NOW },
  ).footer;
  assert.deepEqual(interrupted, { kind: 'interrupted' }, 'Ctrl-C wins over every other footer');
});

test('the asking footer names the first parked worker when several are asking at once', () => {
  const tasks = [
    task({ id: 'T02', slug: 'ask-a', phase: 'asking', since: NOW, question: 'a?' }),
    task({ id: 'T04', slug: 'ask-b', phase: 'asking', since: NOW, question: 'b?' }),
  ];
  const footer = buildDisplay({ branch: 'pir/demo', ceiling: 4, tasks }, { now: NOW }).footer;
  assert.equal(footer.kind, 'asking');
  assert.equal(footer.task, 'T02', 'the first asking worker is the one the footer names; the person correlates the rest');
});

test('a plain question footer names the task and its question, and a summary has no conflicts count', () => {
  const d = buildDisplay({ branch: 'pir/demo', ceiling: 4, tasks: [task({ id: 'T05', slug: 'ask-one', phase: 'asking', since: NOW, question: 'which format?' })] }, { now: NOW });
  assert.deepEqual(d.footer, { kind: 'asking', task: 'T05', slug: 'ask-one', question: 'which format?' });
  assert.ok(!('conflicts' in d.summary), 'the paste-in conflict state is gone (2026-09-26)');
});

test('a preparing task (setup running, DESIGN §2.4) is an active row labelled `preparing`, counted in running (T07)', () => {
  const d = buildDisplay(
    { branch: 'pir/x', ceiling: 1, tasks: [task({ id: 'T01', phase: 'preparing', since: NOW - 2000 }), task({ id: 'T02' })] },
    { now: NOW },
  );
  assert.deepEqual(d.rows[0], { id: 'T01', slug: 'a-thing', kind: 'preparing', label: 'preparing', elapsedMs: 2000 });
  assert.equal(d.summary.running, 1);
  assert.equal(d.summary.ceilingFull, true, 'it holds its slot under the ceiling');
  assert.equal(d.rows[1].label, 'queued · ceiling full');
});

test('the end gate running reads as testing, not finished, with its elapsed clock (user 2026-09-25)', () => {
  const allDone = [task({ id: 'T01', done: true }), task({ id: 'T02', done: true })];
  const d = buildDisplay({ branch: 'pir/demo', ceiling: 4, tasks: allDone, testing: { since: NOW - 72_000 } }, { now: NOW });
  assert.equal(d.summary.finished, false, 'every task merged is not finished while the tests run');
  assert.deepEqual(d.footer, { kind: 'testing', branch: 'pir/demo', elapsedMs: 72_000 });

  // The verdict wins over a stale testing marker: a complete run shows its hand-off.
  const done = buildDisplay({ branch: 'pir/demo', ceiling: 4, tasks: allDone, complete: true, readyToMerge: true, testing: { since: NOW } }, { now: NOW });
  assert.equal(done.footer.kind, 'handoff');
  assert.equal(done.summary.finished, true);
});

// --- a conflict pir sent to the live worker reads `fixing conflict` (live-workers T08, DESIGN §2.10) ---

test('a sent conflict is an active `fixing conflict` row, counted as running not as a conflict, with no footer', () => {
  const d = buildDisplay(
    {
      branch: 'pir/demo',
      ceiling: 4,
      tasks: [task({ id: 'T05', slug: 'clash', phase: 'asking', since: NOW - 3000, question: 'merge conflict in a.txt', conflictSent: true })],
    },
    { now: NOW },
  );
  assert.deepEqual(d.rows[0], { id: 'T05', slug: 'clash', kind: 'fixing-conflict', label: 'fixing conflict', elapsedMs: 3000 });
  assert.equal(d.summary.running, 1, 'the fixing worker holds its slot');
  assert.equal(d.summary.asking, 0, 'nothing is asked of the person');
  assert.deepEqual(d.footer, { kind: 'running' }, 'no conflict or asking footer');
});

test('a sent conflict does not hide another worker\'s question from the footer', () => {
  const d = buildDisplay(
    {
      branch: 'pir/demo',
      ceiling: 4,
      tasks: [
        task({ id: 'T05', slug: 'clash', phase: 'asking', since: NOW, conflictSent: true }),
        task({ id: 'T06', slug: 'ask', phase: 'asking', since: NOW, question: 'which format?' }),
      ],
    },
    { now: NOW },
  );
  assert.equal(d.footer.kind, 'asking');
  assert.equal(d.footer.task, 'T06');
});

// --- asking kinds (live-workers T09, DESIGN §2.4) --------------------------------------------------

test('each asking source maps to its label; with no source the row keeps its phase label', () => {
  const tasks = [
    task({ id: 'T01', slug: 'report', phase: 'asking', asking: 'question', since: NOW - 1000 }),
    task({ id: 'T02', slug: 'set', phase: 'building', asking: 'questions', since: NOW - 2000 }),
    task({ id: 'T03', slug: 'perm', phase: 'reviewing', asking: 'permission', since: NOW - 3000 }),
    // A report and a pending request together: the request says what is wanted now.
    task({ id: 'T04', slug: 'both', phase: 'asking', asking: 'permission', since: NOW }),
    task({ id: 'T05', slug: 'plain', phase: 'building', asking: null, since: NOW }),
    // A snapshot from before the field: an `asking` phase reads as a question.
    task({ id: 'T06', slug: 'old', phase: 'asking', since: NOW }),
  ];
  const { rows } = buildDisplay({ branch: 'pir/demo', ceiling: 9, tasks }, { now: NOW });
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.deepEqual(by.T01, { id: 'T01', slug: 'report', kind: 'asking', label: 'asking you · a question', elapsedMs: 1000 });
  assert.deepEqual(by.T02, { id: 'T02', slug: 'set', kind: 'asking', label: 'asking you · a question', elapsedMs: 2000 });
  assert.deepEqual(by.T03, { id: 'T03', slug: 'perm', kind: 'asking', label: 'asking you · allow a command?', elapsedMs: 3000 });
  assert.equal(by.T04.label, 'asking you · allow a command?');
  assert.deepEqual(by.T05, { id: 'T05', slug: 'plain', kind: 'building', label: 'building', elapsedMs: 0 });
  assert.equal(by.T06.label, 'asking you · a question');
});

test('summary counts request-only askers as asking you (and running); the footer names one', () => {
  const tasks = [
    task({ id: 'T01', slug: 'perm', phase: 'building', asking: 'permission', since: NOW }),
    task({ id: 'T02', slug: 'busy', phase: 'building', since: NOW }),
  ];
  const d = buildDisplay({ branch: 'pir/demo', ceiling: 2, tasks }, { now: NOW });
  assert.equal(d.summary.asking, 1);
  assert.equal(d.summary.running, 2);
  assert.deepEqual(d.footer, { kind: 'asking', task: 'T01', slug: 'perm', question: '' });
});

test('a worker fixing a sent conflict that raises a permission request is asking, not fixing', () => {
  const tasks = [task({ id: 'T01', slug: 'fix', phase: 'asking', conflictSent: true, asking: 'permission', since: NOW })];
  const d = buildDisplay({ branch: 'pir/demo', ceiling: 2, tasks }, { now: NOW });
  assert.equal(d.rows[0].kind, 'asking');
  assert.equal(d.rows[0].label, 'asking you · allow a command?');
  assert.equal(d.footer.kind, 'asking');
});

test('a done task with a stale asking field reads merged', () => {
  const d = buildDisplay({ branch: 'b', ceiling: 1, tasks: [task({ done: true, asking: 'permission' })] }, { now: NOW });
  assert.equal(d.rows[0].kind, 'done');
  assert.equal(d.summary.asking, 0);
});

// --- the coordinator agent (pir-coordinator T06, DESIGN §2.5, §2.9, §2.10) ------------------------

test('an item the coordinator agent holds reads `asking coordinator`; the person\'s reads `asking you`; only the person\'s are counted', () => {
  const tasks = [
    task({ id: 'T01', slug: 'agent-q', phase: 'asking', since: NOW - 3000, stoppedAt: NOW - 1000, holder: 'coordinator' }),
    task({ id: 'T02', slug: 'agent-perm', phase: 'building', since: NOW - 3000, asking: 'permission', holder: 'coordinator' }),
    task({ id: 'T03', slug: 'person-q', phase: 'asking', since: NOW - 3000, holder: 'person' }),
    task({ id: 'T04', slug: 'old-snap', phase: 'asking', since: NOW - 3000 }),
  ];
  const d = buildDisplay({ branch: 'pir/demo', ceiling: 8, tasks }, { now: NOW });
  assert.deepEqual(
    d.rows.map((r) => [r.id, r.kind, r.label]),
    [
      ['T01', 'asking-coordinator', 'asking coordinator · a question'],
      ['T02', 'asking-coordinator', 'asking coordinator · allow a command?'],
      ['T03', 'asking', 'asking you · a question'],
      ['T04', 'asking', 'asking you · a question'],
    ],
  );
  assert.equal(d.rows[0].elapsedMs, 2000, 'the clock stops for the coordinator too (§2.5)');
  assert.equal(d.summary.asking, 2, 'the summary counts the person\'s only');
  assert.equal(d.summary.running, 4, 'every asking task still holds its slot');
  assert.deepEqual(d.footer, { kind: 'asking', task: 'T03', slug: 'person-q', question: '' }, 'the footer names the person\'s, never the agent\'s');

  const agentOnly = buildDisplay({ branch: 'pir/demo', ceiling: 8, tasks: tasks.slice(0, 2) }, { now: NOW });
  assert.equal(agentOnly.summary.asking, 0);
  assert.deepEqual(agentOnly.footer, { kind: 'running' }, 'nothing asks the person, so the run reads as running');
  assert.equal(askingCount({ tasks: tasks.slice(0, 2) }), 0, 'the runs list does not turn the run amber');
  assert.equal(askingCount({ tasks }), 2);
});

test('the hand-off block with the agent: preparing, ready to merge with the report, red with why; absent with the agent off', () => {
  const done = [task({ done: true })];
  const at = (handoff, over = {}) => buildDisplay({ branch: 'pir/demo', ceiling: 4, tasks: done, handoff, ...over }, { now: NOW }).footer;

  assert.deepEqual(at({ state: 'preparing', reportPath: null, mainSha: null }), { kind: 'handoff', branch: 'pir/demo', state: 'preparing', reportPath: null });
  assert.deepEqual(
    at({ state: 'ready', reportPath: 'plans/demo/REPORT.md', mainSha: 'abc' }, { complete: true, readyToMerge: true }),
    { kind: 'handoff', branch: 'pir/demo', state: 'ready', reportPath: 'plans/demo/REPORT.md' },
  );
  assert.deepEqual(
    at({ state: 'red', reportPath: 'plans/demo/REPORT.md', mainSha: 'abc' }, { complete: true, testsReason: { reason: 'test `npm test` exited 1', logPath: '/c/tests.log' } }),
    { kind: 'handoff', branch: 'pir/demo', state: 'red', reportPath: 'plans/demo/REPORT.md', reason: 'test `npm test` exited 1', logPath: '/c/tests.log' },
  );
  // With --no-coordinator there is no handoff, and the footers are today's.
  assert.deepEqual(at(null, { complete: true, readyToMerge: true }), { kind: 'handoff', branch: 'pir/demo' });
  assert.deepEqual(at(null, { complete: true, readyToMerge: false }), { kind: 'red', branch: 'pir/demo', reason: null, logPath: null });
  // A question the person must answer still comes first.
  const asking = buildDisplay(
    { branch: 'pir/demo', ceiling: 4, tasks: [task({ phase: 'asking', holder: 'person' })], handoff: { state: 'preparing' } },
    { now: NOW },
  ).footer;
  assert.equal(asking.kind, 'asking');
});

// --- end-of-run helper rows (pir-coordinator T11) --------------------------------------------------

const helperRow = (over) => task({ id: 'tests-fix', slug: 'fix-red-tests', helper: true, phase: 'building', since: NOW - 5000, ...over });

test('a helper row renders below the tasks; the summary counts only the plan tasks (T11)', () => {
  const rs = { branch: 'pir/demo', ceiling: 2, tasks: [task({ id: 'T01', done: true, doneMs: 1000 }), task({ id: 'T02', done: true })], helpers: [helperRow()] };
  const d = buildDisplay(rs, { now: NOW });
  assert.deepEqual(d.rows.map((r) => r.id), ['T01', 'T02', 'tests-fix']);
  assert.deepEqual(d.rows[2], { id: 'tests-fix', slug: 'fix-red-tests', kind: 'building', label: 'working', elapsedMs: 5000 });
  assert.equal(d.summary.done, 2);
  assert.equal(d.summary.total, 2, 'n/m done counts the plan tasks only');
  assert.equal(d.summary.running, 0, 'the helper holds no slot under the ceiling');
  assert.equal(d.summary.waiting, 0);
});

test('a helper whose question is the person\'s reads asking you, is counted, and takes the footer (T11)', () => {
  const rs = {
    branch: 'pir/demo',
    ceiling: 2,
    tasks: [task({ id: 'T01', done: true })],
    helpers: [helperRow({ id: 'main-sync', slug: 'resolve-main-merge', asking: 'questions', holder: 'person', stoppedAt: NOW - 1000 })],
    handoff: { state: 'preparing', reportPath: null, mainSha: null },
  };
  const d = buildDisplay(rs, { now: NOW });
  const row = d.rows.find((r) => r.id === 'main-sync');
  assert.equal(row.kind, 'asking');
  assert.equal(row.label, 'asking you · a question');
  assert.equal(row.elapsedMs, 4000, 'its clock stops while it waits on the person');
  assert.equal(askingCount(rs), 1, 'the runs list turns amber for it');
  assert.equal(d.summary.total, 1);
  assert.deepEqual(d.footer, { kind: 'asking', task: 'main-sync', slug: 'resolve-main-merge', question: '' }, 'the asking pointer beats the preparing hand-off');
});

test('a helper whose question the agent holds reads asking coordinator and asks nothing of the person (T11)', () => {
  const rs = { branch: 'pir/demo', ceiling: 2, tasks: [task({ id: 'T01', done: true })], helpers: [helperRow({ asking: 'questions', holder: 'coordinator' })], handoff: { state: 'preparing' } };
  const d = buildDisplay(rs, { now: NOW });
  assert.equal(d.rows[1].kind, 'asking-coordinator');
  assert.equal(d.rows[1].label, 'asking coordinator · a question');
  assert.equal(askingCount(rs), 0);
  assert.equal(d.footer.kind, 'handoff');
});

test('a helper that reported done reads finishing while it is closed; with no helper the key is simply absent (T11)', () => {
  const d = buildDisplay({ branch: 'b', ceiling: 1, tasks: [task({ done: true })], helpers: [helperRow({ phase: 'merging' })] }, { now: NOW });
  assert.equal(d.rows[1].label, 'finishing');
  assert.equal(buildDisplay({ branch: 'b', ceiling: 1, tasks: [task({ done: true })] }, { now: NOW }).rows.length, 1);
});

// --- the coordinator agent's pinned row (pir-coordinator T12) -------------------------------------

const agent = (over) => ({ id: 'sess-1', live: true, logPath: '/c/conversations/coordinator-1.ndjson', state: 'up', holding: 0, ...over });

test('with an agent the rows are tasks, separator, agent, helpers; with none, no separator and no agent row (T12)', () => {
  const tasks = [task({ id: 'T01', done: true }), task({ id: 'T02', phase: 'building', since: NOW - 1000 })];
  const helpers = [helperRow({ id: 'main-sync', slug: 'resolve-main-merge' })];
  const d = buildDisplay({ branch: 'b', ceiling: 2, tasks, helpers, coordinator: agent() }, { now: NOW });
  assert.deepEqual(d.rows.map((r) => r.kind), ['done', 'building', 'separator', 'agent', 'building']);
  assert.deepEqual(d.rows.map((r) => r.id), ['T01', 'T02', '──', 'coordinator', 'main-sync']);
  assert.deepEqual(d.rows[3], { id: 'coordinator', slug: 'coordinator agent', agent: true, elapsedMs: null, kind: 'agent', label: 'on duty' });
  assert.deepEqual(rowEntries({ tasks, helpers, coordinator: agent() }).map((e) => e.id), ['T01', 'T02', '──', 'coordinator', 'main-sync']);

  for (const coordinator of [null, undefined]) {
    const none = buildDisplay({ branch: 'b', ceiling: 2, tasks, helpers, coordinator }, { now: NOW });
    assert.deepEqual(none.rows.map((r) => r.id), ['T01', 'T02', 'main-sync']);
    assert.deepEqual(rowEntries({ tasks, helpers, coordinator }).map((e) => e.id), ['T01', 'T02', 'main-sync']);
  }
});

test('the agent row states what it does and how much it holds (T12)', () => {
  const label = (c) => buildDisplay({ branch: 'b', ceiling: 1, tasks: [task()], coordinator: agent(c) }, { now: NOW }).rows[2];
  assert.equal(label({ holding: 0 }).label, 'on duty');
  assert.equal(label({ holding: 1 }).label, 'holding 1 question');
  assert.equal(label({ holding: 2 }).label, 'holding 2 questions');
  assert.equal(label({ state: 'restarting', live: false }).label, 'restarting');
  const gone = label({ state: 'given-up', live: false });
  assert.equal(gone.label, 'given up · questions come to you');
  assert.equal(gone.kind, 'agent-given-up');
  // A snapshot written before T12 has no state or holding: its `live` decides.
  assert.equal(label({ state: undefined, holding: undefined }).label, 'on duty');
  assert.equal(label({ state: undefined, holding: undefined, live: false }).label, 'restarting');
  for (const c of [{ holding: 3 }, { state: 'given-up' }]) assert.equal(label(c).elapsedMs, null, 'no clock');
});

test('the summary, askingCount and the footer are unchanged by the agent row (T12)', () => {
  const tasks = [
    task({ id: 'T01', done: true }),
    task({ id: 'T02', phase: 'asking', since: NOW - 3000, holder: 'person' }),
    task({ id: 'T03', phase: 'building', since: NOW - 3000, asking: 'permission', holder: 'coordinator' }),
    task({ id: 'T04', deps: ['T02'] }),
  ];
  const without = { branch: 'b', ceiling: 3, tasks };
  for (const coordinator of [agent({ holding: 1 }), agent({ state: 'given-up', live: false })]) {
    const withAgent = { ...without, coordinator };
    assert.deepEqual(buildDisplay(withAgent, { now: NOW }).summary, buildDisplay(without, { now: NOW }).summary);
    assert.deepEqual(buildDisplay(withAgent, { now: NOW }).footer, buildDisplay(without, { now: NOW }).footer);
    assert.equal(askingCount(withAgent), askingCount(without));
    assert.equal(askingCount(withAgent), 1);
  }
});
