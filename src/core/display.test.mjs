// The pure display model, exercised exhaustively without a terminal (DESIGN §2.3, §4). The in-place
// painting itself is the renderer's and is hand-verified (T09); everything a person reads off a row —
// the kind, the label, the elapsed clock, the counts, the footer — is a rule, and a rule only a person
// can check is a rule that rots. So the vocabulary lives here, tested in milliseconds.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDisplay } from './display.mjs';

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
  assert.deepEqual(by.T05, { id: 'T05', slug: 'ask-one', kind: 'asking', label: 'asking you', elapsedMs: 9000 });
  // T06 waits on the not-done T05; the label names the unmet dep (§2.3).
  assert.deepEqual(by.T06, { id: 'T06', slug: 'waits-on-05', kind: 'waiting', label: 'needs T05', elapsedMs: null });
  // T07 is ready and, since the ceiling (5) is not full (four active workers), simply queued.
  assert.deepEqual(by.T07, { id: 'T07', slug: 'ready-one', kind: 'queued', label: 'queued', elapsedMs: null });
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

// --- footer: a coordinator-side merge conflict carries the copy-paste resolution prompt (T14) --------

test('an asking task that hit a merge conflict carries its copy-paste prompt on the footer; a plain question does not (T14, §2.8)', () => {
  // A conflict is modelled as an asking task with a `prompt` (buildConflictPrompt's output, carried by
  // the shell from the parked worker's decision). The model carries it as DATA so the vocabulary is
  // testable without a terminal; the live renderer keeps its frame compact and the shell prints the block
  // on the normal screen (T15, §2.3).
  const PROMPT = 'Merge conflict on T05 ask-one …\n  git merge pir/demo\n  KEEP: ____';
  const conflicted = buildDisplay(
    { branch: 'pir/demo', ceiling: 4, tasks: [task({ id: 'T05', slug: 'ask-one', phase: 'asking', since: NOW, question: 'merge conflict in greeting.txt', prompt: PROMPT })] },
    { now: NOW },
  ).footer;
  assert.equal(conflicted.kind, 'asking');
  assert.equal(conflicted.prompt, PROMPT, 'the conflicted footer carries the ready-to-paste prompt block');

  // A plain question (no prompt) keeps the unchanged footer shape — no `prompt` key at all.
  const plain = buildDisplay(
    { branch: 'pir/demo', ceiling: 4, tasks: [task({ id: 'T05', slug: 'ask-one', phase: 'asking', since: NOW, question: 'which format?' })] },
    { now: NOW },
  ).footer;
  assert.deepEqual(plain, { kind: 'asking', task: 'T05', slug: 'ask-one', question: 'which format?' }, 'a plain question footer is unchanged — no prompt key');
});
