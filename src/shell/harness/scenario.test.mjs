// The scenario spec proven pure (DESIGN §4.1, T15). defineScenario normalizes and validates a spec:
// it fills the low seatbelt defaults, requires an id, a fixture and at least one fact, and rejects a
// "fact" that is not a { check } from assertions.mjs. No clock, no I/O, no live agent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineScenario, DEFAULT_SEATBELTS } from './scenario.mjs';
import { helloPerSpawn, ceilingHeld } from './assertions.mjs';

test('defineScenario fills the seatbelt defaults and passes the facts through', () => {
  const s = defineScenario({ id: 'single', fixture: 'fixtures/single', facts: [helloPerSpawn()] });
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
  assert.throws(() => defineScenario({ fixture: 'f', facts: [helloPerSpawn()] }), /needs a string id/);
  assert.throws(() => defineScenario({ id: 's', facts: [helloPerSpawn()] }), /needs a fixture/);
  assert.throws(() => defineScenario({ id: 's', fixture: 'f', facts: [] }), /at least one fact/);
});

test('defineScenario rejects a fact that is not a { check } builder result', () => {
  assert.throws(() => defineScenario({ id: 's', fixture: 'f', facts: [{ id: 'nope' }] }), /must be a \{ id, label, check \}/);
});
