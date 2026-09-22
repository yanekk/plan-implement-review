import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serializeSnapshot, parseSnapshot } from './snapshot.mjs';
import { buildDisplay } from './display.mjs';

// A representative live snapshot: the process facts T05 records, no final state (the run is live),
// and a runState carrying every task shape buildDisplay reads — a done task, a building one, a
// parked "asking you" one, an idle one blocked on a dependency, and one queued behind the ceiling.
const liveRunState = () => ({
  branch: 'pir/detached-runs',
  ceiling: 2,
  complete: false,
  readyToMerge: false,
  interrupted: false,
  tasks: [
    { id: 'T01', slug: 'run-state', deps: [], done: true, phase: null, since: null, doneMs: 4200, question: null, prompt: null },
    { id: 'T02', slug: 'index-record', deps: [], done: false, phase: 'building', since: 1700000000000, doneMs: null, question: null, prompt: null },
    { id: 'T05', slug: 'process-identity', deps: ['T01'], done: false, phase: 'asking', since: 1700000005000, doneMs: null, question: 'survives a terminal restart?', prompt: null },
    { id: 'T04', slug: 'dashboard-model', deps: ['T01'], done: false, phase: null, since: null, doneMs: null, question: null, prompt: null },
    { id: 'T06', slug: 'index-store', deps: [], done: false, phase: null, since: null, doneMs: null, question: null, prompt: null },
  ],
});

const liveSnapshot = () => ({
  version: 1,
  proc: {
    pid: 54321,
    startTime: 'Tue Sep 22 08:27:37 2026',
    slug: 'detached-runs',
    repo: 'plan-implement-review',
    branch: 'pir/detached-runs',
    startedAt: '2026-09-22T08:27:37.000Z',
  },
  finalState: null,
  runState: liveRunState(),
});

test('round-trip: parseSnapshot(serializeSnapshot(s)) deep-equals s', () => {
  const s = liveSnapshot();
  assert.deepEqual(parseSnapshot(serializeSnapshot(s)), s);
});

test('round-trip holds for a finished run (finalState carried through)', () => {
  const s = { ...liveSnapshot(), finalState: 'finished' };
  assert.deepEqual(parseSnapshot(serializeSnapshot(s)), s);
});

test('round-trip holds for a stopped run', () => {
  const s = { ...liveSnapshot(), finalState: 'stopped' };
  assert.deepEqual(parseSnapshot(serializeSnapshot(s)), s);
});

test('a parsed runState is accepted by buildDisplay without error', () => {
  const parsed = parseSnapshot(serializeSnapshot(liveSnapshot()));
  const out = buildDisplay(parsed.runState, { now: 1700000010000 });
  // buildDisplay ran and produced its model — the snapshot's runState is the exact shape it consumes.
  assert.equal(out.branch, 'pir/detached-runs');
  assert.equal(out.summary.total, 5);
  assert.equal(out.summary.done, 1);
  assert.equal(out.rows.length, 5);
  // The asking task surfaces on the footer, proving the parked-worker fields survived the round-trip.
  assert.equal(out.footer.kind, 'asking');
  assert.equal(out.footer.task, 'T05');
  assert.equal(out.footer.question, 'survives a terminal restart?');
});

test('serialize output is a JSON string the parser reads back', () => {
  const text = serializeSnapshot(liveSnapshot());
  assert.equal(typeof text, 'string');
  assert.doesNotThrow(() => JSON.parse(text));
});

test('non-JSON text → null', () => {
  assert.equal(parseSnapshot('not json at all {'), null);
  assert.equal(parseSnapshot(''), null);
  assert.equal(parseSnapshot('{ "version": 1, '), null); // truncated / torn file
});

test('wrong top-level type → null', () => {
  assert.equal(parseSnapshot('[]'), null); // an array
  assert.equal(parseSnapshot('42'), null); // a bare number
  assert.equal(parseSnapshot('"a string"'), null);
  assert.equal(parseSnapshot('null'), null); // JSON null
});

test('wrong version → null', () => {
  const s = liveSnapshot();
  const text = JSON.stringify({ ...s, version: 2 });
  assert.equal(parseSnapshot(text), null);
  const noVersion = JSON.stringify({ proc: s.proc, finalState: null, runState: s.runState });
  assert.equal(parseSnapshot(noVersion), null);
});

test('missing proc → null', () => {
  const s = liveSnapshot();
  const text = JSON.stringify({ version: 1, finalState: null, runState: s.runState });
  assert.equal(parseSnapshot(text), null);
});

test('missing runState → null', () => {
  const s = liveSnapshot();
  const text = JSON.stringify({ version: 1, proc: s.proc, finalState: null });
  assert.equal(parseSnapshot(text), null);
});

test('proc present but not an object → null', () => {
  const s = liveSnapshot();
  const text = JSON.stringify({ version: 1, proc: 'nope', finalState: null, runState: s.runState });
  assert.equal(parseSnapshot(text), null);
});

test('finalState absent → parsed snapshot with finalState null (a live run)', () => {
  const s = liveSnapshot();
  const text = JSON.stringify({ version: 1, proc: s.proc, runState: s.runState }); // no finalState key
  const parsed = parseSnapshot(text);
  assert.notEqual(parsed, null);
  assert.equal(parsed.finalState, null);
});

test('finalState explicit null → valid, stays null', () => {
  const parsed = parseSnapshot(serializeSnapshot({ ...liveSnapshot(), finalState: null }));
  assert.equal(parsed.finalState, null);
});

test('finalState out of the set → null snapshot', () => {
  const s = liveSnapshot();
  for (const bad of ['finish', 'FINISHED', 'crashed', 'running', 'done', 42, true]) {
    const text = JSON.stringify({ version: 1, proc: s.proc, finalState: bad, runState: s.runState });
    assert.equal(parseSnapshot(text), null, `finalState ${JSON.stringify(bad)} should reject the snapshot`);
  }
});

test('an empty tasks array is valid (a run that has not dispatched yet)', () => {
  const s = liveSnapshot();
  s.runState = { branch: 'pir/detached-runs', ceiling: 2, tasks: [] };
  const parsed = parseSnapshot(serializeSnapshot(s));
  assert.notEqual(parsed, null);
  assert.deepEqual(parsed.runState.tasks, []);
  // and it still paints: buildDisplay handles a run with nothing dispatched.
  const out = buildDisplay(parsed.runState, { now: 1700000010000 });
  assert.equal(out.summary.total, 0);
  assert.equal(out.rows.length, 0);
});

test('parseSnapshot never throws, whatever the string', () => {
  const inputs = ['', '{', '}', '[', 'undefined', 'NaN', '\u0000', '{"version":1}', '{"version":1,"proc":{}}', '🙂', '{"a":', 'true'];
  for (const input of inputs) {
    assert.doesNotThrow(() => parseSnapshot(input), `threw on ${JSON.stringify(input)}`);
  }
});

test('serializeSnapshot normalises an absent finalState to null in its output', () => {
  const { finalState, ...noFinal } = liveSnapshot(); // build a snap object with no finalState key
  const parsed = parseSnapshot(serializeSnapshot(noFinal));
  assert.equal(parsed.finalState, null);
});
