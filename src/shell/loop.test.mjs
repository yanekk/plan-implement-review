import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { runPass, drain, createRunState } from './loop.mjs';
import { createFakePlatform } from './fake/platform.mjs';
import { createFakeWorktree } from './fake/worktree.mjs';
import { workerName, coordinatorName } from '../core/naming.mjs';

// The dry-run seatbelt is on in the tests (DESIGN §5.2): the loop is handed fakes and a scratch
// repo, so nothing here reaches a real agent or the real project.
process.env.PARALLEL_DRY_RUN = '1';

const REPO = 'demo-repo';
const SLUG = 'demo';

// Build a valid PROGRESS.md the parser reads: a reviewed gate and a task table with the Runs column.
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

// Stand up a fake platform + scratch worktree for a plan; register cleanup.
function setup(t, rows, { behaviors = {}, files = {} } = {}) {
  const worktree = createFakeWorktree({ progress: progressDoc(rows), files, slug: SLUG });
  const platform = createFakePlatform({ behaviors });
  t.after(() => worktree.cleanup());
  const base = { platform, worktree, repo: REPO, slug: SLUG, maxWorkers: 4 };
  return { platform, worktree, base };
}

const chain = (n) =>
  Array.from({ length: n }, (_, i) => ({ num: `T0${i + 1}`, deps: i === 0 ? [] : [`T0${i}`] }));

test('a dependency chain drains to all ✅ on the feature branch and promotes to main exactly once', (t) => {
  const { worktree, base } = setup(t, chain(5));
  assert.equal(worktree.mainCommitCount(), 1, 'main starts at the initial commit only');

  const result = drain(base);

  assert.equal(result.reason, 'promoted');
  assert.equal(result.promoted, true);

  // main moved exactly once, at promotion; every earlier merge went into the feature branch.
  const promotes = worktree.events.filter((e) => e.op === 'promote');
  assert.equal(promotes.length, 1, 'promoted to main exactly once');
  const merges = worktree.events.filter((e) => e.op === 'mergeTask');
  assert.equal(merges.length, 5, 'five task branches merged');
  assert.ok(
    merges.every((e) => e.into === `pir/${SLUG}`),
    'task branches merge into the feature branch, never main',
  );

  const finalMain = worktree.progressOn('main');
  assert.ok(!finalMain.includes('⬜'), 'main has no ⬜ task after promotion');
  assert.equal((finalMain.match(/✅/g) || []).length, 5, 'all five tasks are ✅ on main');
});

test('task branches are cut from the feature branch, not from main', (t) => {
  const { worktree, base } = setup(t, chain(3));
  drain(base);
  const cuts = worktree.events.filter((e) => e.op === 'createTask');
  assert.equal(cuts.length, 3);
  assert.ok(cuts.every((e) => e.from === `pir/${SLUG}`));
});

test('two independent ready tasks are spawned in the same pass (worked concurrently)', (t) => {
  const { base } = setup(t, [{ num: 'T01' }, { num: 'T02' }]);
  const state = createRunState();
  const r = runPass({ ...base, state });
  const spawns = r.actions.filter((a) => a.type === 'spawn');
  assert.equal(spawns.length, 2, 'both independent tasks spawn at once');
  assert.equal(r.liveAfter, 2, 'two workers are live after the first pass');
});

test('fake workers are named {repo} · {plan} · T{nn}; the task is recoverable from the name', (t) => {
  const { platform, base } = setup(t, [{ num: 'T01' }]);
  runPass({ ...base, state: createRunState() });
  const spawn = platform.spawns[0];
  assert.equal(spawn.name, workerName({ repo: REPO, plan: SLUG, task: 'T01' }));
  assert.equal(spawn.name, `${REPO} · ${SLUG} · T01`);
  assert.equal(spawn.task, 'T01', 'the loop rebuilds the task from the worker name');
});

test('each implemented auto task gets a fresh reviewer: a distinct id, the same name, after implement', (t) => {
  const { platform, base } = setup(t, [{ num: 'T01' }]);
  drain(base);
  const impl = platform.spawns.find((s) => s.role === 'implement' && s.task === 'T01');
  const review = platform.spawns.find((s) => s.role === 'review' && s.task === 'T01');
  assert.ok(impl && review, 'both an implement and a review session were spawned');
  assert.notEqual(impl.id, review.id, 'the reviewer is a distinct session');
  assert.equal(impl.name, review.name, 'same worker name, different session (DESIGN §2.8)');
  assert.ok(platform.spawns.indexOf(impl) < platform.spawns.indexOf(review), 'review comes after implement');
});

test('the implement session is closed as its reviewer spawns, so one task in review holds one slot', (t) => {
  const { platform, base } = setup(t, [{ num: 'T01' }]);
  const state = createRunState();
  runPass({ ...base, state }); // pass 1: spawn implementer
  const implId = platform.spawns[0].id;
  const r2 = runPass({ ...base, state }); // pass 2: implemented → spawn reviewer, close implementer
  assert.ok(r2.actions.some((a) => a.type === 'review' && a.closes === implId));
  assert.ok(platform.closed.includes(implId), 'the implementer session is closed');
  assert.equal(r2.liveAfter, 1, 'implementer closed + reviewer spawned = one live session');
});

test('a you task is spawned as a hands-on worker, consumes a slot, and is never reviewed', (t) => {
  const { platform, base } = setup(t, [{ num: 'T01', runs: 'you' }]);
  const state = createRunState();
  const r1 = runPass({ ...base, state });
  assert.ok(r1.actions.some((a) => a.type === 'spawn' && a.role === 'verify'), 'spawned a verify worker');
  assert.equal(r1.liveAfter, 1, 'it holds a worker slot');
  drain({ ...base, state });
  assert.ok(!platform.spawns.some((s) => s.role === 'review'), 'a you task is never put through review');
});

test('a hands-on you worker reported done is merged and reconciled to ✅, unblocking its dependents', (t) => {
  // T01 is a you task on the critical path; T02 (auto) waits on it.
  const { worktree, base } = setup(t, [{ num: 'T01', runs: 'you' }, { num: 'T02', deps: ['T01'] }]);
  const result = drain(base);
  assert.equal(result.promoted, true);

  const spawnActions = result.actions.filter((a) => a.type === 'spawn');
  const mergeT01 = result.actions.findIndex((a) => a.type === 'merge' && a.task === 'T01');
  const spawnT02 = result.actions.findIndex((a) => a.type === 'spawn' && a.task === 'T02');
  assert.ok(mergeT01 >= 0 && spawnT02 >= 0);
  assert.ok(mergeT01 < spawnT02, 'T02 is not spawned until the you task T01 has merged (deps gated)');

  const finalMain = worktree.progressOn('main');
  assert.equal((finalMain.match(/✅/g) || []).length, 2);
});

test('the ceiling is respected: five ready tasks with maxWorkers 2 spawn at most two in a pass', (t) => {
  const { base } = setup(t, [1, 2, 3, 4, 5].map((n) => ({ num: `T0${n}` })));
  const r = runPass({ ...base, maxWorkers: 2, state: createRunState() });
  assert.equal(r.actions.filter((a) => a.type === 'spawn').length, 2);
});

test('merges are serialized: two done workers merge one branch per pass, not two', (t) => {
  const { base } = setup(t, [{ num: 'T01' }, { num: 'T02' }]);
  const state = createRunState();
  runPass({ ...base, state }); // spawn T01, T02
  runPass({ ...base, state }); // both implemented → reviewers spawned, implementers closed
  const r3 = runPass({ ...base, state }); // both reviewers done → at most one merge
  assert.equal(r3.actions.filter((a) => a.type === 'merge').length, 1, 'one merge this pass');
});

test('a worker question surfaces via the inbox and a sent answer resumes that worker', (t) => {
  const { platform, base } = setup(t, [{ num: 'T01' }], { behaviors: { T01: { question: 'which format?' } } });
  const state = createRunState();
  runPass({ ...base, state }); // spawn
  const r2 = runPass({ ...base, state }); // worker asks
  const surfaced = r2.actions.find((a) => a.type === 'surface' && a.kind === 'question');
  assert.ok(surfaced, 'the question is surfaced');
  assert.equal(surfaced.text, 'which format?');

  // The user answers; the worker resumes and the plan finishes.
  platform.send(workerName({ repo: REPO, plan: SLUG, task: 'T01' }), 'use json');
  const result = drain({ ...base, state });
  assert.equal(result.promoted, true, 'the answered worker resumes and the plan promotes');
});

test('a merge conflict a worker cannot resolve surfaces as a decision, and nothing merges to main', (t) => {
  const { worktree, base } = setup(t, [{ num: 'T01' }], { behaviors: { T01: { conflict: 'cannot merge cleanly' } } });
  const result = drain(base);
  assert.equal(result.reason, 'parked', 'the run parks on the unresolved conflict');
  assert.ok(result.actions.some((a) => a.type === 'surface' && a.kind === 'conflict'));
  assert.ok(!result.actions.some((a) => a.type === 'merge'), 'no merge happened');
  assert.ok(!result.actions.some((a) => a.type === 'promote'), 'no promotion happened');
  assert.equal(worktree.mainCommitCount(), 1, 'main is untouched');
});

test('the kill switch mid-drain stops dispatch and closes every fake worker; main untouched', (t) => {
  const { platform, worktree, base } = setup(t, [{ num: 'T01' }, { num: 'T02' }]);
  let halted = false;
  const control = { isHalted: () => halted, log: () => {} };
  const state = createRunState();

  runPass({ ...base, control, state }); // spawn T01, T02
  const liveIds = platform._workers ? [...platform._workers.keys()] : [];
  assert.equal(liveIds.length, 2);

  halted = true;
  const r = runPass({ ...base, control, state }); // halt: close everything
  assert.equal(r.halted, true);
  assert.equal(r.liveAfter, 0, 'every worker is closed');
  for (const id of liveIds) assert.ok(platform.closed.includes(id), `worker ${id} closed`);
  assert.ok(!r.actions.some((a) => ['merge', 'promote', 'spawn'].includes(a.type)), 'no dispatch under halt');
  assert.equal(worktree.mainCommitCount(), 1, 'main untouched by the kill switch');
});

test('a red feature branch is not promoted; the failure is surfaced instead', (t) => {
  const { worktree, base } = setup(t, [{ num: 'T01' }]);
  const runTests = () => ({ ok: false });
  const result = drain({ ...base, runTests });
  assert.notEqual(result.reason, 'promoted');
  assert.ok(result.actions.some((a) => a.type === 'surface' && a.kind === 'red-feature'));
  assert.equal(worktree.mainCommitCount(), 1, 'a red feature branch never reaches main');
});

test('a crashed worker is closed as dead and its worktree reclaimed, freeing its slot', (t) => {
  const { platform, worktree, base } = setup(t, [{ num: 'T01' }], { behaviors: { T01: { crash: true } } });
  const state = createRunState();
  runPass({ ...base, state }); // spawn T01
  const implId = platform.spawns[0].id;
  // The worker crashes before it ever appears in the live list. buildAssignments matches workers by
  // name and gives a just-spawned worker a one-pass grace to appear (so a slow worker is not respawned
  // into a duplicate — FINDINGS 2026-09-09), so a never-appearing crash is recognised a pass or two
  // later, not instantly. Drive passes until the dead-close lands.
  let dead;
  for (let i = 0; i < 5 && !dead; i++) {
    const r = runPass({ ...base, state });
    dead = r.actions.find((a) => a.type === 'close' && a.reason === 'dead');
  }
  assert.ok(dead, 'the crashed worker is eventually closed as dead');
  assert.ok(platform.closed.includes(implId));
  assert.ok(worktree.events.some((e) => e.op === 'remove'), 'its worktree is removed');
});

test('a worker whose spawn id differs from its listed id is tracked by name, not respawned, and closed by the listed id (FINDINGS 2026-09-09)', (t) => {
  // The live runaway: `claude --bg` returns an id that does not match the `id` in `claude agents
  // --json`. A platform that reproduces exactly that — spawn returns BOGUS, list reports REAL under
  // the same name — must not make the loop respawn (it should recognise the worker by name), and a
  // close must use the listed id, the only one that can actually stop the session.
  const worktree = createFakeWorktree({ progress: progressDoc([{ num: 'T01' }]), slug: SLUG });
  t.after(() => worktree.cleanup());
  const NAME = workerName({ repo: REPO, plan: SLUG, task: 'T01' });
  const spawns = [];
  const closed = [];
  let listed = [];
  const platform = {
    spawn({ name }) {
      spawns.push(name);
      listed = [{ id: 'REAL-1', name, cwd: '/x', status: 'busy', state: 'working', live: true }];
      return 'BOGUS-1'; // the mismatch: the returned id is not the one list()/close use
    },
    list: () => listed,
    close: (id) => (closed.push(id), (listed = listed.filter((w) => w.id !== id)), { ok: true }),
    inbox: () => [],
  };
  const base = { platform, worktree, repo: REPO, slug: SLUG, maxWorkers: 1 };
  const state = createRunState();

  runPass({ ...base, state }); // pass 1: spawn (returns BOGUS-1; list now reports REAL-1)
  assert.equal(spawns.length, 1, 'spawned once');
  const r2 = runPass({ ...base, state }); // pass 2: recognised live BY NAME, not respawned
  assert.equal(spawns.length, 1, 'not respawned despite the id mismatch — the name matched');
  assert.equal(r2.liveAfter, 1, 'still exactly one worker, not a runaway');

  const halted = { isHalted: () => true, log() {} };
  runPass({ ...base, state, control: halted }); // halt closes it
  assert.ok(closed.includes('REAL-1'), 'closed by the listed id, the only one close can act on');
  assert.ok(!closed.includes('BOGUS-1'), 'the bogus spawn id was never used to close');
});

test('the coordinator does not count its OWN session (or a foreign agent) toward the ceiling (T12 P5)', (t) => {
  // The drill logged `ceiling full: 2/1 busy` with a single real worker, because the coordinator's own
  // `claude` session shares the repo git-dir and appeared in the list. Here the list carries the
  // coordinator ({repo} · {slug}, no task) and a foreign agent alongside one real worker; liveAfter
  // must be 1, and neither non-worker may be adopted or closed.
  const worktree = createFakeWorktree({ progress: progressDoc([{ num: 'T01' }, { num: 'T02' }]), slug: SLUG });
  t.after(() => worktree.cleanup());
  const fake = createFakePlatform({});
  const nonWorkers = [
    { id: 'COORD', name: `${REPO} · ${SLUG}`, cwd: '/c', status: 'busy', state: 'working', live: true },
    { id: 'FOREIGN', name: 'other-repo · other-plan · T09', cwd: '/f', status: 'busy', state: 'working', live: true },
  ];
  const platform = { ...fake, list: () => [...fake.list(), ...nonWorkers] };
  const base = { platform, worktree, repo: REPO, slug: SLUG, maxWorkers: 1 };
  const state = createRunState();

  const r = runPass({ ...base, state }); // ceiling 1: exactly one worker should spawn, coordinator uncounted
  assert.equal(r.liveAfter, 1, 'one real worker live; the coordinator and the foreign agent are not counted');
  assert.equal(r.actions.filter((a) => a.type === 'spawn').length, 1, 'the free slot was used (not eaten by the self-count)');
  assert.ok(!fake.closed.includes('COORD') && !fake.closed.includes('FOREIGN'), 'neither non-worker was closed');
});

// --- T13 Problem A: a hello opens each freshly-spawned worker's channel ----------------------------

test('every freshly spawned worker (implement and review) is sent a hello carrying the coordinator name (T13)', (t) => {
  const { platform, base } = setup(t, [{ num: 'T01' }]);
  const state = createRunState();
  const NAME = workerName({ repo: REPO, plan: SLUG, task: 'T01' });
  const COORD = coordinatorName({ repo: REPO, plan: SLUG });

  runPass({ ...base, state }); // pass 1: spawn implementer → hello
  let hellos = platform.sent.filter((s) => s.msg.kind === 'hello');
  assert.equal(hellos.length, 1, 'the implement spawn was sent one hello');
  assert.equal(hellos[0].to, NAME, 'the hello is addressed by the worker name');
  assert.equal(hellos[0].msg.text, COORD, 'the hello carries the coordinator’s own addressable name');

  runPass({ ...base, state }); // pass 2: implemented → fresh reviewer spawns → hello
  hellos = platform.sent.filter((s) => s.msg.kind === 'hello');
  assert.equal(hellos.length, 2, 'the fresh reviewer was sent a hello too');
  assert.ok(hellos.every((h) => h.to === NAME), 'both hellos address the same worker name (DESIGN §2.8)');
});

test('the loop still runs against a platform with no send half (no hello, no crash) (T13)', (t) => {
  // The id-mismatch platform below has no `send` method. The hello must be optional, or the loop would
  // throw on the first spawn. It simply spawns, is recognised by name, and drains — no hello sent.
  const worktree = createFakeWorktree({ progress: progressDoc([{ num: 'T01' }]), slug: SLUG });
  t.after(() => worktree.cleanup());
  const NAME = workerName({ repo: REPO, plan: SLUG, task: 'T01' });
  let listed = [];
  const platform = {
    spawn({ name }) {
      listed = [{ id: 'R1', name, cwd: '/x', status: 'busy', state: 'working', live: true }];
      return 'R1';
    },
    list: () => listed,
    close: () => ({ ok: true }),
    inbox: () => [],
  };
  const state = createRunState();
  assert.doesNotThrow(() => runPass({ platform, worktree, repo: REPO, slug: SLUG, maxWorkers: 1, state }));
  assert.ok(NAME); // referenced
});

// --- T13 Problem B: a finished worker is not closed until it is idle -------------------------------

test('a review handoff waits until the implementer is idle before closing it (T13)', (t) => {
  // T01 lingers busy for one tick after it reports implemented. The loop must NOT spawn the reviewer or
  // close the implementer while it is busy; it does both once the next pass shows it idle.
  const { platform, base } = setup(t, [{ num: 'T01' }], { behaviors: { T01: { lingerBusy: 1 } } });
  const state = createRunState();
  runPass({ ...base, state }); // pass 1: spawn implementer
  const implId = platform.spawns[0].id;

  const busy = runPass({ ...base, state }); // pass 2: implemented but still busy → held
  assert.ok(!busy.actions.some((a) => a.type === 'review'), 'no reviewer spawns while the implementer is busy');
  assert.ok(!platform.closed.includes(implId), 'the busy implementer is not closed (no mid-turn SIGTERM)');
  assert.ok(busy.actions.some((a) => a.type === 'await-idle' && a.task === 'T01'), 'the pass records it is waiting for idle');
  assert.equal(busy.liveAfter, 1, 'it keeps its slot while held');

  const idle = runPass({ ...base, state }); // pass 3: now idle → hand off
  assert.ok(idle.actions.some((a) => a.type === 'review' && a.closes === implId), 'the reviewer spawns once the implementer is idle');
  assert.ok(platform.closed.includes(implId), 'the idle implementer is now closed');
});

test('a merge (and close) waits until the done worker is idle before firing (T13)', (t) => {
  // A `you` task goes straight to done with no review phase, isolating the merge gate. It lingers busy
  // one tick after done; the loop must not merge its branch or close it until it is idle.
  const { platform, worktree, base } = setup(t, [{ num: 'T01', runs: 'you' }], { behaviors: { T01: { lingerBusy: 1 } } });
  const state = createRunState();
  runPass({ ...base, state }); // pass 1: spawn the hands-on worker
  const workerId = platform.spawns[0].id;

  const busy = runPass({ ...base, state }); // pass 2: done but still busy → held
  assert.ok(!busy.actions.some((a) => a.type === 'merge'), 'no merge while the done worker is busy');
  assert.ok(!platform.closed.includes(workerId), 'the busy worker is not closed mid-turn');
  assert.ok(busy.actions.some((a) => a.type === 'await-idle' && a.task === 'T01'));
  assert.ok(!worktree.events.some((e) => e.op === 'mergeTask'), 'its branch is not merged while it is busy');

  const idle = runPass({ ...base, state }); // pass 3: idle → merge and close
  assert.ok(idle.actions.some((a) => a.type === 'merge' && a.task === 'T01'), 'the merge fires once it is idle');
  assert.ok(platform.closed.includes(workerId), 'the idle worker is closed and its branch merged');
});

test('the kill switch closes a busy, finished worker immediately — the idle gate does not apply under halt (T13)', (t) => {
  // The idle gate protects a normal close from interrupting a mid-turn worker. The kill switch is a hard
  // stop (DESIGN §2.4) and must override it: a busy review-ready worker is closed at once under HALT.
  const { platform, base } = setup(t, [{ num: 'T01' }], { behaviors: { T01: { lingerBusy: 9 } } });
  let halted = false;
  const control = { isHalted: () => halted, log: () => {} };
  const state = createRunState();
  runPass({ ...base, control, state }); // spawn
  const workerId = platform.spawns[0].id;
  runPass({ ...base, control, state }); // implemented, but lingers busy → normal close would be held

  halted = true;
  const r = runPass({ ...base, control, state }); // HALT closes it regardless of busy
  assert.equal(r.halted, true);
  assert.ok(platform.closed.includes(workerId), 'the kill switch closed the busy worker without waiting for idle');
  assert.equal(r.liveAfter, 0, 'no worker is left live after the halt');
});

test('dry run stays isolated: the scratch repo is a temp dir, never the real project', (t) => {
  const { worktree, base } = setup(t, chain(2));
  assert.ok(worktree.dir.startsWith(tmpdir()), 'the scratch repo lives under the temp dir');
  assert.notEqual(worktree.dir, process.cwd());
  const result = drain(base);
  assert.equal(result.promoted, true, 'a full run completes against fakes alone');
});
