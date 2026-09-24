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
import { renderHandoff } from '../coordinate.mjs';
import { buildConflictPrompt } from '../../core/conflict.mjs';
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
  adoptedAndDispatched,
  mergeConflictResolved,
  handedOffGreenBranch,
  killSwitchStoppedAll,
  ceilingHeld,
  reachedWidth,
  resumedNotRebuilt,
  noRebuildFrom,
  feedsCleared,
  leftoverSessionsReaped,
  stoppedGracefully,
  resumedFromPartial,
  loadRestartPoint,
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

// --- adoptedAndDispatched (dynamic-task tail: adopt→dispatch→merge, task-agnostic, T05) ------------

// A bundle in the adopted-task shape (DESIGN §2.2, §2.4): T01 (the introducer) merged, the coordinator
// adopted the worker-introduced T02, then dispatched it (spawn) and merged its branch. Task-agnostic: the
// fact discovers T02 from the `adopt` line rather than being told it.
function adoptedBundle(over = {}) {
  return bundle({
    flow: [
      fl('t3', 'merge', 'T01'),
      fl('t4', 'adopt', 'T02'),
      fl('t5', 'spawn', 'T02'),
      fl('t8', 'merge', 'T02'),
    ],
    ...over,
  });
}

test('adoptedAndDispatched passes when an adopted task was dispatched and its branch merged', () => {
  const r = adoptedAndDispatched().check(adoptedBundle());
  assert.equal(r.pass, true, r.detail);
  assert.ok(r.evidence.some((e) => e.includes('adopt T02')));
  assert.ok(r.evidence.some((e) => e.includes('spawn T02')));
});

test('adoptedAndDispatched fails when nothing was adopted (no worker introduced a task)', () => {
  const r = adoptedAndDispatched().check(bundle({ flow: [fl('t3', 'merge', 'T01'), fl('t5', 'spawn', 'T01')] }));
  assert.equal(r.pass, false);
  assert.match(r.detail, /no adopt line/);
});

test('adoptedAndDispatched fails when the adopted task was never dispatched (silently never built)', () => {
  const r = adoptedAndDispatched().check(bundle({ flow: [fl('t4', 'adopt', 'T02')] }));
  assert.equal(r.pass, false);
  assert.match(r.detail, /never dispatched/);
});

test('adoptedAndDispatched fails when the adopted task dispatched but its branch never merged', () => {
  const r = adoptedAndDispatched().check(bundle({ flow: [fl('t4', 'adopt', 'T02'), fl('t5', 'spawn', 'T02')] }));
  assert.equal(r.pass, false);
  assert.match(r.detail, /never merged/);
});

test('adoptedAndDispatched requires the dispatch to follow the adoption, not a stray earlier spawn', () => {
  // A `spawn T02` before the adopt line cannot be the dispatch of the adopted row (the row did not exist yet).
  const r = adoptedAndDispatched().check(
    bundle({ flow: [fl('t1', 'spawn', 'T02'), fl('t4', 'adopt', 'T02'), fl('t8', 'merge', 'T02')] }),
  );
  assert.equal(r.pass, false);
  assert.match(r.detail, /never dispatched/);
});

// The coordinator's captured stdout (bundle.coordinatorOut) at a green and a red finish, built from the
// real renderHandoff so a change to its wording breaks these tests rather than the live fact.
const GREEN_OUT = `pass 12\n${renderHandoff({ readyToMerge: true, taskCount: 2, slug: 'scratch' })}\n`;
const RED_OUT = `pass 12\n${renderHandoff({
  readyToMerge: false,
  taskCount: 2,
  slug: 'scratch',
  why: 'test `npm test` exited 1 · log plans/scratch/.parallel/control/tests.log',
})}\n`;

// --- mergeConflictResolved (task-agnostic, attended non-agentic model, T13) -----------------------

// A bundle in the attended-resolution shape (DESIGN §2.8): T01 (winner) merged clean; T02 conflicted, was
// surfaced, and the SAME worker resumed to a merge — NO `answer` line (the person resolved it on the live
// worker, nothing routed). The run HANDED OFF: no `promote`, no `Merge branch 'pir/scratch'` into main in
// the git log (only task-branch integrations), and the feature branch carries the decided side. A worker in
// the timeline lets runIdentity resolve the plan for the hand-off git-log check.
function resolvedBundle(over = {}) {
  return bundle({
    flow: [
      fl('t3', 'merge', 'T01'),
      fl('t4', 'surface', 'T02'),
      fl('t6', 'merge', 'T02'),
    ],
    gitLog: '* merge pir/scratch-T02 (pir/scratch)\n* merge pir/scratch-T01\n* seed\n',
    timeline: [tick('t1', [wagent('T02', 'idle', { sessionId: 's2i', role: 'implement' })])],
    finalFiles: { 'greeting.txt': 'hello there\n' },
    coordinatorOut: GREEN_OUT,
    ...over,
  });
}
const decided = { file: 'greeting.txt', content: 'hello there' };

test('mergeConflictResolved passes when the conflict was kept alive, resumed without a routed answer, and the decided side was handed off', () => {
  assert.equal(mergeConflictResolved(decided).check(resolvedBundle()).pass, true);
});

test('mergeConflictResolved fails when no task was surfaced', () => {
  const r = mergeConflictResolved(decided).check(bundle({ flow: [fl('t3', 'merge', 'T01')] }));
  assert.equal(r.pass, false);
  assert.match(r.detail, /no task surface/);
});

test('mergeConflictResolved fails when the surfaced task never merged (the conflict was never resolved on the live worker)', () => {
  // Surfaced but no later merge — the worker was closed and its branch never landed.
  const r = mergeConflictResolved(decided).check(
    bundle({ flow: [fl('t4', 'surface', 'T02')], timeline: [tick('t1', [wagent('T02', 'busy')])] }),
  );
  assert.equal(r.pass, false);
  assert.match(r.detail, /branch never landed/);
});

test('mergeConflictResolved fails when the run promoted to main instead of handing off (§2.4)', () => {
  // A resolved conflict that ended in the removed promotion is not a hand-off — the composed
  // handedOffGreenBranch rejects the `promote` line.
  const r = mergeConflictResolved(decided).check(resolvedBundle({
    flow: [fl('t3', 'merge', 'T01'), fl('t4', 'surface', 'T02'), fl('t6', 'merge', 'T02'), fl('t9', 'promote', 'pir/scratch')],
  }));
  assert.equal(r.pass, false);
  assert.match(r.detail, /did not hand off a green feature branch/);
});

test('mergeConflictResolved fails when the LOSING side shipped on the feature branch (the T22 regression)', () => {
  const r = mergeConflictResolved(decided).check(resolvedBundle({ finalFiles: { 'greeting.txt': 'hi world\n' } }));
  assert.equal(r.pass, false);
  assert.match(r.detail, /losing side shipped/);
});

test('mergeConflictResolved fails when the task was respawned (a second implement session)', () => {
  const r = mergeConflictResolved(decided).check(
    resolvedBundle({
      timeline: [
        tick('t1', [wagent('T02', 'idle', { sessionId: 's2i', role: 'implement' })]),
        tick('t2', [wagent('T02', 'busy', { sessionId: 's2i-again', role: 'implement' })]),
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

// --- handedOffGreenBranch (T10: no promotion; the run hands off a green feature branch, §2.4) --------

// A clean hand-off bundle: a task merged onto the feature branch, no `promote` line, and main carries no
// promotion merge (git log has only the task work, not `Merge branch 'pir/scratch'`). A worker in the
// timeline lets runIdentity resolve the plan so the git-log check runs.
test('handedOffGreenBranch passes when a task merged, nothing was promoted, and main gained no merge', () => {
  const b = bundle({
    flow: [fl('t5', 'merge', 'T01')],
    gitLog: '* T01 marker (pir/scratch)\n* seed\n',
    timeline: [tick('t1', [wagent('T01', 'busy')])],
    coordinatorOut: GREEN_OUT,
  });
  const r = handedOffGreenBranch().check(b);
  assert.equal(r.pass, true, r.detail);
  assert.ok(r.evidence.includes('git log: no promotion merge into main'));
  assert.ok(r.evidence.includes('coordinator.out: git merge pir/scratch'));
});

// declared-test-command T10: the flow and git look the same for a red finish as a green one, so a run
// whose end-of-run gate went red must FAIL on the coordinator's own printed verdict, naming the reason.
test('handedOffGreenBranch fails when the coordinator printed the red hand-off', () => {
  const b = bundle({
    flow: [fl('t5', 'merge', 'T01')],
    gitLog: '* T01 marker (pir/scratch)\n* seed\n',
    timeline: [tick('t1', [wagent('T01', 'busy')])],
    coordinatorOut: RED_OUT,
  });
  const r = handedOffGreenBranch().check(b);
  assert.equal(r.pass, false);
  assert.match(r.detail, /went red: test `npm test` exited 1/);
  assert.ok(r.evidence.some((e) => e.startsWith('coordinator.out: ✗')));
});

test('handedOffGreenBranch fails when the coordinator output was not captured', () => {
  const b = bundle({
    flow: [fl('t5', 'merge', 'T01')],
    gitLog: '* T01 marker (pir/scratch)\n* seed\n',
    timeline: [tick('t1', [wagent('T01', 'busy')])],
    coordinatorOut: null,
  });
  const r = handedOffGreenBranch().check(b);
  assert.equal(r.pass, false);
  assert.match(r.detail, /no coordinator\.out/);
});

// A run that stalled or halted prints no hand-off at all: neither line, so no green verdict to accept.
test('handedOffGreenBranch fails when the coordinator output lacks the green hand-off line', () => {
  const b = bundle({
    flow: [fl('t5', 'merge', 'T01')],
    gitLog: '* T01 marker (pir/scratch)\n* seed\n',
    timeline: [tick('t1', [wagent('T01', 'busy')])],
    coordinatorOut: 'pass 3\nstalled: nothing left to do\n',
  });
  const r = handedOffGreenBranch().check(b);
  assert.equal(r.pass, false);
  assert.match(r.detail, /no `git merge pir\/scratch` hand-off line/);
});

// T10 review: the conflict-resolution prompt coordinate.mjs prints mid-run carries `  git merge pir/{plan}`
// too. A run that merged T01, hit a conflict on T02 and then stalled or timed out never handed off, so the
// bare merge line must not read as the green verdict.
test('handedOffGreenBranch fails when the only `git merge` line is a conflict prompt, not the hand-off', () => {
  const prompt = buildConflictPrompt({
    task: 'T02',
    slug: 'second',
    workerName: null,
    taskBranch: 'pir/scratch-T02',
    featureBranch: 'pir/scratch',
    files: ['greeting.txt'],
  });
  const b = bundle({
    flow: [fl('t5', 'merge', 'T01')],
    gitLog: '* T01 marker (pir/scratch)\n* seed\n',
    timeline: [tick('t1', [wagent('T01', 'busy')])],
    coordinatorOut: `pass 3\n\n${prompt}\npass 4\n`,
  });
  const r = handedOffGreenBranch().check(b);
  assert.equal(r.pass, false, r.detail);
  assert.match(r.detail, /no `git merge pir\/scratch` hand-off line/);
});

// T10 review: on a non-TTY the renderer appends the final red frame (its footer also says `not ready to
// merge`, with no reason under it) before renderHandoff prints. The reason quoted must be the hand-off's.
test('handedOffGreenBranch quotes the hand-off reason, not the red status frame printed before it', () => {
  const frame = '  T01 ✅\n\n✗ 2 task(s) built on pir/scratch, but its tests fail — not ready to merge.\n';
  const b = bundle({
    flow: [fl('t5', 'merge', 'T01')],
    gitLog: '* T01 marker (pir/scratch)\n* seed\n',
    timeline: [tick('t1', [wagent('T01', 'busy')])],
    coordinatorOut: frame + RED_OUT,
  });
  const r = handedOffGreenBranch().check(b);
  assert.equal(r.pass, false);
  assert.match(r.detail, /went red: test `npm test` exited 1/);
});

// The regression guard the task asks for: a bundle carrying a `promote` line — the removed model — now
// FAILS, so the promotion cannot silently return through this fact.
test('handedOffGreenBranch fails on a bundle that carries a promote line (the removed model)', () => {
  const b = bundle({
    flow: [fl('t5', 'merge', 'T01'), fl('t9', 'promote', 'pir/scratch')],
    gitLog: "*   Merge branch 'pir/scratch'\n| * T01\n",
    timeline: [tick('t1', [wagent('T01', 'busy')])],
  });
  const r = handedOffGreenBranch().check(b);
  assert.equal(r.pass, false);
  assert.match(r.detail, /merged to main/);
});

// The other half of the regression guard: no `promote` line, but the git log shows a promotion merge of
// the feature branch into main — main was not left untouched, so it FAILS.
test('handedOffGreenBranch fails when the git log shows a promotion merge into main', () => {
  const b = bundle({
    flow: [fl('t5', 'merge', 'T01')],
    gitLog: "Merge branch 'pir/scratch'\n* T01\n",
    timeline: [tick('t1', [wagent('T01', 'busy')])],
  });
  const r = handedOffGreenBranch().check(b);
  assert.equal(r.pass, false);
  assert.match(r.detail, /promotion merge/);
});

// A dependent-task worker brings the feature branch into its own task branch before signalling done;
// git labels that `Merge branch 'pir/scratch' into pir/scratch-T03`. That merge shares the promotion
// prefix but never touches main, so it must NOT be read as a promotion — a clean hand-off still passes
// (the same ` into ` exclusion that saved oneMergeToMain from the review-queue false-FAIL, 2026-09-13).
test('handedOffGreenBranch passes when a worker integration merge shares the promotion prefix', () => {
  const gitLog =
    '* T01 (pir/scratch)\n' +
    "| |   a8717af Merge branch 'pir/scratch' into pir/scratch-T03\n" +
    '| * reconcile T03\n';
  const b = bundle({
    flow: [fl('t5', 'merge', 'T01'), fl('t7', 'merge', 'T03')],
    gitLog,
    timeline: [tick('t1', [wagent('T01', 'busy')])],
    coordinatorOut: GREEN_OUT,
  });
  const r = handedOffGreenBranch().check(b);
  assert.equal(r.pass, true, r.detail);
});

// Non-vacuous: a run that promoted nothing AND merged no task assembled nothing, so the hand-off is
// vacuous and must FAIL — otherwise an empty run would pass trivially.
test('handedOffGreenBranch fails vacuously-safe when no task merged onto the feature branch', () => {
  const b = bundle({
    flow: [fl('t1', 'spawn', 'T01')],
    gitLog: '* seed\n',
    timeline: [tick('t1', [wagent('T01', 'busy')])],
  });
  const r = handedOffGreenBranch().check(b);
  assert.equal(r.pass, false);
  assert.match(r.detail, /vacuous/);
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

// --- stop-and-restart facts (restart-review / restart-implement fixtures) ------------------------

// A stopped-then-resumed half-built run: T01 committed part 1 (abc1234) and was stopped with SIGTERM
// (its teardown closed the implementer), then resumed on the same branch and merged.
const partialBundle = () =>
  bundle({
    flow: [
      fl('2026-01-01T00:00:00Z', 'restart'),
      fl('2026-01-01T00:00:01Z', 'spawn', 'T01'),
      fl('2026-01-01T00:00:08Z', 'teardown:', 'closed pir-h / scratch / T01 / work / implement (i1)'),
      fl('2026-01-01T00:00:10Z', 'restart'),
      fl('2026-01-01T00:00:10Z', 'resume', 'T01'),
      fl('2026-01-01T00:00:11Z', 'spawn', 'T01'),
      fl('2026-01-01T00:00:20Z', 'merge', 'T01'),
    ],
    gitLog: '* 9f9f9f9 reconcile T01 → ✅\n* def5678 T01: part 2\n* abc1234 T01: part 1\n* 0000000 seed\n',
    restartPoint: { task: 'T01', head: 'abc1234deadbeef', glyph: '⬜', signal: 'SIGTERM' },
  });

test('stoppedGracefully passes when a SIGTERM stop logged a teardown before the restart', () => {
  const r = stoppedGracefully().check(partialBundle());
  assert.equal(r.pass, true, r.detail);
});

test('stoppedGracefully fails on a SIGKILL crash — no teardown ran', () => {
  const b = partialBundle();
  b.restartPoint.signal = 'SIGKILL';
  assert.equal(stoppedGracefully().check(b).pass, false);
});

test('stoppedGracefully fails when the stop closed no worker (no teardown line before the boundary)', () => {
  const b = partialBundle();
  b.flow = b.flow.filter((e) => e.type !== 'teardown:');
  const r = stoppedGracefully().check(b);
  assert.equal(r.pass, false);
  assert.match(r.detail, /no teardown/);
});

test('resumedFromPartial passes when the stopped branch was resumed, its part-1 commit kept once, and merged', () => {
  const r = resumedFromPartial('T01', { commit: 'T01: part 1' }).check(partialBundle());
  assert.equal(r.pass, true, r.detail);
});

test('resumedFromPartial fails when the branch was discarded (its stop-time commit is gone from history)', () => {
  const b = partialBundle();
  b.gitLog = '* 9f9f9f9 reconcile T01 → ✅\n* 7777777 T01: part 2\n* 6666666 T01: part 1\n';
  const r = resumedFromPartial('T01', { commit: 'T01: part 1' }).check(b);
  assert.equal(r.pass, false);
  assert.match(r.detail, /thrown away/);
});

test('resumedFromPartial fails when the resumed implementer redid part 1', () => {
  const b = partialBundle();
  b.gitLog += '* 5555555 T01: part 1\n';
  const r = resumedFromPartial('T01', { commit: 'T01: part 1' }).check(b);
  assert.equal(r.pass, false);
  assert.match(r.detail, /redid/);
});

test('resumedFromPartial fails when the stop caught the task already built (🔍), not half-built', () => {
  const b = partialBundle();
  b.restartPoint.glyph = '🔍';
  const r = resumedFromPartial('T01', { commit: 'T01: part 1' }).check(b);
  assert.equal(r.pass, false);
  assert.match(r.detail, /half-built/);
});

test('resumedFromPartial fails on a rebuild line or with no resume line', () => {
  const rebuilt = partialBundle();
  rebuilt.flow = rebuilt.flow.map((e) => (e.type === 'resume' ? { ...e, type: 'rebuild' } : e));
  assert.equal(resumedFromPartial('T01').check(rebuilt).pass, false);
  const silent = partialBundle();
  silent.flow = silent.flow.filter((e) => e.type !== 'resume');
  assert.match(resumedFromPartial('T01').check(silent).detail, /no `resume T01` line/);
});

test('loadRestartPoint reads restart-point.json; missing or malformed → null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pir-rp-'));
  try {
    assert.equal(loadRestartPoint({ dir }).restartPoint, null);
    writeFileSync(join(dir, 'restart-point.json'), JSON.stringify({ task: 'T01', head: 'abc', glyph: '⬜', signal: 'SIGTERM' }));
    assert.deepEqual(loadRestartPoint({ dir }).restartPoint, { task: 'T01', head: 'abc', glyph: '⬜', signal: 'SIGTERM' });
    writeFileSync(join(dir, 'restart-point.json'), '{nope');
    assert.equal(loadRestartPoint({ dir }).restartPoint, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
