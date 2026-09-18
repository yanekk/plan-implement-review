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
    factIds: ['no-hello-ever', 'by-name-addressing', 'no-close-before-idle', 'one-merge-to-main'],
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
    factIds: ['no-hello-ever', 'no-close-before-idle', 'one-merge-to-main'],
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
    factIds: ['merge-conflict-resolved'],
  },
  'human-decision': {
    taskCount: 1,
    deps: { T01: [] },
    ceiling: 1,
    factIds: ['question-round-trip:T01', 'one-merge-to-main'],
  },
  'hands-on': {
    taskCount: 2,
    deps: { T01: [], T02: ['T01'] },
    ceiling: 1,
    factIds: ['verify-worker-spawned:T02', 'you-never-reviewed:T02', 'one-merge-to-main', 'ceiling-held:1', 'scribe-wrote-finding'],
  },
  'blog-app': {
    taskCount: 7,
    deps: { T01: [], T02: ['T01'], T03: ['T01'], T04: ['T01'], T05: ['T02', 'T03', 'T04'], T06: ['T05'], T07: ['T06'] },
    ceiling: 3,
    factIds: [
      'reached-width:2',
      'ceiling-held:3',
      'one-merge-to-main',
      'verify-worker-spawned:T05',
      'you-never-reviewed:T05',
      'verify-worker-spawned:T07',
      'you-never-reviewed:T07',
      'scribe-wrote-finding',
    ],
  },
  restart: {
    taskCount: 2,
    deps: { T01: [], T02: ['T01'] },
    ceiling: 1,
    factIds: ['resumed-not-rebuilt:T02', 'no-rebuild-from:T01', 'feeds-cleared', 'leftover-sessions-reaped:1', 'one-merge-to-main'],
  },
};

// --- The registry ---------------------------------------------------------------------------------

test('listFixtures returns exactly the DESIGN §4.1 fixtures', () => {
  assert.deepEqual(new Set(listFixtures()), new Set(Object.keys(EXPECT)));
  assert.equal(listFixtures().length, Object.keys(EXPECT).length);
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

test('merge-conflict: carries a task-agnostic scripted decision and the decided final content (T28)', () => {
  const fx = getFixture('merge-conflict');
  // The decision names no task — which of the two same-line tasks conflicts is a timing race, so the
  // runner routes the fixed decision to whatever task surfaces (run.mjs scriptedAnswerFor).
  assert.equal(fx.scriptedAnswer.task, undefined, 'the scripted decision names no task (the loser is a race)');
  assert.ok(/hello there/.test(fx.scriptedAnswer.text), 'the decision keeps the "hello there" side');
  assert.deepEqual(fx.finalContent, { file: 'greeting.txt', content: 'hello there' }, 'main must end with the decided side');
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

test('hands-on: T01 is an auto build and T02 is a you-verify depending on it, with a Needs-a-person block', () => {
  const fx = getFixture('hands-on');
  const { tasks } = parseProgress(fx.progress);
  const t01 = tasks.find((t) => t.num === 'T01');
  const t02 = tasks.find((t) => t.num === 'T02');
  assert.equal(t01.runs, 'auto', 'T01 is an autonomous build');
  assert.equal(t02.runs, 'you', 'T02 is a hands-on verify task');
  assert.deepEqual(t02.deps, ['T01'], 'the verify depends on the build (§2.6)');

  // The auto build's doc asks for a runnable program with its own test; the verify doc carries the
  // "Needs a person" block pir-verify step 1 reads (the command and what to report).
  const buildDoc = Object.entries(fx.tasks).find(([n]) => n.startsWith('T01-'))[1];
  const verifyDoc = Object.entries(fx.tasks).find(([n]) => n.startsWith('T02-'))[1];
  assert.match(buildDoc, /greet\.mjs/, 'T01 builds greet.mjs');
  assert.match(buildDoc, /greet\.test\.mjs/, 'T01 has its own test');
  assert.match(verifyDoc, /## Needs a person/, 'T02 carries a Needs-a-person block');
  assert.match(verifyDoc, /Needs you — I cannot see this from here/, 'in the pir-verify handover shape');
  assert.match(verifyDoc, /node greet\.mjs/, 'the block names the command to run');
  assert.match(verifyDoc, /^\*\*Runs:\*\* you$/m, 'the verify doc declares Runs: you');

  // The fixture wires the runner to capture FINDINGS.md so scribeWroteFinding can read it back.
  assert.equal(fx.finalContent.file, 'plans/hands-on/FINDINGS.md');
});

test('blog-app: T02/T03/T04 are a concurrent auto trio off T01, with two you check-ins', () => {
  const fx = getFixture('blog-app');
  const { tasks } = parseProgress(fx.progress);
  // The trio depends ONLY on T01, so all three can build at once (the fixture's whole point).
  for (const num of ['T02', 'T03', 'T04']) {
    const t = tasks.find((x) => x.num === num);
    assert.equal(t.runs, 'auto', `${num} is an autonomous build`);
    assert.deepEqual(t.deps, ['T01'], `${num} depends only on T01 so the trio runs concurrently`);
  }
  // Both check-ins are you-tasks that fold back without review (§2.6).
  for (const num of ['T05', 'T07']) {
    assert.equal(tasks.find((x) => x.num === num).runs, 'you', `${num} is a hands-on check-in`);
  }
  assert.equal(fx.finalContent.file, 'plans/blog-app/FINDINGS.md');
});

test('blog-app: T01 pins the contract and the pure core; the trio doc scope-fences package.json to T03', () => {
  const fx = getFixture('blog-app');
  const doc = (num) => Object.entries(fx.tasks).find(([n]) => n.startsWith(`${num}-`))[1];
  // T01 pins the shared contract and the stdlib pure core the parallel workers build against.
  assert.match(doc('T01'), /CONTRACT\.md/, 'T01 pins the REST contract');
  assert.match(doc('T01'), /GET\s+\/api\/posts/, 'the contract names the posts endpoint');
  assert.match(doc('T01'), /src\/core\//, 'T01 pins the stdlib pure core');
  // The file partition that lets three branches merge clean: only T03 edits package.json.
  assert.match(doc('T03'), /only trio member that edits `package\.json`/i, 'T03 owns the pg dependency');
  assert.match(doc('T02'), /do NOT edit `package\.json`/i, 'T02 does not touch package.json');
  assert.match(doc('T04'), /add no dependency/i, 'T04 adds no dependency');
  // npm test stays install-free: the e2e test is a separate script, never wired into `test`.
  assert.match(doc('T06'), /npm run e2e/, 'the e2e test is its own script');
  assert.match(doc('T06'), /do NOT.*`test` script|`test` script.*unchanged|not.*part of `npm test`/is, 'e2e is kept out of npm test');
});

test('blog-app: the worker owns bring-up/teardown; the person block is judgement only, no compose up/down (T39)', () => {
  const fx = getFixture('blog-app');
  for (const num of ['T05', 'T07']) {
    const doc = Object.entries(fx.tasks).find(([n]) => n.startsWith(`${num}-`))[1];
    assert.match(doc, /## Needs a person/, `${num} carries a Needs-a-person block`);
    assert.match(doc, /Needs you — I cannot see this from here/, `${num} uses the pir-verify handover shape`);
    assert.match(doc, /^\*\*Runs:\*\* you$/m, `${num} declares Runs: you`);
    // The worker owns the environment: bring-up + teardown live in the Environment section (DESIGN §2.6).
    assert.match(doc, /## Environment \(the worker owns this\)/, `${num} carries a worker Environment section`);
    const envHead = doc.indexOf('## Environment');
    const personHead = doc.indexOf('## Needs a person');
    const envBlock = doc.slice(envHead, personHead);
    const personBlock = doc.slice(personHead);
    assert.match(envBlock, /docker compose up --build/, `${num}: the worker brings the stack up`);
    assert.match(envBlock, /docker compose down/, `${num}: the worker tears the stack down`);
    assert.match(envBlock, /seatbelt/, `${num}: teardown named as the seatbelt`);
    // The person block is judgement only — no environment up/down chore ever appears in it (T39).
    assert.doesNotMatch(personBlock, /docker compose up/, `${num}: person block has no compose up`);
    assert.doesNotMatch(personBlock, /docker compose down/, `${num}: person block has no compose down`);
    assert.match(personBlock, /Docker Desktop/, `${num}: the person is still told the Docker Desktop precondition`);
  }
});

test('blog-app: at check-in #2 the worker runs the e2e; the person block is the click-through only (T40)', () => {
  const fx = getFixture('blog-app');
  const t07 = Object.entries(fx.tasks).find(([n]) => n.startsWith('T07-'))[1];
  // DESIGN §2.6 (T40): a machine-decidable check is the worker's to run and record, not the person's.
  // The e2e install + run move into a worker-owned "Automated checks" section; the person's block is the
  // subjective click-through only. The mutation this guards is the pre-T40 shape — put the e2e run back
  // into the person's steps and both halves of this fail.
  assert.match(t07, /## Automated checks \(the worker runs these\)/, 'T07 carries a worker Automated-checks section');
  const checksHead = t07.indexOf('## Automated checks');
  const personHead = t07.indexOf('## Needs a person');
  assert.ok(checksHead !== -1 && personHead !== -1 && checksHead < personHead, 'Automated checks precede Needs a person');
  const checksBlock = t07.slice(checksHead, personHead);
  const personBlock = t07.slice(personHead);
  // The worker's section runs the e2e and says it records the machine result.
  assert.match(checksBlock, /npx playwright install/, 'the worker installs the browser driver');
  assert.match(checksBlock, /npm run e2e/, 'the worker runs the e2e test');
  assert.match(checksBlock, /machine result|records/i, 'the worker records the machine result');
  // The person's block never carries the automated test — it is the click-through judgement only.
  assert.doesNotMatch(personBlock, /npm run e2e/, 'the person is not asked to run the e2e');
  assert.doesNotMatch(personBlock, /playwright/i, 'the person is not asked to install the driver');
  assert.match(personBlock, /click through|click-through/i, "the person's block is the click-through judgement");
  // The task doc requires the two confirmations kept separate and no ambiguous reply rounded up.
  assert.match(t07, /two separate confirmations|kept separate|separately/i, 'T07 requires two separate confirmations');
  assert.match(t07, /never (merges|rounds|inflat)|ambiguous/i, 'T07 forbids merging or rounding an ambiguous reply up');
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
