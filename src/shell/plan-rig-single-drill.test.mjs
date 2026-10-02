// The single-run drill, the parts that are not walked once per size (single-runs T11, DESIGN §2.8, §2.11):
// a single run on the list beside a planning run and builds, at every size on one run; and a stop while
// pir's own tests run, then a resume. The walk from the box to `merged`, the dropped run and the taken name
// are in plan-rig-single-drill-helpers.mjs, one file per size. The seatbelts are the planning rig's.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SINGLE_RED_FILE } from './fake/sessions.mjs';
import { startPlanRun } from './launch.mjs';
import { startSingle, SINGLE_RIG_NAME } from './plan-rig.mjs';
import { BRIEF, CTRL_S, ENTER, LEFT, SIZES, ndjson, rigWithTeardown, seedRuns } from './plan-rig-helpers.mjs';

const SKIP_T07 = "skip: T07 — waits for the old 'ready to merge' row, which a single run no longer reaches since single-finisher T05; T07 re-enables it";

const PROMPT = 'Fix the typo in the README\n\nand nothing else';
const CTRL_R = '\x12';
// A machine busy with the other test files stretches every wait.
const SLOW = 60000;
// 60×20 is narrower than the list's columns: without a single run the frame cuts the list after REPO;
// beside one SLUG gives way to SLUG_MIN (pir-tui.mjs listColumns) and every column is drawn.
const DRILL_SIZES = [...SIZES, [60, 20]];

test('end to end at 80×24, 120×40 and 60×20: a planning run and two builds beside a single run read as they did, and both rows that want the person count', { timeout: 180000, skip: SKIP_T07 }, async (t) => {
  const rig = rigWithTeardown(t, { scripts: 'single-happy' });
  seedRuns(rig, 2);
  const screens = DRILL_SIZES.map(([cols, rows]) => ({ size: `${cols}×${rows}`, wide: cols >= 80, screen: rig.openScreen({ cols, rows }) }));
  // pattern(wide) → the regex at a size: below 80 columns, with no single run, the frame cuts the list after REPO.
  const all = (pattern, limit = SLOW) => Promise.all(screens.map(async ({ size, wide, screen }) => {
    try {
      return { wide, text: (await screen.waitFor(pattern(wide), limit)).join('\n') };
    } catch (err) {
      throw new Error(`${size}: ${err.message}`);
    }
  }));
  // The rows as the planning and build tests read them; the label is cut where SLUG ends at each size.
  const planRow = (wide) => new RegExp(`^[▎ ] "Add dark .*…"? +plan +● asking you +repo${wide ? ' +plan …' : '$'}`, 'm');
  const workRow = (n, wide) => new RegExp(`^[▎ ] rig-run-${n} +work +◌ finished +repo${wide ? ' +▱▱▱▱▱▱▱▱ 0' : '$'}`, 'm');
  const singleRow = (wide) => new RegExp(`^[▎ ] ${SINGLE_RIG_NAME} +single +● ready to merge +repo${wide ? ' +build ✓ re' : '$'}`, 'm');
  try {
    await all(() => /rig-run-1/);
    assert.equal(startPlanRun(BRIEF, { cwd: rig.repoDir, env: rig.env }).started, true);
    const before = await all(planRow);
    for (const { wide, text } of before) {
      assert.match(text, workRow(0, wide));
      assert.match(text, workRow(1, wide));
      assert.match(text, /^3 runs · 0 running · 2 finished · 0 crashed · 1 waiting for/m);
    }
    assert.equal(startSingle(rig, PROMPT).started, true);
    // Beside a single run every size draws PROGRESS; at 60 columns the label is cut to `"Add dark …`.
    const beside = await all(() => singleRow(true));
    for (const { text } of beside) {
      assert.match(text, planRow(true));
      assert.match(text, workRow(0, true));
      assert.match(text, workRow(1, true));
      assert.match(text, /^4 runs · 0 running · 2 finished · 0 crashed · 2 waiting for/m);
      assert.match(text, /^ {2}SLUG +TYPE +STATE +REPO +PROGRESS/m);
    }
    assert.deepEqual(screens.map(({ screen }) => screen.overflows()), [0, 0, 0], 'no line ran past the frame at any size');
  } finally {
    await Promise.all(screens.map(({ screen }) => screen.close()));
  }
});

test("end to end at 80×24: Ctrl+S twice while pir's tests run stops the run in its build step; Ctrl+R twice starts that test run again, without the builder, and the run ends ready", { timeout: 180000, skip: SKIP_T07 }, async (t) => {
  const rig = rigWithTeardown(t, { scripts: 'single-happy' });
  // A test line slow enough to be stopped in, through the scratch home's settings, which override the
  // repo's key by key (DESIGN §2.2).
  const settings = join(rig.home, '.pir', 'repo');
  mkdirSync(settings, { recursive: true });
  writeFileSync(join(settings, 'settings.json'), JSON.stringify({ test: [`sleep 8 && test ! -f ${SINGLE_RED_FILE}`] }) + '\n');
  const screen = rig.openScreen({ cols: 80, rows: 24 });
  const twice = async (key, armed, then) => {
    screen.send(key);
    await screen.waitFor(armed, SLOW);
    screen.send(key);
    return (await screen.waitFor(then, SLOW)).join('\n');
  };
  try {
    await screen.waitFor(/No runs yet/, SLOW);
    const started = startSingle(rig, PROMPT);
    assert.equal(started.started, true);
    const testing = /single +● testing +repo +build · tests …/;
    await screen.waitFor(testing, SLOW);
    const stopped = await twice(CTRL_S, new RegExp(`Ctrl\\+S again to stop ${started.runId} now`), /single +◼ stopped +repo +build · tests …/);
    assert.match(stopped, /^1 run · 0 running · 0 finished · 0 crashed · 1 stopped$/m);
    const state = () => JSON.parse(readFileSync(join(started.controlDir, 'state.json'), 'utf8'));
    assert.deepEqual([state().step, state().running, state().outcome], ['build', 'tests', null], 'stopped with the test run in flight');

    screen.send(ENTER);
    const steps = (await screen.waitFor(/this frame is stale/, SLOW)).join('\n');
    assert.match(steps, /^▎ ✗ build +builder +stopped$/m);
    assert.match(steps, /^— stopped · this frame is stale\. Ctrl\+R Ctrl\+R on the list resumes it\.$/m);
    assert.doesNotMatch(steps, /Ctrl\+S Ctrl\+S stop this run/);
    screen.send(LEFT);
    await screen.waitFor(/SLUG/, SLOW);

    // The resume goes straight back to testing: the builder had reported, so nothing is asked of it again.
    await twice(CTRL_R, /Ctrl\+R again to resume "Fix the typo in the REA…"/, testing);
    await screen.waitFor(new RegExp(`${SINGLE_RIG_NAME} +single +● ready to merge +repo +build ✓ review ✓`), SLOW);
    const argvs = ndjson(rig.received).filter((x) => x.argv).map((x) => x.argv.join(' '));
    assert.equal(argvs.length, 2, `the builder and the reviewer, once each:\n${argvs.join('\n')}`);
    assert.ok(!argvs.some((a) => a.includes('--resume')), 'no session was reopened for a test run that passed');
    assert.ok(existsSync(join(started.record.repoPath, 'plans', SINGLE_RIG_NAME, '.parallel', 'single', 'state.json')), 'the run was renamed after the resumed tests');
    assert.equal(screen.overflows(), 0);
  } finally {
    await screen.close();
  }
});
