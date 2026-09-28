import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stoppedOnPerson, waitingOn } from './asking.mjs';

const parked = (decision = {}) => ({ phase: 'awaiting-answer', decision: { kind: 'question', text: 'which?', ...decision } });
const act = (o) => ({ state: o.open ? 'busy' : 'idle', turns: 0, open: false, pending: [], ...o });

test('waitingOn: a pending request names its kind, even on a task still implementing', () => {
  const t = { phase: 'implementing' };
  assert.equal(waitingOn(t, act({ state: 'permission', open: true, turns: 2 })), 'permission');
  assert.equal(waitingOn(t, act({ state: 'questions', open: true, turns: 2 })), 'questions');
  assert.equal(waitingOn(undefined, act({ state: 'permission', open: true })), 'permission', 'no tracked task: the request still waits');
});

test('waitingOn: a request inside the open asking turn outranks the report', () => {
  assert.equal(waitingOn(parked({ askEnd: 3 }), act({ state: 'permission', open: true, turns: 2 })), 'permission');
});

test('waitingOn: parked but the asking turn is still open, nothing pending → working (T10)', () => {
  assert.equal(waitingOn(parked(), act({ open: true, turns: 2 })), null, 'first pass, askEnd not yet set');
  assert.equal(waitingOn(parked({ askEnd: 3 }), act({ open: true, turns: 2 })), null, 'turns < askEnd: the asking turn');
});

test('waitingOn: parked and the turn has ended → question', () => {
  assert.equal(waitingOn(parked(), act({ open: false, turns: 3 })), 'question');
  assert.equal(waitingOn(parked({ askEnd: 3 }), act({ open: false, turns: 3 })), 'question');
});

test('waitingOn: a later non-answer turn (a background wake-up) keeps the task asking (§2.1)', () => {
  assert.equal(waitingOn(parked({ askEnd: 3 }), act({ open: true, turns: 3 })), 'question');
  assert.equal(waitingOn(parked({ askEnd: 3 }), act({ open: true, turns: 5 })), 'question');
});

test('waitingOn: a conflict fix pir sent asks the person nothing', () => {
  assert.equal(waitingOn(parked({ kind: 'conflict', sent: true }), act({ open: false, turns: 3 })), null);
  assert.equal(waitingOn(parked({ kind: 'conflict', sent: true }), undefined), null);
});

test('waitingOn: an unseen worker keeps the parked reading', () => {
  assert.equal(waitingOn(parked(), undefined), 'question');
});

test('waitingOn: a task not parked and no request → null', () => {
  assert.equal(waitingOn({ phase: 'implementing' }, act({ open: true, turns: 1 })), null);
  assert.equal(waitingOn({ phase: 'reviewing' }, undefined), null);
  assert.equal(waitingOn(undefined, undefined), null);
});

// --- stopped-worker-asking T02: a stopped implementer or reviewer is waiting on the person ------------

const stopped = (o = {}) => act({ open: false, turns: 3, background: [], ...o });

test('stoppedOnPerson: idle with no background job running, and nothing else', () => {
  assert.equal(stoppedOnPerson(stopped()), true);
  assert.equal(stoppedOnPerson(stopped({ background: ['bg1'] })), false, 'a job of its own still running');
  assert.equal(stoppedOnPerson(act({ open: false, turns: 3 })), false, 'no `background` field: pir cannot see its jobs');
  assert.equal(stoppedOnPerson({ state: 'idle', pending: [] }), false, 'the fake platform shape');
  for (const state of ['busy', 'permission', 'questions', 'starting']) {
    assert.equal(stoppedOnPerson(stopped({ state })), false, state);
  }
  assert.equal(stoppedOnPerson(undefined), false);
  assert.equal(stoppedOnPerson(null), false);
  assert.equal(stoppedOnPerson({ state: 'idle', background: 'x' }), false, 'a non-array is not an empty list');
});

test('waitingOn: an implementer or reviewer that stopped is asking a question', () => {
  assert.equal(waitingOn({ phase: 'implementing' }, stopped()), 'question');
  assert.equal(waitingOn({ phase: 'reviewing' }, stopped()), 'question');
});

test('waitingOn: an implementer idle behind its own background job is working', () => {
  assert.equal(waitingOn({ phase: 'implementing' }, stopped({ background: ['bg1'] })), null);
  assert.equal(waitingOn({ phase: 'reviewing' }, stopped({ background: ['bg1', 'bg2'] })), null);
});

test('waitingOn: a busy implementer, or one pir cannot see, is working', () => {
  assert.equal(waitingOn({ phase: 'implementing' }, stopped({ state: 'busy', open: true })), null);
  assert.equal(waitingOn({ phase: 'implementing' }, undefined), null);
  assert.equal(waitingOn({ phase: 'implementing' }, act({ open: false, turns: 3 })), null, 'no `background` field');
});

test('waitingOn: a stopped worker in any other phase is not asking', () => {
  for (const phase of ['review-ready', 'done', 'preparing', 'verifying']) {
    assert.equal(waitingOn({ phase }, stopped()), null, phase);
  }
  assert.equal(waitingOn(undefined, stopped()), null, 'no tracked task');
});

test('waitingOn: a conflict fix pir sent stays unasked when its worker stops', () => {
  assert.equal(waitingOn(parked({ kind: 'conflict', sent: true }), stopped()), null);
});

test('waitingOn: a pending request on an implementer still names its kind, background or not', () => {
  assert.equal(waitingOn({ phase: 'implementing' }, stopped({ state: 'permission', background: ['bg1'] })), 'permission');
  assert.equal(waitingOn({ phase: 'reviewing' }, stopped({ state: 'questions' })), 'questions');
});

test('waitingOn: a report park reads as before when the activity carries `background`', () => {
  assert.equal(waitingOn(parked({ askEnd: 3 }), stopped({ state: 'busy', open: true, turns: 2 })), null, 'still in the asking turn');
  assert.equal(waitingOn(parked({ askEnd: 3 }), stopped()), 'question');
  assert.equal(waitingOn(parked({ askEnd: 3 }), stopped({ background: ['bg1'] })), 'question', 'a report park ignores the job');
  assert.equal(waitingOn(parked({ askEnd: 3 }), stopped({ state: 'busy', open: true, turns: 4 })), 'question', 'a wake-up turn');
});

// ---- pir-coordinator T04: waiting items and who holds them ----

import { waitingItems, holderOf, waitingFor, itemKey } from './asking.mjs';

const permReq = (id, command = 'npm test') => ({ kind: 'permission', requestId: id, toolName: 'Bash', input: { command } });
const qReq = (id) => ({ kind: 'questions', requestId: id, questions: [{ question: 'Colour?', options: [] }], input: {} });
const live = (id, task, activity) => ({ id, task, live: true, activity });

test('waitingItems: one item per pending request and one per ended report park', () => {
  const stateTasks = { T01: { workerId: 'a', ...parked({ askEnd: 1 }) }, T02: { workerId: 'b', phase: 'implementing' } };
  const workers = [
    live('a', 'T01', act({ open: false, turns: 1 })),
    live('b', 'T02', act({ state: 'permission', open: true, pending: [permReq('r1'), qReq('r2')] })),
    { id: 'c', task: 'T03', live: false, activity: act({ state: 'permission', pending: [permReq('r9')] }) },
  ];
  assert.deepEqual(waitingItems(stateTasks, workers), [
    { worker: 'a', task: 'T01', kind: 'report', text: 'which?' },
    { worker: 'b', task: 'T02', kind: 'permission', requestId: 'r1', request: permReq('r1') },
    { worker: 'b', task: 'T02', kind: 'questions', requestId: 'r2', request: qReq('r2') },
  ]);
});

test('waitingItems: a park still inside its asking turn, a fix pir sent, or a worker not holding the task is no item', () => {
  const stateTasks = { T01: { workerId: 'a', ...parked() }, T02: { workerId: 'x', ...parked() }, T03: { workerId: 'c', ...parked({ kind: 'conflict', sent: true }) } };
  const workers = [live('a', 'T01', act({ open: true, turns: 0 })), live('b', 'T02', act({ turns: 3 })), live('c', 'T03', act({ turns: 3 }))];
  assert.deepEqual(waitingItems(stateTasks, workers), []);
});

test('waitingItems: a reserved permission carries reservedFor (destructive list and ask rules)', () => {
  const workers = [live('a', 'T01', act({ state: 'permission', pending: [permReq('r1', 'rm -rf build'), permReq('r2', 'git push origin HEAD'), permReq('r3', 'ls')] }))];
  const items = waitingItems({}, workers, { askRules: ['Bash(git push:*)'] });
  assert.equal(items[0].reserved.kind, 'destructive');
  assert.equal(items[1].reserved.kind, 'ask-rule');
  assert.equal(items[2].reserved, undefined);
});

test('holderOf: the agent holds a worker only while it holds every item; none waiting → null', () => {
  const a = { worker: 'w', kind: 'permission', requestId: 'r1' };
  const b = { worker: 'w', kind: 'report' };
  assert.equal(itemKey(a), 'w:r1');
  assert.equal(itemKey(b), 'w:report');
  assert.equal(holderOf([], new Set()), null);
  assert.equal(holderOf([a, b], new Set()), 'person', 'no live agent: every item is the person\'s');
  assert.equal(holderOf([a, b], new Set(['w:r1'])), 'person');
  assert.equal(holderOf([a, b], new Set(['w:r1', 'w:report'])), 'coordinator');
});

test('waitingFor: waitingOn\'s kind plus the holder; an unkeyable item is the person\'s', () => {
  const t = { workerId: 'w', ...parked({ askEnd: 1 }) };
  assert.equal(waitingFor(t, act({ turns: 1 }), { heldByAgent: new Set() }).holder, 'person');
  assert.deepEqual(waitingFor(t, act({ turns: 1 }), { heldByAgent: new Set(['w:report']) }), { kind: 'question', holder: 'coordinator' });
  assert.deepEqual(waitingFor(t, undefined, { heldByAgent: new Set(['w:report']) }), { kind: 'question', holder: 'person' }, 'unseen worker');
  assert.deepEqual(waitingFor(undefined, act({ state: 'permission', pending: [] }), { workerId: 'w' }), { kind: 'permission', holder: 'person' });
  assert.equal(waitingFor({ phase: 'implementing' }, act({ open: true })), null);
});
