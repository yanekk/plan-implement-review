// live-drill.mjs's decisions, proven without a pty or a paid worker (live-workers T18): which task needs
// what from the logs, and the picker keys for each kind of question. The live half is the drill itself.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { taskViews, nextAction, questionKeys, TYPED_NAME } from './live-drill.mjs';

const init = { t: 1, dir: 'in', event: { type: 'system', subtype: 'init', session_id: 's' } };
const pauseUse = { t: 2, dir: 'in', event: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'p1', name: 'Bash', input: { command: 'node -e "setTimeout(() => {}, 90000)"' } }] } } };
const pauseDone = { t: 3, dir: 'in', event: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'p1', content: '' }] } } };
const request = (id, toolName, input = {}) => ({ t: 4, dir: 'request', requestId: id, toolName, input });
const result = { t: 5, dir: 'in', event: { type: 'result', subtype: 'success' } };
const log = (file, ...entries) => ({ file, entries: [init, ...entries] });

test('taskViews reads the latest log per task: its role, activity, pending requests and the running pause', () => {
  const v = taskViews([
    log('T01-implement-1.ndjson', pauseUse),
    log('T02-implement-1.ndjson', request('r1', 'Bash', { command: 'touch approved.txt' })),
    log('T03-implement-1.ndjson', result),
    log('T03-review-1.ndjson'),
    { file: 'notes.txt', entries: [] },
  ]);
  assert.equal(v.T01.pausing, true);
  assert.equal(v.T02.pending[0].kind, 'permission');
  assert.equal(v.T03.role, 'review', 'the review log is the latest');
  assert.equal(taskViews([log('T01-implement-1.ndjson', pauseUse, pauseDone)]).T01.pausing, false);
});

test('nextAction interrupts T01 during its pause once, then answers each request once, then looks at T04', () => {
  const views = {
    T01: { role: 'implement', pausing: true, pending: [] },
    T02: { role: 'implement', pending: [{ kind: 'permission', requestId: 'r1' }] },
    T04: { role: 'implement', state: 'idle', pending: [] },
  };
  const done = new Set();
  const order = [];
  for (let a = nextAction(views, done); a; a = nextAction(views, done)) {
    order.push(a.id);
    done.add(a.id);
  }
  assert.deepEqual(order, ['interrupt', 'permission:r1', 'watch-background']);
  assert.equal(nextAction({ T01: { role: 'review', pausing: true } }), null, 'a reviewer is never interrupted');
});

test('questionKeys: a pick-several ticks two, a name is typed on Other, any other pick-one takes ↓ Enter', () => {
  const keys = questionKeys({
    questions: [
      { question: 'Which extras should extras.txt list?', multiSelect: true, options: [{ label: 'apples' }, { label: 'pears' }, { label: 'plums' }] },
      { question: 'What name should name.txt hold?', options: [{ label: 'Ada' }, { label: 'Grace' }] },
    ],
  }).map((s) => s.keys);
  assert.deepEqual(keys, [' ', '\x1b[B', '\x1b[B', ' ', '\r', '\x1b[A', '\r', TYPED_NAME, '\r', '\r']);
  const single = questionKeys({ questions: [{ question: 'Which greeting?', options: [{ label: 'a' }, { label: 'b' }] }] });
  assert.deepEqual(single.map((s) => s.keys), ['\x1b[B', '\r']);
  assert.ok(single.at(-1).until.test('⚑ answer sent — waiting for pir to deliver it'));
});
