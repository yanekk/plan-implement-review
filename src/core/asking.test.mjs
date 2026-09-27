import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitingOn } from './asking.mjs';

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
