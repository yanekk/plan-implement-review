import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  startCoordinator,
  readReviewGate,
  createAgentBridge,
  teardownRun,
  ensureMain,
  canPromoteHere,
  runawayVerdict,
  gitRun,
} from './coordinate.mjs';
import { createFakePlatform } from './fake/platform.mjs';
import { createFakeWorktree } from './fake/worktree.mjs';
import { workerName, coordinatorName } from '../core/naming.mjs';
import { progressPathFor } from '../core/progress.mjs';

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
  assert.equal(result.promoted, true, 'the plan still drains to promotion alongside the foreign agents');
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
  // The loop also sends each freshly-spawned worker a `hello` (T13 Problem A), so `sent` carries those
  // too. The answer is the only `answer`-kind message, and it went to T01 alone.
  const answers = platform.sent.filter((s) => s.msg.kind === 'answer');
  assert.deepEqual(answers.map((s) => s.to), [workerName({ repo: REPO, plan: SLUG, task: 'T01', role: 'implement' })], 'answered T01 and only T01');
  assert.equal(answers[0].msg.kind, 'answer');

  const { result } = driveCollecting(coordinator);
  assert.equal(result.promoted, true, 'the answered worker resumes and the plan promotes');
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
  assert.equal(result.promoted, true);

  const you = passes.flatMap((p) => p.youToDrive).find((y) => y.task === 'T01');
  assert.ok(you, 'the coordinator surfaced a hands-on worker for the you task');
  assert.equal(you.worker, workerName({ repo: REPO, plan: SLUG, task: 'T01', role: 'verify' }));

  assert.ok(platform.spawns.some((s) => s.role === 'verify' && s.task === 'T01'), 'T01 spawned as a verify worker');
  assert.ok(!platform.spawns.some((s) => s.role === 'review' && s.task === 'T01'), 'a you task is never reviewed');

  const finalMain = worktree.progressOn('main');
  assert.equal((finalMain.match(/✅/g) || []).length, 2, 'both tasks are ✅ on main');
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

// --- 10. Task branches merge into the feature branch; main touched once ---------------------------

test('task branches merge into the feature branch and main is touched exactly once, at promotion', (t) => {
  const { coordinator, worktree } = setup(t, chain(4));
  assert.equal(worktree.mainCommitCount(), 1, 'main starts at the initial commit only');

  const { result } = driveCollecting(coordinator);
  assert.equal(result.promoted, true);

  const merges = worktree.events.filter((e) => e.op === 'mergeTask');
  assert.equal(merges.length, 4, 'four task branches merged');
  assert.ok(merges.every((e) => e.into === `pir/${SLUG}`), 'every merge went into the feature branch, never main');
  assert.equal(worktree.events.filter((e) => e.op === 'promote').length, 1, 'promoted to main exactly once');
  const finalMain = worktree.progressOn('main');
  assert.equal((finalMain.match(/✅/g) || []).length, 4, 'all four tasks are ✅ on main');
});

// --- 11. Promote only on a green feature branch --------------------------------------------------

test('a red feature branch is surfaced, not promoted; a green one promotes', (t) => {
  const red = setup(t, [{ num: 'T01' }], { runTests: () => ({ ok: false }) });
  const { result: redResult, surfaces: redSurfaces } = driveCollecting(red.coordinator);
  assert.notEqual(redResult.reason, 'promoted', 'a red feature branch is not promoted');
  assert.ok(redSurfaces.some((s) => s.kind === 'red-feature'), 'the red feature branch is surfaced to the user');
  assert.equal(red.worktree.mainCommitCount(), 1, 'nothing red reached main');

  const green = setup(t, [{ num: 'T01' }], { runTests: () => ({ ok: true }) });
  assert.equal(driveCollecting(green.coordinator).result.promoted, true, 'a green feature branch promotes');
});

// --- 12. Reports each ✅ and terminates when the plan is fully ✅ and promoted ----------------------

test('the coordinator reports each task reaching ✅ and terminates on a fully promoted plan', (t) => {
  const { coordinator, worktree } = setup(t, chain(3));
  const { result, completed } = driveCollecting(coordinator);
  assert.equal(result.reason, 'promoted');
  assert.equal(result.promoted, true);
  assert.deepEqual([...completed].sort(), ['T01', 'T02', 'T03'], 'each task was reported reaching ✅ as it merged');
  const finalMain = worktree.progressOn('main');
  assert.ok(!finalMain.includes('⬜'), 'no ⬜ task remains on main after promotion');
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
  assert.equal(driveCollecting(coordinator).result.promoted, true, 'the answered worker resumes and the plan promotes');
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
  assert.equal(driveCollecting(coordinator).result.promoted, true, 'the answered decision resumes and the plan promotes');
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
