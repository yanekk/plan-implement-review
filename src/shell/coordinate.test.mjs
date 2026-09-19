import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, renameSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  startCoordinator,
  readReviewGate,
  createAgentBridge,
  teardownRun,
  ensureMain,
  canPromoteHere,
  renderHandoff,
  runawayVerdict,
  gitRun,
  clearTransientFeeds,
  startupControlHygiene,
  fileControl,
} from './coordinate.mjs';
import { createMessaging } from './platform.mjs';
import { createFakePlatform } from './fake/platform.mjs';
import { createFakeWorktree, git } from './fake/worktree.mjs';
import { workerName, coordinatorName } from '../core/naming.mjs';
import { progressPathFor, reconcileTaskRow } from '../core/progress.mjs';

// The dry-run seatbelt (DESIGN §5.2): the coordinator is handed fakes and a scratch repo, so nothing
// here reaches a real agent or the real project. Every test below drives the SAME startCoordinator the
// bin drives live; only the injected platform/worktree differ.
process.env.PARALLEL_DRY_RUN = '1';

const REPO = 'demo-repo';
const SLUG = 'demo';

function progressDoc(rows) {
  const header = '| # | Task | Runs | Depends on | State | Notes |';
  const sep = '|---|---|---|---|---|---|';
  const body = rows
    .map((r) => {
      const deps = r.deps && r.deps.length ? r.deps.join(', ') : '—';
      return `| ${r.num} | ${r.num} thing | ${r.runs ?? 'auto'} | ${deps} | ${r.state ?? '⬜'} | |`;
    })
    .join('\n');
  return `# Progress\n\n**Plan reviewed:** 2026-09-08 — reviewed\n\n${header}\n${sep}\n${body}\n`;
}

// Stand up a coordinator over the fakes for a plan. Returns the coordinator plus the fake platform and
// worktree so a test can inspect spawns/sends/closes and the branch events.
function setup(t, rows, { behaviors = {}, files = {}, maxWorkers = 4, control, runTests } = {}) {
  const worktree = createFakeWorktree({ progress: progressDoc(rows), files, slug: SLUG });
  const platform = createFakePlatform({ behaviors });
  t.after(() => worktree.cleanup());
  const coordinator = startCoordinator({
    slug: SLUG,
    repo: REPO,
    platform,
    worktree,
    maxWorkers,
    control,
    runTests,
  });
  return { coordinator, platform, worktree };
}

// Drive to quiescence, collecting every pass summary so a test can assert what was surfaced and
// completed across the whole run, not just the last pass.
function driveCollecting(coordinator, opts = {}) {
  const passes = [];
  const result = coordinator.drive({ ...opts, onPass: (r) => passes.push(r) });
  const completed = passes.flatMap((p) => p.completed);
  const surfaces = passes.flatMap((p) => p.surfaces);
  return { result, passes, completed, surfaces };
}

const chain = (n) =>
  Array.from({ length: n }, (_, i) => ({ num: `T0${i + 1}`, deps: i === 0 ? [] : [`T0${i}`] }));

// --- 1. The reviewed gate -------------------------------------------------------------------------

test('readReviewGate refuses a plan whose gate says "not yet", and passes a reviewed one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pir-gate-'));
  try {
    const write = (slug, note) => {
      const p = join(dir, progressPathFor(slug));
      mkdirSync(join(p, '..'), { recursive: true });
      writeFileSync(p, `# Progress\n\n**Plan reviewed:** ${note}\n\n| # | Task | State |\n|---|---|---|\n| T01 | a | ⬜ |\n`);
    };
    write('unrev', 'not yet — run `/pir-review-plan` first');
    write('rev', '2026-09-08 — 4 fixed, 3 decided');

    assert.equal(readReviewGate('unrev', { root: dir }).reviewed, false, 'a "not yet" gate refuses');
    assert.equal(readReviewGate('rev', { root: dir }).reviewed, true, 'a dated gate passes');
    assert.equal(readReviewGate('missing', { root: dir }).missing, true, 'an absent plan is reported missing, not reviewed');
    assert.equal(readReviewGate('missing', { root: dir }).reviewed, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- 2. Dispatch is coordinator-chosen; review is a fresh, distinct session ------------------------

test('a task is dispatched pir-implement, then reviewed by a fresh distinct session with a distinct role name', (t) => {
  const { coordinator, platform } = setup(t, [{ num: 'T01' }]);
  driveCollecting(coordinator);

  const impl = platform.spawns.find((s) => s.role === 'implement' && s.task === 'T01');
  const review = platform.spawns.find((s) => s.role === 'review' && s.task === 'T01');
  assert.ok(impl && review, 'both an implement and a fresh review session were spawned for T01');
  assert.notEqual(impl.id, review.id, 'the reviewer is a distinct session, never the implementer');
  // Implementer and reviewer now carry distinct names by role (DESIGN §2.8), addressed directly.
  assert.notEqual(impl.name, review.name, 'distinct names, one per role');
  assert.equal(impl.name, workerName({ repo: REPO, plan: SLUG, task: 'T01', role: 'implement' }));
  assert.equal(review.name, workerName({ repo: REPO, plan: SLUG, task: 'T01', role: 'review' }));
  assert.ok(
    platform.spawns.indexOf(impl) < platform.spawns.indexOf(review),
    'the coordinator dispatched implement before it dispatched review',
  );
});

// --- 3. Naming and identity: its own name, its workers by prefix, foreigners ignored ---------------

test('the coordinator names itself and its workers per §2.8 and ignores agents from other repos/plans', (t) => {
  const worktree = createFakeWorktree({ progress: progressDoc([{ num: 'T01' }]), slug: SLUG });
  t.after(() => worktree.cleanup());
  const fake = createFakePlatform({});

  // A live agent from a different repo AND a sibling plan in this repo are both in the machine's list.
  // Neither is one of THIS coordinator's workers (its workers are `${REPO} · ${SLUG} · T…`), so the
  // coordinator must never adopt, review or close them (DESIGN §2.8).
  const foreigners = [
    { id: 'F1', name: 'other-repo · other-plan · T01 · implement', cwd: '/x', status: 'busy', state: 'working', live: true },
    { id: 'F2', name: `${REPO} · another-plan · T01 · implement`, cwd: '/y', status: 'busy', state: 'working', live: true },
  ];
  const platform = { ...fake, list: () => [...fake.list(), ...foreigners] };

  const coordinator = startCoordinator({ slug: SLUG, repo: REPO, platform, worktree, maxWorkers: 4 });
  assert.equal(coordinatorName({ repo: REPO, plan: SLUG }), `${REPO} · ${SLUG}`);

  const { result } = driveCollecting(coordinator);
  assert.equal(result.complete, true, 'the plan still drains to completion alongside the foreign agents');
  assert.ok(!fake.closed.includes('F1') && !fake.closed.includes('F2'), 'no foreign agent was ever closed');
  const spawnedNames = fake.spawns.map((s) => s.name);
  assert.ok(
    spawnedNames.every((n) => n.startsWith(`${REPO} · ${SLUG} · `)),
    'every worker it spawned carries its own repo·plan prefix',
  );
});

// --- 4. A question is surfaced; the answer is routed down to that worker only ----------------------

test('a worker question is surfaced in plain English and the answer is sent down to that worker only', (t) => {
  const { coordinator, platform } = setup(t, [{ num: 'T01' }, { num: 'T02' }], {
    behaviors: { T01: { question: 'which output format?' } },
  });

  coordinator.pass(); // spawn T01, T02
  const r2 = coordinator.pass(); // T01 asks
  const surfaced = r2.surfaces.find((s) => s.kind === 'question' && s.task === 'T01');
  assert.ok(surfaced, 'the question surfaced');
  assert.match(surfaced.message, /which output format\?/);
  assert.match(surfaced.message, /worker on T01/i, 'the plain-English surface names the task');

  const res = coordinator.answer({ task: 'T01', text: 'use json' });
  assert.equal(res.worker, workerName({ repo: REPO, plan: SLUG, task: 'T01', role: 'implement' }));
  // Since T30 there is no spawn hello, so the answer is the ONLY message the coordinator sends; it is
  // the only `answer`-kind message and it went to T01 alone.
  const answers = platform.sent.filter((s) => s.msg.kind === 'answer');
  assert.deepEqual(answers.map((s) => s.to), [workerName({ repo: REPO, plan: SLUG, task: 'T01', role: 'implement' })], 'answered T01 and only T01');
  assert.equal(answers[0].msg.kind, 'answer');

  const { result } = driveCollecting(coordinator);
  assert.equal(result.complete, true, 'the answered worker resumes and the plan completes, ready to hand off');
});

// --- 5. A parked worker does not stall the others -------------------------------------------------

test('other ready tasks keep progressing while one worker is parked awaiting an answer', (t) => {
  const { coordinator, worktree } = setup(t, [{ num: 'T01' }, { num: 'T02' }], {
    behaviors: { T01: { question: 'blocked on you' } },
  });

  // Drive WITHOUT ever answering T01. T02 is independent and must run to ✅ on its own.
  const { result, completed } = driveCollecting(coordinator);
  assert.equal(result.reason, 'parked', 'the run parks (T01 waits on the user), it does not stall');
  assert.ok(completed.includes('T02'), 'T02 completed while T01 stayed parked');
  assert.ok(!completed.includes('T01'), 'T01 did not complete — it is still waiting on the user');

  const feature = worktree.progressOn(`pir/${SLUG}`);
  assert.match(feature, /T02 .*✅/, 'T02 is ✅ on the feature branch');
  assert.ok(coordinator.state.tasks.T01, 'T01 is still tracked, parked, not dropped');
});

// --- 6. A `you` task is a hands-on worker, never reviewed, folded back to ✅ ------------------------

test('a ready you task spawns a hands-on pir-verify worker, is never reviewed, and unblocks its dependents', (t) => {
  const { coordinator, platform, worktree } = setup(t, [
    { num: 'T01', runs: 'you' },
    { num: 'T02', deps: ['T01'] },
  ]);

  const { result, passes } = driveCollecting(coordinator);
  assert.equal(result.complete, true);

  const you = passes.flatMap((p) => p.youToDrive).find((y) => y.task === 'T01');
  assert.ok(you, 'the coordinator surfaced a hands-on worker for the you task');
  assert.equal(you.worker, workerName({ repo: REPO, plan: SLUG, task: 'T01', role: 'verify' }));

  assert.ok(platform.spawns.some((s) => s.role === 'verify' && s.task === 'T01'), 'T01 spawned as a verify worker');
  assert.ok(!platform.spawns.some((s) => s.role === 'review' && s.task === 'T01'), 'a you task is never reviewed');

  const finalFeature = worktree.progressOn(`pir/${SLUG}`);
  assert.equal((finalFeature.match(/✅/g) || []).length, 2, 'both tasks are ✅ on the feature branch');
});

// --- 7. The implementer is closed as its reviewer spawns ------------------------------------------

test('the implement session is closed when its fresh reviewer spawns, so a task in review holds one slot', (t) => {
  const { coordinator, platform } = setup(t, [{ num: 'T01' }]);
  coordinator.pass(); // spawn implementer
  const implId = platform.spawns[0].id;
  const r2 = coordinator.pass(); // implemented → spawn reviewer, close implementer
  assert.ok(r2.reviewing.some((x) => x.task === 'T01'), 'a fresh reviewer was dispatched for T01');
  assert.ok(platform.closed.includes(implId), 'the implementer session is closed');
  assert.equal(r2.live, 1, 'implementer closed + reviewer spawned = one live session, not two');
});

// --- 8. A conflict surfaces as a decision; a deferred decision marks the task ⛔ --------------------

test('a merge conflict a worker cannot resolve surfaces as a decision, and defer marks the task ⛔', (t) => {
  const { coordinator, platform, worktree } = setup(t, [{ num: 'T01' }], {
    behaviors: { T01: { conflict: 'cannot merge cleanly' } },
  });

  coordinator.pass(); // spawn
  const r2 = coordinator.pass(); // worker reports an unresolved conflict
  const conflict = r2.surfaces.find((s) => s.kind === 'conflict' && s.task === 'T01');
  assert.ok(conflict, 'the conflict surfaced as a decision for the user');
  assert.match(conflict.message, /merge conflict/i);

  const workerId = coordinator.state.tasks.T01.workerId;
  coordinator.defer({ task: 'T01' });
  const feature = readFileSync(join(coordinator.state.feature.path, progressPathFor(SLUG)), 'utf8');
  assert.match(feature, /T01 .*⛔/, 'the deferred task is ⛔ on the feature branch');
  assert.ok(platform.closed.includes(workerId), 'the parked worker was closed to free its slot');
  assert.ok(!coordinator.state.tasks.T01, 'the deferred task is no longer tracked as live');
});

// --- 9. Ceiling logged; HALT stops dispatch and closes workers ------------------------------------

test('the ceiling-full case is logged when ready work cannot start', (t) => {
  const logs = [];
  const control = { isHalted: () => false, log: (l) => logs.push(l) };
  const { coordinator } = setup(t, [1, 2, 3, 4, 5].map((n) => ({ num: `T0${n}` })), { maxWorkers: 2, control });
  const r = coordinator.pass();
  assert.equal(r.spawned.length, 2, 'only two of five ready tasks start');
  assert.equal(r.ceilingFull, true, 'the ceiling is reported full with work waiting');
  assert.ok(logs.some((l) => /ceiling full/.test(l)), 'the ceiling hit is logged');
});

test('the HALT flag stops all dispatch and closes every worker; main is untouched', (t) => {
  let halted = false;
  const control = { isHalted: () => halted, log: () => {} };
  const { coordinator, platform, worktree } = setup(t, [{ num: 'T01' }, { num: 'T02' }], { control });

  coordinator.pass(); // spawn T01, T02
  const liveIds = platform._workers ? [...platform._workers.keys()] : [];
  assert.equal(liveIds.length, 2);

  halted = true;
  const r = coordinator.pass(); // halt closes everything
  assert.equal(r.halted, true);
  assert.equal(r.live, 0, 'every worker closed');
  for (const id of liveIds) assert.ok(platform.closed.includes(id), `worker ${id} closed under HALT`);
  assert.equal(r.spawned.length, 0, 'no dispatch under HALT');
  assert.equal(worktree.mainCommitCount(), 1, 'main untouched by the kill switch');
});

// --- 10. Task branches merge into the feature branch; main is never touched -----------------------

test('task branches merge into the feature branch and main is never touched — the run hands off, it does not promote (DESIGN §2.4)', (t) => {
  const { coordinator, worktree } = setup(t, chain(4));
  assert.equal(worktree.mainCommitCount(), 1, 'main starts at the initial commit only');

  const { result } = driveCollecting(coordinator);
  assert.equal(result.complete, true);
  assert.deepEqual(result.readyToMerge, { branch: `pir/${SLUG}` }, 'it hands off the green feature branch');

  const merges = worktree.events.filter((e) => e.op === 'mergeTask');
  assert.equal(merges.length, 4, 'four task branches merged');
  assert.ok(merges.every((e) => e.into === `pir/${SLUG}`), 'every merge went into the feature branch, never main');
  assert.equal(worktree.events.filter((e) => e.op === 'promote').length, 0, 'nothing was ever promoted to main');
  assert.equal(worktree.mainCommitCount(), 1, 'main is untouched — the person merges pir/demo by hand');
  const finalFeature = worktree.progressOn(`pir/${SLUG}`);
  assert.equal((finalFeature.match(/✅/g) || []).length, 4, 'all four tasks are ✅ on the feature branch');
});

// --- 11. Hand off only a green feature branch ----------------------------------------------------

test('a red feature branch is surfaced with no hand-off; a green one is handed off to merge by hand', (t) => {
  const red = setup(t, [{ num: 'T01' }], { runTests: () => ({ ok: false }) });
  const { result: redResult, surfaces: redSurfaces } = driveCollecting(red.coordinator);
  assert.equal(redResult.reason, 'complete', 'the plan is done, but the branch is red');
  assert.equal(redResult.testsPassed, false, 'the feature-branch tests failed');
  assert.ok(!redResult.readyToMerge, 'a red branch is never offered for merge (DESIGN §2.8)');
  assert.ok(redSurfaces.some((s) => s.kind === 'red-feature'), 'the red feature branch is surfaced to the user');
  assert.equal(red.worktree.mainCommitCount(), 1, 'nothing red reached main');

  const green = setup(t, [{ num: 'T01' }], { runTests: () => ({ ok: true }) });
  const greenResult = driveCollecting(green.coordinator).result;
  assert.equal(greenResult.complete, true, 'a green feature branch completes');
  assert.deepEqual(greenResult.readyToMerge, { branch: `pir/${SLUG}` }, 'and is handed off for the person to merge');
});

// --- 12. Reports each ✅ and terminates when the plan is fully ✅ and handed off --------------------

test('the coordinator reports each task reaching ✅ and terminates on a completed, handed-off plan', (t) => {
  const { coordinator, worktree } = setup(t, chain(3));
  const { result, completed } = driveCollecting(coordinator);
  assert.equal(result.reason, 'complete');
  assert.equal(result.complete, true);
  assert.deepEqual(result.readyToMerge, { branch: `pir/${SLUG}` });
  assert.deepEqual([...completed].sort(), ['T01', 'T02', 'T03'], 'each task was reported reaching ✅ as it merged');
  const finalFeature = worktree.progressOn(`pir/${SLUG}`);
  assert.ok(!finalFeature.includes('⬜'), 'no ⬜ task remains on the feature branch at hand-off');
});

// --- 13. P2: the answer channel — a user decision routes down to the parked worker -----------------

test('a decision written to the answers file drains once, then routes down to the parked worker (P2, T12)', (t) => {
  // The bridge's answers file is the down-channel the drill lacked (the bin surfaced a question and
  // then had no way to route the answer). The skill APPENDS a decision; the bin drains and routes it.
  const dir = mkdtempSync(join(tmpdir(), 'pir-answers-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bridge = createAgentBridge({ dir });

  writeFileSync(bridge.answersPath, JSON.stringify({ task: 'T01', text: 'use json' }) + '\n', { flag: 'a' });
  writeFileSync(bridge.answersPath, JSON.stringify({ task: 'T02', defer: true, note: 'later' }) + '\n', { flag: 'a' });
  writeFileSync(bridge.answersPath, 'not json\n', { flag: 'a' }); // a malformed line is dropped, not guessed
  const drained = bridge.drainAnswers();
  assert.deepEqual(drained, [
    { task: 'T01', text: 'use json' },
    { task: 'T02', defer: true, note: 'later' },
  ]);
  assert.equal(bridge.drainAnswers().length, 0, 'draining consumes the file — a decision is routed once');

  // End to end against the fakes: park T01 on a question, then drain→answer and watch it resume.
  const { coordinator, platform } = setup(t, [{ num: 'T01' }, { num: 'T02' }], {
    behaviors: { T01: { question: 'which output format?' } },
  });
  coordinator.pass(); // spawn
  const r2 = coordinator.pass(); // T01 asks
  assert.ok(r2.surfaces.some((s) => s.task === 'T01'), 'T01 parked with a question');

  writeFileSync(bridge.answersPath, JSON.stringify({ task: 'T01', text: 'use json' }) + '\n', { flag: 'a' });
  for (const d of bridge.drainAnswers()) coordinator.answer({ task: d.task, text: d.text });
  assert.ok(
    platform.sent.some((s) => s.to === workerName({ repo: REPO, plan: SLUG, task: 'T01', role: 'implement' }) && s.msg.kind === 'answer'),
    'the drained decision was sent down to the parked worker as an answer',
  );
  assert.equal(driveCollecting(coordinator).result.complete, true, 'the answered worker resumes and the plan completes');
});

test('routing an answer logs an `answer {task}` flow line so the coordinator wakes to deliver it (T27, T21 reflection)', (t) => {
  // In the live bin platform.send only QUEUES the answer to the outbox; the coordinator delivers it via
  // SendMessage. The coordinator watches the flow log, so answer() must log an `answer {task}` line
  // (symmetric with the loop's `hello`) or a queued answer has nothing to wake it and it hand-polls the
  // outbox (T21 reflection, 2026-09-13). Assert the line is written when a decision routes down.
  const logs = [];
  const control = { isHalted: () => false, log: (l) => logs.push(l) };
  const { coordinator } = setup(t, [{ num: 'T01' }, { num: 'T02' }], {
    behaviors: { T01: { question: 'which output format?' } },
    control,
  });
  coordinator.pass(); // spawn
  coordinator.pass(); // T01 asks and parks
  const before = logs.length;
  coordinator.answer({ task: 'T01', text: 'use json' });
  assert.ok(
    logs.slice(before).includes('answer T01'),
    `answer() must log "answer T01" so the coordinator wakes to deliver; got: ${logs.slice(before).join(' | ')}`,
  );
});

// --- 13b. C (T30): a failed answer down-send is recorded and retried, never dropped ---------------

test('a dropped answer down-send is recorded as send-failed and the outbox fallback retry delivers it (C, T30)', (t) => {
  const worktree = createFakeWorktree({ progress: progressDoc([{ num: 'T01' }, { num: 'T02' }]), slug: SLUG });
  t.after(() => worktree.cleanup());
  const fake = createFakePlatform({ behaviors: { T01: { question: 'which output format?' } } });
  const logs = [];
  const control = { isHalted: () => false, log: (l) => logs.push(l) };

  // Wrap send so the FIRST answer send is DROPPED (ok:false, delivers nothing) — the deterministic
  // stand-in for a SendMessage the live coordinator could not deliver — and every later send goes
  // through to the worker (the outbox fallback re-reading and re-sending the still-queued answer).
  let sends = 0;
  const platform = {
    ...fake,
    send(name, msg) {
      sends += 1;
      if (sends === 1) return { ok: false };
      return fake.send(name, msg);
    },
  };
  const coordinator = startCoordinator({ slug: SLUG, repo: REPO, platform, worktree, maxWorkers: 4, control });

  coordinator.pass(); // spawn T01, T02
  coordinator.pass(); // T01 asks and parks

  // First attempt is dropped: the failure is RECORDED (send-failed), not silent, and the parked
  // decision is KEPT so the answer can be retried — it is never lost.
  const r1 = coordinator.answer({ task: 'T01', text: 'use json' });
  assert.equal(r1.ok, false, 'the dropped send is reported as a failure');
  assert.ok(logs.includes('send-failed T01'), 'the failed down-send was recorded as `send-failed T01`');
  assert.ok(!logs.includes('answer T01'), 'a dropped send does not log a successful `answer` line');
  assert.ok(coordinator.state.tasks.T01.decision, 'the parked decision is kept for a retry, not dropped');

  // The retry delivers: the worker unblocks, the successful send logs `answer T01`, and the plan drains.
  const r2 = coordinator.answer({ task: 'T01', text: 'use json' });
  assert.equal(r2.ok, true, 'the retry delivers');
  assert.ok(logs.includes('answer T01'), 'the successful retry logs `answer T01`');
  assert.equal(coordinator.state.tasks.T01.decision, null, 'the delivered answer clears the parked decision');
  assert.equal(driveCollecting(coordinator).result.complete, true, 'the answered worker resumes and the plan completes');
});

test('an answer to a genuinely unreachable worker is recorded as send-failed, not silently dropped (C, T30)', (t) => {
  const logs = [];
  const control = { isHalted: () => false, log: (l) => logs.push(l) };
  const { coordinator, platform } = setup(t, [{ num: 'T01' }, { num: 'T02' }], {
    behaviors: { T01: { question: 'which output format?' } },
    control,
  });
  coordinator.pass(); // spawn
  coordinator.pass(); // T01 asks and parks

  // The parked worker is gone (crashed / closed): the fake's send reports ok:false for an unknown name,
  // the deterministic stand-in for a genuinely unreachable worker.
  const workerId = coordinator.state.tasks.T01.workerId;
  platform.close(workerId);

  const r = coordinator.answer({ task: 'T01', text: 'use json' });
  assert.equal(r.ok, false, 'the send to a gone worker is reported as a failure');
  assert.ok(logs.includes('send-failed T01'), 'the undeliverable answer was recorded as `send-failed T01`');
  assert.ok(!logs.includes('answer T01'), 'an undeliverable answer does not log a successful `answer` line');
});

// --- 14. P3: a `decision` message parks and surfaces, same as a question ---------------------------

test('a worker `decision` message parks and surfaces like a question, and the answer resumes it (P3, T12)', (t) => {
  // The pir-worker contract tells a worker to send `kind: question` OR `kind: decision`; the loop
  // previously handled only question/conflict, so a real decision message was dropped. It must park.
  const { coordinator } = setup(t, [{ num: 'T01' }, { num: 'T02' }], {
    behaviors: { T01: { decision: 'two defensible layouts — which?' } },
  });
  coordinator.pass(); // spawn
  const r2 = coordinator.pass(); // T01 raises a decision
  const surfaced = r2.surfaces.find((s) => s.task === 'T01');
  assert.ok(surfaced, 'the decision surfaced to the user (not silently dropped)');
  assert.equal(surfaced.kind, 'decision');
  assert.match(surfaced.message, /needs a decision from you/i);

  coordinator.answer({ task: 'T01', text: 'layout A' });
  assert.equal(driveCollecting(coordinator).result.complete, true, 'the answered decision resumes and the plan completes');
});

// --- 15. P6: no exit path orphans a spawned worker ------------------------------------------------

test('teardownRun closes every live worker of the run (stop + SIGTERM), so no exit orphans one (P6, T12)', (t) => {
  const { coordinator, platform, worktree } = setup(t, [{ num: 'T01' }, { num: 'T02' }], {
    behaviors: { T01: { question: 'blocked on you' } },
  });
  const { result } = driveCollecting(coordinator); // T02 completes; T01 parks unanswered and stays live
  assert.equal(result.reason, 'parked');
  const parkedId = coordinator.state.tasks.T01.workerId;
  assert.ok(platform._workers.has(parkedId), 'the parked worker is still a live session before teardown');

  const { closed } = teardownRun({ platform, worktree, state: coordinator.state, repo: REPO, slug: SLUG });
  assert.ok(closed.includes(parkedId), 'teardown reported the parked worker closed');
  assert.ok(platform.closed.includes(parkedId), 'it was closed through the platform (stop + SIGTERM live)');
  assert.ok(!platform._workers.has(parkedId), 'no live session of this run remains after teardown');
  // teardownRun is not the HALT forensics path (the loop handles that and never reaches here), so it also
  // clears each closed worker's leftover record with `claude rm`, so a stalled/errored exit leaves nothing
  // in the "Claude agents" view (T41).
  assert.ok(platform.removed.includes(parkedId), 'teardown removes the leftover record too (claude rm)');
});

// --- 16. P4/P5: the ported bin guards (ensureMain, promotion guard, runaway breaker) ---------------

test('ensureMain creates a local main at HEAD when a checkout has none, and is a no-op otherwise (P4, T12)', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'pir-nomain-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const g = (args) => gitRun(dir, args);
  g(['init', '-b', 'side']);
  g(['config', 'user.email', 'x@test.local']);
  g(['config', 'user.name', 'PIR Test']);
  g(['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(dir, 'f.txt'), 'hi');
  g(['add', '-A']);
  g(['commit', '-m', 'init', '--no-edit']);

  assert.equal(g(['rev-parse', '--verify', '--quiet', 'refs/heads/main']).ok, false, 'a side-branch clone has no local main');
  const res = ensureMain(dir);
  assert.equal(res.created, true);
  assert.equal(res.from, 'side');
  assert.equal(g(['rev-parse', '--verify', '--quiet', 'refs/heads/main']).ok, true, 'main now exists at HEAD');
  assert.equal(ensureMain(dir).created, false, 'a second call is a no-op — main already exists');
});

test('renderHandoff: a green plan hands off `git merge pir/{slug}`; a red one prints the failure with no merge line (DESIGN §2.4, §2.8)', () => {
  const green = renderHandoff({ readyToMerge: { branch: 'pir/demo' }, taskCount: 5, slug: 'demo' });
  assert.match(green, /git merge pir\/demo/, 'the green hand-off gives the person the exact merge command');
  assert.match(green, /5 task/, 'it names how many tasks are green');
  assert.match(green, /tests pass/i);

  const red = renderHandoff({ readyToMerge: null, taskCount: 5, slug: 'demo' });
  assert.ok(!/git merge/.test(red), 'a red branch is NEVER handed a merge line (§2.8)');
  assert.match(red, /tests fail/i, 'the red output names the failure');
  assert.match(red, /pir\/demo/, 'and still names the branch so the person can go fix it');
});

test('canPromoteHere refuses the canonical repo unless PARALLEL_ALLOW_HERE overrides (P5, T12)', () => {
  assert.equal(canPromoteHere('plan-implement-review', {}), false, 'the canonical repo is refused by default');
  assert.equal(canPromoteHere('plan-implement-review', { allowHere: true }), true, 'the override permits it');
  assert.equal(canPromoteHere('pir-scratch', {}), true, 'a differently-named scratch clone is fine');
});

test('runawayVerdict tolerates a transient CEILING+1 handoff but aborts a real runaway (P5, T12)', () => {
  assert.deepEqual(runawayVerdict({ liveCount: 2, ceiling: 2, overPasses: 5 }), { abort: false, over: 0 }, 'at/under ceiling never aborts and resets the counter');
  assert.deepEqual(runawayVerdict({ liveCount: 3, ceiling: 2, overPasses: 0 }), { abort: false, over: 1 }, 'one over on its first pass is a review handoff, tolerated');
  assert.equal(runawayVerdict({ liveCount: 3, ceiling: 2, overPasses: 2, overGrace: 3 }).abort, true, 'one over that persists to the grace limit aborts');
  assert.equal(runawayVerdict({ liveCount: 5, ceiling: 2, overPasses: 0 }).abort, true, 'more than one over the ceiling aborts at once — a real runaway');
});

// --- 16. T25: the up-channel is a file drop the bin drains directly, with no agent relay -----------

test('a worker report dropped as a file reaches the loop-facing inbox with no agent relay (T25)', (t) => {
  // The relay this replaces made the coordinator agent re-encode every worker message into an inbox
  // file. Now a worker WRITES its own report; the bin ingests it through the same platform.inbox() the
  // loop already calls. No SendMessage, no coordinator turn — that is the ~20–25% relay cost removed.
  const dir = mkdtempSync(join(tmpdir(), 'pir-reports-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bridge = createAgentBridge({ dir });

  // A worker reports the way the pir-worker contract does: write a temp file, then rename it into
  // reports/, so the bin never reads a half-written file. The payload is its own [pir:v1 …] message.
  const drop = (name, text, from) => {
    const tmp = join(bridge.reportsDir, `${name}.tmp`);
    writeFileSync(tmp, JSON.stringify({ from, text }));
    renameSync(tmp, join(bridge.reportsDir, `${name}.json`));
  };
  const wname = workerName({ repo: REPO, plan: SLUG, task: 'T01', role: 'implement' });
  drop('1-T01', '[pir:v1 kind=implemented task=T01]\ndone building', wname);

  // Binding the bridge's transport to the real messaging is exactly what the bin does (createPlatform).
  const messaging = createMessaging({ transport: bridge.transport });
  assert.deepEqual(messaging.inbox(), [
    { from: wname, kind: 'implemented', task: 'T01', text: 'done building' },
  ]);
  assert.equal(messaging.inbox().length, 0, 'a report is ingested exactly once — the file was consumed');
});

test('reports drain in name order and a torn/malformed report is dropped, never guessed (T25)', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'pir-reports-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bridge = createAgentBridge({ dir });
  const put = (name, body) => writeFileSync(join(bridge.reportsDir, name), body);
  put('2-T02.json', JSON.stringify({ from: 'w2', text: 'b' }));
  put('1-T01.json', JSON.stringify({ from: 'w1', text: 'a' }));
  put('3-torn.json', '{not valid json'); // a half-written / malformed report
  put('4-note.txt', 'not a report'); // a non-.json file is left alone

  assert.deepEqual(bridge.transport.drain(), [
    { from: 'w1', text: 'a' },
    { from: 'w2', text: 'b' },
  ]);
  // The consumed reports and the malformed .json are gone; a non-report file is untouched.
  assert.deepEqual(readdirSync(bridge.reportsDir), ['4-note.txt']);
  assert.equal(bridge.transport.drain().length, 0, 'nothing left to drain');
});

// --- 17. T03: the restart reconciliation summary is exposed for the bin to relay (DESIGN §2.8) -----

// Seed a task branch at a committed glyph, as a crashed run would have left it (mirrors loop.test's
// helper): cut the branch+worktree off the feature branch and commit its own PROGRESS.md row at glyph.
function seedBranch(worktree, slug, num, glyph, { file } = {}) {
  const wt = worktree.createTask(slug, num);
  const p = join(wt.path, progressPathFor(slug));
  writeFileSync(p, reconcileTaskRow(readFileSync(p, 'utf8'), { num, state: glyph, notes: '' }));
  if (file) writeFileSync(join(wt.path, file), `work ${num}\n`);
  git(wt.path, ['add', '-A']);
  git(wt.path, ['commit', '-m', `${num}: seed ${glyph}`, '--no-edit']);
  return wt;
}

test('a restart run exposes a plain-English reconciliation summary from pass(), for the bin to relay (T03)', (t) => {
  const worktree = createFakeWorktree({ progress: progressDoc([{ num: 'T01' }, { num: 'T02' }, { num: 'T03' }]), slug: SLUG });
  t.after(() => worktree.cleanup());
  worktree.openFeature(SLUG);
  seedBranch(worktree, SLUG, 'T01', '✅', { file: 'work-T01.txt' });
  seedBranch(worktree, SLUG, 'T02', '🔍', { file: 'work-T02.txt' });
  seedBranch(worktree, SLUG, 'T03', '🟡', { file: 'work-T03.txt' });
  const platform = createFakePlatform({});
  const coordinator = startCoordinator({ slug: SLUG, repo: REPO, platform, worktree, maxWorkers: 3 });

  const r = coordinator.pass();
  assert.ok(r.restartSummary, 'the first pass of a restart returns a plain-English summary the bin prints');
  assert.match(r.restartSummary, /merged T01/);
  assert.match(r.restartSummary, /T02 to review/);
  assert.match(r.restartSummary, /rebuilding T03/);
});

test('a genuine first start exposes no reconciliation summary from pass() (T03)', (t) => {
  const { coordinator } = setup(t, [{ num: 'T01' }]);
  assert.equal(coordinator.pass().restartSummary, null, 'a first start adopts nothing, so it has no summary');
});

test('recordSurface appends the rendered surface as a JSON line for the skill to relay (T25)', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'pir-surfaced-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bridge = createAgentBridge({ dir });
  bridge.recordSurface({ task: 'T01', kind: 'question', text: 'which format?', message: 'The worker on T01 needs a decision from you: which format?' });
  bridge.recordSurface({ task: 'T02', kind: 'conflict', text: 'clash in x', message: 'The worker on T02 hit a merge conflict…' });
  const lines = readFileSync(bridge.surfacedPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((l) => l.task), ['T01', 'T02']);
  assert.match(lines[0].message, /needs a decision from you/);
});

// --- T04: control-folder cleanup on restart (DESIGN §2.7, §7) ---------------------------------

// Seed a control folder that already holds a dead run's leftovers: a reports/ drop-dir with two report
// files, and the three append-only feeds carrying a stale line each. Returns the dir.
function seedControl() {
  const dir = mkdtempSync(join(tmpdir(), 'pir-control-'));
  const reportsDir = join(dir, 'reports');
  mkdirSync(reportsDir, { recursive: true });
  writeFileSync(join(reportsDir, '001.json'), JSON.stringify({ from: 'w', text: 'stale report' }));
  writeFileSync(join(reportsDir, '002.json'), JSON.stringify({ from: 'w', text: 'stale report 2' }));
  writeFileSync(join(dir, 'answers'), JSON.stringify({ task: 'T01', text: 'stale answer' }) + '\n');
  writeFileSync(join(dir, 'outbox'), JSON.stringify({ to: 'w', text: 'stale down' }) + '\n');
  writeFileSync(join(dir, 'surfaced'), JSON.stringify({ task: 'T01', message: 'stale surface' }) + '\n');
  return dir;
}

test('clearTransientFeeds empties reports/ and truncates answers/outbox/surfaced, reporting what it cleared (T04)', (t) => {
  const dir = seedControl();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const { cleared } = clearTransientFeeds(dir);

  assert.deepEqual(
    readdirSync(join(dir, 'reports')).filter((n) => n.endsWith('.json')),
    [],
    'every leftover report *.json is removed',
  );
  for (const f of ['answers', 'outbox', 'surfaced']) {
    assert.equal(readFileSync(join(dir, f), 'utf8'), '', `${f} is truncated to empty`);
    assert.ok(existsSync(join(dir, f)), `${f} still exists (truncated, not deleted, so this run can append)`);
  }
  assert.deepEqual(cleared.sort(), ['answers', 'outbox', 'reports/', 'surfaced'], 'it reports the four feeds it cleared');
});

test('clearTransientFeeds never touches log or HALT (T04)', (t) => {
  const dir = seedControl();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'log'), '2026-09-17T00:00:00.000Z start\n');
  writeFileSync(join(dir, 'HALT'), '');

  const { cleared } = clearTransientFeeds(dir);

  assert.equal(readFileSync(join(dir, 'log'), 'utf8'), '2026-09-17T00:00:00.000Z start\n', 'the audit log is preserved');
  assert.ok(existsSync(join(dir, 'HALT')), 'the kill switch is preserved');
  assert.ok(!cleared.includes('log') && !cleared.includes('HALT'), 'neither durable record is reported as cleared');
});

test('clearTransientFeeds is a no-op that does not throw on a fresh control dir (T04)', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'pir-control-fresh-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  let res;
  assert.doesNotThrow(() => {
    res = clearTransientFeeds(dir);
  });
  assert.deepEqual(res.cleared, [], 'nothing to clear when every feed is absent');
});

test('a stale answers line is gone after the clear, so it cannot route to a fresh worker (T04)', (t) => {
  const dir = seedControl();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.match(readFileSync(join(dir, 'answers'), 'utf8'), /stale answer/, 'precondition: a stale answer is queued');

  clearTransientFeeds(dir);

  assert.equal(readFileSync(join(dir, 'answers'), 'utf8').trim(), '', 'the stale answer is gone');
});

test('startupControlHygiene refuses a still-HALTed run without clearing HALT or the feeds (T04)', (t) => {
  const repo = mkdtempSync(join(tmpdir(), 'pir-halt-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const control = fileControl(repo, SLUG);
  writeFileSync(join(control.dir, 'HALT'), '');
  writeFileSync(join(control.dir, 'answers'), JSON.stringify({ task: 'T01', text: 'stale' }) + '\n');

  const r = startupControlHygiene(control);

  assert.equal(r.halted, true, 'a present HALT refuses the run');
  assert.equal(r.flag, control.flag, 'the refusal names the flag path so the person knows what to remove');
  assert.ok(existsSync(control.flag), 'HALT is left in place — never auto-cleared (§2.7)');
  assert.match(readFileSync(join(control.dir, 'answers'), 'utf8'), /stale/, 'the feeds are not cleared on a refusal');
  assert.ok(!existsSync(control.logPath), 'no restart marker is written when the run is refused');
});

test('startupControlHygiene clears the feeds and appends a restart marker, preserving prior log lines (T04)', (t) => {
  const repo = mkdtempSync(join(tmpdir(), 'pir-restart-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const control = fileControl(repo, SLUG);
  mkdirSync(join(control.dir, 'reports'), { recursive: true });
  writeFileSync(join(control.dir, 'reports', '001.json'), '{"from":"w","text":"stale"}');
  writeFileSync(join(control.dir, 'answers'), JSON.stringify({ task: 'T01', text: 'stale' }) + '\n');
  writeFileSync(control.logPath, '2026-09-17T00:00:00.000Z spawn T01\n');

  const r = startupControlHygiene(control);

  assert.equal(r.halted, false, 'no HALT, so the run proceeds');
  assert.deepEqual(
    readdirSync(join(control.dir, 'reports')).filter((n) => n.endsWith('.json')),
    [],
    'the stale report is cleared',
  );
  assert.equal(readFileSync(join(control.dir, 'answers'), 'utf8'), '', 'the stale answer is cleared');
  const log = readFileSync(control.logPath, 'utf8');
  assert.match(log, /spawn T01/, 'the prior log line is preserved');
  assert.match(log, /restart\n$/, 'a restart marker is appended to the log');
});
