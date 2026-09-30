import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { helpersOf, runningHelpers, helperOfFrame, interruptGate, gateWarning, stoppedByInterrupt, helpersNote } from './helpers.mjs';

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

test('a helper\'s own helper is not listed: it rolls up into the outer one (DESIGN §2.1)', () => {
  const log = [
    agentCall('outerCall'),
    started('outer', 'outerCall'),
    agentCall('innerCall', 'outerCall'),
    started('inner', 'innerCall'),
    progress('inner', 'innerCall', 'inner step', 4, 400),
  ];
  assert.deepEqual(helpersOf(log).map((h) => h.id), ['outer']);
  assert.deepEqual(runningHelpers(log).map((h) => h.id), ['outer']);
  assert.equal(helpersOf(log)[0].step, '', 'the inner helper\'s progress is not the outer one\'s');
  // The CLI may yield the inner task_started before the helper frame holding its Agent call.
  const reordered = [log[0], log[1], log[3], log[2]];
  assert.deepEqual(helpersOf(reordered).map((h) => h.id), ['outer']);
});

// ---- The interrupt rules (T04, DESIGN §2.5, §2.6, §2.8) ----

const interrupt = () => at({ dir: 'out', from: 'person', kind: 'interrupt' });
const result = () => at({ dir: 'in', event: { type: 'result', subtype: 'success', result: '' } });
const message = (text, helpersStopped) => at({ dir: 'out', from: 'person', kind: 'message', text, ...(helpersStopped ? { helpersStopped } : {}) });
const H1 = { id: 'h1', description: 'Survey the code' };
const H2 = { id: 'h2', description: 'Check the tests' };

test('interruptGate: every row of the table', () => {
  for (const key of ['escape', 'ctrl+c-empty']) {
    assert.deepEqual(interruptGate(null, key, []), { gate: null, send: true }, `${key}, nothing running: interrupt at once`);
    assert.deepEqual(interruptGate(null, key, [H1, H2]), { gate: { armed: true, helpers: [H1, H2] }, send: false }, `${key}, helpers running: arm`);
    const armed = { armed: true, helpers: [H1] };
    assert.deepEqual(interruptGate(armed, key, [H1]), { gate: null, send: true }, `${key} while armed: send`);
    assert.deepEqual(interruptGate(armed, key, []), { gate: null, send: true }, `${key} while armed, helper ended since: still send`);
  }
  assert.deepEqual(interruptGate({ armed: true, helpers: [H1] }, 'other', [H1]), { gate: null, send: false }, 'other key disarms');
  assert.deepEqual(interruptGate(null, 'other', [H1]), { gate: null, send: false });
  assert.deepEqual(interruptGate(null, 'escape', undefined), { gate: null, send: true }, 'no running list reads as none');
});

test('gateWarning: singular and plural, start order kept; nothing when not armed', () => {
  assert.equal(gateWarning({ armed: true, helpers: [H1] }), 'esc again to interrupt · this also stops 1 helper: Survey the code');
  assert.equal(gateWarning({ armed: true, helpers: [H1, H2] }), 'esc again to interrupt · this also stops 2 helpers: Survey the code; Check the tests');
  assert.equal(gateWarning({ armed: true, helpers: [H2, H1] }), 'esc again to interrupt · this also stops 2 helpers: Check the tests; Survey the code');
  assert.equal(gateWarning(null), '');
});

test('stoppedByInterrupt on the recording: the helper the interrupt killed, until a message reports it', () => {
  assert.deepEqual(stoppedByInterrupt(sample).map((h) => h.id), [HELPER]);
  assert.deepEqual(stoppedByInterrupt(lines).map((h) => h.id), [HELPER], 'raw lines read the same');
  assert.deepEqual(stoppedByInterrupt(sample.slice(0, endIndex)), [], 'not yet ended');
  assert.deepEqual(stoppedByInterrupt([...sample, message('go on', [HELPER])]), []);
  assert.deepEqual(stoppedByInterrupt([...lines, JSON.stringify(message('go on', [HELPER]))]), [], 'reported in a raw line');
  assert.deepEqual(stoppedByInterrupt([...sample, message('go on', ['someone-else'])]).map((h) => h.id), [HELPER]);
});

test('stoppedByInterrupt leaves out a helper that completed after an interrupt, or that the agent stopped itself', () => {
  assert.deepEqual(stoppedByInterrupt([started('h', 'c'), interrupt(), updated('h', 'completed'), result()]), []);
  assert.deepEqual(stoppedByInterrupt([started('h', 'c'), interrupt(), updated('h', 'failed'), result()]), []);
  assert.deepEqual(stoppedByInterrupt([started('h', 'c'), updated('h', 'stopped'), result()]), [], 'no interrupt before it');
  assert.deepEqual(stoppedByInterrupt([started('h', 'c'), interrupt(), result(), updated('h', 'stopped')]), [], 'after the interrupt\'s result');
});

test('stoppedByInterrupt: two interrupts, one helper stopped by each, no message between → both, in start order', () => {
  const log = [started('h1', 'c1'), started('h2', 'c2'), interrupt(), updated('h2', 'killed'), result(), interrupt(), notified('h1', 'stopped'), result()];
  assert.deepEqual(stoppedByInterrupt(log).map((h) => h.id), ['h1', 'h2']);
});

test('stoppedByInterrupt: an interrupt of an idle parent (no result after it) whose helper ends killed is included', () => {
  const log = [started('h', 'c'), result(), interrupt(), updated('h', 'killed'), notified('h', 'stopped')];
  assert.deepEqual(stoppedByInterrupt(log).map((x) => x.id), ['h']);
});

test('stoppedByInterrupt: a helper a resumed note ended is not included, even inside an interrupt window', () => {
  assert.deepEqual(stoppedByInterrupt([started('h', 'c'), resumed()]), []);
  assert.deepEqual(stoppedByInterrupt([started('h', 'c'), interrupt(), resumed()]), []);
});

test('stoppedByInterrupt: a message sent before the helper ended does not count as reporting it', () => {
  const log = [started('h', 'c'), message('first', ['h']), interrupt(), updated('h', 'killed')];
  assert.deepEqual(stoppedByInterrupt(log).map((x) => x.id), ['h']);
});

test('helpersNote: singular, plural, empty → null, a double quote kept as written', () => {
  assert.equal(helpersNote([]), null);
  assert.equal(helpersNote(undefined), null);
  assert.equal(helpersNote([H1]), '[pir] Before this message, the person\'s interrupt stopped your helper: "Survey the code". It will not report back. Start it again or do the work yourself if it is still needed.');
  assert.equal(helpersNote([H1, H2]), '[pir] Before this message, the person\'s interrupt stopped your helpers: "Survey the code", "Check the tests". They will not report back. Start them again or do the work yourself if it is still needed.');
  const note = helpersNote([{ id: 'q', description: 'Find "mainTip" callers' }]);
  assert.ok(note.includes('"Find "mainTip" callers"'), note);
  assert.ok(!note.includes('\\'), 'no escaping backslashes');
});

test('stoppedByInterrupt: an idle-parent interrupt\'s window closes at the person\'s next message, so a helper the agent stops itself in the new turn is not included', () => {
  // Nothing was running, so the interrupt went at once and no result followed it (§2.1); the next turn
  // then starts a helper and stops it itself before its own result.
  const log = [result(), interrupt(), message('go on'), started('h', 'c'), updated('h', 'stopped'), result()];
  assert.deepEqual(stoppedByInterrupt(log), []);
});
