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
  'live-workers-demo': {
    taskCount: 4,
    deps: { T01: [], T02: [], T03: [], T04: [] },
    ceiling: 2,
    factIds: [
      'request-answered:T01:questions',
      'request-answered:T02:permission',
      'request-answered:T03:questions',
      'ceiling-held:2',
      'handed-off-green-branch',
    ],
  },
  'real-asking': {
    taskCount: 2,
    deps: { T01: [], T02: [] },
    ceiling: 2,
    factIds: ['ceiling-held:2', 'handed-off-green-branch'],
  },
  'pir-coordinator': {
    taskCount: 2,
    deps: { T01: [], T02: [] },
    ceiling: 2,
    factIds: ['agent-answered:T01', 'reserved-to-person:T02', 'remote-only-after-pass:T02', 'ready-with-report', 'ceiling-held:2'],
  },
  'pir-coordinator-concurrent': {
    taskCount: 3,
    deps: { T01: [], T02: [], T03: [] },
    ceiling: 3,
    factIds: [
      'briefs-overlapped:T01:T02',
      'agent-answered:T01',
      'agent-answered:T02',
      'one-decision-each:T01,T02',
      'timed-out-to-person:T03',
      'statements-match-record',
      'ready-with-report:no-conflict',
      'ceiling-held:3',
    ],
  },
};

// --- The registry ---------------------------------------------------------------------------------

// The fixtures that seed no plan (pir-plan-command T17): checked on their own below, not by the loops.
const PLANLESS = ['plan-command'];

test('listFixtures returns exactly the DESIGN §4.1 fixtures, and the plan-command one', () => {
  assert.deepEqual(new Set(listFixtures()), new Set([...Object.keys(EXPECT), ...PLANLESS]));
  assert.equal(listFixtures().length, Object.keys(EXPECT).length + PLANLESS.length);
});

// declared-test-command T10: the coordinator refuses to start a plan without a valid setup/test block
// and runs its `test` lines as the end-of-run gate, so every fixture must carry one or no live run
// can start, let alone end green.
test('every fixture installs a DESIGN.md whose setup/test block parses: setup none, test npm test', () => {
  for (const id of listFixtures().filter((f) => !PLANLESS.includes(f))) {
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

test('merge-conflict: unattended — merges held, the answerer types the decided side on any question, decided final content (live-workers §2.10)', () => {
  const fx = getFixture('merge-conflict');
  // The coordinator sends the fix to the live worker, so nobody pastes: no hands-on block.
  assert.equal(fx.needsPerson, undefined, 'no person step — the fix is sent, the question answered by the stand-in');
  // Merges are held so the clash lands at the coordinator's merge, not the worker's own integrate.
  assert.equal(fx.scenario.holdMerges, true);
  // The worker's question wording cannot be known, so the answer is typed on any question.
  assert.match(fx.scenario.answerPending.typed['*'], /hello there/, 'the stand-in keeps "hello there"');
  // Both task docs make the side a judgement to ask about, so the worker asks rather than picks.
  for (const doc of Object.values(fx.tasks)) assert.match(doc, /ask the person which greeting to keep/);
  assert.ok(fx.scenario.seatbelts.timeoutMs <= 20 * 60 * 1000, 'an unattended budget, not a human-speed one');
  assert.notEqual(fx.scenario.expectedTerminal, 'parked', 'the run completes; it is not a designed forever-park');
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

test('live-workers-demo: T01 must ask through AskUserQuestion; T02 runs the exact command the seeded settings mark ask', () => {
  const fx = getFixture('live-workers-demo');
  assert.deepEqual(fx.scenario.answerPending, {
    typed: { 'What name should name.txt hold? Type your own.': 'Typed by the harness' },
    say: { T04: 'go' },
    afterWake: {},
    permissions: {},
    personDelayMs: 0,
  });
  assert.match(fx.tasks['T04-background.md'], /wait for the person's go/);
  assert.match(fx.tasks['T03-extras.md'], /multiSelect true/);
  assert.match(fx.tasks['T04-background.md'], /run_in_background: true[\s\S]*Monitor tool/);
  assert.match(fx.tasks['T01-greeting.md'], /AskUserQuestion tool/);
  // A 90 s pause first, so the person can interrupt a busy worker.
  assert.match(fx.tasks['T01-greeting.md'], /run exactly `node -e "setTimeout\(\(\) => \{\}, 90000\)"`/);
  const settings = JSON.parse(fx.seedFiles['.claude/settings.json']);
  assert.deepEqual(settings.permissions.ask, ['Bash(touch approved.txt)']);
  assert.match(fx.tasks['T02-approval.md'], /running exactly `touch approved\.txt`/);
  // Committed with the seed, so every task worktree loads it.
  assert.ok(fixtureFiles(fx)['.claude/settings.json']);
});

test('real-asking: T01 reports, works on and only then asks in plain text; T02 is woken while asking and answered by the harness', () => {
  const fx = getFixture('real-asking');
  assert.deepEqual(fx.scenario.answerPending, { typed: {}, say: {}, afterWake: { T02: 'blue' }, permissions: {}, personDelayMs: 0 });
  assert.equal(fx.scenario.statusSnapshots, true, 'the coordinator writes status.json so the row history is captured');
  assert.equal(fx.scenario.seatbelts.timeoutMs, 15 * 60 * 1000);
  const t01 = fx.tasks['T01-greeting.md'];
  assert.match(t01, /\(1\) drop a `question` report[\s\S]*\(2\) keep working[\s\S]*run exactly `node -e "setTimeout\(\(\) => \{\}, 30000\)"`[\s\S]*\(3\) only then ask the person, in plain text/);
  assert.match(t01, /NOT the\s+AskUserQuestion tool/);
  const t02 = fx.tasks['T02-colour.md'];
  assert.match(t02, /run_in_background: true\*\*, start exactly `node -e "setTimeout\(\(\) => \{\}, 60000\)"`/);
  assert.match(t02, /not the person's answer/);
  assert.doesNotMatch(t02, /`sleep/);
});

test('pir-coordinator: the agent runs, the push is reserved and denied, main moves after T01, the ready branch is merged (T09)', () => {
  const fx = getFixture('pir-coordinator');
  const sc = fx.scenario;
  assert.equal(sc.coordinator, true);
  assert.equal(sc.statusSnapshots, true, 'the answerer reads who holds an item from status.json');
  assert.equal(sc.seatbelts.timeoutMs, 20 * 60 * 1000);
  assert.deepEqual(sc.answerPending.permissions, { T02: 'deny' });
  assert.equal(sc.mainCommit.after, 'T01');
  assert.equal(sc.mergeWhenReady, true);
  const files = fixtureFiles(fx);
  assert.deepEqual(JSON.parse(files['.claude/settings.json']), { permissions: { ask: ['Bash(git push:*)'] } });
  assert.match(files['.claude/pir-coordinator.md'], /Pass questions about the public API to the person/);
  const design = files[`plans/${fx.slug}/DESIGN.md`];
  assert.match(design, /The greeting function is named `greet`/, 'DESIGN answers T01\'s question');
  assert.match(design, /main's line first/, 'DESIGN settles the end-sync conflict');
  // T01 changes the line the main commit changes differently, so the end sync conflicts.
  assert.equal(files['notes.txt'], 'status: seeded\n');
  assert.match(fx.tasks['T01-greeting.md'], /from `status: seeded` to `status: greeting added`/);
  assert.notEqual(sc.mainCommit.files['notes.txt'], 'status: greeting added\n');
  assert.match(fx.tasks['T01-greeting.md'], /\*\*AskUserQuestion\s+tool\*\*/);
  const t02 = fx.tasks['T02-version.md'];
  assert.match(t02, /Run exactly `git push origin HEAD`/);
  assert.match(t02, /NOT the\s+AskUserQuestion tool/);
});

test('pir-coordinator-concurrent: three askers at once, a 3-minute hold, the rules hold T03, the person waits a minute (T14)', () => {
  const fx = getFixture('pir-coordinator-concurrent');
  const sc = fx.scenario;
  assert.equal(sc.coordinator, true);
  assert.equal(sc.statusSnapshots, true);
  assert.equal(sc.coordinatorHoldMs, 180000);
  assert.equal(sc.answerPending.personDelayMs, 60000);
  assert.equal(sc.seatbelts.timeoutMs, 20 * 60 * 1000);
  assert.equal(sc.mainCommit, null, 'main does not move: no end-sync conflict');
  assert.equal(sc.mergeWhenReady, true);
  const files = fixtureFiles(fx);
  assert.match(files['.claude/pir-coordinator.md'], /release date, write no decision and do not pass them on; wait/);
  const design = files[`plans/${fx.slug}/DESIGN.md`];
  assert.match(design, /greeting function is named `greet`/);
  assert.match(design, /farewell function is named `farewell`/);
  assert.match(design, /release date .* is deliberately \*\*not\*\* decided/s);
  for (const name of ['T01-greeting.md', 'T02-farewell.md', 'T03-release.md']) {
    assert.match(fx.tasks[name], /FIRST action.*\*\*AskUserQuestion tool\*\*/s, name);
  }
  // Different questions, so the agent decides two items, not one twice.
  assert.notEqual(/"([^"]+)"/.exec(fx.tasks['T01-greeting.md'])[1], /"([^"]+)"/.exec(fx.tasks['T02-farewell.md'])[1]);
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

// live-workers T16: the carried src/shell imports the Agent SDK (worker-proc.mjs) and pi-tui, and the
// scratch has no install of its own, so installFixture links the source repo's node_modules in. Without it
// every live harness run dies at import. The link is gitignored, so the seed stays clean and deterministic.
test('a scratch repo from installFixture imports the SDK and pi-tui from its carried src/shell/', () => {
  const dir = tmp('pir-fix-modules-');
  try {
    const res = installFixture('single', { into: dir });
    assert.equal(res.modules, true, 'node_modules was linked in');
    const out = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "const w = await import('./src/shell/worker-proc.mjs'); await import('./src/shell/coordinate.mjs'); await import('./src/shell/pir-tui.mjs'); console.log(typeof w.startWorker);",
      ],
      { cwd: dir, encoding: 'utf8' },
    );
    assert.equal(out.trim(), 'function');
    assert.equal(git(dir, ['status', '--porcelain']).trim(), '', 'the node_modules link is not a change');
    assert.doesNotMatch(git(dir, ['ls-files']), /node_modules/, 'the link is never committed');
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

// --- plan-command: a repo with no plan (pir-plan-command T17) -------------------------------------

test('plan-command: a plan scenario with the §5.2 seatbelts and the plan-command facts', () => {
  const fx = getFixture('plan-command');
  const s = fx.scenario;
  assert.equal(s.kind, 'plan');
  assert.equal(s.fixture, 'plan-command');
  assert.equal(s.seatbelts.ceiling, 2);
  assert.equal(s.seatbelts.timeoutMs, 90 * 60_000);
  assert.equal(s.replyCap, 40);
  assert.equal(s.reply, 'Yes. Go with your recommendation, and keep it as small as possible.');
  assert.match(fx.brief, /^Add a slugify\(text\) function to src\/slug\.mjs: .*at most three tasks\.$/);
  assert.deepEqual(
    s.facts.map((f) => f.id),
    ['plan-reviewed-on-branch', 'every-task-done', 'handed-off-green-branch', 'main-untouched', 'index-row-is-work'],
  );
  assert.ok(!Object.keys(fixtureFiles(fx)).some((p) => p.startsWith('plans/')), 'no plan is laid down');
});

test('plan-command installs a scratch repo with no plans/, the skills but not src/ carried, and a green npm test', () => {
  const dir = tmp('pir-fix-plan-command-');
  try {
    const res = installFixture('plan-command', { into: dir });
    assert.equal(res.source, false, 'the engine runs from the harness checkout, not a copy');
    assert.equal(existsSync(join(dir, 'plans')), false, 'no plans/');
    assert.ok(existsSync(join(dir, 'src/slug.mjs')));
    assert.equal(existsSync(join(dir, 'src/shell')), false, 'the framework is not carried into src/');
    assert.ok(existsSync(join(dir, '.claude/skills/pir-plan/SKILL.md')), 'the planning skills are carried');
    assert.equal(git(dir, ['status', '--porcelain']).trim(), '', 'the seeded tree is clean');
    assert.equal(git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']).trim(), 'main');
    // NODE_TEST_CONTEXT is this runner's: a child `node --test` that inherits it reports to us, not to stdout.
    const { NODE_TEST_CONTEXT, ...env } = process.env;
    const out = execFileSync('npm', ['test'], { cwd: dir, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.match(out, /pass 1/);
    assert.match(out, /fail 0/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
