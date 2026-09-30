// The planning rig (T10): a scratch repo, a scratch home and the fake `claude` first on PATH, with the
// real `pir` screen driven through a pseudo-terminal. No test here runs the real `claude` or writes the
// person's real `~/.pir`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { startPlanRig, scriptSet, SCRIPT_SETS, PLAN_RIG_SLUG, PLAN_RIG_SLUG_2, PLAN_RIG_QUESTION } from './plan-rig.mjs';
import { PLANNER_MATCH, REVIEWER_MATCH } from './fake/sessions.mjs';
import { indexDir, listRecords, writeRecord } from './index-store.mjs';
import { dropPersonInput } from './person-inbox.mjs';
import { git, LABEL, SIZES, esc, until, startRigPlan, RIGHT, LEFT, ENTER } from './plan-rig-helpers.mjs';

const inside = (path, dir) => realpathSync(path).startsWith(realpathSync(dir) + '/');

test('startPlanRig builds a scratch repo on main with one commit, and cleanup removes it and its worktrees', (t) => {
  const rig = startPlanRig();
  t.after(() => rig.cleanup());
  assert.equal(git(rig.repoDir, 'branch', '--show-current'), 'main');
  assert.equal(git(rig.repoDir, 'rev-list', '--count', 'HEAD'), '1');
  assert.deepEqual(git(rig.repoDir, 'ls-files').split('\n').sort(), ['README.md', 'package.json']);
  assert.equal(JSON.parse(readFileSync(join(rig.repoDir, 'package.json'), 'utf8')).scripts.test, 'node -e 0');
  assert.equal(git(rig.repoDir, 'status', '--porcelain'), '');

  // A worktree a run would add, where a run adds it; cleanup must take it too.
  const wt = join(rig.repoDir, '.claude', 'worktrees', 'pir-plan-abcd');
  git(rig.repoDir, 'worktree', 'add', '-q', '-b', 'pir/plan-abcd', wt);
  assert.equal(git(rig.repoDir, 'status', '--porcelain'), '', 'the worktree folder does not dirty main');
  rig.cleanup();
  assert.ok(!existsSync(rig.root));
  assert.ok(!existsSync(wt));
  rig.cleanup(); // idempotent
});

test('startPlanRig into a folder builds there and refuses a non-empty one; keep leaves it', (t) => {
  const into = mkdtempSync(join(tmpdir(), 'pir-plan-rig-into-'));
  t.after(() => rmSync(into, { recursive: true, force: true }));
  const rig = startPlanRig({ into, keep: true });
  assert.equal(rig.root, into);
  rig.cleanup();
  assert.ok(existsSync(rig.repoDir), 'keep leaves the scratch folder');
  assert.throws(() => startPlanRig({ into }), /not empty/);
});

test("the rig's env puts the shim first on PATH and every home in the scratch folder", (t) => {
  const rig = startPlanRig({ baseEnv: { ...process.env, PARALLEL_ALLOW_HERE: '1', PIR_FAKE_CLAUDE_SCRIPT: '/x' } });
  t.after(() => rig.cleanup());
  const claude = execFileSync('/bin/sh', ['-c', 'command -v claude'], { env: rig.env, encoding: 'utf8' }).trim();
  assert.equal(claude, join(rig.shimDir, 'claude'), 'resolveClaudePath finds the fake, never the real claude');
  assert.match(readFileSync(claude, 'utf8'), /pir fake claude/);
  assert.ok(inside(rig.env.PIR_HOME, rig.root) && inside(rig.env.HOME, rig.root));
  assert.notEqual(realpathSync(rig.env.HOME), realpathSync(homedir()));
  assert.equal(rig.env.PIR_REPOS, rig.root, "the box's scan lists the rig's repo and nothing of the person's");
  assert.equal(rig.env.PARALLEL_ALLOW_HERE, undefined);
  assert.equal(rig.env.PIR_FAKE_CLAUDE_SCRIPT, undefined);
  // The scratch home's identity lets git commit there.
  assert.equal(execFileSync('git', ['config', 'user.email'], { cwd: rig.repoDir, env: rig.env, encoding: 'utf8' }).trim(), 'rig@pir.invalid');
});

test('every script set routes the planner, the reviewer and both worker phases', () => {
  for (const name of SCRIPT_SETS) {
    const entries = scriptSet(name);
    const pick = (opening) => entries.find((e) => new RegExp(e.match).test(opening));
    assert.ok(pick(`${PLANNER_MATCH} and plan`), name);
    assert.ok(pick(`${REVIEWER_MATCH} and review`), name);
    assert.ok(pick('carry out exactly this instruction and nothing else: pir-implement T01'), name);
    assert.ok(pick('carry out exactly this instruction and nothing else: pir-review T01'), name);
  }
  const planner = (name) => scriptSet(name)[0].script;
  assert.ok(planner('no-plan').some((s) => s.sh?.includes('kind=no-plan')));
  const crash = planner('crash-planner');
  const exitAt = crash.findIndex((s) => 'exit' in s);
  assert.ok(exitAt > 0 && crash[exitAt + 1].sh.includes('kind=planned'), 'the crash falls between the commit and the report');
  const taken = planner('taken-slug');
  assert.ok(taken.some((s) => s.sh?.includes(`kind=planned plan=${PLAN_RIG_SLUG_2}`)));
  assert.ok(JSON.stringify(scriptSet('taken-slug')[1].script).includes(PLAN_RIG_SLUG_2));
  assert.throws(() => scriptSet('nope'), /unknown script set/);
});

test("the taken-slug set takes the planner's slug by its branch and leaves main at one commit", (t) => {
  const rig = startPlanRig({ scripts: 'taken-slug' });
  t.after(() => rig.cleanup());
  assert.equal(git(rig.repoDir, 'branch', '--list', `pir/${PLAN_RIG_SLUG}`).replace(/^[* ]+/, ''), `pir/${PLAN_RIG_SLUG}`);
  assert.equal(git(rig.repoDir, 'rev-list', '--count', 'main'), '1');
  assert.equal(rig.slug, PLAN_RIG_SLUG_2);
});

test('end to end at 80×24: bare `pir` under the rig opens on the empty-runs line, touching no real index', async (t) => {
  const rig = startPlanRig();
  t.after(() => rig.cleanup());
  const { screens, overflows } = await rig.driveScreen({ cols: 80, rows: 24, first: /No runs yet/ });
  const text = screens[0].rows.join('\n');
  assert.match(text, /No runs yet/);
  assert.equal(overflows, 0);
  // Nothing was started, so the shim was never run. The real ~/.pir is not compared before and after:
  // a live run on this machine may write it meanwhile. The env test above holds the index in the rig.
  assert.ok(!existsSync(rig.received));
});

// The empty-runs line alone does not prove the rig's PIR_HOME reached pir: on a machine whose real ~/.pir
// is empty it would pass with the env dropped. A run written into the rig's own index must show.
test("end to end at 80×24: a run in the rig's own index is what `pir` lists", async (t) => {
  const rig = startPlanRig();
  t.after(() => rig.cleanup());
  const slug = 'rig-seeded-run';
  writeRecord(
    { version: 1, slug, repo: 'repo', repoPath: rig.repoDir, controlDir: join(rig.root, 'control'), pid: 2147483646,
      startTime: 'Sat Sep 26 12:00:00 2026', startedAt: null, branch: `pir/${slug}`, finalState: null, updatedAt: null },
    { dir: indexDir({ env: rig.env }) },
  );
  const { screens } = await rig.driveScreen({ cols: 80, rows: 24, first: new RegExp(slug) });
  const text = screens[0].rows.join('\n');
  assert.match(text, new RegExp(slug));
  assert.doesNotMatch(text, /No runs yet/);
});

// ---- T11: planning runs on the dashboard, end to end (DESIGN §2.10, §2.14). ----

test('end to end: a planning run whose planner asks lists as asking you with its label, then as your go once planned and reviewed', async (t) => {
  const { rig, dir, started, request } = await startRigPlan(t);
  const planning = new RegExp(`"${esc(LABEL)}" +plan +● asking you +repo +plan … +1`);
  for (const [cols, rows] of SIZES) {
    const { screens, overflows } = await rig.driveScreen({ cols, rows, first: planning });
    const text = screens[0].rows.join('\n');
    assert.match(text, /SLUG +TYPE +STATE +REPO +PROGRESS +WK/, `${cols}×${rows}`);
    assert.match(text, /1 run · 0 running · 0 finished · 0 crashed · 1 waiting for you/, 'the planner asking counts as waiting');
    assert.match(text, /Ctrl\+R resume/);
    assert.equal(overflows, 0, `${cols}×${rows}: nothing wraps`);
  }

  // Answer the planner's question as the conversation view would; the fake plans, the reviewer reviews.
  const workers = JSON.parse(readFileSync(join(started.controlDir, 'workers.json'), 'utf8'));
  const dropped = dropPersonInput(started.controlDir, { to: workers[0].id, kind: 'answers', requestId: request.requestId, answers: { [PLAN_RIG_QUESTION]: 'Small' } }, { coordinatorAlive: true });
  assert.deepEqual(dropped, { ok: true });
  await until(() => listRecords({ dir }).find((r) => r.slug === PLAN_RIG_SLUG && r.finalState === 'finished'), 'the reviewed run finished', 30000);

  const yourGo = new RegExp(`${PLAN_RIG_SLUG} +plan +● your go +repo +plan ✓ review ✓`);
  for (const [cols, rows] of SIZES) {
    const { screens, overflows } = await rig.driveScreen({ cols, rows, first: yourGo });
    const text = screens[0].rows.join('\n');
    assert.match(text, /1 run · 0 running · 0 finished · 0 crashed · 1 waiting for you/, `${cols}×${rows}`);
    assert.doesNotMatch(text, /"/, 'the label is gone once the run has its slug');
    assert.equal(overflows, 0);
  }
});

test('end to end: Ctrl+S Ctrl+S stops a planning run mid-planner, and Ctrl+R Ctrl+R brings the row back to planning', async (t) => {
  const { rig, dir, started } = await startRigPlan(t);
  const screen = rig.openScreen({ cols: 80, rows: 24 });
  try {
    await screen.waitFor(new RegExp(`"${esc(LABEL)}" +plan +● asking you`));
    screen.send('\x13');
    await screen.waitFor(/⚠ Ctrl\+S again to stop/);
    screen.send('\x13');
    await screen.waitFor(new RegExp(`"${esc(LABEL)}" +plan +◼ stopped`), 20000);
    assert.equal(listRecords({ dir }).find((r) => r.slug === started.runId).finalState, 'stopped');

    screen.send('\x12');
    await screen.waitFor(new RegExp(`⚠ Ctrl\\+R again to resume "${esc(LABEL)}"`));
    screen.send('\x12');
    await screen.waitFor(new RegExp(`"${esc(LABEL)}" +plan +● (planning|asking you) +repo +plan …`), 20000);
    const record = listRecords({ dir }).find((r) => r.slug === started.runId);
    assert.equal(record.finalState, null, 'the resumed run is live again');
    assert.notEqual(record.pid, started.pid, 'a new planning program');
    assert.equal(screen.overflows(), 0);
  } finally {
    await screen.close();
  }
});

// ---- T12: the steps view, the go, and the build it starts, end to end (DESIGN §2.8, §2.11). ----

test('end to end: opening a planning run shows its steps — plan asking, review and build pending', async (t) => {
  const { rig } = await startRigPlan(t);
  for (const [cols, rows] of SIZES) {
    const { screens, overflows } = await rig.driveScreen({
      cols, rows, first: /● asking you/,
      keys: [{ keys: ENTER, until: /pick a step/ }],
    });
    const text = screens.at(-1).rows.join('\n');
    assert.match(text, new RegExp(`"${esc(LABEL)}" · planning · pir/plan-[0-9a-f]{4}`), `${cols}×${rows}`);
    assert.match(text, /▎ ● plan +planner +asking you · a question +\d+:\d\d/);
    assert.match(text, /○ review +reviewer +starts when the plan is written/);
    assert.match(text, /○ build +— +asks your go after review/);
    assert.match(text, /● plan — asking you; open it \(→\) to answer/);
    assert.equal(overflows, 0, `${cols}×${rows}: nothing wraps`);
  }
});

// Drives one screen from the steps view through the planner's question to the go, at the given size.
async function toTheGo(rig, screen) {
  await screen.waitFor(/● asking you/);
  screen.send(ENTER);
  await screen.waitFor(/▎ ● plan +planner +asking you/);
  screen.send(RIGHT);
  await screen.waitFor(new RegExp(esc(PLAN_RIG_QUESTION)));
  screen.send(ENTER); // the first option is selected: answer it
  await screen.waitFor(new RegExp(`plan ${PLAN_RIG_SLUG} is committed`), 30000);
  screen.send(LEFT);
  // The rename moved the run's key under the open view; the steps view is still this run.
  const rows = await screen.waitFor(/Start the parallel build now\?/, 30000);
  return rows.join('\n');
}

test('end to end at 80×24: → answers the planner, ← is the steps view, the go question; n declines it', async (t) => {
  const { rig, dir } = await startRigPlan(t);
  const screen = rig.openScreen({ cols: 80, rows: 24 });
  try {
    const go = await toTheGo(rig, screen);
    assert.match(go, new RegExp(`${PLAN_RIG_SLUG} · reviewed · pir/${PLAN_RIG_SLUG}`));
    assert.match(go, /✔ plan +planner +plan written/);
    assert.match(go, /✔ review +reviewer +reviewed/);
    assert.match(go, /● build +— +waiting for your go/);
    assert.match(go, /1 task, longest chain 1, up to 1 can run at once\./);
    assert.match(go, /↵ start · n not now/);

    screen.send('n');
    const after = (await screen.waitFor(/Build it with/)).join('\n');
    assert.match(after, new RegExp(`${PLAN_RIG_SLUG} · finished`));
    assert.match(after, new RegExp(`Build it with: pir start ${PLAN_RIG_SLUG}`));
    assert.doesNotMatch(after, /Start the parallel build/);
    assert.equal(listRecords({ dir }).find((r) => r.slug === PLAN_RIG_SLUG).go, 'declined');

    screen.send(LEFT);
    await screen.waitFor(new RegExp(`${PLAN_RIG_SLUG} +plan +◌ finished`));
    assert.equal(screen.overflows(), 0);
  } finally {
    await screen.close();
  }
});

test('end to end at 120×40: ↵ on the go starts the build on the same row, which ends green with main unchanged', async (t) => {
  const { rig, dir } = await startRigPlan(t);
  const mainBefore = git(rig.repoDir, 'rev-parse', 'main');
  const screen = rig.openScreen({ cols: 120, rows: 40 });
  try {
    await toTheGo(rig, screen);
    screen.send(ENTER);
    // The build's view, with the fake plan's task on it. The fake task is worked on for a moment only and
    // can be done between two polls of the screen, so its row is waited for in any state, merged included
    // (FINDINGS 2026-09-26: requiring a running state failed about half the runs).
    await until(() => /T01 +first-task +/.test(screen.text()), "the fake plan's task on the build's view", 30000);
    const record = listRecords({ dir }).find((r) => r.slug === PLAN_RIG_SLUG);
    assert.equal(record.kind, 'work', 'the row flipped from plan to work');
    // With the agent on the run settles `ready to merge` and the next pass hands over to the finisher
    // (finisher T05). That pass is one pass gap (250 ms) later (fast-tests DESIGN §2.3), inside the screen's
    // 500 ms refresh, so the end waited for is the finisher's row, not the `ready to merge` frame.
    const done = (await screen.waitFor(/◆ finisher +preparing/, 90000)).join('\n');
    assert.match(done, /T01 +first-task +merged/);
    assert.doesNotMatch(done, /git merge/, 'no merge line beside the finisher');
    assert.equal(git(rig.repoDir, 'rev-parse', 'main'), mainBefore, 'main is untouched');
    // With the agent on (the default), the finisher starts only once the delivery report is committed on
    // the feature branch (pir-coordinator T05): the fake agent's sections, the rendered decisions, the footer.
    const report = git(rig.repoDir, 'show', `pir/${PLAN_RIG_SLUG}:plans/${PLAN_RIG_SLUG}/REPORT.md`);
    assert.match(report, /## What was delivered\n\nThe fake plan's one task\./);
    assert.match(report, /## Decisions made for you\n\nNone\./);
    assert.match(report, /## Branch\n\nSynced with `main` at `[0-9a-f]{12}`/);
    assert.match(report, /Tests: green\./);
    screen.send(LEFT);
    await screen.waitFor(new RegExp(`${PLAN_RIG_SLUG} +work +`));
    assert.equal(screen.overflows(), 0);
  } finally {
    await screen.close();
  }
});
