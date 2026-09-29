import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { helpersOf, runningHelpers, helperOfFrame } from './helpers.mjs';

// Cut from plans/visible-helpers/evidence/plan-0339-helper.ndjson: the planner starts a background Explore
// helper, asks a question while it runs, the person interrupts, Claude kills the helper, and a later turn
// claims to be waiting for it.
const lines = readFileSync(new URL('./fixtures/helper-sample.ndjson', import.meta.url), 'utf8').split('\n').filter(Boolean);
const sample = lines.map((l) => JSON.parse(l));
const HELPER = 'a84a4013ffcebe5e4';
const AGENT_CALL = 'toolu_01DkrWKh5q7BdwWzubBcNeKW';
const endIndex = sample.findIndex((e) => e.event?.subtype === 'task_updated');
const interruptIndex = sample.findIndex((e) => e.dir === 'out' && e.kind === 'interrupt');

// Builders for hand-made entries, shaped as DESIGN §2.1.
let clock = 1;
const at = (e) => ({ t: clock++, ...e });
const sys = (subtype, fields) => at({ dir: 'in', event: { type: 'system', subtype, ...fields } });
const started = (id, toolUseId, o = {}) => sys('task_started', {
  task_id: id, tool_use_id: toolUseId, description: `helper ${id}`, subagent_type: 'Explore', is_backgrounded: true, task_type: 'local_agent', ...o,
});
const progress = (id, toolUseId, description, toolUses, durationMs) => sys('task_progress', {
  task_id: id, tool_use_id: toolUseId, description, last_tool_name: 'Read', usage: { tool_uses: toolUses, duration_ms: durationMs },
});
const updated = (id, status) => sys('task_updated', { task_id: id, patch: { status } });
const notified = (id, status) => sys('task_notification', { task_id: id, status });
const agentCall = (id, parent = null) => at({ dir: 'in', event: { type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Agent', input: {} }] }, parent_tool_use_id: parent } });
const resumed = () => at({ dir: 'note', kind: 'resumed' });

test('helpersOf on the recording: one background Explore helper, running, then stopped by the interrupt', () => {
  const before = helpersOf(sample.slice(0, endIndex));
  assert.equal(before.length, 1);
  const [h] = before;
  assert.equal(h.id, HELPER);
  assert.equal(h.toolUseId, AGENT_CALL);
  assert.equal(h.description, 'Survey end-of-run machinery');
  assert.equal(h.subagentType, 'Explore');
  assert.equal(h.background, true);
  assert.equal(h.state, 'running');
  assert.match(h.step, /^Running grep -n "mainContains/, 'the last progress step');
  assert.equal(h.steps, 20);
  assert.equal(h.durationMs, 52040);
  assert.equal(h.endedAt, null);
  assert.deepEqual(runningHelpers(sample.slice(0, endIndex)).map((x) => x.id), [HELPER]);

  const after = helpersOf(sample);
  assert.equal(after.length, 1);
  assert.equal(after[0].state, 'stopped', 'task_updated killed maps to stopped');
  assert.equal(after[0].endedAt, endIndex);
  assert.ok(endIndex > interruptIndex);
  assert.deepEqual(runningHelpers(sample), []);
});

test('helpersOf reads raw log lines as well as parsed entries', () => {
  assert.deepEqual(helpersOf(lines), helpersOf(sample));
});

test('a helper with no progress yet: no step, 0 steps, no time', () => {
  const [h] = helpersOf([started('h1', 'call1')]);
  assert.deepEqual({ step: h.step, steps: h.steps, durationMs: h.durationMs, state: h.state }, { step: '', steps: 0, durationMs: null, state: 'running' });
});

test('a foreground helper reads background false, the other fields alike', () => {
  const [h] = helpersOf([started('h1', 'call1', { is_backgrounded: false, subagent_type: undefined }), progress('h1', 'call1', 'Reading a.mjs', 3, 1200)]);
  assert.equal(h.background, false);
  assert.equal(h.subagentType, '');
  assert.deepEqual([h.step, h.steps, h.durationMs, h.state], ['Reading a.mjs', 3, 1200, 'running']);
});

test('end mapping: completed → finished, failed → failed, killed and stopped → stopped', () => {
  for (const [status, state] of [['completed', 'finished'], ['failed', 'failed'], ['killed', 'stopped'], ['stopped', 'stopped']]) {
    assert.equal(helpersOf([started('h', 'c'), updated('h', status)])[0].state, state, `task_updated ${status}`);
    assert.equal(helpersOf([started('h', 'c'), notified('h', status)])[0].state, state, `task_notification ${status}`);
  }
});

test('either end event alone ends the helper, and the first status seen wins', () => {
  const onlyNotification = helpersOf([started('h', 'c'), notified('h', 'completed')]);
  assert.deepEqual([onlyNotification[0].state, onlyNotification[0].endedAt], ['finished', 1]);
  const onlyUpdate = helpersOf([started('h', 'c'), updated('h', 'failed')]);
  assert.deepEqual([onlyUpdate[0].state, onlyUpdate[0].endedAt], ['failed', 1]);
  const both = helpersOf([started('h', 'c'), updated('h', 'killed'), notified('h', 'completed')]);
  assert.deepEqual([both[0].state, both[0].endedAt], ['stopped', 1]);
  const reverse = helpersOf([started('h', 'c'), notified('h', 'completed'), updated('h', 'killed')]);
  assert.deepEqual([reverse[0].state, reverse[0].endedAt], ['finished', 1]);
});

test('a task_updated with no status (or an unknown one) does not end the helper', () => {
  const [h] = helpersOf([started('h', 'c'), sys('task_updated', { task_id: 'h', patch: { end_time: 5 } }), updated('h', 'running')]);
  assert.equal(h.state, 'running');
});

test('a helper seen only in frames, with no task_started, is not listed', () => {
  const frame = at({ dir: 'in', event: { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] }, parent_tool_use_id: 'callX' } });
  assert.deepEqual(helpersOf([frame, progress('hX', 'callX', 'Reading', 1, 10), updated('hX', 'completed')]), []);
});

test('a background Bash task_started is not a helper', () => {
  assert.deepEqual(helpersOf([started('b1', 'bash1', { task_type: 'local_bash' })]), []);
});

test('a resumed note mid-helper ends it as stopped; a helper ended before it keeps its state', () => {
  const log = [started('h1', 'c1'), started('h2', 'c2'), updated('h1', 'completed'), resumed(), progress('h2', 'c2', 'late', 9, 9)];
  const [h1, h2] = helpersOf(log);
  assert.deepEqual([h1.state, h1.endedAt], ['finished', 2]);
  assert.deepEqual([h2.state, h2.endedAt], ['stopped', 3]);
  assert.deepEqual(runningHelpers(log), []);
});

test('two helpers are listed in start order, each with its own progress', () => {
  const log = [started('h2', 'c2'), started('h1', 'c1'), progress('h1', 'c1', 'one', 1, 100), progress('h2', 'c2', 'two', 2, 200), updated('h2', 'completed')];
  const hs = helpersOf(log);
  assert.deepEqual(hs.map((h) => [h.id, h.step, h.state]), [['h2', 'two', 'finished'], ['h1', 'one', 'running']]);
  assert.deepEqual(runningHelpers(log).map((h) => h.id), ['h1']);
});

test('helperOfFrame: a helper\'s own frame resolves to it; a nested helper\'s frames roll up to the outer one', () => {
  const log = [
    agentCall('outerCall'),
    started('outer', 'outerCall'),
    agentCall('innerCall', 'outerCall'), // the outer helper spawns its own helper
    started('inner', 'innerCall', { is_backgrounded: false }),
    agentCall('deepCall', 'innerCall'), // and that one spawns another, with no task_started of its own
    agentCall('otherCall'),
    started('other', 'otherCall'),
  ];
  const hs = helpersOf(log);
  assert.equal(helperOfFrame(hs, 'outerCall', log).id, 'outer');
  assert.equal(helperOfFrame(hs, 'innerCall', log).id, 'outer');
  assert.equal(helperOfFrame(hs, 'deepCall', log).id, 'outer');
  assert.equal(helperOfFrame(hs, 'otherCall', log).id, 'other');
  assert.equal(helperOfFrame(hs, 'unknownCall', log), null);
  assert.equal(helperOfFrame(hs, null, log), null);
  assert.equal(helperOfFrame(hs, '', log), null);
});

test('helperOfFrame on the recording: the helper\'s frames resolve to it', () => {
  const hs = helpersOf(sample);
  assert.equal(helperOfFrame(hs, AGENT_CALL, sample).id, HELPER);
});
