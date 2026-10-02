// The planning rig's single runs (single-runs T08): the five single script sets, each run to its outcome by
// the real single program with the fake builder and reviewer, and one run followed on the real `pir`
// screen. The seatbelts are the rig's: a scratch repo, a scratch home, the fake `claude` first on PATH.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { builderInstruction, reviewerInstruction, SINGLE_ID_RE } from '../core/singleflow.mjs';
import { BUILDER_MATCH, FINISHER_GO_QUESTION, PLANNER_MATCH, REVIEWER_MATCH, SINGLE_RED_FILE, SINGLE_REVIEWER_MATCH } from './fake/sessions.mjs';
import { indexDir, listRecords } from './index-store.mjs';
import { dropPersonInput } from './person-inbox.mjs';
import {
  scriptSet,
  startPlanRig,
  startSingle,
  SCRIPT_SETS,
  SINGLE_RIG_DROP_ASK,
  SINGLE_RIG_NAME,
  SINGLE_RIG_QUESTION,
  SINGLE_RIG_TAKEN,
  SINGLE_RIG_TEST_LINE,
  SINGLE_SCRIPT_SETS,
} from './plan-rig.mjs';
import { git, ndjson, rigWithTeardown, until, SIZES } from './plan-rig-helpers.mjs';
import { readSnapshot } from './snapshot-store.mjs';

const PROMPT = 'Fix the typo in the README\n\nand nothing else';
const LABEL = 'Fix the typo in the REA…';
// A whole run is two fake sessions and a few `sh` lines; the slack is for a machine busy with other tests.
const RUN_MS = 60000;

// The run's control folder under `key` (its id, or its name after the rename). The repo path is the
// record's, not the rig's: git resolves the scratch folder's symlink (/var → /private/var on macOS).
const controlOf = (started, key) => join(started.record.repoPath, 'plans', key, '.parallel', 'single');
const stateIn = (dir) => JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
const recordsOf = (rig) => listRecords({ dir: indexDir({ env: rig.env }) });
const pirTexts = (log) => log.filter((e) => e.dir === 'out' && e.from === 'pir' && e.kind === 'message').map((e) => e.text);
const buildLog = (dir) => ndjson(join(dir, 'conversations', 'build-1.ndjson'));

// A single run started in a fresh rig, as the box will start it. The teardown stops it if it still runs.
function begin(t, scripts) {
  const rig = rigWithTeardown(t, { scripts });
  const mainBefore = git(rig.repoDir, 'rev-parse', 'main');
  const started = startSingle(rig, PROMPT);
  assert.equal(started.started, true, JSON.stringify(started));
  assert.match(started.runId, SINGLE_ID_RE);
  assert.deepEqual([started.record.kind, started.record.label, started.record.baseBranch], ['single', LABEL, 'main']);
  return { rig, started, mainBefore };
}

// The run's record once its program has finished; `key` is the builder's name, or the run id of a run that
// was never renamed.
const finished = (rig, key) => until(() => recordsOf(rig).find((r) => r.slug === key && r.finalState === 'finished'), `the run ${key} finished`, RUN_MS);

// A run that reached the finisher's go (single-finisher DESIGN §2.4): renamed to the builder's name,
// reviewed, synced up to date, the finisher waiting for the person's Go, and the base still untouched.
// Returns the go question's request, which goAndFinish answers.
async function assertAtGo(rig, started, mainBefore) {
  const dir = controlOf(started, SINGLE_RIG_NAME);
  await until(() => readSnapshot(dir)?.runState?.steps?.[3]?.text === '◆ finisher  waiting for your go', 'the finisher waiting for the go', RUN_MS);
  const ask = await until(() => ndjson(join(dir, 'conversations', 'finisher-1.ndjson')).find((e) => e.dir === 'request' && e.toolName === 'AskUserQuestion'), "the finisher's go question", RUN_MS);
  const st = stateIn(dir);
  assert.deepEqual([st.id, st.name, st.step, st.outcome, st.running, st.end.tests, st.end.sync.state, st.end.finisher], [started.runId, SINGLE_RIG_NAME, 'wait', null, null, 'green', 'up-to-date', 'on']);
  assert.deepEqual(st.commands, { setup: [], test: [SINGLE_RIG_TEST_LINE] }, "the commands are the scratch repo's settings");
  assert.equal(git(rig.repoDir, 'log', '-1', '--format=%s', `pir/${SINGLE_RIG_NAME}`), 'review: a fix', 'the reviewer committed its fix');
  assert.equal(git(rig.repoDir, 'rev-parse', 'main'), mainBefore, 'main is untouched before the go');
  assert.equal(git(rig.repoDir, 'branch', '--list', `pir/${started.runId}`), '', 'the branch was renamed');
  assert.equal(existsSync(controlOf(started, started.runId)), false, 'the control folder moved');
  const snap = readSnapshot(dir);
  assert.deepEqual(snap.runState.steps.map((x) => [x.id, x.phase]), [['build', 'done'], ['review', 'done'], ['sync', 'done'], ['merge', 'finisher']]);
  return { dir, st, ask };
}

// The person's Go, answered in the finisher's conversation as the conversation view drops it; the finisher
// merges into main and the run ends `finished`.
async function goAndFinish(rig, dir, ask) {
  const finisher = JSON.parse(readFileSync(join(dir, 'finisher', 'session.json'), 'utf8')).sessionId;
  const answers = { [FINISHER_GO_QUESTION]: 'Go' };
  assert.deepEqual(dropPersonInput(dir, { to: finisher, kind: 'answers', requestId: ask.requestId, answers }, { coordinatorAlive: true }), { ok: true });
  const record = await finished(rig, SINGLE_RIG_NAME);
  assert.deepEqual([record.kind, record.branch, record.controlDir], ['single', `pir/${SINGLE_RIG_NAME}`, dir]);
  const st = stateIn(dir);
  assert.deepEqual([st.step, st.outcome], ['wait', 'finished']);
  assert.equal(git(rig.repoDir, 'merge-base', '--is-ancestor', `pir/${SINGLE_RIG_NAME}`, 'main').length, 0, 'the finisher merged the branch into main');
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'workers.json'), 'utf8')), [], 'no session is left running');
  const snap = readSnapshot(dir);
  assert.deepEqual([snap.runState.kind, snap.runState.name, snap.runState.outcome], ['single', SINGLE_RIG_NAME, 'finished']);
  assert.deepEqual(snap.runState.steps.map((x) => [x.id, x.phase]), [['build', 'done'], ['review', 'done'], ['sync', 'done'], ['merge', 'done']]);
  return { st, record };
}

// A run carried from the start to the finisher's Go and then to `finished`.
async function assertFinished(rig, started, mainBefore) {
  const { dir, st, ask } = await assertAtGo(rig, started, mainBefore);
  await goAndFinish(rig, dir, ask);
  return { dir, st };
}

// ---- The rig itself. ----

test('the scratch repo names no setup and a test line a script can turn red; single-taken takes its name by a branch', (t) => {
  const rig = startPlanRig({ scripts: 'single-taken' });
  t.after(() => rig.cleanup());
  assert.deepEqual(JSON.parse(readFileSync(join(rig.repoDir, '.pir', 'settings.json'), 'utf8')), { baseBranch: 'main', setup: [], test: [`test ! -f ${SINGLE_RED_FILE}`] });
  assert.equal(git(rig.repoDir, 'rev-parse', `pir/${SINGLE_RIG_TAKEN}`), git(rig.repoDir, 'rev-parse', 'main'));
  assert.equal(git(rig.repoDir, 'rev-list', '--count', 'main'), '1');
  const plain = startPlanRig({ scripts: 'single-happy' });
  t.after(() => plain.cleanup());
  assert.equal(git(plain.repoDir, 'branch', '--list', 'pir/*'), '', 'no other set takes a name');
});

test('every single script set routes the builder and the reviewer by their real openings, and still plans', () => {
  const at = { reportsDir: '/r/plans/single-ab12/.parallel/single/reports', base: 'main', baseSha: 'abc1234', prompt: PROMPT };
  const openings = {
    builder: builderInstruction(at),
    noted: builderInstruction({ ...at, setupNote: 'The setup step failed in this worktree before you started.' }),
    reviewer: reviewerInstruction({ ...at, name: SINGLE_RIG_NAME }),
  };
  assert.deepEqual(SINGLE_SCRIPT_SETS, ['single-happy', 'single-red', 'single-asks', 'single-dropped', 'single-taken']);
  for (const name of SINGLE_SCRIPT_SETS) {
    const entries = scriptSet(name);
    // The fake takes the first entry whose match fits the opening.
    const pick = (opening) => entries.find((e) => new RegExp(e.match).test(opening))?.match;
    assert.equal(pick(openings.builder), BUILDER_MATCH, name);
    assert.equal(pick(openings.noted), BUILDER_MATCH, `${name}: a setup note does not hide the builder`);
    assert.equal(pick(openings.reviewer), SINGLE_REVIEWER_MATCH, name);
    assert.equal(pick(`${PLANNER_MATCH} and plan`), PLANNER_MATCH, name);
    assert.equal(pick(`${REVIEWER_MATCH} and review`), REVIEWER_MATCH, name);
  }
  // The planning sets are as they were: none scripts a single run.
  for (const name of SCRIPT_SETS) assert.ok(!scriptSet(name).some((e) => e.match === BUILDER_MATCH), name);
  assert.throws(() => scriptSet('single-nope'), /unknown script set "single-nope" \(.*single-happy, single-red/);
});

// ---- Each script set, run to its outcome by the real program, without the screen. ----

test('single-happy: the builder commits and names the run, the reviewer commits a fix, main untouched until the person\'s Go, and the finisher\'s merge ends it finished', async (t) => {
  const { rig, started, mainBefore } = begin(t, 'single-happy');
  const { dir, st } = await assertFinished(rig, started, mainBefore);
  assert.deepEqual(st.rounds, { build: 0, review: 0 });
  assert.equal(st.baseline, null, 'a green run never tests the starting point');
  assert.equal(git(rig.repoDir, 'rev-list', '--count', `${mainBefore}..pir/${SINGLE_RIG_NAME}`), '2', "the builder's commit and the reviewer's");
  // Each session got its real opening, and the fake found the reports folder in it.
  const reports = join(started.controlDir, 'reports');
  assert.deepEqual(pirTexts(buildLog(dir)), [builderInstruction({ reportsDir: reports, base: 'main', baseSha: mainBefore, prompt: PROMPT })]);
  assert.deepEqual(pirTexts(ndjson(join(dir, 'conversations', 'review-1.ndjson'))), [
    reviewerInstruction({ reportsDir: join(dir, 'reports'), name: SINGLE_RIG_NAME, base: 'main', baseSha: mainBefore, prompt: PROMPT }),
  ]);
  // Only the fake was ever started: three sessions, all through the shim, and no sync helper for a base
  // that never moved.
  const argvs = ndjson(rig.received).filter((x) => x.argv).map((x) => x.argv.join(' '));
  assert.equal(argvs.length, 3);
  assert.ok(argvs[0].includes(`repo / ${started.runId} / single / builder`), argvs[0]);
  assert.ok(argvs[1].includes(`repo / ${SINGLE_RIG_NAME} / single / reviewer`), argvs[1]);
  assert.ok(argvs[2].includes(`repo / ${SINGLE_RIG_NAME} / single / finisher`), argvs[2]);
});

test("single-red: the test line fails on the builder's first commit and passes on its second; one red round, the starting point green", async (t) => {
  const { rig, started, mainBefore } = begin(t, 'single-red');
  const { dir, st } = await assertFinished(rig, started, mainBefore);
  assert.deepEqual(st.rounds, { build: 1, review: 0 });
  assert.deepEqual([st.baseline.ok, st.baseline.half], [true, null]);
  const [, red, ...rest] = pirTexts(buildLog(dir));
  assert.deepEqual(rest, [], 'one message for one red');
  assert.match(red, new RegExp(`and they failed: test \`test ! -f ${SINGLE_RED_FILE.replace('.', '\\.')}\` exited 1\\. Round 1 of 3\\.`));
  assert.match(red, /They pass on the untouched starting point \(main [0-9a-f]{7}\), so this change broke them\./);
  assert.deepEqual(
    git(rig.repoDir, 'log', '--format=%s', `${mainBefore}..pir/${SINGLE_RIG_NAME}`).split('\n'),
    ['review: a fix', 'fix: make the tests pass', 'fix: the fake change'],
  );
  assert.equal(git(rig.repoDir, 'ls-tree', '--name-only', `pir/${SINGLE_RIG_NAME}`, SINGLE_RED_FILE), '', 'the red file is gone from the branch');
});

test('single-asks: the builder asks its question before it builds, the step reads asking, and the answer lets the run reach the go and finish', async (t) => {
  const { rig, started, mainBefore } = begin(t, 'single-asks');
  const request = await until(() => buildLog(started.controlDir).find((e) => e.dir === 'request'), "the builder's question", RUN_MS);
  assert.ok(JSON.stringify(request).includes(SINGLE_RIG_QUESTION), JSON.stringify(request));
  const step = await until(() => {
    const s = readSnapshot(started.controlDir)?.runState?.steps?.[0];
    return s?.phase === 'asking' ? s : null;
  }, 'the build step asking', RUN_MS);
  assert.equal(step.asking, 'questions');
  assert.equal(git(rig.repoDir, 'rev-parse', `pir/${started.runId}`), mainBefore, 'nothing is built before the answer');

  const [worker] = JSON.parse(readFileSync(join(started.controlDir, 'workers.json'), 'utf8'));
  const input = { to: worker.id, kind: 'answers', requestId: request.requestId, answers: { [SINGLE_RIG_QUESTION]: 'Only the first' } };
  assert.deepEqual(dropPersonInput(started.controlDir, input, { coordinatorAlive: true }), { ok: true });
  const { st } = await assertFinished(rig, started, mainBefore);
  assert.deepEqual(st.rounds, { build: 0, review: 0 });
});

test("single-dropped: the builder asks in plain words, and after the person's reply reports dropped; nothing is renamed or built", async (t) => {
  const { rig, started, mainBefore } = begin(t, 'single-dropped');
  // A session that stopped with no report in hand is asking the person (DESIGN §2.9).
  const step = await until(() => {
    const s = readSnapshot(started.controlDir)?.runState?.steps?.[0];
    return s?.phase === 'asking' ? s : null;
  }, 'the build step asking', RUN_MS);
  assert.equal(step.asking, 'question');
  assert.ok(JSON.stringify(buildLog(started.controlDir)).includes(SINGLE_RIG_DROP_ASK));
  assert.equal(stateIn(started.controlDir).outcome, null, 'not dropped before the person agrees');

  const [worker] = JSON.parse(readFileSync(join(started.controlDir, 'workers.json'), 'utf8'));
  assert.deepEqual(dropPersonInput(started.controlDir, { to: worker.id, kind: 'message', text: 'Yes, drop it.' }, { coordinatorAlive: true }), { ok: true });
  const record = await finished(rig, started.runId);
  assert.deepEqual([record.kind, record.branch, record.controlDir], ['single', `pir/${started.runId}`, started.controlDir]);
  const st = stateIn(started.controlDir);
  assert.deepEqual([st.step, st.outcome, st.name], ['build', 'dropped', null]);
  assert.equal(st.accepted.body, 'Too big for a single run: use /plan.');
  assert.equal(git(rig.repoDir, 'rev-parse', `pir/${started.runId}`), mainBefore, 'the branch is kept, with nothing on it');
  assert.equal(git(rig.repoDir, 'rev-parse', 'main'), mainBefore);
  assert.deepEqual(readSnapshot(started.controlDir).runState.steps.map((s) => s.phase), ['failed', 'pending', 'pending', 'pending']);
  assert.equal(ndjson(rig.received).filter((x) => x.argv).length, 1, 'no reviewer for a dropped run');
});

test('single-taken: pir refuses the taken name in a message, the builder names the run again, and it finishes under the second name', async (t) => {
  const { rig, started, mainBefore } = begin(t, 'single-taken');
  const { dir, st } = await assertFinished(rig, started, mainBefore);
  const [, refused, ...rest] = pirTexts(buildLog(dir));
  assert.deepEqual(rest, []);
  assert.equal(
    refused,
    `pir did not accept your \`built\` report for pir/${SINGLE_RIG_TAKEN}: The name "${SINGLE_RIG_TAKEN}" is taken: a branch pir/${SINGLE_RIG_TAKEN} already exists. Choose another name, then drop the \`built\` report again.`,
  );
  assert.deepEqual(st.rounds, { build: 0, review: 0 });
  assert.equal(git(rig.repoDir, 'rev-parse', `pir/${SINGLE_RIG_TAKEN}`), mainBefore, 'the taken branch is not touched');
});

// ---- On the real screen. ----

// The row T10 painted, at the new end (single-finisher T07, DESIGN §2.11): TYPE `single`, `ready for your
// go` while the finisher waits for the go, which counts as waiting on the person, then `finished` after the
// Go. Its states on the way there and its steps view are driven in plan-rig-single-row.test.mjs.
test('end to end: a single run started in the rig is listed by the real `pir` as a single row that reaches ready for your go, then finished', async (t) => {
  const { rig, started, mainBefore } = begin(t, 'single-happy');
  const row = new RegExp(`${SINGLE_RIG_NAME} +single +● ready for your go +repo +build ✓ review ✓ sync ✓`);
  const screen = rig.openScreen({ cols: 80, rows: 24 });
  try {
    await screen.waitFor(row, RUN_MS);
    const { dir, ask } = await assertAtGo(rig, started, mainBefore);
    for (const [cols, rows] of SIZES) {
      const { screens, overflows } = await rig.driveScreen({ cols, rows, first: row });
      assert.match(screens[0].rows.join('\n'), /1 run · 0 running · 0 finished · 0 crashed · 1 waiting for you/, `${cols}×${rows}`);
      assert.equal(overflows, 0, `${cols}×${rows}: nothing wraps`);
    }
    await goAndFinish(rig, dir, ask);
    await screen.waitFor(new RegExp(`${SINGLE_RIG_NAME} +single +◌ finished +repo +build ✓ review ✓ sync ✓ merge`), RUN_MS);
    assert.equal(screen.overflows(), 0);
  } finally {
    await screen.close();
  }
});
