import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, renameSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  startCoordinator,
  readReviewGate,
  readTestBlockGate,
  testBlockRefusal,
  createReportInbox,
  teardownRun,
  ensureMain,
  canPromoteHere,
  renderHandoff,
  runFeatureTests,
  runawayVerdict,
  gitRun,
  clearTransientFeeds,
  startupControlHygiene,
  fileControl,
  buildRunState,
  testingRunState,
  displayPhaseFor,
  waitForReport,
  shouldSelfReport,
  finalStateForExit,
  writeRunSnapshot,
  writeRunFinal,
  updateIndexFinalState,
  makePrepare,
} from './coordinate.mjs';
import { readSnapshot } from './snapshot-store.mjs';
import { serializeRecord } from '../core/runrecord.mjs';
import { EventEmitter } from 'node:events';
import { createMessaging, createPlatform, encodeMessage } from './platform.mjs';
import { startWorker } from './worker-proc.mjs';
import { fakeClaudeSpawner, turn } from './fake/claude-stream.mjs';
import { createFakePlatform } from './fake/platform.mjs';
import { createFakeWorktree, git } from './fake/worktree.mjs';
import { workerName } from '../core/naming.mjs';
import { progressPathFor, reconcileTaskRow } from '../core/progress.mjs';

// The dry-run seatbelt (DESIGN §5.2): the coordinator is handed fakes and a scratch repo, so nothing
// here reaches a real agent or the real project. Every test below drives the SAME startCoordinator the
// bin drives live; only the injected platform/worktree differ.
process.env.PARALLEL_DRY_RUN = '1';

const REPO = 'demo-repo';
const SLUG = 'demo';

// A task's slug is its Task-column value (DESIGN §2.9); the worker name carries it. Give each task a
// distinct slug so the coordinator's rebuilt names (the answer down-send, the you-worker to drive) can
// be asserted to match the sessions the loop spawned.
const slugOf = (num) => `${num}-thing`;
const wname = (task, role) => workerName({ repo: REPO, plan: SLUG, task, slug: slugOf(task), role });

function progressDoc(rows) {
  const header = '| # | Task | Runs | Depends on | State | Notes |';
  const sep = '|---|---|---|---|---|---|';
  const body = rows
    .map((r) => {
      const deps = r.deps && r.deps.length ? r.deps.join(', ') : '—';
      return `| ${r.num} | ${slugOf(r.num)} | ${r.runs ?? 'auto'} | ${deps} | ${r.state ?? '⬜'} | |`;
    })
    .join('\n');
  return `# Progress\n\n**Plan reviewed:** 2026-09-08 — reviewed\n\n${header}\n${sep}\n${body}\n`;
}

// Stand up a coordinator over the fakes for a plan. Returns the coordinator plus the fake platform and
// worktree so a test can inspect spawns/sends/closes and the branch events.
function setup(t, rows, { behaviors = {}, files = {}, maxWorkers = 4, control, runTests, prepare } = {}) {
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
    prepare,
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

// --- 1b. The setup/test block gate (declared-test-command DESIGN §2.3) ---------------------------

test('readTestBlockGate: a valid block passes; a missing block, a malformed one and no DESIGN.md refuse', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pir-block-'));
  try {
    const write = (slug, text) => {
      mkdirSync(join(dir, 'plans', slug), { recursive: true });
      writeFileSync(join(dir, 'plans', slug, 'DESIGN.md'), text);
    };
    write('valid', '---\nsetup:\n  - npm ci\ntest:\n  - npm test\n---\n# Design\n');
    write('noblock', '# Design\n\nThe test command is `npm test`.\n');
    write('malformed', '---\nsetup: none\ntest: none\n---\n');
    mkdirSync(join(dir, 'plans', 'nodesign'), { recursive: true });

    assert.deepEqual(readTestBlockGate('valid', { root: dir }), { ok: true, setup: ['npm ci'], test: ['npm test'] });
    assert.deepEqual(readTestBlockGate('noblock', { root: dir }), { ok: false, reason: 'no front-matter block' });
    const bad = readTestBlockGate('malformed', { root: dir });
    assert.equal(bad.ok, false);
    assert.ok(bad.reason, 'a malformed block carries the parser reason');
    assert.deepEqual(readTestBlockGate('nodesign', { root: dir }), { ok: false, reason: 'no DESIGN.md' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('testBlockRefusal names the file, the reason and /pir-review-plan', () => {
  assert.equal(
    testBlockRefusal('demo', 'no test key'),
    "cannot start 'demo': plans/demo/DESIGN.md has no valid setup/test block (no test key).\n" +
      'A plan without one counts as not reviewed. Run /pir-review-plan demo to add it.\n',
  );
});

// The bin itself, as a subprocess against a scratch git repo — DRY mode only. PARALLEL_LIVE is removed
// from the child's env on purpose: a regression under PARALLEL_LIVE=1 would spawn paid workers.
function runBinDry(root, slug) {
  const env = { ...process.env };
  delete env.PARALLEL_LIVE;
  const bin = fileURLToPath(new URL('./coordinate.mjs', import.meta.url));
  return spawnSync(process.execPath, [bin, slug], { cwd: root, env, encoding: 'utf8', timeout: 30000 });
}

function scratchGitPlan(design) {
  const root = mkdtempSync(join(tmpdir(), 'pir-bin-'));
  const g = (...a) => execFileSync('git', a, { cwd: root, stdio: 'pipe' });
  g('init', '-q', '-b', 'main');
  mkdirSync(join(root, 'plans', 'demo'), { recursive: true });
  writeFileSync(
    join(root, 'plans', 'demo', 'PROGRESS.md'),
    '# Progress\n\n**Plan reviewed:** 2026-09-24 — clean\n\n| # | Task | Depends on | State | Notes |\n|---|---|---|---|---|\n| T01 | a | — | ⬜ | |\n',
  );
  if (design !== null) writeFileSync(join(root, 'plans', 'demo', 'DESIGN.md'), design);
  g('add', '-A');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'plan');
  return { root, g };
}

test('the coordinator bin refuses a plan without a valid block, dry run, before any worktree or branch', () => {
  const { root, g } = scratchGitPlan('# Design\n\nno block here\n');
  try {
    const r = runBinDry(root, 'demo');
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.ok(
      r.stderr.includes(testBlockRefusal('demo', 'no front-matter block')),
      `stderr carries the refusal: ${r.stderr}`,
    );
    assert.doesNotMatch(r.stdout, /DRY:/, 'refused before the dry-run branch');
    assert.equal(g('worktree', 'list', '--porcelain').toString().match(/^worktree /gm).length, 1, 'no worktree created');
    assert.equal(g('branch', '--list', 'pir/*').toString().trim(), '', 'no pir branch cut');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the coordinator bin starts a plan with a valid block exactly as before (dry run)', () => {
  const { root } = scratchGitPlan('---\nsetup: none\ntest:\n  - true\n---\n# Design\n');
  try {
    const r = runBinDry(root, 'demo');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /DRY: not spawning real workers/);
    assert.match(r.stdout, /Ready to dispatch now: T01/);
  } finally {
    rmSync(root, { recursive: true, force: true });
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
  assert.equal(impl.name, wname('T01', 'implement'));
  assert.equal(review.name, wname('T01', 'review'));
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
  // Neither is one of THIS coordinator's workers (its workers are `${REPO} / ${SLUG} / T… / {slug} /
  // {role}`, §2.9), so the coordinator must never adopt, review or close them. They use the legacy `·`
  // form the harness still emits, which parseAgentName still reads during the transition (DESIGN §3.2).
  const foreigners = [
    { id: 'F1', name: 'other-repo · other-plan · T01 · implement', cwd: '/x', status: 'busy', state: 'working', live: true },
    { id: 'F2', name: `${REPO} · another-plan · T01 · implement`, cwd: '/y', status: 'busy', state: 'working', live: true },
  ];
  const platform = { ...fake, list: () => [...fake.list(), ...foreigners] };

  const coordinator = startCoordinator({ slug: SLUG, repo: REPO, platform, worktree, maxWorkers: 4 });

  const { result } = driveCollecting(coordinator);
  assert.equal(result.complete, true, 'the plan still drains to completion alongside the foreign agents');
  assert.ok(!fake.closed.includes('F1') && !fake.closed.includes('F2'), 'no foreign agent was ever closed');
  const spawnedNames = fake.spawns.map((s) => s.name);
  assert.ok(
    spawnedNames.every((n) => n.startsWith(`${REPO} / ${SLUG} / `)),
    'every worker it spawned carries its own repo/plan prefix (§2.9)',
  );
});

// --- 4. A question is surfaced for the display; the person answers the worker directly, nothing routed

test('a worker question is surfaced for the display and the parked worker holds its slot; nothing is routed (DESIGN §2.2)', (t) => {
  const { coordinator, platform } = setup(t, [{ num: 'T01' }, { num: 'T02' }], {
    behaviors: { T01: { question: 'which output format?' } },
  });

  coordinator.pass(); // spawn T01, T02
  const r2 = coordinator.pass(); // T01 asks
  const surfaced = r2.surfaces.find((s) => s.kind === 'question' && s.task === 'T01');
  assert.ok(surfaced, 'the question surfaced for the display');
  assert.match(surfaced.message, /which output format\?/);
  assert.match(surfaced.message, /worker on T01/i, 'the plain-English surface names the task');

  // There is no down-channel (DESIGN §2.2, T03): the coordinator has no answer() to route with, and the
  // person answers the parked worker DIRECTLY in its own session. The worker holds its slot meanwhile.
  assert.equal(coordinator.answer, undefined, 'no down-channel answer() — the person answers the worker directly');
  assert.ok(coordinator.state.tasks.T01, 'the parked worker is still tracked, holding its slot');
  assert.equal(platform.sent.length, 0, 'the coordinator routed nothing down — there is no down-channel');
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

// --- 6. A row marked `you` is built like any other — the auto/you distinction is gone (§2.5) -------

test('a row still marked `you` in the Runs column is built and reviewed like any other task, unblocking its dependents', (t) => {
  const { coordinator, platform, worktree } = setup(t, [
    { num: 'T01', runs: 'you' },
    { num: 'T02', deps: ['T01'] },
  ]);

  const { result } = driveCollecting(coordinator);
  assert.equal(result.complete, true);

  assert.ok(platform.spawns.some((s) => s.role === 'implement' && s.task === 'T01'), 'T01 built by an implement worker');
  assert.ok(!platform.spawns.some((s) => s.role === 'verify'), 'no verify worker is ever spawned');

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
  // This is a WORKER-raised integrate conflict (§2.8 first bullet): the worker holds the context and
  // escalates a decision, so it carries no copy-paste prompt. The copy-paste resolution prompt (T14) is
  // only for the COORDINATOR's own merge conflict (loop.mjs 3d / reconcile), where the worker finished
  // clean and has no idea a clash happened. renderSurface passes the field through either way.
  assert.equal(conflict.prompt, null, 'a worker-raised conflict carries no coordinator prompt (T14 is the coordinator-hit path)');

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

test('the coordinator carries the red gate reason out of pass() and drive(); green carries null (DESIGN §2.8)', (t) => {
  const why = { ok: false, reason: 'test `make test` exited 2', logPath: '/x/tests.log' };
  const red = setup(t, [{ num: 'T01' }], { runTests: () => why });
  let lastPass;
  const redResult = red.coordinator.drive({ onPass: (r) => { lastPass = r; } });
  assert.deepEqual(lastPass.testsReason, { reason: why.reason, logPath: why.logPath }, 'the completing pass carries it');
  assert.deepEqual(redResult.testsReason, { reason: why.reason, logPath: why.logPath });

  const green = setup(t, [{ num: 'T01' }], { runTests: () => ({ ok: true }) });
  assert.equal(green.coordinator.drive().testsReason, null);
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

// --- 13. There is no down-channel: the coordinator never routes an answer (DESIGN §2.2, T03) --------

test('the coordinator exposes no answer() and never sends anything down — the person answers directly', (t) => {
  // The whole down-channel is gone (DESIGN §2.2): a blocked worker is answered by the person directly in
  // its own session. So there is no answer() to route with, and even a parked worker drives nothing down.
  const { coordinator, platform } = setup(t, [{ num: 'T01' }, { num: 'T02' }], {
    behaviors: { T01: { question: 'which output format?' } },
  });
  assert.equal(coordinator.answer, undefined, 'there is no answer() on the controller');

  coordinator.pass(); // spawn
  coordinator.pass(); // T01 asks and parks
  driveCollecting(coordinator); // drive on; T01 stays parked, unanswered
  assert.equal(platform.sent.length, 0, 'nothing was ever sent down — there is no down-channel to route on');
});

// --- 14. P3: a `decision` message parks and surfaces, same as a question ---------------------------

test('a worker `decision` message parks and surfaces like a question; the worker is answered directly (P3, DESIGN §2.2)', (t) => {
  // The pir-worker contract tells a worker to send `kind: question` OR `kind: decision`; both park the
  // task and surface it for the display. The answer is not routed — the person replies to the worker.
  const { coordinator } = setup(t, [{ num: 'T01' }, { num: 'T02' }], {
    behaviors: { T01: { decision: 'two defensible layouts — which?' } },
  });
  coordinator.pass(); // spawn
  const r2 = coordinator.pass(); // T01 raises a decision
  const surfaced = r2.surfaces.find((s) => s.task === 'T01');
  assert.ok(surfaced, 'the decision surfaced (not silently dropped)');
  assert.equal(surfaced.kind, 'decision');
  assert.match(surfaced.message, /needs a decision from you/i);
  assert.ok(coordinator.state.tasks.T01, 'the worker parks and holds its slot, awaiting the person');
});

// --- 15. P6: no exit path orphans a spawned worker ------------------------------------------------

test('teardownRun closes every live worker of the run at once (immediate SIGTERM), so no exit orphans one (P6, T12)', (t) => {
  const { coordinator, platform, worktree } = setup(t, [{ num: 'T01' }, { num: 'T02' }], {
    behaviors: { T01: { question: 'blocked on you' } },
  });
  const { result } = driveCollecting(coordinator); // T02 completes; T01 parks unanswered and stays live
  assert.equal(result.reason, 'parked');
  const parkedId = coordinator.state.tasks.T01.workerId;
  assert.ok(platform._workers.has(parkedId), 'the parked worker is still a live session before teardown');

  const { closed } = teardownRun({ platform, worktree, state: coordinator.state, repo: REPO, slug: SLUG });
  assert.ok(closed.includes(parkedId), 'teardown reported the parked worker closed');
  assert.ok(platform.closed.includes(parkedId), 'it was closed through the platform');
  assert.ok(
    platform.closeOpts.some((c) => c.id === parkedId && c.immediate === true),
    'closed immediate: teardown runs just before process.exit, so the SIGTERM cannot wait (live-workers §2.12)',
  );
  assert.ok(!platform._workers.has(parkedId), 'no live worker of this run remains after teardown');
  // teardownRun is not the HALT forensics path, so it also calls remove (T41), a no-op for live children.
  assert.ok(platform.removed.includes(parkedId), 'teardown calls remove on a finish path');
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

test('renderHandoff: a red hand-off carries the gate\'s reason and log path when given one', () => {
  const red = renderHandoff({ readyToMerge: null, taskCount: 2, slug: 'demo', why: '`make test` exited 2; output: /x/tests.log' });
  assert.match(red, /`make test` exited 2/);
  assert.match(red, /\/x\/tests\.log/);
});

// runFeatureTests runs the setup then test lines of the front-matter block in the main checkout's
// DESIGN.md (DESIGN §2.2, §2.5), in the feature worktree. Real /bin/sh, scratch dirs: `root` holds the
// plan, `dir` is the feature worktree the lines run in.
function gate(t, designBody) {
  const root = mkdtempSync(join(tmpdir(), 'pir-gate-root-'));
  const dir = mkdtempSync(join(tmpdir(), 'pir-gate-feature-'));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  });
  mkdirSync(join(root, 'plans', 'demo'), { recursive: true });
  if (designBody != null) writeFileSync(join(root, 'plans', 'demo', 'DESIGN.md'), designBody);
  const logPath = join(root, 'tests.log');
  return { root, dir, logPath, run: () => runFeatureTests(dir, { slug: 'demo', root, logPath }) };
}

const block = (setup, tests) =>
  `---\nsetup:${setup.length ? '\n' + setup.map((l) => `  - ${l}`).join('\n') : ' none'}\ntest:\n` +
  `${tests.map((l) => `  - ${l}`).join('\n')}\n---\n\n# Design\n`;

test('runFeatureTests: green setup and test is ok, with every $ header in run order in one log', (t) => {
  const g = gate(t, block(['echo prepared > ready'], ['test -f ready', 'echo suite-ran']));
  const r = g.run();
  assert.equal(r.ok, true);
  assert.equal(r.half, null);
  assert.equal(r.logPath, g.logPath);
  const log = readFileSync(g.logPath, 'utf8');
  assert.equal(
    log.split('\n').filter((l) => l.startsWith('$ ')).join('|'),
    '$ echo prepared > ready|$ test -f ready|$ echo suite-ran',
  );
  assert.match(log, /suite-ran/, 'the output lands in the log, not the terminal');
});

test('runFeatureTests: a failing setup line is red in the setup half and no test line runs', (t) => {
  const g = gate(t, block(['exit 4'], ['touch tests-ran']));
  const r = g.run();
  assert.equal(r.ok, false);
  assert.equal(r.half, 'setup');
  assert.equal(r.command, 'exit 4');
  assert.equal(r.reason, 'setup `exit 4` exited 4');
  assert.equal(existsSync(join(g.dir, 'tests-ran')), false);
  assert.doesNotMatch(readFileSync(g.logPath, 'utf8'), /\$ touch/);
});

test('runFeatureTests: a failing second test line is red in the test half and the reason names it', (t) => {
  const g = gate(t, block([], ['true', 'exit 3   # second suite', 'echo never']));
  const r = g.run();
  assert.equal(r.ok, false);
  assert.equal(r.half, 'test');
  assert.equal(r.reason, 'test `exit 3   # second suite` exited 3');
  assert.equal(r.logPath, g.logPath);
  assert.doesNotMatch(readFileSync(g.logPath, 'utf8'), /\$ echo never/, 'it stops at the first failing line');
});

test('runFeatureTests: setup none runs only the test lines, and the log is rewritten per run', (t) => {
  const g = gate(t, block([], ['echo only-test']));
  writeFileSync(g.logPath, '$ stale from a previous run\n');
  assert.equal(g.run().ok, true);
  const headers = readFileSync(g.logPath, 'utf8').split('\n').filter((l) => l.startsWith('$ '));
  assert.deepEqual(headers, ['$ echo only-test']);
});

test('runFeatureTests: DESIGN.md is read from root, even when the feature worktree\'s copy has no block', (t) => {
  const g = gate(t, block([], ['touch from-root']));
  // The restart case: a feature branch cut before the block was written carries the old prose copy.
  mkdirSync(join(g.dir, 'plans', 'demo'), { recursive: true });
  writeFileSync(join(g.dir, 'plans', 'demo', 'DESIGN.md'), '**The test command.**\n\n```\nexit 9\n```\n');
  assert.equal(g.run().ok, true);
  assert.equal(existsSync(join(g.dir, 'from-root')), true, 'the line ran in the feature worktree');
});

test('runFeatureTests: an invalid or missing block is red with the parser\'s reason and runs nothing', (t) => {
  const prose = gate(t, '**The test command.**\n\n```\ntouch ran\n```\n');
  const r = prose.run();
  assert.equal(r.ok, false);
  assert.equal(r.half, null);
  assert.equal(r.reason, 'plans/demo/DESIGN.md: no front-matter block');
  assert.equal(existsSync(join(prose.dir, 'ran')), false, 'no prose is guessed at');
  assert.equal(existsSync(prose.logPath), false, 'no command ran, so no log');

  const noTest = gate(t, '---\nsetup: none\n---\n');
  assert.equal(noTest.run().reason, 'plans/demo/DESIGN.md: no test key');

  assert.equal(gate(t, null).run().reason, 'plans/demo/DESIGN.md: no front-matter block');
});

test('runFeatureTests: the run\'s own switches do not reach the project\'s setup or suite', (t) => {
  const g = gate(t, block(['test -z "$PARALLEL_LIVE$PIR_RUN"'], ['test -z "$PARALLEL_LIVE$PIR_RUN"']));
  const saved = { live: process.env.PARALLEL_LIVE, run: process.env.PIR_RUN };
  process.env.PARALLEL_LIVE = '1';
  process.env.PIR_RUN = '1';
  t.after(() => {
    if (saved.live === undefined) delete process.env.PARALLEL_LIVE; else process.env.PARALLEL_LIVE = saved.live;
    if (saved.run === undefined) delete process.env.PIR_RUN; else process.env.PIR_RUN = saved.run;
  });
  assert.equal(g.run().ok, true);
});

// No module may still import the prose reader T04 deleted.
test('nothing imports testcommand.mjs any more', () => {
  const src = join(import.meta.dirname, '..');
  const offenders = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.mjs') && /from ['"][^'"]*testcommand\.mjs['"]/.test(readFileSync(p, 'utf8'))) offenders.push(p);
    }
  };
  walk(src);
  assert.deepEqual(offenders, []);
  assert.equal(existsSync(join(src, 'core', 'testcommand.mjs')), false);
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

// --- 16. The up-channel is a file drop the bin drains directly, no agent (DESIGN §2.2) -------------

test('a worker report dropped as a file reaches the loop-facing inbox with no agent relay (DESIGN §2.2)', (t) => {
  // A worker reports UP by writing its own report file; the bin ingests it through the same
  // platform.inbox() the loop already calls. No SendMessage, no coordinator turn — a plain file drop.
  const dir = mkdtempSync(join(tmpdir(), 'pir-reports-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const inbox = createReportInbox({ dir });

  // A worker reports the way the pir-worker contract does: write a temp file, then rename it into
  // reports/, so the bin never reads a half-written file. The payload is its own [pir:v1 …] message.
  const drop = (name, text, from) => {
    const tmp = join(inbox.reportsDir, `${name}.tmp`);
    writeFileSync(tmp, JSON.stringify({ from, text }));
    renameSync(tmp, join(inbox.reportsDir, `${name}.json`));
  };
  const implName = wname('T01', 'implement');
  drop('1-T01', '[pir:v1 kind=implemented task=T01]\ndone building', implName);

  // Binding the report inbox's transport to the real messaging is exactly what the bin does (createPlatform).
  const messaging = createMessaging({ transport: inbox.transport });
  assert.deepEqual(messaging.inbox(), [
    { from: implName, kind: 'implemented', task: 'T01', text: 'done building' },
  ]);
  assert.equal(messaging.inbox().length, 0, 'a report is ingested exactly once — the file was consumed');
});

test('reports drain in name order and a torn/malformed report is dropped, never guessed (DESIGN §2.2)', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'pir-reports-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const inbox = createReportInbox({ dir });
  const put = (name, body) => writeFileSync(join(inbox.reportsDir, name), body);
  put('2-T02.json', JSON.stringify({ from: 'w2', text: 'b' }));
  put('1-T01.json', JSON.stringify({ from: 'w1', text: 'a' }));
  put('3-torn.json', '{not valid json'); // a half-written / malformed report
  put('4-note.txt', 'not a report'); // a non-.json file is left alone

  assert.deepEqual(inbox.transport.drain(), [
    { from: 'w1', text: 'a' },
    { from: 'w2', text: 'b' },
  ]);
  // The consumed reports and the malformed .json are gone; a non-report file is untouched.
  assert.deepEqual(readdirSync(inbox.reportsDir), ['4-note.txt']);
  assert.equal(inbox.transport.drain().length, 0, 'nothing left to drain');
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
  assert.match(r.restartSummary, /resuming T03/);
});

test('a genuine first start exposes no reconciliation summary from pass() (T03)', (t) => {
  const { coordinator } = setup(t, [{ num: 'T01' }]);
  assert.equal(coordinator.pass().restartSummary, null, 'a first start adopts nothing, so it has no summary');
});

// --- 18. Feeding the live display: the loop→display mapping (DESIGN §2.3) --------------------------

test('displayPhaseFor maps a tracked worker role/phase to the display phase (DESIGN §2.3)', () => {
  assert.equal(displayPhaseFor(null), null, 'no worker → no phase');
  assert.equal(displayPhaseFor({ role: 'implement', phase: 'implementing' }), 'building');
  assert.equal(displayPhaseFor({ role: 'verify', phase: 'verifying' }), 'building', 'a you/verify scribe reads as building');
  assert.equal(displayPhaseFor({ role: 'review', phase: 'reviewing' }), 'reviewing');
  assert.equal(displayPhaseFor({ role: 'review', phase: 'done' }), 'merging', 'a reviewed task waiting on its merge is merging');
  assert.equal(displayPhaseFor({ role: 'implement', phase: 'awaiting-answer' }), 'asking', 'a parked worker is asking, whatever its role');
});

test('buildRunState assembles the display model input from a pass result and the tracked workers (DESIGN §2.3)', () => {
  const passTasks = [
    { num: 'T01', name: 'done-one', deps: [], state: '✅' },
    { num: 'T02', name: 'build-one', deps: [], state: '⬜' },
    { num: 'T03', name: 'ask-one', deps: ['T02'], state: '⬜' },
    { num: 'T04', name: 'wait-one', deps: ['T03'], state: '⬜' },
  ];
  const stateTasks = {
    T02: { role: 'implement', phase: 'implementing' },
    T03: { role: 'implement', phase: 'awaiting-answer', decision: { text: 'which layout?' } },
  };
  const rs = buildRunState({
    passTasks,
    stateTasks,
    branch: 'pir/demo',
    ceiling: 4,
    sinceByTask: { T02: 100, T03: 50 },
    doneMsByTask: { T01: 6400 },
    complete: false,
    readyToMerge: false,
  });
  assert.equal(rs.branch, 'pir/demo');
  assert.equal(rs.ceiling, 4);
  const by = Object.fromEntries(rs.tasks.map((t) => [t.id, t]));
  assert.deepEqual(by.T01, { id: 'T01', slug: 'done-one', deps: [], done: true, phase: null, since: null, doneMs: 6400, question: null, prompt: null, conflictSent: false });
  assert.equal(by.T02.phase, 'building');
  assert.equal(by.T02.since, 100);
  assert.equal(by.T03.phase, 'asking');
  assert.equal(by.T03.question, 'which layout?');
  assert.equal(by.T03.prompt, null, 'a plain question carries no copy-paste prompt (only a conflict does — T14)');
  // T04 has no worker and its dep is not ✅: the pure model will read it as waiting; buildRunState just
  // reports no phase and passes the deps through.
  assert.equal(by.T04.phase, null);
  assert.deepEqual(by.T04.deps, ['T03']);
});

test('a coordinator-hit conflict with a live worker is sent, not surfaced: no paste block, and the row reads fixing (live-workers T08)', (t) => {
  const cr = (mine) => ({ conflictResolve: { file: 'greeting.txt', mine, resolved: 'hello there\n' } });
  const { coordinator, platform } = setup(t, [{ num: 'T01' }, { num: 'T02' }], {
    files: { 'greeting.txt': 'hello world\n' },
    behaviors: { T01: cr('hello there\n'), T02: cr('hi world\n') },
  });
  let sent = null;
  let r;
  for (let i = 0; i < 20 && !sent; i++) {
    r = coordinator.pass();
    sent = r.actions.find((a) => a.type === 'conflict-sent');
    assert.ok(!r.surfaces.some((s) => s.kind === 'conflict'), 'no conflict surface, so the bin prints no paste block');
  }
  assert.ok(sent, 'the conflict was sent to the live worker');
  assert.equal(platform.sent.length, 1);
  const rs = buildRunState({ passTasks: r.tasks, stateTasks: coordinator.state.tasks, branch: 'pir/demo', ceiling: 4 });
  const row = rs.tasks.find((x) => x.id === sent.task);
  assert.equal(row.phase, 'asking');
  assert.equal(row.conflictSent, true, 'the run state carries conflictSent for the display');
});

test('buildRunState marks conflictSent only for a sent conflict', () => {
  const passTasks = [
    { num: 'T01', name: 'sent', deps: [], state: '⬜' },
    { num: 'T02', name: 'printed', deps: [], state: '⬜' },
  ];
  const stateTasks = {
    T01: { role: 'review', phase: 'awaiting-answer', decision: { kind: 'conflict', text: 'c', prompt: 'p', sent: true } },
    T02: { role: 'review', phase: 'awaiting-answer', decision: { kind: 'conflict', text: 'c', prompt: 'p' } },
  };
  const by = Object.fromEntries(buildRunState({ passTasks, stateTasks, branch: 'b', ceiling: 2 }).tasks.map((x) => [x.id, x]));
  assert.equal(by.T01.conflictSent, true);
  assert.equal(by.T02.conflictSent, false);
});

// --- 19. Control-folder cleanup on restart (DESIGN §2.7, §3.5) -------------------------------------
//
// The only transient feed left is reports/ (the up-channel); the down-channel feeds were removed with
// the relay (DESIGN §2.2, T03), so a restart clears reports/ and nothing else.

// Seed a control folder that already holds a dead run's leftover reports. Returns the dir.
function seedControl() {
  const dir = mkdtempSync(join(tmpdir(), 'pir-control-'));
  const reportsDir = join(dir, 'reports');
  mkdirSync(reportsDir, { recursive: true });
  writeFileSync(join(reportsDir, '001.json'), JSON.stringify({ from: 'w', text: 'stale report' }));
  writeFileSync(join(reportsDir, '002.json'), JSON.stringify({ from: 'w', text: 'stale report 2' }));
  return dir;
}

test('clearTransientFeeds empties the reports drop-dir and reports what it cleared (T03)', (t) => {
  const dir = seedControl();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const { cleared } = clearTransientFeeds(dir);

  assert.deepEqual(
    readdirSync(join(dir, 'reports')).filter((n) => n.endsWith('.json')),
    [],
    'every leftover report *.json is removed',
  );
  assert.deepEqual(cleared, ['reports/'], 'it reports the one feed it cleared — reports/ is all that is left');
});

test('clearTransientFeeds never touches log or HALT (T03)', (t) => {
  const dir = seedControl();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'log'), '2026-09-17T00:00:00.000Z start\n');
  writeFileSync(join(dir, 'HALT'), '');

  const { cleared } = clearTransientFeeds(dir);

  assert.equal(readFileSync(join(dir, 'log'), 'utf8'), '2026-09-17T00:00:00.000Z start\n', 'the audit log is preserved');
  assert.ok(existsSync(join(dir, 'HALT')), 'the kill switch is preserved');
  assert.ok(!cleared.includes('log') && !cleared.includes('HALT'), 'neither durable record is reported as cleared');
});

test('clearTransientFeeds is a no-op that does not throw on a fresh control dir (T03)', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'pir-control-fresh-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  let res;
  assert.doesNotThrow(() => {
    res = clearTransientFeeds(dir);
  });
  assert.deepEqual(res.cleared, [], 'nothing to clear when reports/ is absent');
});

test('a stale report is gone after the clear, so it cannot route to a fresh worker (T03)', (t) => {
  const dir = seedControl();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(readdirSync(join(dir, 'reports')).length, 2, 'precondition: two stale reports are queued');

  clearTransientFeeds(dir);

  assert.equal(readdirSync(join(dir, 'reports')).filter((n) => n.endsWith('.json')).length, 0, 'the stale reports are gone');
});

test('startupControlHygiene refuses a still-HALTed run without clearing HALT or the reports (T03)', (t) => {
  const repo = mkdtempSync(join(tmpdir(), 'pir-halt-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const control = fileControl(repo, SLUG);
  writeFileSync(join(control.dir, 'HALT'), '');
  mkdirSync(join(control.dir, 'reports'), { recursive: true });
  writeFileSync(join(control.dir, 'reports', '001.json'), '{"from":"w","text":"stale"}');

  const r = startupControlHygiene(control);

  assert.equal(r.halted, true, 'a present HALT refuses the run');
  assert.equal(r.flag, control.flag, 'the refusal names the flag path so the person knows what to remove');
  assert.ok(existsSync(control.flag), 'HALT is left in place — never auto-cleared (§2.7)');
  assert.equal(readdirSync(join(control.dir, 'reports')).length, 1, 'the reports are not cleared on a refusal');
  assert.ok(!existsSync(control.logPath), 'no restart marker is written when the run is refused');
});

test('startupControlHygiene clears the reports and appends a restart marker, preserving prior log lines (T03)', (t) => {
  const repo = mkdtempSync(join(tmpdir(), 'pir-restart-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const control = fileControl(repo, SLUG);
  mkdirSync(join(control.dir, 'reports'), { recursive: true });
  writeFileSync(join(control.dir, 'reports', '001.json'), '{"from":"w","text":"stale"}');
  writeFileSync(control.logPath, '2026-09-17T00:00:00.000Z spawn T01\n');

  const r = startupControlHygiene(control);

  assert.equal(r.halted, false, 'no HALT, so the run proceeds');
  assert.deepEqual(
    readdirSync(join(control.dir, 'reports')).filter((n) => n.endsWith('.json')),
    [],
    'the stale report is cleared',
  );
  const log = readFileSync(control.logPath, 'utf8');
  assert.match(log, /spawn T01/, 'the prior log line is preserved');
  assert.match(log, /restart\n$/, 'a restart marker is appended to the log');
});

// --- waitForReport survives a runtime watch failure (T17) ---------------------------------------
// fs.watch reports a runtime failure (EMFILE under fd pressure, a watch that dies later) by emitting an
// 'error' event on the FSWatcher, not by throwing from watch(). Without an 'error' listener Node re-throws
// it as an unhandled event and the whole coordinator process exits — which is exactly what crashed the
// live merge-conflict run ~2.4s in (FINDINGS 2026-09-21). The fix absorbs the error and lets the POLL_MS
// timeout backstop take over, so the run keeps going on paced polling.
test('waitForReport absorbs an FSWatcher error event and resolves via the timeout, never crashing (T17)', async () => {
  const watcher = new EventEmitter();
  let closed = false;
  watcher.close = () => {
    closed = true;
  };
  const fakeWatch = () => watcher; // stands in for fs.watch under fd pressure

  let resolved = false;
  const p = waitForReport('/nowhere', 30, { watch: fakeWatch }).then(() => {
    resolved = true;
  });

  // The runtime watch failure. Without the T17 'error' listener this call throws synchronously (an
  // EventEmitter with no 'error' listener re-throws) — proving the listener is attached.
  assert.doesNotThrow(() => watcher.emit('error', new Error('EMFILE: too many open files, watch')));

  // The error must NOT finish the wait early (that would busy-spin the pass loop into re-watching every
  // pass). setImmediate fires before the 30ms timeout, so the wait is still pending here.
  await new Promise((r) => setImmediate(r));
  assert.equal(resolved, false, 'the watch error did not resolve the wait — it falls back to the timeout');

  await p; // resolves via the timeout backstop, not by crashing
  assert.equal(resolved, true);
  assert.equal(closed, true, 'the dead watcher is closed on the error');
});

test('waitForReport still falls back to the timeout when fs.watch cannot start at all (sync throw) (T17)', async () => {
  const fakeWatch = () => {
    throw new Error('ENOSYS: fs.watch not supported on this filesystem');
  };
  let resolved = false;
  const p = waitForReport('/nowhere', 20, { watch: fakeWatch }).then(() => {
    resolved = true;
  });
  assert.equal(resolved, false, 'the sync-catch fallback still waits for the timeout, it does not throw');
  await p;
  assert.equal(resolved, true);
});

// --- T10: the coordinator's detached self-reporting (DESIGN §2.4, §2.6, §3.4, §3.5) -----------------
//
// These drive the pure/injectable halves the bin wires: the PIR_RUN gate, the exit → final-status
// mapping, the per-pass snapshot write, the final-status write on exit, and the index-entry stamp. The
// bin glue itself (dynamic index-store load, process facts) is the untested integration seam, as in the
// rest of this module; every decision it makes is proven here against fakes.

const tmpControl = (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'pir-t10-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const sampleProc = { pid: 4242, startTime: 'Tue Sep 22 08:27:37 2026', slug: SLUG, repo: REPO, branch: `pir/${SLUG}`, startedAt: '2026-09-22T08:27:37.000Z' };
const sampleRunState = () =>
  buildRunState({ passTasks: [{ num: 'T01', name: '1-thing', deps: [], state: '⬜' }], branch: `pir/${SLUG}`, ceiling: 4 });

test('shouldSelfReport is the PIR_RUN gate — only a `pir`-launched run reports on itself (DESIGN §3.5)', () => {
  assert.equal(shouldSelfReport({}), false, 'no PIR_RUN → classic foreground path, no self-reporting');
  assert.equal(shouldSelfReport({ PIR_RUN: '1' }), true, 'PIR_RUN set by the launcher → the run self-reports');
});

test('finalStateForExit: clean ends → finished/stopped; every abnormal exit → no status (DESIGN §2.2, §7)', () => {
  assert.equal(finalStateForExit('complete'), 'finished', 'a completed hand-off (green or red) is a clean end');
  assert.equal(finalStateForExit('stall'), 'finished', 'nothing-left-to-do is a clean end');
  assert.equal(finalStateForExit('stop'), 'stopped', 'a user stop records stopped');
  for (const abnormal of ['halt', 'runaway', 'safety-cap', 'error', 'anything-else']) {
    assert.equal(finalStateForExit(abnormal), null, `${abnormal} records NO status → classified crashed`);
  }
});

test('writeRunSnapshot writes a live status.json parseSnapshot accepts, whose runState matches the pass (DESIGN §2.4)', (t) => {
  const controlDir = tmpControl(t);
  const runState = sampleRunState();
  writeRunSnapshot({ controlDir, proc: sampleProc, runState });

  const snap = readSnapshot(controlDir);
  assert.ok(snap, 'the snapshot round-trips through parseSnapshot (it is not malformed)');
  assert.equal(snap.finalState, null, 'a per-pass snapshot is live — no final status yet');
  assert.deepEqual(snap.runState, runState, 'the snapshot carries exactly the run state the display was given');
  assert.deepEqual(snap.proc, sampleProc, 'and the process facts the dashboard classifies from');
});

test('buildRunState carries testsReason into runState, and a snapshot written and read back keeps it (DESIGN §2.8)', (t) => {
  const testsReason = { reason: 'test `make test` exited 2', logPath: '/x/tests.log' };
  const passTasks = [{ num: 'T01', name: 'a', deps: [], state: '✅' }];
  const rs = buildRunState({ passTasks, branch: 'pir/demo', ceiling: 2, complete: true, readyToMerge: false, testsReason });
  assert.deepEqual(rs.testsReason, testsReason);
  assert.equal(buildRunState({ passTasks, branch: 'pir/demo', ceiling: 2 }).testsReason, null, 'absent means null');

  const controlDir = tmpControl(t);
  writeRunSnapshot({ controlDir, proc: sampleProc, runState: rs });
  assert.deepEqual(readSnapshot(controlDir).runState.testsReason, testsReason, 'status.json keeps the reason');
});

test('writeRunFinal on a clean end writes `finished` to BOTH the snapshot and the index entry (DESIGN §2.2, T10)', (t) => {
  for (const reason of ['complete', 'stall']) {
    const controlDir = tmpControl(t);
    const idxCalls = [];
    const runState = sampleRunState();
    const res = writeRunFinal({ controlDir, proc: sampleProc, runState, reason, updateIndex: (f) => idxCalls.push(f) });

    assert.equal(res.finalState, 'finished', `${reason} is a clean end → finished`);
    assert.equal(res.wrote, true);
    assert.equal(readSnapshot(controlDir).finalState, 'finished', `${reason}: the snapshot records finished`);
    assert.deepEqual(idxCalls, ['finished'], `${reason}: the index entry is stamped finished too`);
  }
});

test('writeRunFinal on a stop writes `stopped` to both (DESIGN §2.6, T10)', (t) => {
  const controlDir = tmpControl(t);
  const idxCalls = [];
  const res = writeRunFinal({ controlDir, proc: sampleProc, runState: sampleRunState(), reason: 'stop', updateIndex: (f) => idxCalls.push(f) });
  assert.equal(res.finalState, 'stopped');
  assert.equal(readSnapshot(controlDir).finalState, 'stopped', 'the snapshot records stopped');
  assert.deepEqual(idxCalls, ['stopped'], 'the index entry is stamped stopped');
});

test('writeRunFinal on an abnormal exit writes NOTHING — snapshot and index both stay null → crashed (DESIGN §2.2, §7, T10)', (t) => {
  for (const reason of ['halt', 'runaway', 'safety-cap', 'error']) {
    const controlDir = tmpControl(t);
    // A live snapshot from the last pass is already on disk (finalState null).
    writeRunSnapshot({ controlDir, proc: sampleProc, runState: sampleRunState() });
    const idxCalls = [];
    const res = writeRunFinal({ controlDir, proc: sampleProc, runState: sampleRunState(), reason, updateIndex: (f) => idxCalls.push(f) });

    assert.equal(res.wrote, false, `${reason}: no final status is written`);
    assert.equal(res.finalState, null);
    assert.equal(readSnapshot(controlDir).finalState, null, `${reason}: the last live snapshot is left untouched (still null)`);
    assert.deepEqual(idxCalls, [], `${reason}: the index entry is not stamped, so it classifies crashed`);
  }
});

test('teardownRun closes workers but leaves the worktrees, so the next start can resume them', (t) => {
  const { coordinator, platform, worktree } = setup(t, [{ num: 'T01' }, { num: 'T02' }], {
    behaviors: { T01: { question: 'blocked on you' } },
  });
  driveCollecting(coordinator); // T02 completes; T01 parks unanswered and stays live
  const parkedId = coordinator.state.tasks.T01.workerId;
  assert.ok(platform._workers.has(parkedId), 'the parked worker is live before the stop');

  const removesBefore = worktree.events.filter((e) => e.op === 'remove').length;
  const { closed } = teardownRun({ platform, state: coordinator.state, repo: REPO, slug: SLUG });

  assert.ok(closed.includes(parkedId), 'the stop still closes the live worker (no orphaned paid session)');
  assert.ok(!platform._workers.has(parkedId), 'the session is gone from the platform');
  const removesAfter = worktree.events.filter((e) => e.op === 'remove').length;
  assert.equal(removesAfter, removesBefore, 'but NO worktree was removed — the next start reconciles them (§2.6)');
});

test('teardownRun keeps the task branch on an error/Ctrl-C exit too, even when handed a worktree (ENOSPC, 2026-09-22)', (t) => {
  const { coordinator, platform, worktree } = setup(t, [{ num: 'T01' }, { num: 'T02' }], {
    behaviors: { T01: { question: 'blocked on you' } },
  });
  driveCollecting(coordinator);
  const parkedTaskBranch = `pir/${SLUG}-T01`;

  // `worktree` is passed on purpose: the old signature removed task worktrees whenever it had one.
  teardownRun({ platform, worktree, state: coordinator.state, repo: REPO, slug: SLUG });
  assert.ok(!worktree.events.some((e) => e.op === 'remove' && e.branch === parkedTaskBranch), 'no task worktree is removed');
  assert.ok(worktree.branchExists(parkedTaskBranch), 'the parked task branch survives for the next start');
});

test('updateIndexFinalState stamps the run`s index entry, composing runrecord + the store (DESIGN §2.8, T10)', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'pir-t10-idx-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, `${REPO}__${SLUG}.json`);
  // Seed the entry the launcher (T08) wrote: a live run, finalState null.
  const entry = { version: 1, slug: SLUG, repo: REPO, repoPath: '/x', controlDir: dir, pid: 4242, startTime: 'Tue Sep 22 08:27:37 2026', startedAt: '2026-09-22T08:27:37.000Z', branch: `pir/${SLUG}`, finalState: null };
  writeFileSync(path, serializeRecord(entry));

  const written = [];
  const fakeStore = { recordPath: (repo, slug) => join(dir, `${repo}__${slug}.json`), writeRecord: (rec) => written.push(rec) };

  const res = updateIndexFinalState({ repo: REPO, slug: SLUG, finalState: 'finished', indexStore: fakeStore, now: () => '2026-09-22T09:00:00.000Z' });
  assert.equal(res.updated, true);
  assert.equal(written.length, 1, 'the entry was written back exactly once');
  assert.equal(written[0].finalState, 'finished', 'with its final status set');
  assert.equal(written[0].updatedAt, '2026-09-22T09:00:00.000Z', 'and an updatedAt stamp');
  assert.equal(written[0].pid, 4242, 'the pointer fields (pid, startTime, repo…) are preserved');
  assert.equal(written[0].startTime, 'Tue Sep 22 08:27:37 2026');
});

test('updateIndexFinalState is a safe no-op when the store is absent or the entry is missing (DESIGN §2.10, T10)', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'pir-t10-idx2-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // No store at all (T06 not loaded on this branch) → nothing done, no throw.
  assert.deepEqual(updateIndexFinalState({ repo: REPO, slug: SLUG, finalState: 'finished', indexStore: null }), {
    updated: false,
    reason: 'no-index-store',
  });

  // Store present but the launcher's entry is not on disk → no-op, not a throw during exit.
  const written = [];
  const fakeStore = { recordPath: (repo, slug) => join(dir, `${repo}__${slug}.json`), writeRecord: (rec) => written.push(rec) };
  assert.deepEqual(updateIndexFinalState({ repo: REPO, slug: SLUG, finalState: 'finished', indexStore: fakeStore }), {
    updated: false,
    reason: 'no-entry',
  });
  assert.equal(written.length, 0, 'a missing entry is never conjured into existence');
});

// --- T07: worker setup (DESIGN §2.4) -----------------------------------------------------------------

// A setup handle that finishes ok on its Nth poll (never, with after = null), recording kills.
function slowPrepare(after = null) {
  const handles = {};
  const prepare = (num) => {
    let polls = 0;
    let done = null;
    const h = {
      killed: false,
      poll: () => {
        polls += 1;
        if (done === null && after !== null && polls >= after) done = { ok: true, logPath: null };
        return done;
      },
      kill: () => {
        h.killed = true;
        done ??= { ok: false, reason: 'killed' };
      },
    };
    handles[num] = h;
    return h;
  };
  return { prepare, handles };
}

test('displayPhaseFor: a task whose setup is running reads `preparing` (T07)', () => {
  assert.equal(displayPhaseFor({ role: 'implement', phase: 'preparing' }), 'preparing');
});

test('drive() does not end a run as parked or stalled while its only task is preparing (T07)', (t) => {
  const { prepare } = slowPrepare(6); // longer than drive()'s 2 quiet passes
  const { coordinator } = setup(t, [{ num: 'T01' }], { prepare });
  const { result, passes } = driveCollecting(coordinator);
  assert.equal(result.reason, 'complete');
  assert.ok(passes[0].preparing === 1 && passes[0].live === 1, 'a preparing pass reports the task as live work');
});

test('a preparing task shows as a `preparing` row in the run state (T07)', (t) => {
  const { prepare } = slowPrepare();
  const { coordinator } = setup(t, [{ num: 'T01' }], { prepare });
  const r = coordinator.pass();
  const rs = buildRunState({ passTasks: r.tasks, stateTasks: coordinator.state.tasks, branch: 'pir/demo', ceiling: 4 });
  assert.equal(rs.tasks[0].phase, 'preparing');
});

test('teardownRun (every non-HALT exit, the stop included) kills every running setup (T07)', (t) => {
  const { prepare, handles } = slowPrepare();
  const { coordinator, platform } = setup(t, [{ num: 'T01' }, { num: 'T02' }], { prepare });
  coordinator.pass();
  const logged = [];
  teardownRun({ platform, state: coordinator.state, repo: REPO, slug: SLUG, control: { log: (l) => logged.push(l) } });
  assert.ok(handles.T01.killed && handles.T02.killed);
  assert.ok(logged.includes('teardown: killed setup for T01'));
  assert.equal(platform.closed.length, 0, 'no session to close for a task still preparing');
});

test('makePrepare: no setup lines (setup: none, or no valid block) means no prepare step (T07)', () => {
  assert.equal(makePrepare({ design: '---\nsetup: none\ntest:\n  - npm test\n---\n', setupDir: '/x' }), null);
  assert.equal(makePrepare({ design: '# no block\n', setupDir: '/x' }), null);
});

test('makePrepare starts the setup lines in the worktree, logging to control/setup/T{nn}.log (T07)', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'pir-prepare-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const calls = [];
  const prepare = makePrepare({
    design: '---\nsetup:\n  - cd server && npm ci\ntest:\n  - npm test\n---\n',
    setupDir: join(dir, 'setup'),
    start: (lines, opts) => (calls.push({ lines, opts }), 'handle'),
  });
  assert.equal(prepare('T03', '/wt/T03'), 'handle');
  assert.deepEqual(calls, [{ lines: ['cd server && npm ci'], opts: { cwd: '/wt/T03', logPath: join(dir, 'setup', 'T03.log') } }]);
  assert.ok(existsSync(join(dir, 'setup')), 'the setup log folder is created');
});

test('makePrepare with the real runner runs the lines in the worktree and the handle reports it (T07)', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'pir-prepare-real-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'wt'));
  const prepare = makePrepare({ design: '---\nsetup:\n  - echo ready > marker\ntest:\n  - true\n---\n', setupDir: join(dir, 'setup') });
  const h = prepare('T01', join(dir, 'wt'));
  for (let i = 0; i < 200 && h.poll() === null; i++) await new Promise((res) => setTimeout(res, 10));
  assert.deepEqual(h.poll(), { ok: true, logPath: join(dir, 'setup', 'T01.log') });
  assert.equal(readFileSync(join(dir, 'wt', 'marker'), 'utf8'), 'ready\n');
  assert.match(readFileSync(join(dir, 'setup', 'T01.log'), 'utf8'), /\$ echo ready > marker/);
});

test('testingRunState marks the run as the end gate running, so a viewer does not read it as finished (user 2026-09-25)', () => {
  const passTasks = [{ num: 'T01', name: 'one', deps: [], state: '✅' }];
  const rs = testingRunState(buildRunState({ passTasks, branch: 'pir/demo', ceiling: 4, doneMsByTask: { T01: 5000 } }), { since: 42 });
  assert.deepEqual(rs.testing, { since: 42 });
  assert.equal(rs.complete, false);
  assert.equal(rs.readyToMerge, false);
  assert.equal(rs.tasks[0].done, true);
  assert.equal(rs.tasks[0].doneMs, 5000);
});

// --- live-workers T05: the coordinator over the REAL platform, workers played by the fake `claude` ---
//
// The platform is the real one (platform.mjs → worker-proc → the Agent SDK); only the process behind each
// worker is the fake `claude`. A fake worker cannot commit or drop a report, so the test plays that part:
// when a worker's turn ends (its `result` is logged) the test commits that phase's work on the worker's
// task branch and queues its report for the inbox, as a real worker's skills would.

function livePlatform(t, { script = [{ await: 'user' }, ...turn('ok')] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pir-live-coord-'));
  const controlDir = join(dir, 'control');
  const reports = [];
  const received = [];
  let n = 0;
  const start = (o) => {
    n += 1;
    const scriptPath = join(dir, `script-${n}.json`);
    writeFileSync(scriptPath, JSON.stringify(script));
    const rec = join(dir, `received-${n}.ndjson`);
    received.push(rec);
    const worker = startWorker({ ...o, spawnProcess: fakeClaudeSpawner({ script: scriptPath, received: rec }) });
    const [, , task, , role] = o.name.split(' / ');
    let done = false;
    worker.onEvent((e) => {
      if (done || e.dir !== 'in' || e.event.type !== 'result') return;
      done = true;
      const glyph = role === 'implement' ? '🔍' : '✅';
      if (role === 'implement') writeFileSync(join(o.cwd, `work-${task}.txt`), `work ${task}\n`);
      const progress = join(o.cwd, progressPathFor(SLUG));
      writeFileSync(progress, reconcileTaskRow(readFileSync(progress, 'utf8'), { num: task, state: glyph, notes: role }));
      git(o.cwd, ['add', '-A']);
      git(o.cwd, ['commit', '-m', `${task}: ${role}`, '--no-edit']);
      reports.push({ from: o.name, text: encodeMessage({ kind: role === 'implement' ? 'implemented' : 'done', task }) });
    });
    return worker;
  };
  const platform = createPlatform({
    controlDir,
    transport: { drain: () => reports.splice(0) },
    startWorker: start,
    claudePath: '/nonexistent/claude',
  });
  t.after(async () => {
    for (const w of platform.list()) platform.close(w.id, { immediate: true });
    await until(() => platform.list().length === 0, 'every child to exit');
    rmSync(dir, { recursive: true, force: true });
  });
  const workersFile = () => JSON.parse(readFileSync(join(controlDir, 'workers.json'), 'utf8'));
  const receivedLines = (i) =>
    existsSync(received[i]) ? readFileSync(received[i], 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  return { platform, controlDir, workersFile, receivedLines };
}

async function until(pred, what, ms = 10000) {
  const start = Date.now();
  for (;;) {
    const v = pred();
    if (v) return v;
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 15));
  }
}

test('the coordinator drives two workers from spawn to done through the real platform (live-workers T05)', async (t) => {
  const { platform, controlDir } = livePlatform(t);
  const worktree = createFakeWorktree({ progress: progressDoc([{ num: 'T01' }, { num: 'T02' }]), slug: SLUG });
  t.after(() => worktree.cleanup());
  const coordinator = startCoordinator({ slug: SLUG, repo: REPO, platform, worktree, maxWorkers: 2 });

  // pass() is synchronous and the children answer in their own time, so the test paces the passes.
  let result;
  const completed = [];
  await until(() => {
    result = coordinator.pass();
    completed.push(...result.completed);
    return result.complete;
  }, 'the plan to complete');

  assert.equal(result.testsPassed, true);
  assert.deepEqual(result.readyToMerge, { branch: `pir/${SLUG}` });
  assert.deepEqual([...completed].sort(), ['T01', 'T02']);
  assert.ok(worktree.fileOn(`pir/${SLUG}`, 'work-T01.txt').ok && worktree.fileOn(`pir/${SLUG}`, 'work-T02.txt').ok, 'both tasks merged');
  assert.equal(worktree.mainCommitCount(), 1, 'main untouched');

  const logs = readdirSync(join(controlDir, 'conversations')).sort();
  assert.deepEqual(logs, ['T01-implement-1.ndjson', 'T01-review-1.ndjson', 'T02-implement-1.ndjson', 'T02-review-1.ndjson']);
  await until(() => platform.list().length === 0, 'every merged worker to exit after its close');
});

test('teardownRun SIGTERMs every live child at once and workers.json empties as they exit (live-workers T05)', async (t) => {
  // Workers that ignore stdin EOF: only the SIGTERM can end them, so their exit proves teardown sent it.
  const { platform, workersFile, receivedLines } = livePlatform(t, { script: [{ onEof: 'ignore' }, { await: 'user' }] });
  const worktree = createFakeWorktree({ progress: progressDoc([{ num: 'T01' }, { num: 'T02' }]), slug: SLUG });
  t.after(() => worktree.cleanup());
  const coordinator = startCoordinator({ slug: SLUG, repo: REPO, platform, worktree, maxWorkers: 2 });

  coordinator.pass(); // spawns both implementers
  assert.equal(platform.list().length, 2);
  assert.equal(workersFile().length, 2, 'workers.json lists both live children');
  // Let both fakes install their SIGTERM recorder (they log each stdin line after it is set up).
  await until(() => [0, 1].every((i) => receivedLines(i).some((l) => l.line)), 'both fakes to take their opening message');

  const { closed } = teardownRun({ platform, state: coordinator.state, repo: REPO, slug: SLUG });
  assert.equal(closed.length, 2, 'both children closed');
  await until(() => platform.list().length === 0, 'both children to exit');
  assert.ok([0, 1].every((i) => receivedLines(i).some((l) => l.signal === 'SIGTERM')), 'each child got its SIGTERM');
  assert.deepEqual(workersFile(), [], 'workers.json lists exactly the live children: none');
});
