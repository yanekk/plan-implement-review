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
