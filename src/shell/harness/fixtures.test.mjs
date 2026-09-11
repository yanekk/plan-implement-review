// The six live-scenario fixtures and their loader, proven at BUILD time — no agent spawned (DESIGN
// §4.1, T16). What is proven here: every fixture's scratch plan parses and is marked reviewed with the
// task graph its scenario needs; every fixture ships a valid scenario spec (T15) declaring the named
// facts; and installFixture lays a fixture down deterministically, carries the parallel skills the
// workers need, and the seeded shape genuinely forces (or avoids) a merge conflict — replayed over real
// git. Running a fixture against real workers is T17; this file never does.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseProgress } from '../../core/progress.mjs';
import { listFixtures, getFixture, fixtureFiles, installFixture, DEFAULT_SKILLS_DIR } from './fixtures.mjs';

// What each fixture must be, from DESIGN §4.1. Task graph (count + deps), the scenario ceiling, and the
// exact fact ids the scenario declares (assertions.mjs ids). Kept as data so one loop checks all six.
const EXPECT = {
  single: {
    taskCount: 1,
    deps: { T01: [] },
    ceiling: 1,
    factIds: ['hello-per-spawn', 'by-name-addressing', 'no-close-before-idle', 'one-merge-to-main'],
  },
  parallel: {
    taskCount: 3,
    deps: { T01: [], T02: [], T03: [] },
    ceiling: 2,
    factIds: ['hello-per-spawn', 'ceiling-held:2', 'kill-switch-stopped-all'],
  },
  'review-queue': {
    taskCount: 3,
    deps: { T01: [], T02: [], T03: ['T01'] },
    ceiling: 2,
    factIds: ['hello-per-spawn', 'no-close-before-idle', 'one-merge-to-main'],
  },
  'clean-merge': {
    taskCount: 2,
    deps: { T01: [], T02: [] },
    ceiling: 2,
    factIds: ['one-merge-to-main', 'ceiling-held:2', 'no-close-before-idle'],
  },
  'merge-conflict': {
    taskCount: 2,
    deps: { T01: [], T02: [] },
    ceiling: 2,
    factIds: ['conflict-surfaced-and-parked'],
  },
  'human-decision': {
    taskCount: 1,
    deps: { T01: [] },
    ceiling: 1,
    factIds: ['question-round-trip:T01', 'one-merge-to-main'],
  },
};

// --- The registry ---------------------------------------------------------------------------------

test('listFixtures returns exactly the six DESIGN §4.1 fixtures', () => {
  assert.deepEqual(new Set(listFixtures()), new Set(Object.keys(EXPECT)));
  assert.equal(listFixtures().length, 6);
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

test('clean-merge: the two task docs edit different files, and the probe expects a clean merge', () => {
  const fx = getFixture('clean-merge');
  assert.equal(fx.probe.expect, 'clean');
  const targets = fx.probe.edits.map((e) => e.file);
  assert.equal(new Set(targets).size, 2, 'the two edits target different files');
  assert.deepEqual(new Set(Object.keys(fx.seedFiles)), new Set(['a.txt', 'b.txt']));
});

test('human-decision: the task doc is deliberately underspecified and a scripted answer is carried', () => {
  const fx = getFixture('human-decision');
  const doc = Object.values(fx.tasks)[0];
  assert.match(doc, /NOT SPECIFIED/, 'the wording is explicitly left unspecified');
  assert.match(doc, /ask the coordinator/i, 'the worker is told to ask, not guess');
  assert.equal(fx.scriptedAnswer.task, 'T01');
  assert.ok(fx.scriptedAnswer.text.length > 0, 'a scripted answer line is present');
});

test('parallel: at least two independent tasks so workers run concurrently', () => {
  const { tasks } = parseProgress(getFixture('parallel').progress);
  const independent = tasks.filter((t) => t.deps.length === 0);
  assert.ok(independent.length >= 2, 'two or more tasks with no dependency');
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

    // The parallel skills a worker needs are carried locally (FINDINGS 2026-09-09).
    assert.ok(existsSync(join(dir, '.claude/skills/pir-worker/SKILL.md')), 'pir-worker carried');
    assert.ok(existsSync(join(dir, '.claude/skills/pir-coordinate/SKILL.md')), 'pir-coordinate carried');
    assert.ok(res.skills.includes('pir-worker') && res.skills.includes('pir-implement'));

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
