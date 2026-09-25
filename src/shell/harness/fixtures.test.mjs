// The live-scenario fixtures and their loader, proven at BUILD time — no agent spawned (DESIGN §4.1,
// T16). What is proven here: every fixture's scratch plan parses and is marked reviewed with the task
// graph its scenario needs; every fixture ships a valid scenario spec (T15) declaring the named facts;
// and installFixture lays a fixture down deterministically, carries the parallel skills the workers need,
// and the seeded shape genuinely forces (or avoids) a merge conflict — replayed over real git. The old
// `hands-on` and `blog-app` fixtures went with the `you` model (DESIGN §2.5, T05). Running a fixture
// against real workers is the live half (T09); this file never does.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseProgress } from '../../core/progress.mjs';
import { parseTestBlock } from '../../core/testblock.mjs';
import { listFixtures, getFixture, fixtureFiles, installFixture, DEFAULT_SKILLS_DIR } from './fixtures.mjs';

// What each fixture must be, from DESIGN §4.1. Task graph (count + deps), the scenario ceiling, and the
// exact fact ids the scenario declares (assertions.mjs ids). Kept as data so one loop checks all six.
const EXPECT = {
  single: {
    taskCount: 1,
    deps: { T01: [] },
    ceiling: 1,
    factIds: ['no-hello-ever', 'no-close-before-idle', 'handed-off-green-branch'],
  },
  parallel: {
    taskCount: 3,
    deps: { T01: [], T02: [], T03: [] },
    ceiling: 2,
    factIds: ['no-hello-ever', 'ceiling-held:2', 'kill-switch-stopped-all'],
  },
  'review-queue': {
    taskCount: 3,
    deps: { T01: [], T02: [], T03: ['T01'] },
    ceiling: 2,
    factIds: ['no-hello-ever', 'no-close-before-idle', 'handed-off-green-branch'],
  },
  'clean-merge': {
    taskCount: 2,
    deps: { T01: [], T02: [] },
    ceiling: 2,
    factIds: ['handed-off-green-branch', 'ceiling-held:2', 'no-close-before-idle'],
  },
  'merge-conflict': {
    taskCount: 2,
    deps: { T01: [], T02: [] },
    ceiling: 2,
    factIds: ['merge-conflict-resolved', 'ceiling-held:2'],
  },
  'human-decision': {
    taskCount: 2,
    deps: { T01: [], T02: [] },
    ceiling: 2,
    factIds: ['parked-worker-holds-slot:T01'],
  },
  restart: {
    taskCount: 2,
    deps: { T01: [], T02: ['T01'] },
    ceiling: 1,
    factIds: ['resumed-not-rebuilt:T02', 'no-rebuild-from:T01', 'feeds-cleared', 'leftover-sessions-reaped:1'],
  },
  'restart-review': {
    taskCount: 1,
    deps: { T01: [] },
    ceiling: 1,
    factIds: ['stopped-gracefully', 'resumed-not-rebuilt:T01', 'feeds-cleared', 'ceiling-held:1'],
  },
  'restart-implement': {
    taskCount: 1,
    deps: { T01: [] },
    ceiling: 1,
    factIds: ['stopped-gracefully', 'resumed-from-partial:T01', 'ceiling-held:1'],
  },
  'dynamic-task': {
    taskCount: 1,
    deps: { T01: [] },
    ceiling: 1,
    factIds: ['adopted-and-dispatched', 'handed-off-green-branch'],
  },
};

// --- The registry ---------------------------------------------------------------------------------

test('listFixtures returns exactly the DESIGN §4.1 fixtures', () => {
  assert.deepEqual(new Set(listFixtures()), new Set(Object.keys(EXPECT)));
  assert.equal(listFixtures().length, Object.keys(EXPECT).length);
});

// declared-test-command T10: the coordinator refuses to start a plan without a valid setup/test block
// and runs its `test` lines as the end-of-run gate, so every fixture must carry one or no live run
// can start, let alone end green.
test('every fixture installs a DESIGN.md whose setup/test block parses: setup none, test npm test', () => {
  for (const id of listFixtures()) {
    const fx = getFixture(id);
    const design = fixtureFiles(fx)[`plans/${fx.slug}/DESIGN.md`];
    assert.ok(design, `${id}: no DESIGN.md`);
    const r = parseTestBlock(design);
    assert.equal(r.ok, true, `${id}: ${r.reason}`);
    assert.deepEqual(r.setup, [], id);
    assert.deepEqual(r.test, ['npm test'], id);
  }
});

test('getFixture throws on an unknown id, naming the known ones', () => {
  assert.throws(() => getFixture('nope'), /unknown fixture "nope".*single/s);
});

// --- Each fixture's scratch plan and scenario spec ------------------------------------------------

for (const id of Object.keys(EXPECT)) {
  const want = EXPECT[id];

  test(`${id}: PROGRESS.md parses, is reviewed, and has the expected task graph`, () => {
    const fx = getFixture(id);
    const { planReviewed, tasks, errors } = parseProgress(fx.progress);
    assert.equal(errors.length, 0, `parse errors: ${errors.join('; ')}`);
    assert.equal(planReviewed.reviewed, true, 'the fixture plan must be pre-marked reviewed');
    assert.equal(tasks.length, want.taskCount);
    for (const t of tasks) {
      assert.deepEqual(t.deps, want.deps[t.num], `${id} ${t.num} deps`);
      assert.equal(t.state, '⬜', `${id} ${t.num} starts unbuilt`);
    }
  });

  test(`${id}: ships a valid scenario spec declaring its named facts`, () => {
    const fx = getFixture(id);
    const s = fx.scenario;
    assert.equal(s.id, id);
    assert.equal(s.fixture, id, 'the scenario points back at its own fixture id');
    assert.equal(getFixture(s.fixture).id, id, 'scenario.fixture resolves through getFixture');
    assert.equal(s.seatbelts.ceiling, want.ceiling, `${id} ceiling seatbelt`);
    assert.equal(s.seatbelts.killSwitch, true, 'the kill switch is always wired');
    assert.deepEqual(
      s.facts.map((f) => f.id),
      want.factIds,
      `${id} declares exactly its named facts`,
    );
  });

  test(`${id}: one task doc per row, each naming its task id`, () => {
    const fx = getFixture(id);
    const { tasks } = parseProgress(fx.progress);
    assert.equal(Object.keys(fx.tasks).length, tasks.length, 'a task doc per PROGRESS row');
    for (const t of tasks) {
      const file = Object.keys(fx.tasks).find((name) => name.startsWith(`${t.num}-`));
      assert.ok(file, `${id} has a tasks/${t.num}-*.md`);
      assert.ok(fx.tasks[file].includes(`# ${t.num} —`), `${id} ${file} heads with its task id`);
    }
  });
}

// --- Fixture-specific seeded shapes ---------------------------------------------------------------

test('merge-conflict: both task docs edit the same file, and the probe expects a conflict', () => {
  const fx = getFixture('merge-conflict');
  const files = Object.values(fx.tasks);
  assert.ok(files.every((t) => t.includes('greeting.txt')), 'both tasks name greeting.txt');
  assert.equal(fx.probe.expect, 'conflict');
  const targets = fx.probe.edits.map((e) => e.file);
  assert.deepEqual(new Set(targets), new Set(['greeting.txt']), 'both edits target the one file');
  assert.equal(fx.seedFiles['greeting.txt'], 'hello world\n');
});

test('merge-conflict: attended — no scripted answer, a Needs-a-person block, a human-speed budget, decided final content (T13)', () => {
  const fx = getFixture('merge-conflict');
  // The down-channel is gone (§2.2, T05): nothing is routed — a person resolves the conflict on the live
  // worker directly, so the fixture carries no scripted answer any more.
  assert.equal(fx.scriptedAnswer, undefined, 'no scripted answer — the person resolves the conflict directly (§2.2)');
  // A "Needs a person" block names the manual step and pins the decided side so the run stays deterministic.
  assert.match(fx.needsPerson, /attach/i, 'the block tells the person to attach to the parked worker');
  assert.match(fx.needsPerson, /hello there/, 'the block pins "hello there" as the side to keep');
  // A human-speed wall-clock budget (above the 10-min default) so a real person has time to attach and
  // paste before the auto-HALT; the attended run FINISHES once resolved, so it declares no forever-park.
  assert.ok(fx.scenario.seatbelts.timeoutMs >= 20 * 60 * 1000, 'a human-speed timeout budget is set');
  assert.notEqual(fx.scenario.expectedTerminal, 'parked', 'the attended run completes; it is not a designed forever-park');
  // The fact list is the conflict resolution plus the ceiling bound.
  const factIds = fx.scenario.facts.map((f) => f.id);
  assert.ok(factIds.includes('merge-conflict-resolved'), 'the conflict-resolution fact is declared');
  assert.ok(factIds.includes('ceiling-held:2'), 'ceilingHeld(2) is kept in the fact list');
  assert.deepEqual(fx.finalContent, { file: 'greeting.txt', content: 'hello there' }, 'the handed-off branch must read the decided side');
});

test('clean-merge: the two task docs edit different files, and the probe expects a clean merge', () => {
  const fx = getFixture('clean-merge');
  assert.equal(fx.probe.expect, 'clean');
  const targets = fx.probe.edits.map((e) => e.file);
  assert.equal(new Set(targets).size, 2, 'the two edits target different files');
  assert.deepEqual(new Set(Object.keys(fx.seedFiles)), new Set(['a.txt', 'b.txt']));
});

test('human-decision: T01 is deliberately underspecified and told to park; T02 is independent, no answer routed', () => {
  const fx = getFixture('human-decision');
  const { tasks } = parseProgress(fx.progress);
  // Two INDEPENDENT tasks so the parked T01 does not block T02 (the whole point, at ceiling 2).
  assert.deepEqual(tasks.find((t) => t.num === 'T01').deps, [], 'T01 is independent');
  assert.deepEqual(tasks.find((t) => t.num === 'T02').deps, [], 'T02 is independent');
  const t01 = Object.entries(fx.tasks).find(([n]) => n.startsWith('T01-'))[1];
  assert.match(t01, /NOT SPECIFIED/, 'the wording is explicitly left unspecified');
  assert.match(t01, /ask the person|drop a `question` report and park/i, 'the worker is told to ask and park, not guess');
  // The down-channel is gone (§2.2, T05): no scripted answer is carried; the program routes nothing.
  assert.equal(fx.scriptedAnswer, undefined, 'no scripted answer — the person answers the worker directly');
});

test('dynamic-task: T01 is told to propose-and-wait before adding the missing task; the fixture hands over the escalate-before-add judgement', () => {
  const fx = getFixture('dynamic-task');
  const { tasks } = parseProgress(fx.progress);
  // A single seed task, so the next-free number the live worker adds is unambiguous (T02).
  assert.equal(tasks.length, 1, 'one seed task so the introduced task has an unambiguous next-free number');
  assert.deepEqual(tasks[0].deps, [], 'the seed task is independent');
  const t01 = Object.entries(fx.tasks).find(([n]) => n.startsWith('T01-'))[1];
  // The worker must escalate BEFORE adding and must not add on its own — the carve-out's whole discipline.
  assert.match(t01, /decision/i, 'the worker is told to propose the missing task as a decision');
  assert.match(t01, /Do NOT add the task on your own/, 'the worker is told not to add it on its own');
  assert.match(t01, /addition only|never edit T01/i, 'the addition is add-only, never an edit of T01');
  assert.match(t01, /Depends on` naming T01|depending on T01/i, 'the added task depends on the existing T01');
  // The person-only judgement (DESIGN §5.1) is carried on the fixture for the live drill, and names the crux.
  assert.match(fx.needsPerson, /escalate BEFORE adding/, 'the handover asks the person to judge escalate-before-add');
  assert.match(fx.needsPerson, /well-formed/, 'the handover asks the person to judge the addition is well-formed');
  assert.match(fx.needsPerson, /adopt/, 'the handover asks the person to confirm the coordinator adopted and dispatched');
  // An attended, completing run: no scripted answer (the person approves directly), a human-speed budget.
  assert.equal(fx.scenario.expectedTerminal, 'completed', 'the approved run completes; it is not a forever-park');
  assert.ok(fx.scenario.seatbelts.timeoutMs >= 20 * 60 * 1000, 'a human-speed timeout budget is set');
});

test('parallel: at least two independent tasks so workers run concurrently', () => {
  const { tasks } = parseProgress(getFixture('parallel').progress);
  const independent = tasks.filter((t) => t.deps.length === 0);
  assert.ok(independent.length >= 2, 'two or more tasks with no dependency');
});

test('restart: registered, declares the 🔍 crash point on the dependent task (T06)', () => {
  const fx = getFixture('restart');
  // It resolves through the normal registry (the same path installFixture and the runner use).
  assert.equal(fx.id, 'restart');
  assert.ok(listFixtures().includes('restart'), 'restart is in the fixture registry');
  // The crash point is the deterministic mid-review state: the dependent task committing 🔍. T02 depends
  // on T01, so the kill lands with T01 already done and T02 mid-review every run (§2.2).
  assert.deepEqual(fx.restart.waitFor, { task: 'T02', glyph: '🔍' });
  const { tasks } = parseProgress(fx.progress);
  assert.deepEqual(tasks.find((t) => t.num === 'T02').deps, ['T01'], 'T02 depends on T01 so the ordering is fixed');
});

test('restart-review: stops with SIGTERM at the 🔍 point, so the teardown path is exercised', () => {
  const fx = getFixture('restart-review');
  assert.deepEqual(fx.restart, { waitFor: { task: 'T01', glyph: '🔍' }, signal: 'SIGTERM' });
});

test('restart-implement: stops with SIGTERM at the part-1 commit, and the task doc names that exact subject', () => {
  const fx = getFixture('restart-implement');
  assert.deepEqual(fx.restart, { waitFor: { task: 'T01', commit: 'T01: part 1' }, signal: 'SIGTERM' });
  const doc = fx.tasks['T01-parts.md'];
  assert.match(doc, /`T01: part 1`/, 'the implementer is told the exact subject the crash point waits for');
  assert.match(doc, /sleep 60/, 'the pause that makes the stop land between the parts');
  assert.match(doc, /already committed/, 'a resumed implementer is told not to redo part 1');
});

// --- The loader: install, carry skills, seed git -------------------------------------------------

function tmp(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function git(dir, args, env) {
  return execFileSync(
    'git',
    ['-c', 'user.name=T', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args],
    { cwd: dir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], env: env ? { ...process.env, ...env } : process.env },
  );
}

test('fixtureFiles lays down the scaffold, the plan tree, task docs and seed files', () => {
  const files = fixtureFiles(getFixture('clean-merge'));
  const paths = Object.keys(files);
  assert.ok(paths.includes('package.json'));
  assert.ok(paths.includes('.gitignore'));
  assert.ok(paths.includes('plans/clean-merge/PROGRESS.md'));
  assert.ok(paths.includes('plans/clean-merge/DESIGN.md'));
  assert.ok(paths.some((p) => p.startsWith('plans/clean-merge/tasks/T01-')));
  assert.ok(paths.includes('a.txt') && paths.includes('b.txt'), 'seed files at their target paths');
  assert.match(files['.gitignore'], /plans\/\*\/\.parallel\//, 'control state is gitignored');
});

test('installFixture writes the tree, carries the parallel skills, and seeds a committed main', () => {
  const dir = tmp('pir-fix-install-');
  try {
    const res = installFixture('single', { into: dir });
    assert.equal(res.slug, 'single');

    // The plan tree is present and parses reviewed.
    const progressPath = join(dir, 'plans/single/PROGRESS.md');
    assert.ok(existsSync(progressPath));
    assert.equal(parseProgress(readFileSync(progressPath, 'utf8')).planReviewed.reviewed, true);

    // The parallel skills a worker needs are carried locally (FINDINGS 2026-09-09). The agentic
    // coordinator skill (pir-coordinate) was deleted in T07 — the coordinator is a plain program now.
    assert.ok(existsSync(join(dir, '.claude/skills/pir-worker/SKILL.md')), 'pir-worker carried');
    assert.ok(existsSync(join(dir, '.claude/skills/pir-implement/SKILL.md')), 'pir-implement carried');
    assert.ok(res.skills.includes('pir-worker') && res.skills.includes('pir-implement'));

    // The framework code the coordinator runs is carried too (T17 live run 2026-09-11): the coordinator
    // skill shells out to `node src/shell/coordinate.mjs`, so the bin and its imports must be present.
    assert.equal(res.source, true);
    assert.ok(existsSync(join(dir, 'src/shell/coordinate.mjs')), 'the coordinator bin is carried');
    assert.ok(existsSync(join(dir, 'src/core/naming.mjs')), 'the core it imports is carried');
    // But NOT the framework's own tests (else the scratch `npm test` runs them, not the fixture task test)
    // and NOT the harness subtree (the coordinator needs core + shell, not the live-scenario harness).
    assert.ok(!existsSync(join(dir, 'src/shell/coordinate.test.mjs')), 'framework *.test.mjs are not carried');
    assert.ok(!existsSync(join(dir, 'src/shell/harness')), 'the harness subtree is not carried');

    // Git: one commit on main, a clean tree, the plan and skills tracked, control state ignored.
    assert.equal(git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']).trim(), 'main');
    assert.equal(git(dir, ['status', '--porcelain']).trim(), '', 'the seeded tree is clean');
    const tracked = git(dir, ['ls-files']);
    assert.match(tracked, /plans\/single\/PROGRESS\.md/);
    assert.match(tracked, /\.claude\/skills\/pir-worker\/SKILL\.md/);
    assert.doesNotMatch(tracked, /\.parallel\//, 'per-run control state is never committed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('installFixture is deterministic — two installs of a fixture share a commit SHA', () => {
  const a = tmp('pir-fix-det-a-');
  const b = tmp('pir-fix-det-b-');
  try {
    installFixture('merge-conflict', { into: a });
    installFixture('merge-conflict', { into: b });
    const shaA = git(a, ['rev-parse', 'HEAD']).trim();
    const shaB = git(b, ['rev-parse', 'HEAD']).trim();
    assert.equal(shaA, shaB, 'fixed identity, date and content ⇒ identical seed commit');
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});

test('installFixture points at a stub skills dir when asked (hermetic carry)', () => {
  const stub = tmp('pir-fix-skills-');
  const dir = tmp('pir-fix-stub-');
  try {
    // A stub skills source with one skill dir; carry copies exactly it.
    const one = join(stub, 'pir-worker');
    execFileSync('mkdir', ['-p', one]);
    writeFileSync(join(one, 'SKILL.md'), '# stub\n');
    const res = installFixture('single', { into: dir, skillsDir: stub });
    assert.deepEqual(res.skills, ['pir-worker']);
    assert.ok(existsSync(join(dir, '.claude/skills/pir-worker/SKILL.md')));
  } finally {
    rmSync(stub, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- The seeded shape really forces (or avoids) a conflict, over real git ------------------------

// Replay a fixture's probe: branch off the seeded main, apply each task's engineered single-line edit
// on its own branch, then merge the first (fast-forward) and the second into a feature branch. Return
// whether the second merge conflicted. This is the git-level proof the fixture forces its path, with no
// worker spawned (T16 acceptance: "the conflict really conflicts, the clean merge really doesn't").
function replayProbe(dir, probe) {
  const applyEdit = (edit) => {
    const p = join(dir, edit.file);
    writeFileSync(p, readFileSync(p, 'utf8').replace(edit.from, edit.to));
  };
  const base = git(dir, ['rev-parse', 'HEAD']).trim();
  const [e1, e2] = probe.edits;

  git(dir, ['checkout', '-b', 'probe-1', base]);
  applyEdit(e1);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'probe edit 1']);

  git(dir, ['checkout', '-b', 'probe-2', base]);
  applyEdit(e2);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'probe edit 2']);

  git(dir, ['checkout', '-b', 'probe-feature', base]);
  git(dir, ['merge', '--no-edit', 'probe-1']); // clean: first onto base
  let conflicted = false;
  try {
    git(dir, ['merge', '--no-edit', 'probe-2']);
  } catch {
    conflicted = true; // git exits non-zero on a conflict
  }
  return conflicted;
}

test('merge-conflict probe: the two same-line edits really conflict on the second merge', () => {
  const dir = tmp('pir-fix-conflict-');
  try {
    const fx = getFixture('merge-conflict');
    installFixture('merge-conflict', { into: dir });
    assert.equal(replayProbe(dir, fx.probe), true, 'the second merge must conflict');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('clean-merge probe: the two different-file edits merge cleanly', () => {
  const dir = tmp('pir-fix-clean-');
  try {
    const fx = getFixture('clean-merge');
    installFixture('clean-merge', { into: dir });
    assert.equal(replayProbe(dir, fx.probe), false, 'the second merge must be clean');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
