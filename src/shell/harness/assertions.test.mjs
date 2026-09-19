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
  loadControlFeeds,
  parseTranscript,
  sendMessagesOf,
  runIdentity,
  noHelloEver,
  noCloseBeforeIdle,
  parkedWorkerHoldsSlot,
  mergeConflictResolved,
  oneMergeToMain,
  killSwitchStoppedAll,
  ceilingHeld,
  reachedWidth,
  resumedNotRebuilt,
  noRebuildFrom,
  feedsCleared,
  leftoverSessionsReaped,
  checkScenario,
  formatReport,
} from './assertions.mjs';

const REPO = 'pir-h';
const PLAN = 'scratch';
// A coordinator-shaped name for the transcript-loader mechanics tests (the loader tags role from the
// manifest, not the name). There is no coordinator SESSION any more (DESIGN §2.9), so this is a plain
// two-field label that parseAgentName reports as not-a-worker.
const COORD = `${REPO} / ${PLAN}`;
const wname = (t, role = 'implement') => `${REPO} / ${PLAN} / ${t} / work / ${role}`;

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

test('runIdentity reads repo/plan from a worker; there is no coordinator name (DESIGN §2.9)', () => {
  const b = bundle({ timeline: [tick('t1', [wagent('T01', 'busy')])] });
  assert.deepEqual(runIdentity(b), { repo: REPO, plan: PLAN, coordName: null });
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

// --- noHelloEver (T30: the spawn hello is retired) -----------------------------------------------

test('noHelloEver passes a run that spawned workers and logged zero hello lines', () => {
  const b = bundle({
    flow: [fl('t1', 'spawn', 'T01'), fl('t5', 'review', 'T01'), fl('t9', 'merge', 'T01'), fl('t9', 'promote', 'pir/scratch')],
  });
  const r = noHelloEver().check(b);
  assert.equal(r.pass, true, r.detail);
});

test('noHelloEver fails when any hello line is present in the flow', () => {
  const b = bundle({
    flow: [fl('t1', 'spawn', 'T01'), fl('t1', 'hello', 'T01')],
  });
  const r = noHelloEver().check(b);
  assert.equal(r.pass, false, r.detail);
  assert.match(r.detail, /hello/);
});

test('noHelloEver does not pass vacuously over an empty flow (nothing ran)', () => {
  const r = noHelloEver().check(bundle({ flow: [] }));
  assert.equal(r.pass, false, r.detail);
  assert.match(r.detail, /vacuous|nothing ran/);
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

// --- parkedWorkerHoldsSlot (DESIGN §2.2, §2.8: a park costs only its own task, nothing routed) ----

test('parkedWorkerHoldsSlot passes when the task surfaced, held its slot, nothing was routed, and another task merged', () => {
  const b = bundle({
    flow: [fl('t2', 'surface', 'T01'), fl('t5', 'merge', 'T02')],
    timeline: [tick('t1', [wagent('T01', 'busy'), wagent('T02', 'busy')]), tick('t3', [wagent('T01', 'idle')])],
  });
  assert.equal(parkedWorkerHoldsSlot('T01').check(b).pass, true);
});

test('parkedWorkerHoldsSlot fails when a decision was routed down (an answer line — the old relay)', () => {
  const b = bundle({
    flow: [fl('t2', 'surface', 'T01'), fl('t3', 'answer', 'T01'), fl('t5', 'merge', 'T02')],
    timeline: [tick('t3', [wagent('T01', 'idle')])],
  });
  const r = parkedWorkerHoldsSlot('T01').check(b);
  assert.equal(r.pass, false);
  assert.match(r.detail, /routed a decision down/);
});

test('parkedWorkerHoldsSlot fails when the park stalled the run (no other task merged)', () => {
  const b = bundle({
    flow: [fl('t2', 'surface', 'T01')],
    timeline: [tick('t3', [wagent('T01', 'idle')])],
  });
  const r = parkedWorkerHoldsSlot('T01').check(b);
  assert.equal(r.pass, false);
  assert.match(r.detail, /no other task merged/);
});

test('parkedWorkerHoldsSlot fails when the parked worker was not held (never sampled live after it surfaced)', () => {
  const b = bundle({
    flow: [fl('t2', 'surface', 'T01'), fl('t5', 'merge', 'T02')],
    timeline: [tick('t1', [wagent('T01', 'busy')])], // only BEFORE the surface
  });
  const r = parkedWorkerHoldsSlot('T01').check(b);
  assert.equal(r.pass, false);
  assert.match(r.detail, /slot was not held/);
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
    bundle({ flow: [fl('t4', 'surface', 'T02')], timeline: [tick('t1', [cagent(), wagent('T01', 'busy')])] }),
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
  const b = bundle({ flow: [fl('t9', 'promote', 'pir/scratch')], gitLog: "*   Merge branch 'pir/scratch'\n| * T01\n", timeline: [tick('t1', [cagent(), wagent('T01', 'busy')])] });
  assert.equal(oneMergeToMain().check(b).pass, true);
});

test('oneMergeToMain fails when nothing was promoted', () => {
  const r = oneMergeToMain().check(bundle({ flow: [fl('t5', 'merge', 'T01')] }));
  assert.equal(r.pass, false);
  assert.match(r.detail, /exactly one promote/);
});

test('oneMergeToMain fails when the git log shows two promotion merges', () => {
  const b = bundle({ flow: [fl('t9', 'promote', 'pir/scratch')], gitLog: "Merge branch 'pir/scratch'\nMerge branch 'pir/scratch'\n", timeline: [tick('t1', [cagent(), wagent('T01', 'busy')])] });
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
  const b = bundle({ flow: [fl('t9', 'promote', 'pir/scratch')], gitLog, timeline: [tick('t1', [cagent(), wagent('T01', 'busy')])] });
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

// --- reachedWidth --------------------------------------------------------------------------------

test('reachedWidth(2) passes when two task implementers are busy in one tick', () => {
  const b = bundle({ timeline: [tick('t1', [wagent('T02', 'busy'), wagent('T03', 'busy')])] });
  const r = reachedWidth(2).check(b);
  assert.equal(r.pass, true, r.detail);
  assert.match(r.detail, /2 task implementer/);
});

// The one-at-a-time failure: the same two tasks build, but never in the SAME tick. ceilingHeld would
// pass (never more than one at once); reachedWidth is exactly the fact that catches serial work.
test('reachedWidth(2) fails when the tasks only ever build in separate ticks (one at a time)', () => {
  const b = bundle({ timeline: [tick('t1', [wagent('T02', 'busy')]), tick('t2', [wagent('T03', 'busy')])] });
  const r = reachedWidth(2).check(b);
  assert.equal(r.pass, false);
  assert.match(r.detail, /below the required width/);
});

// Counts by task, not by roster row: two listed sessions for ONE task (a respawn / a stopped session
// lingering beside its successor) are width 1, so a duplicate cannot fake concurrency.
test('reachedWidth(2) counts by task — two sessions of one task are width 1, not 2', () => {
  const b = bundle({ timeline: [tick('t1', [
    wagent('T02', 'busy', { sessionId: 'a' }),
    wagent('T02', 'busy', { sessionId: 'b' }),
  ])] });
  assert.equal(reachedWidth(2).check(b).pass, false);
});

// A reviewer is a follow-on session, not a build in flight: one busy implementer beside a busy
// reviewer is width 1.
test('reachedWidth(2) does not count a reviewer as an implementer slot', () => {
  const b = bundle({ timeline: [tick('t1', [
    wagent('T02', 'busy', { role: 'implement' }),
    wagent('T03', 'busy', { role: 'review' }),
  ])] });
  assert.equal(reachedWidth(2).check(b).pass, false);
});

// Strict on `busy`: an idle-but-listed implementer (gone quiet, or a stopped session still in the
// roster) is not a build running right now, so it does not count toward the width.
test('reachedWidth(2) counts only busy implementers, not an idle-but-listed one', () => {
  const b = bundle({ timeline: [tick('t1', [
    wagent('T02', 'busy', { role: 'implement' }),
    wagent('T03', 'idle', { role: 'implement' }),
  ])] });
  const r = reachedWidth(2).check(b);
  assert.equal(r.pass, false);
  // ...but once both are genuinely busy in some tick, the fact passes.
  const b2 = bundle({ timeline: [
    tick('t1', [wagent('T02', 'busy'), wagent('T03', 'idle')]),
    tick('t2', [wagent('T02', 'busy'), wagent('T03', 'busy')]),
  ] });
  assert.equal(reachedWidth(2).check(b2).pass, true);
});

// --- restart facts (T06) -------------------------------------------------------------------------
//
// A restart bundle carries TWO `restart` flow markers (startupControlHygiene runs on every launch); the
// second is the boundary between the dead run and the resumed one. These are hand-built in that shape.

// A resumed run: T02 built (one implement session) before the crash, then adopted to a reviewer and merged
// after the boundary; no rebuild.
const resumedBundle = () =>
  bundle({
    flow: [
      fl('2026-01-01T00:00:00Z', 'restart'),
      fl('2026-01-01T00:00:05Z', 'merge', 'T01'),
      fl('2026-01-01T00:00:10Z', 'restart'), // ← the boundary (resumed run's hygiene)
      fl('2026-01-01T00:00:11Z', 'review', 'T02'),
      fl('2026-01-01T00:00:12Z', 'merge', 'T02'),
    ],
    timeline: [
      tick('2026-01-01T00:00:03Z', [cagent(), wagent('T02', 'busy', { sessionId: 'i2', role: 'implement' })]),
      tick('2026-01-01T00:00:11Z', [cagent(), wagent('T02', 'busy', { sessionId: 'r2', role: 'review' })]),
    ],
  });

test('resumedNotRebuilt passes when the 🔍 task was adopted and merged with one implement session', () => {
  const r = resumedNotRebuilt('T02').check(resumedBundle());
  assert.equal(r.pass, true, r.detail);
});

test('resumedNotRebuilt fails when the task was rebuilt (a rebuild line + a second implementer)', () => {
  const b = resumedBundle();
  b.flow.splice(3, 0, fl('2026-01-01T00:00:10Z', 'rebuild', 'T02'), fl('2026-01-01T00:00:11Z', 'spawn', 'T02'));
  b.timeline[1].agents.push(wagent('T02', 'busy', { sessionId: 'i2b', role: 'implement' })); // a second build
  const r = resumedNotRebuilt('T02').check(b);
  assert.equal(r.pass, false);
  assert.match(r.detail, /rebuilt/);
});

test('resumedNotRebuilt fails vacuously-safe when the run never restarted (one marker)', () => {
  const b = resumedBundle();
  b.flow = b.flow.filter((e) => e.type !== 'restart').concat([fl('2026-01-01T00:00:00Z', 'restart')]);
  const r = resumedNotRebuilt('T02').check(b);
  assert.equal(r.pass, false);
  assert.match(r.detail, /did not restart/);
});

// A left-alone run: T01 merged before the crash and untouched after it.
const leftAloneBundle = () =>
  bundle({
    flow: [
      fl('2026-01-01T00:00:00Z', 'restart'),
      fl('2026-01-01T00:00:05Z', 'merge', 'T01'),
      fl('2026-01-01T00:00:10Z', 'restart'),
      fl('2026-01-01T00:00:12Z', 'merge', 'T02'),
    ],
    timeline: [tick('2026-01-01T00:00:03Z', [cagent(), wagent('T01', 'busy', { sessionId: 'i1', role: 'implement' })])],
  });

test('noRebuildFrom passes when the ✅+merged task is untouched after the restart', () => {
  const r = noRebuildFrom('T01').check(leftAloneBundle());
  assert.equal(r.pass, true, r.detail);
});

test('noRebuildFrom fails when the done task is re-dispatched after the restart', () => {
  const b = leftAloneBundle();
  b.flow.push(fl('2026-01-01T00:00:11Z', 'spawn', 'T01')); // re-dispatched after the boundary
  const r = noRebuildFrom('T01').check(b);
  assert.equal(r.pass, false);
  assert.match(r.detail, /after the restart/);
});

test('noRebuildFrom fails when the task was never finished before the restart (unprovable)', () => {
  const b = leftAloneBundle();
  b.flow = b.flow.filter((e) => !(e.type === 'merge' && e.rest === 'T01')); // no pre-crash merge of T01
  const r = noRebuildFrom('T01').check(b);
  assert.equal(r.pass, false);
  assert.match(r.detail, /not merged before/);
});

// feedsCleared reads bundle.controlFeeds (loadControlFeeds).
const twoRestarts = [fl('2026-01-01T00:00:00Z', 'restart'), fl('2026-01-01T00:00:10Z', 'restart')];

test('feedsCleared passes when a seeded sentinel is gone from every transient feed after restart', () => {
  const b = bundle({
    flow: twoRestarts,
    controlFeeds: { seeded: true, sentinel: 'STALE-X', feeds: { answers: '', outbox: '', surfaced: '', reports: [] } },
  });
  assert.equal(feedsCleared().check(b).pass, true);
});

test('feedsCleared fails naming the feed that kept the stale sentinel', () => {
  const b = bundle({
    flow: twoRestarts,
    controlFeeds: { seeded: true, sentinel: 'STALE-X', feeds: { answers: '{"stale":"STALE-X"}\n', outbox: '', surfaced: '', reports: ['STALE-X.json'] } },
  });
  const r = feedsCleared().check(b);
  assert.equal(r.pass, false);
  assert.match(r.detail, /answers/);
  assert.match(r.detail, /reports\//);
});

test('feedsCleared fails vacuously-safe when nothing was seeded (clearing unproven)', () => {
  const b = bundle({ flow: twoRestarts, controlFeeds: { seeded: false } });
  const r = feedsCleared().check(b);
  assert.equal(r.pass, false);
  assert.match(r.detail, /no stale feed was seeded/);
});

test('loadControlFeeds attaches control-feeds.json and defaults to unseeded on a missing file', () => {
  const seeded = loadControlFeeds(bundle(), { readFile: () => JSON.stringify({ seeded: true, sentinel: 'S', feeds: {} }) });
  assert.equal(seeded.controlFeeds.seeded, true);
  const missing = loadControlFeeds(bundle(), { readFile: () => { throw new Error('no file'); } });
  assert.deepEqual(missing.controlFeeds, { seeded: false });
});

// leftoverSessionsReaped: a pre-crash worker session must be gone by the final tick, ceiling held.
const reapedBundle = () =>
  bundle({
    flow: twoRestarts,
    timeline: [
      tick('2026-01-01T00:00:03Z', [cagent(), wagent('T02', 'busy', { sessionId: 'w2', role: 'implement' })]), // pre-crash
      tick('2026-01-01T00:00:11Z', [cagent(), wagent('T02', 'busy', { sessionId: 'r2', role: 'review' })]), // w2 reaped
    ],
  });

test('leftoverSessionsReaped passes when the pre-crash session is gone by the final tick and the ceiling held', () => {
  const r = leftoverSessionsReaped({ ceiling: 1 }).check(reapedBundle());
  assert.equal(r.pass, true, r.detail);
});

test('leftoverSessionsReaped fails when a pre-crash leftover is still live at the end', () => {
  const b = reapedBundle();
  b.timeline[1].agents.push(wagent('T02', 'idle', { sessionId: 'w2', role: 'implement' })); // the leftover lingers
  const r = leftoverSessionsReaped({ ceiling: 1 }).check(b);
  assert.equal(r.pass, false);
  assert.match(r.detail, /still live/);
});

test('leftoverSessionsReaped fails when the slot peak exceeds the ceiling across the restart', () => {
  const b = reapedBundle();
  // A post-boundary tick with two distinct tasks live (an un-reaped orphan counted beside a resumed worker).
  b.timeline.splice(1, 0, tick('2026-01-01T00:00:10Z', [cagent(), wagent('T02', 'busy', { sessionId: 'r2', role: 'review' }), wagent('T03', 'busy', { sessionId: 'w3', role: 'implement' })]));
  const r = leftoverSessionsReaped({ ceiling: 1 }).check(b);
  assert.equal(r.pass, false);
  assert.match(r.detail, /exceeds the ceiling/);
});

test('leftoverSessionsReaped fails vacuously-safe when the run never restarted', () => {
  const b = reapedBundle();
  b.flow = [fl('2026-01-01T00:00:00Z', 'restart')];
  assert.equal(leftoverSessionsReaped({ ceiling: 1 }).check(b).pass, false);
});

// --- checkScenario + formatReport ----------------------------------------------------------------

test('checkScenario fails the scenario when a single fact fails, and formatReport shows the evidence', () => {
  const b = bundle({ flow: [fl('t1', 'spawn', 'T01')], timeline: [tick('t1', [wagent('T01', 'busy')])] });
  const spec = { id: 'demo', facts: [noHelloEver(), parkedWorkerHoldsSlot('T09')] };
  const report = checkScenario(spec, b);
  assert.equal(report.pass, false, 'one failing fact fails the scenario');
  assert.equal(report.facts.find((f) => f.id === 'no-hello-ever').pass, true);
  const printed = formatReport(report);
  assert.match(printed, /\[FAIL\] scenario: demo/);
  assert.match(printed, /✓ The flow log contains no hello line/);
  assert.match(printed, /✗ T09 parked on the person/);
});

test('checkScenario reports a throwing fact as failed rather than aborting', () => {
  const boom = { id: 'boom', label: 'explodes', check: () => { throw new Error('kaboom'); } };
  const report = checkScenario({ id: 'x', facts: [boom] }, bundle());
  assert.equal(report.pass, false);
  assert.match(report.facts[0].detail, /kaboom/);
});
