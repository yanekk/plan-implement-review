// The assertion layer proven with no live agent (DESIGN §4.1, T15 acceptance). Every fact-builder is
// exercised against a canned bundle that passes it and one that fails it, and the failing case's
// evidence points at the offending line/event. The bundles are hand-built in the exact shape T14's
// loadBundle + loadTranscripts produce; one test also drives the real load path off a temp dir to guard
// the T14→T15 seam. The one thing these cannot reach — a real worker producing the bundle — is T17.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadBundle } from './capture.mjs';
import {
  loadTranscripts,
  parseTranscript,
  sendMessagesOf,
  runIdentity,
  helloPerSpawn,
  noCloseBeforeIdle,
  byNameAddressing,
  questionRoundTrip,
  mergeConflictParked,
  conflictSurfacedAndParked,
  oneMergeToMain,
  killSwitchStoppedAll,
  ceilingHeld,
  checkScenario,
  formatReport,
} from './assertions.mjs';

const REPO = 'pir-h';
const PLAN = 'scratch';
const COORD = `${REPO} · ${PLAN}`;
const wname = (t, role = 'implement') => `${REPO} · ${PLAN} · ${t} · ${role}`;

// --- canned-bundle builders ----------------------------------------------------------------------

const fl = (ts, type, rest = '') => ({ ts, type, rest });
const tick = (ts, agents) => ({ ts, agents });

function wagent(task, status, { sessionId, state = 'working', role = 'implement' } = {}) {
  return { name: wname(task, role), sessionId: sessionId ?? 's' + task + role, cwd: '/wt/' + task, status, state, isWorkerOf: true, isCoordinator: false };
}
function cagent({ status = 'busy' } = {}) {
  return { name: COORD, sessionId: 'sc', cwd: '/c', status, state: 'working', isWorkerOf: false, isCoordinator: true };
}
// A SendMessage transcript event in the real shape (assistant tool_use { to, summary, message }).
function sendEvent(to, summary = '', message = '') {
  return { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'SendMessage', input: { to, summary, message } }] } };
}
function transcript(name, role, task, events = []) {
  return { key: name, name, role, task, sessionId: 'sess-' + (task || role), events };
}
// A minimal bundle with sensible empty defaults; a test overrides the fields its fact reads.
function bundle(over = {}) {
  return { dir: '/bundle', name: 'bundle', flow: [], timeline: [], final: [], manifest: {}, gitLog: '', transcripts: [], ...over };
}

// --- runIdentity ---------------------------------------------------------------------------------

test('runIdentity reads repo/plan/coordName from the timeline coordinator tag', () => {
  const b = bundle({ timeline: [tick('t1', [cagent(), wagent('T01', 'busy')])] });
  assert.deepEqual(runIdentity(b), { repo: REPO, plan: PLAN, coordName: COORD });
});

// --- transcripts: parse and the SendMessage accessor ---------------------------------------------

test('parseTranscript skips malformed lines; sendMessagesOf extracts SendMessage inputs', () => {
  const text = JSON.stringify(sendEvent(COORD, 'hi', 'body')) + '\nnot json\n' + JSON.stringify({ type: 'user', message: { role: 'user', content: 'x' } });
  const events = parseTranscript(text);
  assert.equal(events.length, 2, 'the malformed middle line is dropped');
  const t = transcript(wname('T01'), 'worker', 'T01', events);
  const sends = sendMessagesOf(t);
  assert.equal(sends.length, 1);
  assert.equal(sends[0].to, COORD);
  assert.equal(sends[0].summary, 'hi');
});

test('loadTranscripts maps the T14 manifest to parsed transcripts via an injected reader', () => {
  const manifest = {
    [COORD]: { sessionId: 'sc', cwd: '/c', role: 'coordinator', copied: true, copiedTo: 'transcripts/coordinator.jsonl' },
    [wname('T01')]: { sessionId: 's1', cwd: '/wt', role: 'worker', copied: true, copiedTo: 'transcripts/T01.jsonl' },
    [`${wname('T01')} (s2)`]: { sessionId: 's2', cwd: '/wt', role: 'worker', copied: false, copiedTo: null },
  };
  const files = {
    '/bundle/transcripts/coordinator.jsonl': JSON.stringify(sendEvent(wname('T01'), 'hello')),
    '/bundle/transcripts/T01.jsonl': JSON.stringify(sendEvent(COORD, 'question')),
  };
  const b = loadTranscripts(bundle({ manifest }), { readFile: (p) => { if (!(p in files)) throw new Error('nope'); return files[p]; } });
  assert.equal(b.transcripts.length, 3);
  const coord = b.transcripts.find((t) => t.role === 'coordinator');
  assert.equal(sendMessagesOf(coord)[0].to, wname('T01'));
  // The recurring-name reviewer session keeps its bare name (parses to a task) and reads copied:false as empty.
  const reviewer = b.transcripts.find((t) => t.sessionId === 's2');
  assert.equal(reviewer.name, wname('T01'));
  assert.equal(reviewer.task, 'T01');
  assert.deepEqual(reviewer.events, []);
});

test('loadTranscripts reads a real bundle written by capture.loadBundle (the T14 seam)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pir-t15-'));
  try {
    mkdirSync(join(dir, 'transcripts'), { recursive: true });
    writeFileSync(join(dir, 'transcripts', 'T01.jsonl'), JSON.stringify(sendEvent(COORD, 'q')) + '\n');
    writeFileSync(
      join(dir, 'manifest.json'),
      JSON.stringify({ [wname('T01')]: { sessionId: 's1', cwd: '/wt', role: 'worker', copied: true, copiedTo: join('transcripts', 'T01.jsonl') } }),
    );
    const b = loadTranscripts(loadBundle(dir));
    assert.equal(b.transcripts.length, 1);
    assert.equal(sendMessagesOf(b.transcripts[0])[0].to, COORD);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- helloPerSpawn -------------------------------------------------------------------------------

test('helloPerSpawn passes when every spawn/review has a hello and the coordinator addressed by name', () => {
  const b = bundle({
    flow: [fl('t1', 'spawn', 'T01'), fl('t1', 'hello', 'T01'), fl('t5', 'review', 'T01'), fl('t5', 'hello', 'T01')],
    timeline: [
      tick('t1', [cagent(), wagent('T01', 'busy')]),
      tick('t5', [cagent(), wagent('T01', 'busy', { role: 'review' })]),
    ],
    transcripts: [transcript(COORD, 'coordinator', null, [
      sendEvent(wname('T01', 'implement') + ' [ab12]', 'hello'),
      sendEvent(wname('T01', 'review'), 'hello'),
    ])],
  });
  const r = helloPerSpawn().check(b);
  assert.equal(r.pass, true, r.detail);
});

test('helloPerSpawn fails a spawn with no hello, evidence naming the task', () => {
  const b = bundle({
    flow: [fl('t1', 'spawn', 'T01')], // no hello
    timeline: [tick('t1', [cagent()])],
    transcripts: [transcript(COORD, 'coordinator', null, [sendEvent(wname('T01'), 'hello')])],
  });
  const r = helloPerSpawn().check(b);
  assert.equal(r.pass, false);
  assert.match(r.detail, /T01/);
});

test('helloPerSpawn fails when the coordinator never addressed the worker by name', () => {
  const b = bundle({
    flow: [fl('t1', 'spawn', 'T01'), fl('t1', 'hello', 'T01')],
    timeline: [tick('t1', [cagent(), wagent('T01', 'busy')])],
    transcripts: [transcript(COORD, 'coordinator', null, [sendEvent('someone-else', 'hi')])],
  });
  const r = helloPerSpawn().check(b);
  assert.equal(r.pass, false);
  assert.match(r.detail, /SendMessage to/);
});

// --- noCloseBeforeIdle (the T13 Problem B gate) --------------------------------------------------

test('noCloseBeforeIdle passes when an idle observation comes before the close', () => {
  const b = bundle({
    flow: [fl('2026-09-10T00:00:03.000Z', 'close', 'T01')],
    timeline: [
      tick('2026-09-10T00:00:01.000Z', [wagent('T01', 'busy')]),
      tick('2026-09-10T00:00:02.000Z', [wagent('T01', 'idle')]),
    ],
  });
  assert.equal(noCloseBeforeIdle().check(b).pass, true);
});

test('noCloseBeforeIdle fails when the close precedes any idle observation', () => {
  const b = bundle({
    flow: [fl('2026-09-10T00:00:02.000Z', 'close', 'T01')],
    timeline: [
      tick('2026-09-10T00:00:01.000Z', [wagent('T01', 'busy')]),
      tick('2026-09-10T00:00:03.000Z', [wagent('T01', 'idle')]), // idle only AFTER the close
    ],
  });
  const r = noCloseBeforeIdle().check(b);
  assert.equal(r.pass, false);
  assert.match(r.detail, /before its idle observation/);
});

test('noCloseBeforeIdle exempts a worker never seen busy (a dead/crashed one, §2.3)', () => {
  const b = bundle({ flow: [fl('t3', 'close', 'T02')], timeline: [tick('t1', [])] });
  assert.equal(noCloseBeforeIdle().check(b).pass, true);
});

// --- byNameAddressing ----------------------------------------------------------------------------

test('byNameAddressing passes when a worker addresses the coordinator by the convention name (even with a [ref])', () => {
  const b = bundle({
    timeline: [tick('t1', [cagent()])],
    transcripts: [transcript(wname('T01'), 'worker', 'T01', [sendEvent(`${COORD} [ab12]`, 'question'), sendEvent('pir-h / coord scratch [ab12]', 'question')])],
  });
  assert.equal(byNameAddressing().check(b).pass, true);
});

test('byNameAddressing fails when a worker only messages a non-convention name', () => {
  const b = bundle({
    timeline: [tick('t1', [cagent()])],
    transcripts: [transcript(wname('T01'), 'worker', 'T01', [sendEvent('pir-h / coord scratch [ab12]', 'question')])],
  });
  const r = byNameAddressing().check(b);
  assert.equal(r.pass, false);
  assert.match(r.detail, /never by/);
});

// --- questionRoundTrip ---------------------------------------------------------------------------

test('questionRoundTrip passes when a task is surfaced and later merged', () => {
  const b = bundle({
    flow: [fl('t2', 'surface', 'T03'), fl('t5', 'merge', 'T03')],
    timeline: [tick('t1', [cagent()])],
    transcripts: [transcript(COORD, 'coordinator', null, [sendEvent(wname('T03'), 'answer: option 1')])],
  });
  assert.equal(questionRoundTrip('T03').check(b).pass, true);
});

test('questionRoundTrip fails when a surfaced task never resumes to a merge', () => {
  const b = bundle({ flow: [fl('t2', 'surface', 'T03')] });
  const r = questionRoundTrip('T03').check(b);
  assert.equal(r.pass, false);
  assert.match(r.detail, /never resumed/);
});

// --- mergeConflictParked -------------------------------------------------------------------------

test('mergeConflictParked passes when a conflict is surfaced and no merge of the task landed', () => {
  const b = bundle({ flow: [fl('t2', 'surface', 'T05')], gitLog: "* abc (pir/scratch) merge pir/scratch-T04\n", timeline: [tick('t1', [cagent()])] });
  assert.equal(mergeConflictParked('T05').check(b).pass, true);
});

test('mergeConflictParked fails when the conflicting task was merged anyway', () => {
  const b = bundle({ flow: [fl('t2', 'surface', 'T05'), fl('t5', 'merge', 'T05')], timeline: [tick('t1', [cagent()])] });
  const r = mergeConflictParked('T05').check(b);
  assert.equal(r.pass, false);
  assert.match(r.detail, /merged despite/);
});

test('mergeConflictParked fails when the git log shows the task branch merged', () => {
  const b = bundle({ flow: [fl('t2', 'surface', 'T05')], gitLog: 'merge pir/scratch-T05\n', timeline: [tick('t1', [cagent()])] });
  assert.equal(mergeConflictParked('T05').check(b).pass, false);
});

// --- conflictSurfacedAndParked (task-agnostic) ---------------------------------------------------

test('conflictSurfacedAndParked passes when the winner merged, the surfaced loser did not, and nothing promoted', () => {
  // Ceiling-2 shape: T01 (winner) merged clean; T02 (loser) surfaced and was parked; no promotion.
  const b = bundle({
    flow: [fl('t3', 'merge', 'T01'), fl('t4', 'surface', 'T02')],
    gitLog: "* abc (pir/scratch) merge pir/scratch-T01\n",
    timeline: [tick('t1', [cagent()])],
  });
  assert.equal(conflictSurfacedAndParked().check(b).pass, true);
});

test('conflictSurfacedAndParked fails when no task was surfaced', () => {
  const r = conflictSurfacedAndParked().check(bundle({ flow: [fl('t3', 'merge', 'T01')] }));
  assert.equal(r.pass, false);
  assert.match(r.detail, /no surface/);
});

test('conflictSurfacedAndParked fails when a surfaced task merged anyway', () => {
  const b = bundle({ flow: [fl('t4', 'surface', 'T02'), fl('t5', 'merge', 'T02')], timeline: [tick('t1', [cagent()])] });
  const r = conflictSurfacedAndParked().check(b);
  assert.equal(r.pass, false);
  assert.match(r.detail, /merged anyway/);
});

test('conflictSurfacedAndParked fails when a promotion happened despite a parked conflict', () => {
  const b = bundle({
    flow: [fl('t4', 'surface', 'T02'), fl('t9', 'promote', 'pir/scratch')],
    gitLog: "Merge branch 'pir/scratch'\n",
    timeline: [tick('t1', [cagent()])],
  });
  const r = conflictSurfacedAndParked().check(b);
  assert.equal(r.pass, false);
  assert.match(r.detail, /main did not stay clean/);
});

// --- oneMergeToMain ------------------------------------------------------------------------------

test('oneMergeToMain passes on exactly one promote and one promotion merge in the git log', () => {
  const b = bundle({ flow: [fl('t9', 'promote', 'pir/scratch')], gitLog: "*   Merge branch 'pir/scratch'\n| * T01\n", timeline: [tick('t1', [cagent()])] });
  assert.equal(oneMergeToMain().check(b).pass, true);
});

test('oneMergeToMain fails when nothing was promoted', () => {
  const r = oneMergeToMain().check(bundle({ flow: [fl('t5', 'merge', 'T01')] }));
  assert.equal(r.pass, false);
  assert.match(r.detail, /exactly one promote/);
});

test('oneMergeToMain fails when the git log shows two promotion merges', () => {
  const b = bundle({ flow: [fl('t9', 'promote', 'pir/scratch')], gitLog: "Merge branch 'pir/scratch'\nMerge branch 'pir/scratch'\n", timeline: [tick('t1', [cagent()])] });
  assert.equal(oneMergeToMain().check(b).pass, false);
});

// --- killSwitchStoppedAll ------------------------------------------------------------------------

test('killSwitchStoppedAll passes when halt-close fired, no promote, and no worker survives the last tick', () => {
  const b = bundle({
    flow: [fl('t3', 'halt-close', ''), fl('t3', 'halt-close', '')],
    timeline: [tick('t1', [wagent('T01', 'busy'), wagent('T02', 'busy')]), tick('t4', [cagent()])],
  });
  assert.equal(killSwitchStoppedAll().check(b).pass, true);
});

test('killSwitchStoppedAll fails when a worker is still live after the kill switch', () => {
  const b = bundle({ flow: [fl('t3', 'halt-close', '')], timeline: [tick('t4', [wagent('T01', 'busy')])] });
  const r = killSwitchStoppedAll().check(b);
  assert.equal(r.pass, false);
  assert.match(r.detail, /still live/);
});

test('killSwitchStoppedAll fails when a promote happened despite the halt', () => {
  const b = bundle({ flow: [fl('t3', 'halt-close', ''), fl('t5', 'promote', 'pir/scratch')], timeline: [tick('t6', [])] });
  assert.equal(killSwitchStoppedAll().check(b).pass, false);
});

// --- ceilingHeld ---------------------------------------------------------------------------------

test('ceilingHeld(2) passes when at most two workers are live at once', () => {
  const b = bundle({ timeline: [tick('t1', [wagent('T01', 'busy'), wagent('T02', 'busy')]), tick('t2', [wagent('T02', 'busy')])] });
  assert.equal(ceilingHeld(2).check(b).pass, true);
});

test('ceilingHeld(2) fails when three workers are live in one tick', () => {
  const b = bundle({ timeline: [tick('t1', [wagent('T01', 'busy'), wagent('T02', 'busy'), wagent('T03', 'busy')])] });
  const r = ceilingHeld(2).check(b);
  assert.equal(r.pass, false);
  assert.match(r.detail, /exceeds the ceiling/);
});

// --- checkScenario + formatReport ----------------------------------------------------------------

test('checkScenario fails the scenario when a single fact fails, and formatReport shows the evidence', () => {
  const b = bundle({ flow: [fl('t1', 'spawn', 'T01'), fl('t1', 'hello', 'T01')], transcripts: [transcript(COORD, 'coordinator', null, [sendEvent(wname('T01'), 'hello')])], timeline: [tick('t1', [cagent(), wagent('T01', 'busy')])] });
  const spec = { id: 'demo', facts: [helloPerSpawn(), questionRoundTrip('T09')] };
  const report = checkScenario(spec, b);
  assert.equal(report.pass, false, 'one failing fact fails the scenario');
  assert.equal(report.facts.find((f) => f.id === 'hello-per-spawn').pass, true);
  const printed = formatReport(report);
  assert.match(printed, /\[FAIL\] scenario: demo/);
  assert.match(printed, /✓ A hello opens every worker channel/);
  assert.match(printed, /✗ A question on T09/);
});

test('checkScenario reports a throwing fact as failed rather than aborting', () => {
  const boom = { id: 'boom', label: 'explodes', check: () => { throw new Error('kaboom'); } };
  const report = checkScenario({ id: 'x', facts: [boom] }, bundle());
  assert.equal(report.pass, false);
  assert.match(report.facts[0].detail, /kaboom/);
});
