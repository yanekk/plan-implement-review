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
  loadFinalFiles,
  parseTranscript,
  sendMessagesOf,
  runIdentity,
  helloPerSpawn,
  noCloseBeforeIdle,
  byNameAddressing,
  questionRoundTrip,
  mergeConflictResolved,
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

// --- mergeConflictResolved (task-agnostic, Option 2, T28) ----------------------------------------

// A bundle in the Option-2 shape: T01 (winner) merged clean; T02 conflicted, was surfaced, the decision
// was delivered (`answer T02`), and T02 resumed to a merge; one promotion; main carries the decided side.
function resolvedBundle(over = {}) {
  return bundle({
    flow: [
      fl('t3', 'merge', 'T01'),
      fl('t4', 'surface', 'T02'),
      fl('t5', 'answer', 'T02'),
      fl('t6', 'merge', 'T02'),
      fl('t9', 'promote', 'pir/scratch'),
    ],
    gitLog: "*   Merge branch 'pir/scratch'\n| * merge pir/scratch-T02\n| * merge pir/scratch-T01\n",
    timeline: [tick('t1', [cagent(), wagent('T02', 'idle', { sessionId: 's2i', role: 'implement' })])],
    finalFiles: { 'greeting.txt': 'hello there\n' },
    ...over,
  });
}
const decided = { file: 'greeting.txt', content: 'hello there' };

test('mergeConflictResolved passes when the conflict was kept alive, decided, resumed, and the decided side reached main', () => {
  assert.equal(mergeConflictResolved(decided).check(resolvedBundle()).pass, true);
});

test('mergeConflictResolved fails when no task was surfaced', () => {
  const r = mergeConflictResolved(decided).check(bundle({ flow: [fl('t3', 'merge', 'T01')] }));
  assert.equal(r.pass, false);
  assert.match(r.detail, /no task surface/);
});

test('mergeConflictResolved fails when the surfaced task was never answered and merged (the T22 failure)', () => {
  // Surfaced but no `answer` and no later merge — the worker was closed and the decision had no way down.
  const r = mergeConflictResolved(decided).check(
    bundle({ flow: [fl('t4', 'surface', 'T02')], timeline: [tick('t1', [cagent()])] }),
  );
  assert.equal(r.pass, false);
  assert.match(r.detail, /not resolved through the live worker/);
});

test('mergeConflictResolved fails when the LOSING side shipped to main (the T22 regression)', () => {
  const r = mergeConflictResolved(decided).check(resolvedBundle({ finalFiles: { 'greeting.txt': 'hi world\n' } }));
  assert.equal(r.pass, false);
  assert.match(r.detail, /losing side shipped/);
});

test('mergeConflictResolved fails when the task was respawned (a second implement session)', () => {
  const r = mergeConflictResolved(decided).check(
    resolvedBundle({
      timeline: [
        tick('t1', [cagent(), wagent('T02', 'idle', { sessionId: 's2i', role: 'implement' })]),
        tick('t2', [cagent(), wagent('T02', 'busy', { sessionId: 's2i-again', role: 'implement' })]),
      ],
    }),
  );
  assert.equal(r.pass, false);
  assert.match(r.detail, /respawned/);
});

test('mergeConflictResolved fails when the decided content was not captured', () => {
  const r = mergeConflictResolved(decided).check(resolvedBundle({ finalFiles: {} }));
  assert.equal(r.pass, false);
  assert.match(r.detail, /no captured final content/);
});

// --- loadFinalFiles ------------------------------------------------------------------------------

test('loadFinalFiles reads the bundle final-files.json into bundle.finalFiles; missing → {}', () => {
  const files = { 'greeting.txt': 'hello there\n' };
  const withFiles = loadFinalFiles(bundle({ dir: '/b' }), { readFile: () => JSON.stringify(files) });
  assert.deepEqual(withFiles.finalFiles, files);
  const missing = loadFinalFiles(bundle({ dir: '/b' }), { readFile: () => { throw new Error('ENOENT'); } });
  assert.deepEqual(missing.finalFiles, {});
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

// A dependent-task worker brings the feature branch into its own task branch before signalling done;
// git labels that `Merge branch 'pir/scratch' into pir/scratch-T03`. That merge shares the promotion
// prefix but never touches main, so it must NOT be counted as a second promotion (review-queue
// after-run false-FAIL, 2026-09-13).
test('oneMergeToMain passes when a worker integration merge shares the promotion prefix', () => {
  const gitLog =
    "*   Merge branch 'pir/scratch'\n" +
    "| * reconcile T03\n" +
    "| |   a8717af Merge branch 'pir/scratch' into pir/scratch-T03\n" +
    '| * T01\n';
  const b = bundle({ flow: [fl('t9', 'promote', 'pir/scratch')], gitLog, timeline: [tick('t1', [cagent()])] });
  const r = oneMergeToMain().check(b);
  assert.equal(r.pass, true, r.detail);
  assert.ok(r.evidence.includes('git log promotion merges: 1'));
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

test('ceilingHeld(2) fails when three distinct tasks are in flight in one tick', () => {
  const b = bundle({ timeline: [tick('t1', [wagent('T01', 'busy'), wagent('T02', 'busy'), wagent('T03', 'busy')])] });
  const r = ceilingHeld(2).check(b);
  assert.equal(r.pass, false);
  assert.match(r.detail, /exceeds the ceiling/);
});

// The clean-merge false-FAIL (2026-09-13): a review handoff lists the just-stopped implementer beside
// its fresh reviewer, and with two parallel tasks the raw session count peaks at 3. Grouping by task,
// T02's implement+review overlap is one slot, so the true ceiling of 2 held.
test('ceilingHeld(2) passes across a review handoff — implementer+reviewer of a task is one slot', () => {
  const b = bundle({ timeline: [tick('peak', [
    wagent('T01', 'busy', { role: 'review' }),
    wagent('T02', 'idle', { role: 'implement' }), // stopped, still listed (async claude stop)
    wagent('T02', 'busy', { role: 'review' }),
  ])] });
  const r = ceilingHeld(2).check(b);
  assert.equal(r.pass, true, r.detail);
  assert.match(r.detail, /peak of 2 worker slot/);
});

// A respawn runaway (the 2026-09-09 shape): duplicate SAME-role sessions for one task. That is a real
// second paid agent, not a handoff, so the extra session adds a slot and trips even a single-slot ceiling.
test('ceilingHeld(1) fails on a duplicate same-role session for one task (respawn runaway)', () => {
  const b = bundle({ timeline: [tick('t1', [
    wagent('T01', 'busy', { role: 'implement', sessionId: 'a' }),
    wagent('T01', 'busy', { role: 'implement', sessionId: 'b' }),
  ])] });
  const r = ceilingHeld(1).check(b);
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
