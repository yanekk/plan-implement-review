// The scenario spec proven pure (DESIGN §4.1, T15). defineScenario normalizes and validates a spec:
// it fills the low seatbelt defaults, requires an id, a fixture and at least one fact, and rejects a
// "fact" that is not a { check } from assertions.mjs. No clock, no I/O, no live agent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineScenario, DEFAULT_SEATBELTS } from './scenario.mjs';
import { noHelloEver, ceilingHeld } from './assertions.mjs';

test('defineScenario fills the seatbelt defaults and passes the facts through', () => {
  const s = defineScenario({ id: 'single', fixture: 'fixtures/single', facts: [noHelloEver()] });
  assert.equal(s.id, 'single');
  assert.equal(s.title, 'single', 'title defaults to the id');
  assert.deepEqual(s.seatbelts, DEFAULT_SEATBELTS);
  assert.equal(s.facts.length, 1);
});

test('defineScenario lets a scenario raise its ceiling while keeping the other seatbelts', () => {
  const s = defineScenario({ id: 'parallel', title: 'N parallel', fixture: 'fixtures/parallel', seatbelts: { ceiling: 3 }, facts: [ceilingHeld(3)] });
  assert.equal(s.seatbelts.ceiling, 3);
  assert.equal(s.seatbelts.timeoutMs, DEFAULT_SEATBELTS.timeoutMs, 'the timeout default is kept');
  assert.equal(s.seatbelts.killSwitch, true);
  assert.equal(s.title, 'N parallel');
});

test('defineScenario rejects a spec with no id, no fixture, or no facts', () => {
  assert.throws(() => defineScenario({ fixture: 'f', facts: [noHelloEver()] }), /needs a string id/);
  assert.throws(() => defineScenario({ id: 's', facts: [noHelloEver()] }), /needs a fixture/);
  assert.throws(() => defineScenario({ id: 's', fixture: 'f', facts: [] }), /at least one fact/);
});

test('defineScenario rejects a fact that is not a { check } builder result', () => {
  assert.throws(() => defineScenario({ id: 's', fixture: 'f', facts: [{ id: 'nope' }] }), /must be a \{ id, label, check \}/);
});

test('defineScenario: holdMerges defaults off and is a boolean', () => {
  const spec = (holdMerges) => defineScenario({ id: 'a', fixture: 'f', facts: [noHelloEver()], holdMerges }).holdMerges;
  assert.equal(spec(undefined), false);
  assert.equal(spec(true), true);
});

test('defineScenario: answerPending defaults off and normalises to { typed } (T18)', () => {
  const spec = (answerPending) => defineScenario({ id: 'a', fixture: 'f', facts: [noHelloEver()], answerPending }).answerPending;
  assert.equal(spec(undefined), false);
  assert.deepEqual(spec(true), { typed: {}, say: {}, afterWake: {} });
  assert.deepEqual(spec({ typed: { 'Q?': 'mine' }, say: { T04: 'go' } }), { typed: { 'Q?': 'mine' }, say: { T04: 'go' }, afterWake: {} });
  assert.deepEqual(spec({ afterWake: { T02: 'blue' } }), { typed: {}, say: {}, afterWake: { T02: 'blue' } });
});

test('defineScenario: statusSnapshots defaults off (real-asking-state T05)', () => {
  const base = { id: 'a', fixture: 'f', facts: [noHelloEver()] };
  assert.equal(defineScenario(base).statusSnapshots, false);
  assert.equal(defineScenario({ ...base, statusSnapshots: true }).statusSnapshots, true);
});

test('defineScenario: kind defaults to build; a plan scenario carries its reply and cap (pir-plan-command T17)', () => {
  const base = { id: 'a', fixture: 'f', facts: [noHelloEver()] };
  const b = defineScenario(base);
  assert.equal(b.kind, 'build');
  assert.equal(b.reply, null);
  const p = defineScenario({ ...base, kind: 'plan', reply: 'Yes.', replyCap: 40 });
  assert.deepEqual([p.kind, p.reply, p.replyCap], ['plan', 'Yes.', 40]);
  assert.throws(() => defineScenario({ ...base, kind: 'nope' }), /kind must be one of/);
  assert.throws(() => defineScenario({ ...base, kind: 'plan', replyCap: 40 }), /needs a reply text/);
  assert.throws(() => defineScenario({ ...base, kind: 'plan', reply: 'Yes.', replyCap: 0 }), /positive whole replyCap/);
});
