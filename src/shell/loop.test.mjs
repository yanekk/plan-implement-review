import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runPass, drain, createRunState } from './loop.mjs';
import { createFakePlatform } from './fake/platform.mjs';
import { createFakeWorktree, git } from './fake/worktree.mjs';
import { workerName } from '../core/naming.mjs';
import { reconcileTaskRow, progressPathFor } from '../core/progress.mjs';

// The dry-run seatbelt is on in the tests (DESIGN §5.2): the loop is handed fakes and a scratch
// repo, so nothing here reaches a real agent or the real project.
process.env.PARALLEL_DRY_RUN = '1';

const REPO = 'demo-repo';
const SLUG = 'demo';

// A task's slug is its Task-column value (DESIGN §2.9); the worker name carries it. The fixture gives
// each task a distinct slug so a test can prove the slug rides the name and does not affect matching.
const slugOf = (num) => `${num}-thing`;
const wname = (task, role, slug = slugOf(task)) => workerName({ repo: REPO, plan: SLUG, task, slug, role });

// Build a valid PROGRESS.md the parser reads: a reviewed gate and a task table with the Runs column.
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

// One PROGRESS.md table row in the same layout progressDoc writes (# | Task | Runs | Depends on |
// State | Notes), so a test can hand the fake worker (addRows behaviour) or a seeded branch a
// worker-introduced task row exactly as it would appear on a real branch — valid, or malformed for
// the reject path. The coordinator's adoptNewTaskRows is what reads it back.
function taskRow({ num, deps = [], runs = 'auto', state = '⬜' }) {
  const d = deps.length ? deps.join(', ') : '—';
  return `| ${num} | ${slugOf(num)} | ${runs} | ${d} | ${state} | |`;
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

test('a dependency chain drains to all ✅ on the feature branch and hands it off, never touching main (DESIGN §2.4)', (t) => {
  const { worktree, base } = setup(t, chain(5));
  assert.equal(worktree.mainCommitCount(), 1, 'main starts at the initial commit only');

  const result = drain(base);

  assert.equal(result.reason, 'complete');
  assert.equal(result.complete, true);
  assert.equal(result.testsPassed, true, 'the feature-branch tests passed');
  assert.deepEqual(result.readyToMerge, { branch: `pir/${SLUG}` }, 'it hands off the green feature branch');

  // The run never merges to main; every merge went into the feature branch.
  assert.equal(worktree.events.filter((e) => e.op === 'promote').length, 0, 'nothing was ever promoted to main');
  const merges = worktree.events.filter((e) => e.op === 'mergeTask');
  assert.equal(merges.length, 5, 'five task branches merged');
  assert.ok(
    merges.every((e) => e.into === `pir/${SLUG}`),
    'task branches merge into the feature branch, never main',
  );
  assert.equal(worktree.mainCommitCount(), 1, 'main is untouched — the person merges pir/demo by hand');

  const finalFeature = worktree.progressOn(`pir/${SLUG}`);
  assert.ok(!finalFeature.includes('⬜'), 'the feature branch has no ⬜ task at hand-off');
  assert.equal((finalFeature.match(/✅/g) || []).length, 5, 'all five tasks are ✅ on the feature branch');
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

test('fake workers are named {repo} / {plan} / {task} / {slug} / {role}; the task is recoverable from the name', (t) => {
  const { platform, base } = setup(t, [{ num: 'T01' }]);
  runPass({ ...base, state: createRunState() });
  const spawn = platform.spawns[0];
  assert.equal(spawn.name, wname('T01', 'implement'));
  assert.equal(spawn.name, `${REPO} / ${SLUG} / T01 / T01-thing / implement`);
  assert.equal(spawn.task, 'T01', 'the loop rebuilds the task NUMBER from the worker name, slug and all');
});

test('each implemented auto task gets a fresh reviewer: a distinct id and a distinct role-suffixed name, after implement', (t) => {
  const { platform, base } = setup(t, [{ num: 'T01' }]);
  drain(base);
  const impl = platform.spawns.find((s) => s.role === 'implement' && s.task === 'T01');
  const review = platform.spawns.find((s) => s.role === 'review' && s.task === 'T01');
  assert.ok(impl && review, 'both an implement and a review session were spawned');
  assert.notEqual(impl.id, review.id, 'the reviewer is a distinct session');
  // The implementer and reviewer of one task now carry distinct names by role (DESIGN §2.8), so the
  // coordinator addresses each directly instead of telling them apart by which spawned most recently.
  assert.notEqual(impl.name, review.name, 'distinct names, one per role');
  assert.equal(impl.name, `${REPO} / ${SLUG} / T01 / T01-thing / implement`);
  assert.equal(review.name, `${REPO} / ${SLUG} / T01 / T01-thing / review`);
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

test('a row marked `you` in the Runs column is spawned as an ordinary implement worker and reviewed — the marker is ignored (§2.5)', (t) => {
  const { platform, base } = setup(t, [{ num: 'T01', runs: 'you' }]);
  const state = createRunState();
  const r1 = runPass({ ...base, state });
  assert.ok(r1.actions.some((a) => a.type === 'spawn' && a.role === 'implement'), 'spawned an implement worker');
  assert.ok(!platform.spawns.some((s) => s.role === 'verify'), 'never a verify worker — the auto/you distinction is gone');
  drain({ ...base, state });
  assert.ok(platform.spawns.some((s) => s.role === 'review' && s.task === 'T01'), 'the task is put through review like any other');
});

test('no `hands-on` or `verify` action is ever recorded, even for a row still marked `you`', (t) => {
  const { base } = setup(t, [{ num: 'T01', runs: 'you' }, { num: 'T02' }]);
  const result = drain(base);
  assert.ok(!result.actions.some((a) => a.type === 'hands-on'), 'no hands-on action');
  assert.ok(!result.actions.some((a) => a.type === 'spawn' && a.role === 'verify'), 'no verify spawn');
});

test('a row marked `you` still builds, reviews and merges, unblocking its dependents (Runs ignored end to end)', (t) => {
  // T01 carries a stale `you` marker; T02 waits on it. Both build the ordinary implement→review way.
  const { worktree, base } = setup(t, [{ num: 'T01', runs: 'you' }, { num: 'T02', deps: ['T01'] }]);
  const result = drain(base);
  assert.equal(result.complete, true);
  assert.deepEqual(result.readyToMerge, { branch: `pir/${SLUG}` });

  const mergeT01 = result.actions.findIndex((a) => a.type === 'merge' && a.task === 'T01');
  const spawnT02 = result.actions.findIndex((a) => a.type === 'spawn' && a.task === 'T02');
  assert.ok(mergeT01 >= 0 && spawnT02 >= 0);
  assert.ok(mergeT01 < spawnT02, 'T02 is not spawned until T01 has merged (deps gated)');

  const finalFeature = worktree.progressOn(`pir/${SLUG}`);
  assert.equal((finalFeature.match(/✅/g) || []).length, 2);
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

test('the pass that merges a task returns its row as ✅, so the display never shows it queued in between', (t) => {
  const { base } = setup(t, [{ num: 'T01' }]);
  const state = createRunState();
  let r;
  for (let p = 0; p < 10; p++) {
    r = runPass({ ...base, state });
    if (r.actions.some((a) => a.type === 'merge')) break;
  }
  assert.ok(r.actions.some((a) => a.type === 'merge' && a.task === 'T01'), 'T01 merged');
  assert.equal(state.tasks.T01, undefined, 'the merged worker is forgotten this pass');
  // The row the pass hands back must already read ✅: with no worker holding it and a pre-merge row, the
  // display model reads "not done, not held" as `queued` for one pass.
  assert.equal(r.tasks.find((x) => x.num === 'T01').state, '✅');
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
  platform.send(wname('T01', 'implement'), 'use json');
  const result = drain({ ...base, state });
  assert.equal(result.complete, true, 'the answered worker resumes and the plan completes, ready to hand off');
});

test('a worker-raised surface is written to the flow log, not just the in-memory actions', (t) => {
  // The capture harness (T14) reads the flow log (control/log); a worker question or a conflict the
  // worker caught at its own integrate step used to reach `actions` but never the log, so the T15
  // facts could not see it (T16 review 2026-09-11). Assert the surface line reaches the log.
  const { base } = setup(t, [{ num: 'T01' }], { behaviors: { T01: { question: 'which format?' } } });
  const logLines = [];
  const control = { isHalted: () => false, log: (l) => logLines.push(l) };
  const state = createRunState();
  runPass({ ...base, control, state }); // spawn
  runPass({ ...base, control, state }); // worker asks → surface
  assert.ok(logLines.includes('surface T01'), `flow log must carry the surface; got: ${logLines.join(' | ')}`);
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

test('a coordinator-hit merge conflict keeps the worker alive; its decision is delivered, it resolves, and the branch merges cleanly exactly once (T28)', (t) => {
  // The T22 conflict-path bug end to end (§2.5 Option 2). Two tasks edit the same line of greeting.txt
  // from a common base; T01 merges clean, T02's coordinator-side merge conflicts. The loop must keep
  // T02's worker ALIVE and parked (not close it, not remove its worktree, not delete its task, not
  // respawn it), deliver the user's decision, let the worker resolve on its own branch and re-signal
  // done, then merge the now-clean branch exactly once — with the DECIDED content, not the losing side.
  const cr = (mine) => ({ conflictResolve: { file: 'greeting.txt', mine, resolved: 'hello there\n' } });
  const { platform, worktree, base } = setup(t, [{ num: 'T01' }, { num: 'T02' }], {
    files: { 'greeting.txt': 'hello world\n' },
    behaviors: { T01: cr('hello there\n'), T02: cr('hi world\n') },
  });
  const state = createRunState();

  // First drain: both build and review; T01 merges clean into the feature branch, T02's merge conflicts
  // and the worker PARKS. Nothing reaches main.
  const first = drain({ ...base, state });
  assert.equal(first.reason, 'parked', 'the run parks on the coordinator-hit conflict — it does not stall or promote');
  const conflict = first.actions.find((a) => a.type === 'surface' && a.kind === 'conflict');
  assert.ok(conflict, 'the conflict is surfaced to the user');
  const parkedTask = conflict.task;
  assert.equal(parkedTask, 'T02', 'T02 merges second, so it is the branch that conflicts');
  assert.equal(worktree.mainCommitCount(), 1, 'main is untouched while the conflict is parked');

  // The parked worker is KEPT ALIVE — the whole fix. Not closed, worktree not removed, task not deleted.
  const parked = state.tasks[parkedTask];
  assert.ok(parked, 'the parked task is still tracked (not deleted from state)');
  assert.equal(parked.phase, 'awaiting-answer', 'the worker is parked AWAITING, not closed');
  assert.ok(!platform.closed.includes(parked.workerId), "the parked worker's session was not closed");
  assert.ok(
    !worktree.events.some((e) => e.op === 'remove' && e.branch === `pir/${SLUG}-${parkedTask}`),
    "the parked worker's worktree/branch was not removed",
  );
  // Exactly one worker ran the task — never respawned into a clobbering fresh build (the T22 clobber).
  const implSpawns = platform.spawns.filter((s) => s.task === parkedTask && s.role === 'implement');
  assert.equal(implSpawns.length, 1, 'the parked task was built by exactly one implementer — no respawn');

  // Deliver the user's decision to the SAME, still-alive parked worker (addressed by its current role).
  const name = wname(parkedTask, parked.role);
  // The conflict surface carries a ready-to-paste resolution prompt (T14) naming that same worker, the
  // feature branch to merge in and the conflicting file; the worker picks the side, asking if unsure. It
  // is also on the parked task's decision so the display can show who is asking.
  assert.ok(conflict.prompt, 'the conflict surface carries a copy-paste resolution prompt (T14)');
  assert.ok(conflict.prompt.includes(name), 'the prompt names the worker to attach to (§2.9)');
  assert.match(conflict.prompt, new RegExp(`git merge pir/${SLUG}\\b`), 'the prompt names the feature branch to merge in');
  assert.ok(conflict.prompt.includes('greeting.txt'), 'the prompt lists the conflicting file');
  assert.doesNotMatch(conflict.prompt, /KEEP:/, 'no keep-which-side blank for the person (user 2026-09-24)');
  assert.equal(state.tasks[parkedTask].decision.prompt, conflict.prompt, 'the same prompt rides on the parked task for the display');
  platform.send(name, { kind: 'answer', task: parkedTask, text: 'keep hello there' });

  // Second drain: the worker resolves on its branch, re-signals done, the loop merges the clean branch
  // and the plan completes, ready to hand off.
  const second = drain({ ...base, state });
  assert.equal(second.complete, true, 'the resolved branch merges cleanly and the plan completes');
  assert.deepEqual(second.readyToMerge, { branch: `pir/${SLUG}` });

  const cleanMergesOfParked = worktree.events.filter(
    (e) => e.op === 'mergeTask' && e.branch === `pir/${SLUG}-${parkedTask}` && !e.conflict,
  );
  assert.equal(cleanMergesOfParked.length, 1, 'the parked task merged cleanly exactly once, after resolution');

  // The DECIDED side won: the feature branch carries the decision, not the losing content (the T22
  // regression). main is never touched — the person merges pir/demo by hand (DESIGN §2.4).
  assert.equal(worktree.fileOn(`pir/${SLUG}`, 'greeting.txt').stdout, 'hello there\n', 'the feature branch carries the decided content, not "hi world"');
  assert.equal(worktree.events.filter((e) => e.op === 'promote').length, 0, 'nothing was ever promoted to main');
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

// --- T41: `claude rm` clears a finished worker's leftover record on every NORMAL finish path ----------

test('every normal finish removes the worker record (claude rm) right after close; nothing is removed unclosed (T41)', (t) => {
  const { platform, base } = setup(t, [{ num: 'T01' }]);
  const state = createRunState();
  drain({ ...base, state });
  // A clean single-task run closes exactly two sessions — the implementer (at review hand-off) and the
  // reviewer (at merge) — and both are NORMAL finishes, so each close is followed by a `claude rm` on the
  // SAME id. Removal rides close: it never fires on an id that was not first closed.
  assert.ok(platform.closed.length >= 2, 'the implementer and the reviewer were both closed');
  for (const id of platform.closed) {
    assert.ok(platform.removed.includes(id), `closed id ${id} also had its record removed (claude rm)`);
  }
  for (const id of platform.removed) {
    assert.ok(platform.closed.includes(id), `removed id ${id} was closed first, never removed on its own`);
  }
});

test('the review hand-off removes the implementer record with the authoritative listed id, and it stays in closedIds (T41)', (t) => {
  const { platform, base } = setup(t, [{ num: 'T01' }]);
  const state = createRunState();
  runPass({ ...base, state }); // spawn implementer
  const r2 = runPass({ ...base, state }); // implemented → spawn reviewer, close + remove implementer
  const swap = r2.actions.find((a) => a.type === 'review');
  const implId = swap.closes;
  assert.ok(platform.closed.includes(implId), 'the implementer session is closed at hand-off');
  assert.ok(platform.removed.includes(implId), 'and its leftover record is removed with the same listed id');
  assert.ok(state.closedIds.has(implId), 'the removed id stays in closedIds, so it is never recounted as live');
});

test('a dead worker has its leftover record removed too (T41)', (t) => {
  const { platform, base } = setup(t, [{ num: 'T01' }], { behaviors: { T01: { crash: true } } });
  const state = createRunState();
  runPass({ ...base, state }); // spawn T01
  const implId = platform.spawns[0].id;
  let dead;
  for (let i = 0; i < 5 && !dead; i++) {
    const r = runPass({ ...base, state });
    dead = r.actions.find((a) => a.type === 'close' && a.reason === 'dead');
  }
  assert.ok(dead, 'the crashed worker is closed as dead');
  assert.ok(platform.removed.includes(implId), 'the dead worker record is cleared with claude rm');
});

test('the kill switch closes workers but does NOT remove their records — a killed worker is kept for forensics (T41)', (t) => {
  const { platform, base } = setup(t, [{ num: 'T01' }, { num: 'T02' }]);
  let halted = false;
  const control = { isHalted: () => halted, log: () => {} };
  const state = createRunState();
  runPass({ ...base, control, state }); // spawn T01, T02
  const liveIds = [...platform._workers.keys()];
  halted = true;
  runPass({ ...base, control, state }); // halt: close everything, remove nothing
  for (const id of liveIds) assert.ok(platform.closed.includes(id), `worker ${id} closed under HALT`);
  assert.equal(platform.removed.length, 0, 'no record is removed under HALT — a killed worker stays in the view');
});

test('a red feature branch is completed but not handed off: no readyToMerge, the failure is surfaced', (t) => {
  const { worktree, base } = setup(t, [{ num: 'T01' }]);
  const runTests = () => ({ ok: false });
  const result = drain({ ...base, runTests });
  assert.equal(result.reason, 'complete', 'the plan is done — every task ✅ — but the branch is red');
  assert.equal(result.testsPassed, false, 'the feature-branch tests failed');
  assert.ok(!result.readyToMerge, 'a red branch is never offered for merge (DESIGN §2.8)');
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
  const NAME = wname('T01', 'implement');
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
    { id: 'FOREIGN', name: 'other-repo · other-plan · T09 · implement', cwd: '/f', status: 'busy', state: 'working', live: true },
  ];
  const platform = { ...fake, list: () => [...fake.list(), ...nonWorkers] };
  const base = { platform, worktree, repo: REPO, slug: SLUG, maxWorkers: 1 };
  const state = createRunState();

  const r = runPass({ ...base, state }); // ceiling 1: exactly one worker should spawn, coordinator uncounted
  assert.equal(r.liveAfter, 1, 'one real worker live; the coordinator and the foreign agent are not counted');
  assert.equal(r.actions.filter((a) => a.type === 'spawn').length, 1, 'the free slot was used (not eaten by the self-count)');
  assert.ok(!fake.closed.includes('COORD') && !fake.closed.includes('FOREIGN'), 'neither non-worker was closed');
});

test('a closed session lingering in the agent list is not recounted — the false runaway the first live single run hit (2026-09-12)', (t) => {
  // Real `claude close` is async and a stale registry entry can outlive the process, so a just-closed
  // implementer keeps showing up in `claude agents --json` for a few passes alongside its fresh
  // reviewer. At ceiling 1 the loop must count one live worker across the hand-off, not two — else the
  // runaway breaker (coordinate.mjs, reading r.live) fires "2 over ceiling 1 for 3 passes" and tears the
  // run down mid-review before it can promote, which is exactly what killed the first live single run.
  // lingerClosed keeps the closed implementer listed; lingerBusy keeps the reviewer working while it
  // lingers, so pre-fix the two would be counted together (liveAfter 2).
  const { base } = setup(t, [{ num: 'T01' }], { behaviors: { T01: { lingerClosed: 3, lingerBusy: 2 } } });
  const state = createRunState();
  let complete = false;
  let maxLive = 0;
  for (let i = 0; i < 20 && !complete; i++) {
    const r = runPass({ ...base, maxWorkers: 1, state });
    maxLive = Math.max(maxLive, r.liveAfter);
    complete = r.complete;
  }
  assert.ok(complete, 'the plan completes despite the closed implementer lingering in the list');
  assert.ok(maxLive <= 1, `never more than the ceiling of 1 counted live (saw ${maxLive}) — no false runaway`);
});

test('a closed session that VANISHES then reappears under the same id is still not recounted — the human-decision live false runaway (2026-09-13)', (t) => {
  // The harder shape lingerClosed does not cover: `claude close` SIGTERMs the implementer and it drops
  // off `claude agents --json` at once — but a stale Remote Control registry entry brings it back a few
  // passes later under the SAME id, `idle`, beside its fresh reviewer. The earlier fix pruned closedIds
  // the moment an id fell off the list, so the reappearance was no longer suppressed: at ceiling 1 the
  // loop counted 2 live for 3 passes and the runaway breaker (coordinate.mjs, reading r.live) tore the
  // run down mid-review — which is what killed the human-decision live run after its decision cycle had
  // already completed correctly. closedIds must survive the absence, so the resurrected id stays
  // suppressed and the run promotes.
  // resurrectClosed: the implementer vanishes on close then reappears one pass later; lingerBusy holds
  // the fresh reviewer busy for a few passes (its merge deferred until idle), so it is still live when
  // the implementer comes back — the overlap that made the live run count 2 at ceiling 1. Without both,
  // a lone fast reviewer promotes before the resurrection and the overlap never happens.
  const { base } = setup(t, [{ num: 'T01' }], { behaviors: { T01: { resurrectClosed: 1, lingerBusy: 3 } } });
  const state = createRunState();
  let complete = false;
  let maxLive = 0;
  for (let i = 0; i < 30 && !complete; i++) {
    const r = runPass({ ...base, maxWorkers: 1, state });
    maxLive = Math.max(maxLive, r.liveAfter);
    complete = r.complete;
  }
  assert.ok(complete, 'the plan completes despite the closed implementer reappearing in the list');
  assert.ok(maxLive <= 1, `never more than the ceiling of 1 counted live (saw ${maxLive}) — the resurrected id was suppressed`);
});

// --- T30: no hello is sent at spawn (the spawn ping is retired) ------------------------------------

test('no hello is sent or logged at any spawn — the loop makes no down-send of its own (T30)', (t) => {
  const { platform, base } = setup(t, [{ num: 'T01' }]);
  const state = createRunState();

  runPass({ ...base, state }); // pass 1: spawn implementer — no hello
  runPass({ ...base, state }); // pass 2: implemented → fresh reviewer spawns — still no hello
  runPass({ ...base, state }); // pass 3: reviewer resolves, merge/close

  const hellos = platform.sent.filter((s) => s.msg.kind === 'hello');
  assert.equal(hellos.length, 0, 'no hello message was ever sent at spawn');
  // The loop never calls platform.send — there is no down-channel (DESIGN §2.2, T03): a blocked worker
  // is answered by the person directly, nothing is routed. So the loop opens and uses no send path.
  assert.equal(platform.sent.length, 0, 'the loop sent nothing — there is no down-channel');
});

test('a question report keeps the worker slot and is recorded, and the loop routes no answer (DESIGN §2.2, T03)', (t) => {
  const { platform, base } = setup(t, [{ num: 'T01' }, { num: 'T02' }], { behaviors: { T01: { question: 'which format?' } } });
  const state = createRunState();
  runPass({ ...base, state }); // spawn T01, T02
  const r2 = runPass({ ...base, state }); // T01 asks

  // The report is RECORDED for the display, not relayed: a `surface` action names the parked task.
  const surfaced = r2.actions.find((a) => a.type === 'surface' && a.task === 'T01');
  assert.ok(surfaced, 'the question is recorded as a surface action for the live display');

  // The worker KEEPS its slot: it is still tracked, parked AWAITING, and counts as live (so the ceiling
  // holds it) — a parked worker is alive, not dead (DESIGN §2.2).
  assert.equal(state.tasks.T01.phase, 'awaiting-answer', 'the parked worker holds its slot, AWAITING');
  assert.ok(r2.liveAfter >= 1, 'the parked worker still counts as live');

  // No answer is routed: the loop never calls a platform send — the person answers the worker directly.
  assert.equal(platform.sent.length, 0, 'the loop routed no answer down — there is no down-channel');
});

test('the loop still runs against a platform with no send half (no crash) (T13/T30)', (t) => {
  // The id-mismatch platform below has no `send` method. The loop must not require one — it makes no
  // down-send of its own since the hello was retired (T30) — so it simply spawns, is recognised by
  // name, and drains without touching platform.send.
  const worktree = createFakeWorktree({ progress: progressDoc([{ num: 'T01' }]), slug: SLUG });
  t.after(() => worktree.cleanup());
  const NAME = wname('T01', 'implement');
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
  // The reviewer lingers busy after it reports done; the loop must not merge its branch or close it
  // until it goes idle. (Before §2.5 this used a straight-to-done `you` task to isolate the merge gate;
  // now every task is implement→review, so the gate is exercised on the reviewer that reaches `done`.)
  const { platform, worktree, base } = setup(t, [{ num: 'T01' }], { behaviors: { T01: { lingerBusy: 1 } } });
  const state = createRunState();

  let sawMergeGate = false;
  let mergeFired = false;
  for (let p = 0; p < 10 && !mergeFired; p++) {
    const mergedBefore = worktree.events.some((e) => e.op === 'mergeTask');
    const r = runPass({ ...base, state });
    const mergedNow = worktree.events.some((e) => e.op === 'mergeTask');
    // The merge deferral is a `done worker still busy` await-idle (3d); a review handoff deferral is a
    // `review-ready worker still busy` one (3c) and does not match.
    if (r.actions.some((a) => a.type === 'await-idle' && /done worker/.test(a.reason ?? ''))) {
      sawMergeGate = true;
      assert.ok(!mergedNow, 'no merge while the done worker is busy');
    }
    if (sawMergeGate && !mergedBefore && mergedNow) mergeFired = true;
  }
  assert.ok(sawMergeGate, 'the loop deferred the merge while the done worker was busy');
  assert.ok(mergeFired, 'the merge fires once the done worker goes idle');
  assert.ok(platform.closed.length > 0, 'the merged worker is closed');
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

// --- the await-idle cap: a finished worker that never goes idle is forced through, not held forever --

test('a review handoff is FORCED once the implementer stays busy past the await-idle cap', (t) => {
  // The usage-limits failure: an implementer dropped `implemented` and committed, but a backgrounded
  // test suite left a daemon alive so the session never went idle, and the loop deferred for hours. Past
  // the cap the loop must stop trusting `busy`, force the hand-off, and log why (force-idle).
  const { platform, base } = setup(t, [{ num: 'T01' }], { behaviors: { T01: { lingerBusy: 999 } } });
  const state = createRunState();
  let clock = 0;
  const now = () => clock;
  runPass({ ...base, state, now }); // pass 1: spawn implementer
  const implId = platform.spawns[0].id;

  const held = runPass({ ...base, state, now }); // pass 2: implemented but busy, within the cap → held
  assert.ok(held.actions.some((a) => a.type === 'await-idle' && a.task === 'T01'), 'still held while within the cap');
  assert.ok(!held.actions.some((a) => a.type === 'force-idle'), 'not forced yet');
  assert.ok(!platform.closed.includes(implId), 'the still-recently-busy implementer is not closed');

  clock += 10 * 60 * 1000; // advance past the 5-minute AWAIT_IDLE_TIMEOUT_MS
  const forced = runPass({ ...base, state, now }); // pass 3: still busy, past the cap → forced
  assert.ok(forced.actions.some((a) => a.type === 'force-idle' && a.task === 'T01'), 'the pass records it forced past the cap');
  assert.ok(forced.actions.some((a) => a.type === 'review' && a.closes === implId), 'the reviewer is spawned despite the busy flag');
  assert.ok(platform.closed.includes(implId), 'the stuck implementer is closed (SIGTERM reaps its leaked process group)');
});

test('a merge (and close) is FORCED once the done worker stays busy past the await-idle cap', (t) => {
  // The worker lingers busy forever. Each time the loop defers on a busy worker within the cap, jump the
  // clock past the cap so the deferral is forced: the implementer's review handoff is forced first, then
  // the reviewer reaches `done` (busy forever) and its merge is forced — the deferral this test asserts.
  const { worktree, base } = setup(t, [{ num: 'T01' }], { behaviors: { T01: { lingerBusy: 999 } } });
  const state = createRunState();
  let clock = 0;
  const now = () => clock;

  let forcedMerge = null;
  for (let p = 0; p < 20 && !forcedMerge; p++) {
    const r = runPass({ ...base, state, now });
    // The merge force-idle reason names 'merge'; the review-handoff force-idle names 'hand-off'.
    if (r.actions.some((a) => a.type === 'force-idle' && /merge/.test(a.reason ?? ''))) {
      forcedMerge = r;
      break;
    }
    if (r.actions.some((a) => a.type === 'await-idle')) clock += 10 * 60 * 1000; // past AWAIT_IDLE_TIMEOUT_MS
  }
  assert.ok(forcedMerge, 'the merge is forced once the done worker is busy past the cap');
  assert.ok(forcedMerge.actions.some((a) => a.type === 'merge' && a.task === 'T01'), 'the branch is merged despite the busy flag');
  assert.ok(worktree.events.some((e) => e.op === 'mergeTask'), 'the stuck worker\'s branch is merged');
});

test('dry run stays isolated: the scratch repo is a temp dir, never the real project', (t) => {
  const { worktree, base } = setup(t, chain(2));
  assert.ok(worktree.dir.startsWith(tmpdir()), 'the scratch repo lives under the temp dir');
  assert.notEqual(worktree.dir, process.cwd());
  const result = drain(base);
  assert.equal(result.complete, true, 'a full run completes against fakes alone');
});

// --- T03: restart reconciliation — a restart resumes from git, it does not rebuild ------------------
//
// A restart is simulated with a FRESH run state (createRunState) run against a worktree whose task
// branches already carry committed glyphs, exactly as a crashed run would have left them. seedBranch
// cuts a task branch+worktree off the feature branch (as createTask does mid-run) and commits its own
// PROGRESS.md row at the target glyph, so reconciliation reads the glyph straight from real scratch git
// (DESIGN §2.2) — no state is trusted across the crash. openFeature is idempotent, so seeding it first
// and letting the loop re-open it is safe.

function seedBranch(worktree, slug, num, glyph, { file, content } = {}) {
  const wt = worktree.createTask(slug, num);
  const p = join(wt.path, progressPathFor(slug));
  writeFileSync(p, reconcileTaskRow(readFileSync(p, 'utf8'), { num, state: glyph, notes: '' }));
  if (file) writeFileSync(join(wt.path, file), content ?? `work ${num}\n`);
  git(wt.path, ['add', '-A']);
  git(wt.path, ['commit', '-m', `${num}: seed ${glyph}`, '--no-edit']);
  return wt;
}

test('restart with a ✅ task branch: it is merged, not rebuilt; its work lands on the feature branch and no session spawns', (t) => {
  const { platform, worktree, base } = setup(t, [{ num: 'T01' }]);
  worktree.openFeature(SLUG);
  seedBranch(worktree, SLUG, 'T01', '✅', { file: 'work-T01.txt' });

  const result = drain(base); // fresh state inside drain = a restart
  assert.equal(result.complete, true);
  assert.ok(result.actions.some((a) => a.type === 'merge' && a.task === 'T01'), 'the reviewed branch is merged by reconciliation');
  assert.ok(worktree.fileOn(`pir/${SLUG}`, 'work-T01.txt').ok, 'its committed work landed on the feature branch');
  assert.ok(worktree.events.some((e) => e.op === 'remove' && e.branch === `pir/${SLUG}-T01`), 'its worktree/branch is removed after merge');
  assert.equal(platform.spawns.filter((s) => s.task === 'T01').length, 0, 'no session is spawned for an already-reviewed task');
  assert.equal((worktree.progressOn(`pir/${SLUG}`).match(/✅/g) || []).length, 1, 'T01 is ✅ on the feature branch');
});

test('restart with a 🔍 task branch: a fresh reviewer runs on its existing worktree; no implementer is ever spawned', (t) => {
  const { platform, worktree, base } = setup(t, [{ num: 'T01' }]);
  worktree.openFeature(SLUG);
  seedBranch(worktree, SLUG, 'T01', '🔍', { file: 'work-T01.txt' });

  const state = createRunState();
  const r1 = runPass({ ...base, state });
  const review = r1.actions.find((a) => a.type === 'review' && a.task === 'T01');
  assert.ok(review && review.adopted, 'reconciliation adopts the built branch for review, not implement');
  const reviewSpawn = platform.spawns.find((s) => s.task === 'T01' && s.role === 'review');
  assert.ok(reviewSpawn, 'a fresh reviewer session is spawned');
  // The handle git reports may be the canonical /private/var path where wt.path is /var (a macOS
  // symlink), so match on the existing task worktree's dir name rather than the exact string.
  assert.ok(reviewSpawn.cwd.endsWith('/wt-T01'), 'the reviewer runs on the existing task worktree, not a fresh one');

  const result = drain({ ...base, state });
  assert.equal(result.complete, true);
  assert.equal(platform.spawns.filter((s) => s.task === 'T01' && s.role === 'implement').length, 0, 'no implementer is ever spawned for a built branch');
});

test('restart with a half-built (🟡) branch: the branch and its work are kept, and a fresh implementer is spawned onto them (user decision 2026-09-23)', (t) => {
  const { platform, worktree, base } = setup(t, [{ num: 'T01' }]);
  worktree.openFeature(SLUG);
  const wt = seedBranch(worktree, SLUG, 'T01', '🟡', { file: 'work-T01.txt' });
  // An edit the dead implementer never committed — the resumed one must find it too.
  writeFileSync(join(wt.path, 'uncommitted-T01.txt'), 'mid-edit\n');

  const r = runPass({ ...base, state: createRunState() });
  assert.ok(r.actions.some((a) => a.type === 'resume' && a.task === 'T01'), 'the half-built branch is resumed');
  assert.ok(!worktree.events.some((e) => e.op === 'remove' && e.branch === `pir/${SLUG}-T01`), 'the branch is never removed');
  const spawn = platform.spawns.find((s) => s.task === 'T01' && s.role === 'implement');
  assert.ok(spawn, 'an implementer is dispatched');
  assert.ok(spawn.cwd.endsWith('/wt-T01'), 'on the existing task worktree, not a re-cut one');
  assert.ok(worktree.fileOn(`pir/${SLUG}-T01`, 'work-T01.txt').ok, 'the committed work is still on the branch');
  assert.ok(existsSync(join(wt.path, 'uncommitted-T01.txt')), 'the uncommitted edit is still in the worktree');
});

test('restart with a 🔍 branch whose worktree folder is gone: the worktree is re-attached and reviewed, never re-implemented', (t) => {
  const { platform, worktree, base } = setup(t, [{ num: 'T01' }]);
  worktree.openFeature(SLUG);
  const wt = seedBranch(worktree, SLUG, 'T01', '🔍', { file: 'work-T01.txt' });
  git(worktree.feature.path, ['worktree', 'remove', '--force', wt.path]); // branch survives, folder does not

  const result = drain(base);
  assert.equal(result.complete, true);
  assert.ok(platform.spawns.some((s) => s.task === 'T01' && s.role === 'review'), 'a reviewer is spawned');
  assert.equal(platform.spawns.filter((s) => s.task === 'T01' && s.role === 'implement').length, 0, 'the built task is never re-implemented');
  assert.ok(worktree.fileOn(`pir/${SLUG}`, 'work-T01.txt').ok, 'its original work landed on the feature branch');
});

test('restart with a ✅ branch whose worktree folder is gone: it is still merged, not re-implemented', (t) => {
  const { platform, worktree, base } = setup(t, [{ num: 'T01' }]);
  worktree.openFeature(SLUG);
  const wt = seedBranch(worktree, SLUG, 'T01', '✅', { file: 'work-T01.txt' });
  git(worktree.feature.path, ['worktree', 'remove', '--force', wt.path]);

  const result = drain(base);
  assert.equal(result.complete, true);
  assert.ok(result.actions.some((a) => a.type === 'merge' && a.task === 'T01'), 'the reviewed branch is merged');
  assert.equal(platform.spawns.filter((s) => s.task === 'T01').length, 0, 'no session is spawned for it');
  assert.ok(worktree.fileOn(`pir/${SLUG}`, 'work-T01.txt').ok, 'its work landed on the feature branch');
});

test('restart with a ✅ branch whose merge conflicts: the conflict is surfaced and the branch is left untouched, not rebuilt', (t) => {
  const { worktree, base } = setup(t, [{ num: 'T01' }], { files: { 'greeting.txt': 'base\n' } });
  worktree.openFeature(SLUG);
  seedBranch(worktree, SLUG, 'T01', '✅', { file: 'greeting.txt', content: 'T01 version\n' });
  // A sibling changed the same file on the feature branch after T01 was cut, so the adopted merge collides.
  writeFileSync(join(worktree.feature.path, 'greeting.txt'), 'feature version\n');
  worktree.commitFeature('sibling change on the feature branch');

  const r = runPass({ ...base, state: createRunState() });
  assert.ok(r.actions.some((a) => a.type === 'surface' && a.kind === 'conflict' && a.task === 'T01'), 'the conflict is surfaced to the user');
  assert.ok(!r.actions.some((a) => a.type === 'merge' && a.task === 'T01'), 'the conflicting branch is not merged');
  assert.ok(!r.actions.some((a) => a.type === 'rebuild' && a.task === 'T01'), 'a reviewed-but-unmergeable branch is never rebuilt');
  assert.ok(worktree.branchExists(`pir/${SLUG}-T01`), 'the branch is left untouched for a person to land');
});

test('restart with a ✅ branch whose merge conflicts: it is flagged ⛔ and NEVER re-dispatched over later passes; its dependent waits (user decision 2026-09-17)', (t) => {
  // Reverting the ⛔ mark reddens this: without it the ⬜ row is seen as ready and a fresh implementer
  // clobbers the reviewed work on the very same pass (reproduced 2026-09-17). T02 depends on T01, so it
  // must not start while T01 is unresolved.
  const { platform, worktree, base } = setup(t, [{ num: 'T01' }, { num: 'T02', deps: ['T01'] }], { files: { 'greeting.txt': 'base\n' } });
  worktree.openFeature(SLUG);
  seedBranch(worktree, SLUG, 'T01', '✅', { file: 'greeting.txt', content: 'T01 version\n' });
  writeFileSync(join(worktree.feature.path, 'greeting.txt'), 'feature version\n');
  worktree.commitFeature('sibling change on the feature branch');

  const state = createRunState();
  for (let i = 0; i < 6; i++) runPass({ ...base, state });

  assert.match(worktree.progressOn(`pir/${SLUG}`), /\|\s*T01\s*\|.*⛔/, 'T01 is flagged ⛔ on the feature branch, not left ⬜');
  assert.equal(platform.spawns.filter((s) => s.task === 'T01').length, 0, 'no implementer or reviewer is ever spawned for the conflicted branch');
  assert.ok(worktree.branchExists(`pir/${SLUG}-T01`), 'the reviewed branch is still there for a person to land');
  assert.equal(platform.spawns.filter((s) => s.task === 'T02').length, 0, 'the dependent T02 waits behind the blocked T01');
});

test('restart cleans up a leftover task branch whose task is already ✅ on the feature branch', (t) => {
  const { platform, worktree, base } = setup(t, [{ num: 'T01', state: '✅' }]);
  worktree.openFeature(SLUG);
  seedBranch(worktree, SLUG, 'T01', '✅', { file: 'work-T01.txt' });

  const r = runPass({ ...base, state: createRunState() });
  assert.ok(r.actions.some((a) => a.type === 'cleanup' && a.task === 'T01'), 'the leftover branch is cleaned up');
  assert.ok(worktree.events.some((e) => e.op === 'remove' && e.branch === `pir/${SLUG}-T01`), 'the leftover worktree/branch is removed');
  assert.equal(platform.spawns.length, 0, 'nothing is spawned for an already-merged task');
});

test('mixed restart: T01 ✅-merge, T02 🔍-review, T03 half-built resume, T04 never-started — all in one first pass, ceiling never exceeded', (t) => {
  const { platform, worktree, base } = setup(t, [{ num: 'T01' }, { num: 'T02' }, { num: 'T03' }, { num: 'T04' }]);
  worktree.openFeature(SLUG);
  seedBranch(worktree, SLUG, 'T01', '✅', { file: 'work-T01.txt' });
  seedBranch(worktree, SLUG, 'T02', '🔍', { file: 'work-T02.txt' });
  seedBranch(worktree, SLUG, 'T03', '🟡', { file: 'work-T03.txt' });
  // T04 has no branch — never started.

  const state = createRunState();
  let complete = false;
  let maxLive = 0;
  for (let i = 0; i < 40 && !complete; i++) {
    const r = runPass({ ...base, maxWorkers: 2, state });
    maxLive = Math.max(maxLive, r.liveAfter);
    complete = r.complete;
  }
  assert.ok(complete, 'the mixed restart drains to completion, ready to hand off');
  assert.ok(maxLive <= 2, `the ceiling holds across reconciliation plus dispatch (saw ${maxLive})`);

  assert.equal(platform.spawns.filter((s) => s.task === 'T01').length, 0, 'T01 was merged, never re-run');
  assert.ok(platform.spawns.some((s) => s.task === 'T02' && s.role === 'review'), 'T02 got a fresh reviewer');
  assert.equal(platform.spawns.filter((s) => s.task === 'T02' && s.role === 'implement').length, 0, 'T02 was never re-implemented');
  assert.ok(platform.spawns.some((s) => s.task === 'T03' && s.role === 'implement'), 'T03 was resumed by a fresh implementer');
  assert.ok(platform.spawns.some((s) => s.task === 'T04' && s.role === 'implement'), 'T04 was started normally');
  assert.equal((worktree.progressOn(`pir/${SLUG}`).match(/✅/g) || []).length, 4, 'all four tasks are ✅ on the feature branch');
});

test('a leftover worker session of this slug is reaped session-only on restart; its ✅ branch is still merged and it is never counted against the ceiling', (t) => {
  const worktree = createFakeWorktree({ progress: progressDoc([{ num: 'T01' }]), slug: SLUG });
  t.after(() => worktree.cleanup());
  worktree.openFeature(SLUG);
  seedBranch(worktree, SLUG, 'T01', '✅', { file: 'work-T01.txt' });
  const fake = createFakePlatform({});
  // The dead run's worker session, still listed after a crash that skipped teardown. A plain listing
  // entry (not a real fake worker), so enumerating it in the reap does not advance/commit over the
  // seeded branch — the same non-advancing-agent trick the "own session" test uses.
  const leftover = { id: 'LEFTOVER', name: wname('T01', 'implement'), cwd: '/x', status: 'idle', state: 'done', live: true };
  const platform = { ...fake, list: () => [...fake.list(), leftover] };
  const base = { platform, worktree, repo: REPO, slug: SLUG, maxWorkers: 2 };

  const state = createRunState();
  let complete = false;
  let maxLive = 0;
  for (let i = 0; i < 10 && !complete; i++) {
    const r = runPass({ ...base, state });
    maxLive = Math.max(maxLive, r.liveAfter);
    complete = r.complete;
  }
  assert.ok(complete, 'the plan completes despite the orphaned session lingering in the list');
  assert.ok(fake.closed.includes('LEFTOVER'), 'the leftover session was stopped, session-only');
  assert.ok(fake.removed.includes('LEFTOVER'), 'its session record was removed too');
  assert.ok(worktree.fileOn(`pir/${SLUG}`, 'work-T01.txt').ok, 'the ✅ branch survived the reap and was merged (never worktree.remove in the reap)');
  assert.ok(maxLive <= 2, `the reaped orphan was never counted against the ceiling (saw ${maxLive})`);
});

test('mutation guard: a ✅ branch and a 🔍 branch are never dispatched as fresh implementers (reverting reconciliation reddens this)', (t) => {
  const { platform, worktree, base } = setup(t, [{ num: 'T01' }, { num: 'T02' }]);
  worktree.openFeature(SLUG);
  seedBranch(worktree, SLUG, 'T01', '✅', { file: 'work-T01.txt' });
  seedBranch(worktree, SLUG, 'T02', '🔍', { file: 'work-T02.txt' });

  const result = drain(base);
  assert.equal(result.complete, true);
  assert.equal(platform.spawns.filter((s) => s.task === 'T01' && s.role === 'implement').length, 0, 'the reviewed branch was merged, never re-implemented');
  assert.equal(platform.spawns.filter((s) => s.task === 'T02' && s.role === 'implement').length, 0, 'the built branch was reviewed, never re-implemented');
  assert.ok(platform.spawns.some((s) => s.task === 'T02' && s.role === 'review'), 'T02 got a fresh reviewer');
});

test('reconciliation records a plain-English restart summary naming what it merged/reviewed/resumed/started', (t) => {
  const { worktree, base } = setup(t, [{ num: 'T01' }, { num: 'T02' }, { num: 'T03' }, { num: 'T04' }]);
  worktree.openFeature(SLUG);
  seedBranch(worktree, SLUG, 'T01', '✅', { file: 'work-T01.txt' });
  seedBranch(worktree, SLUG, 'T02', '🔍', { file: 'work-T02.txt' });
  seedBranch(worktree, SLUG, 'T03', '🟡', { file: 'work-T03.txt' });

  const r = runPass({ ...base, maxWorkers: 2, state: createRunState() });
  const summary = r.actions.find((a) => a.type === 'restart-summary');
  assert.ok(summary, 'a restart summary is recorded');
  assert.deepEqual(summary.merged, ['T01']);
  assert.deepEqual(summary.reviewed, ['T02']);
  assert.deepEqual(summary.resumed, ['T03']);
  assert.deepEqual(summary.started, ['T04']);
  assert.match(summary.text, /merged T01/);
  assert.match(summary.text, /T02 to review/);
  assert.match(summary.text, /resuming T03/);
  assert.match(summary.text, /starting T04/);
});

test('a genuine first start records no restart summary and takes no reconciliation action — behaviour identical to today', (t) => {
  const { base } = setup(t, chain(3));
  const result = drain(base);
  assert.equal(result.complete, true);
  assert.ok(!result.actions.some((a) => ['resume', 'cleanup', 'restart-summary'].includes(a.type)), 'no reconciliation action on a first start');
  const merges = result.actions.filter((a) => a.type === 'merge');
  assert.equal(merges.length, 3, 'the three merges are the normal loop merges, not adoptions');
});

// --- T02: the loop acts on adoption — narrates adopted tasks, surfaces bad plan changes ------------
//
// After T01 the merge already writes new task rows into the feature PROGRESS.md and the unchanged
// decideDispatch spawns them on a later pass. T02 makes the loop CONSUME mergeTask's added/errors: an
// `adopt` action per adopted task (so the run tells the person what it picked up) and a
// `bad-plan-change` surface per rejected row (so a malformed addition is seen, not silently dropped).
// The two DESIGN scenarios are proven end to end against the fake worker (addRows) and scratch git.

// A row inserted onto a SEEDED task branch (the restart tests' branches), after the given task's own
// row, then committed — so a reconcile-time merge has a worker-introduced task to adopt. Mirrors what
// the fake platform's addRows does for a live worker, for the branches seedBranch stands up directly.
function addRowToSeedBranch(wt, afterTask, row) {
  const p = join(wt.path, progressPathFor(SLUG));
  const lines = readFileSync(p, 'utf8').split('\n');
  const at = lines.findIndex((l) => new RegExp(`^\\|\\s*${afterTask}\\s*\\|`).test(l.trim()));
  lines.splice(at >= 0 ? at + 1 : lines.length, 0, row);
  writeFileSync(p, lines.join('\n'));
  git(wt.path, ['add', '-A']);
  git(wt.path, ['commit', '-m', `${afterTask}: propose a new task`, '--no-edit']);
}

test('scenario 1: a task introduced by T01 (dep T01) is adopted at T01\'s merge and dispatched only after it, then reviewed and merged like any task', (t) => {
  // Plan T00, T01, T02 (T01, T02 depend on T00). T01's worker introduces T03 (dep T01) on its branch.
  const { worktree, base } = setup(t, [{ num: 'T00' }, { num: 'T01', deps: ['T00'] }, { num: 'T02', deps: ['T00'] }], {
    behaviors: { T01: { addRows: [taskRow({ num: 'T03', deps: ['T01'] })] } },
  });
  const result = drain(base);
  assert.equal(result.complete, true, 'the run completes with the adopted task built');

  const mergeT01 = result.actions.findIndex((a) => a.type === 'merge' && a.task === 'T01');
  const adoptT03 = result.actions.findIndex((a) => a.type === 'adopt' && a.task === 'T03');
  const spawnT03 = result.actions.findIndex((a) => a.type === 'spawn' && a.task === 'T03');
  assert.ok(mergeT01 >= 0, 'T01 merged');
  assert.ok(adoptT03 >= 0, 'an adopt action names T03 — the run says what it picked up');
  assert.ok(adoptT03 >= mergeT01, 'T03 is adopted at T01\'s merge, not before');
  assert.ok(spawnT03 > mergeT01, 'T03 is not spawned before T01 merges (its dep gates it, and it is unseen until then)');

  const finalFeature = worktree.progressOn(`pir/${SLUG}`);
  assert.match(finalFeature, /\|\s*T03\s*\|.*✅/, 'the adopted T03 is built, reviewed and ✅ — ordinary after adoption');
  assert.equal((finalFeature.match(/✅/g) || []).length, 4, 'T00, T01, T02 and the adopted T03 are all ✅');
});

test('scenario 2: a task introduced by T00 (dep T00) starts together with T01 and T02 the pass after T00 merges', (t) => {
  const { base } = setup(t, [{ num: 'T00' }, { num: 'T01', deps: ['T00'] }, { num: 'T02', deps: ['T00'] }], {
    behaviors: { T00: { addRows: [taskRow({ num: 'T03', deps: ['T00'] })] } },
  });
  const state = createRunState();
  const spawnPasses = []; // task nums spawned, per pass
  let adoptedT03 = false;
  let complete = false;
  for (let i = 0; i < 40 && !complete; i++) {
    const r = runPass({ ...base, state }); // maxWorkers 4 — all three fit
    spawnPasses.push(r.actions.filter((a) => a.type === 'spawn').map((a) => a.task));
    if (r.actions.some((a) => a.type === 'adopt' && a.task === 'T03')) adoptedT03 = true;
    complete = r.complete;
  }
  assert.ok(complete, 'the run completes');
  assert.ok(adoptedT03, 'T03 is adopted when T00 merges');

  // T01 and T02 could not start before T00 merged (they depend on it), and T03 did not exist before
  // then, so the first pass any of them can spawn is the one right after T00's merge — and all three
  // are ready on it, so they start together (DESIGN §2.3 scenario 2).
  const together = spawnPasses.find((p) => p.includes('T03'));
  assert.ok(together, 'T03 is spawned');
  assert.ok(together.includes('T01') && together.includes('T02'), 'T01, T02 and T03 all start together in one pass');
});

test('a bad plan change (a new task depending on an unknown task) is surfaced as bad-plan-change; the introducing task still lands ✅ and the run continues', (t) => {
  const { worktree, base } = setup(t, [{ num: 'T00' }, { num: 'T01', deps: ['T00'] }, { num: 'T02', deps: ['T00'] }], {
    behaviors: { T01: { addRows: [taskRow({ num: 'T03', deps: ['T99'] })] } },
  });
  const result = drain(base);
  assert.equal(result.complete, true, 'a bad plan change does not park or stall the run — it continues to completion');

  const bad = result.actions.find((a) => a.type === 'surface' && a.kind === 'bad-plan-change');
  assert.ok(bad, 'the rejected row is surfaced as a bad-plan-change (not silently dropped)');
  assert.equal(bad.task, 'T03', 'the surface names the rejected task');
  assert.match(bad.text, /T99/, 'the surface says which dependency is unknown');

  assert.ok(result.actions.some((a) => a.type === 'merge' && a.task === 'T01'), 'the introducing task still merged — its reviewed code is good');
  assert.ok(!result.actions.some((a) => a.type === 'adopt'), 'nothing was adopted from the atomic-rejected change');
  assert.ok(!result.actions.some((a) => a.type === 'spawn' && a.task === 'T03'), 'the rejected task is never dispatched');

  const finalFeature = worktree.progressOn(`pir/${SLUG}`);
  assert.match(finalFeature, /\|\s*T01\s*\|.*✅/, 'T01 is ✅ on the feature branch despite carrying a bad plan change');
  assert.ok(!/\|\s*T03\s*\|/.test(finalFeature), 'the rejected T03 never reached the feature table');
});

// The remote-grant incident (real-screen-time, 2026-09-22): a reviewer added a wiring task the
// deploy check needed, but could not edit the deploy task's row, so the deploy was dispatched
// without it. A `blocks` clause on the new row now gates the existing task at adoption.
test('a new task that blocks an unstarted task is adopted and the blocked task waits for it', (t) => {
  const { base } = setup(t, [{ num: 'T00' }, { num: 'T01', deps: ['T00'] }, { num: 'T02', deps: ['T01'] }], {
    behaviors: { T01: { addRows: [taskRow({ num: 'T03', deps: ['T00'] }).replace('| T00 |', '| T00; blocks T02 |')] } },
  });
  const result = drain(base);
  assert.equal(result.complete, true);
  const mergeT03 = result.actions.findIndex((a) => a.type === 'merge' && a.task === 'T03');
  const spawnT02 = result.actions.findIndex((a) => a.type === 'spawn' && a.task === 'T02');
  assert.ok(result.actions.some((a) => a.type === 'adopt' && a.task === 'T03'), 'T03 adopted');
  assert.ok(mergeT03 >= 0 && spawnT02 > mergeT03, 'T02 is not dispatched until the blocking T03 has merged');
  assert.ok(!result.actions.some((a) => a.type === 'surface' && a.kind === 'late-block'), 'no late-block: T02 had not started');
});

test('a new task that blocks an already-started task is adopted and surfaced as late-block', (t) => {
  // T01 and T02 both depend only on T00, so T02 is running when T01's branch (with T03 blocking T02) merges.
  const { base } = setup(t, [{ num: 'T00' }, { num: 'T01', deps: ['T00'] }, { num: 'T02', deps: ['T00'] }], {
    behaviors: { T01: { addRows: [taskRow({ num: 'T03', deps: ['T00'] }).replace('| T00 |', '| T00; blocks T02 |')] } },
  });
  const result = drain(base);
  assert.equal(result.complete, true, 'a late block does not stall the run');
  const late = result.actions.find((a) => a.type === 'surface' && a.kind === 'late-block');
  assert.ok(late, 'the person is told T02 started without T03');
  assert.equal(late.task, 'T02');
});

test('a run with no plan change records no adopt and no bad-plan-change (regression guard)', (t) => {
  const { base } = setup(t, chain(3));
  const result = drain(base);
  assert.equal(result.complete, true);
  assert.ok(!result.actions.some((a) => a.type === 'adopt'), 'no adoption when nothing is introduced');
  assert.ok(!result.actions.some((a) => a.type === 'surface' && a.kind === 'bad-plan-change'), 'no bad-plan-change surfaced');
});

test('restart: a ✅ branch that introduced a new task has it adopted at the reconcile merge, then dispatched and built', (t) => {
  // The second merge site: adoption at the restart-reconcile merge, not only the live merge.
  const { platform, worktree, base } = setup(t, [{ num: 'T01' }]);
  worktree.openFeature(SLUG);
  const wt = seedBranch(worktree, SLUG, 'T01', '✅', { file: 'work-T01.txt' });
  addRowToSeedBranch(wt, 'T01', taskRow({ num: 'T03', deps: ['T01'] }));

  const state = createRunState();
  let adopted = false;
  let complete = false;
  for (let i = 0; i < 20 && !complete; i++) {
    const r = runPass({ ...base, state });
    if (r.actions.some((a) => a.type === 'adopt' && a.task === 'T03')) adopted = true;
    complete = r.complete;
  }
  assert.ok(complete, 'the restart drains to completion');
  assert.ok(adopted, 'the reconcile merge adopts the introduced task (both merge sites act on adoption)');
  assert.ok(platform.spawns.some((s) => s.task === 'T03' && s.role === 'implement'), 'the adopted task is dispatched');
  assert.match(worktree.progressOn(`pir/${SLUG}`), /\|\s*T03\s*\|.*✅/, 'T03 is built, reviewed and ✅ on the feature branch');
});
