// The planning rig (T10): a scratch repo, a scratch home and the fake `claude` first on PATH, with the
// real `pir` screen driven through a pseudo-terminal. No test here runs the real `claude` or writes the
// person's real `~/.pir`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { startPlanRig, scriptSet, SCRIPT_SETS, PLAN_RIG_SLUG, PLAN_RIG_SLUG_2, PLAN_RIG_QUESTION, PLAN_RIG_REVIEW_ASK, PLAN_RIG_REVIEW_COMMAND } from './plan-rig.mjs';
import { PLANNER_MATCH, REVIEWER_MATCH } from './fake/sessions.mjs';
import { resumeInstruction } from '../core/planflow.mjs';
import { indexDir, listRecords, writeRecord } from './index-store.mjs';
import { startPlanRun } from './launch.mjs';
import { dropPersonInput } from './person-inbox.mjs';
import { stopRun } from './control-run.mjs';

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
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

const BRIEF = 'Add dark mode to the blog please';
const LABEL = 'Add dark mode to the bl…';
const SIZES = [[80, 24], [120, 40]];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function until(fn, what, ms = 20000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

const ndjson = (path) => (existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

// A planning run started as `pir plan` starts it, in the rig, with the planner parked on its question.
// The test's teardown stops every run the rig's index still shows live, then removes the rig.
async function startRigPlan(t) {
  const rig = startPlanRig();
  const dir = indexDir({ env: rig.env });
  t.after(async () => {
    for (const record of listRecords({ dir })) {
      if (record.finalState === null) await stopRun(record).catch(() => {});
    }
    rig.cleanup();
  });
  const started = startPlanRun(BRIEF, { cwd: rig.repoDir, env: rig.env });
  assert.equal(started.started, true, JSON.stringify(started));
  const request = await until(() => ndjson(join(started.controlDir, 'conversations', 'plan-1.ndjson')).find((e) => e.dir === 'request'), 'the planner question');
  return { rig, dir, started, request };
}

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

const RIGHT = '\x1b[C';
const UP = '\x1b[A';
const LEFT = '\x1b[D';
const ENTER = '\r';

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
    const done = (await screen.waitFor(new RegExp(`git merge pir/${PLAN_RIG_SLUG}`), 90000)).join('\n');
    // With the agent on the end reads `ready to merge` and names the report (pir-coordinator T06).
    assert.match(done, new RegExp(`✔ ready to merge · git merge pir/${PLAN_RIG_SLUG}\\n  report: plans/${PLAN_RIG_SLUG}/REPORT\\.md`));
    assert.equal(git(rig.repoDir, 'rev-parse', 'main'), mainBefore, 'main is untouched');
    // With the agent on (the default), the merge is offered only once the delivery report is committed on
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

// ---- T13: the brief box, and where `pir plan` lands, end to end (DESIGN §2.12, §2.13). ----

const SHIFT_ENTER = '\x1b[13;2u';

// Stop every run the rig's index still shows live, then remove the rig.
function rigWithTeardown(t, opts) {
  const rig = startPlanRig(opts);
  t.after(async () => {
    for (const record of listRecords({ dir: indexDir({ env: rig.env }) })) {
      if (record.finalState === null) await stopRun(record).catch(() => {});
    }
    rig.cleanup();
  });
  return rig;
}

for (const [cols, rows] of SIZES) {
  test(`end to end at ${cols}×${rows}: \`pir plan\` → the brief box; two lines with shift+enter; enter lands in the planner's conversation`, async (t) => {
    const rig = rigWithTeardown(t);
    const screen = rig.openScreen({ cols, rows, args: ['plan'] });
    try {
      const box = (await screen.waitFor(/esc cancel/)).join('\n');
      assert.match(box, /^pir plan {2}new plan in repo/);
      assert.match(box, /What do you want to build\?/);
      assert.match(box, /↵ start planning · shift\+↵ new line · esc cancel/);
      screen.send('Add dark mode');
      screen.send(SHIFT_ENTER);
      screen.send('to the blog please');
      const typed = (await screen.waitFor(/to the blog please/)).join('\n');
      assert.match(typed, /^Add dark mode\nto the blog please$/m, 'two lines in the box');
      screen.send(ENTER);
      const conv = (await screen.waitFor(new RegExp(esc(PLAN_RIG_QUESTION)), 20000)).join('\n');
      assert.match(conv, /^plan +worker \w+ · live/m, "the planner's conversation, not the steps view");
      assert.match(conv, /pir ▸ Load the pir-plan skill/, "pir's first message");
      assert.match(conv, /^ +Add dark mode\n +to the blog please$/m, 'the brief, with its newline, inside it');
      assert.equal(screen.overflows(), 0);
    } finally {
      await screen.close();
    }
    const [record] = listRecords({ dir: indexDir({ env: rig.env }) });
    assert.equal(readFileSync(join(record.controlDir, 'brief.md'), 'utf8'), 'Add dark mode\nto the blog please');
  });
}

test("end to end at 80×24: `pir plan \"one line brief\"` lands in the planner's conversation with no box", async (t) => {
  const rig = rigWithTeardown(t);
  const screen = rig.openScreen({ cols: 80, rows: 24, args: ['plan', 'one line brief'] });
  try {
    const conv = (await screen.waitFor(new RegExp(esc(PLAN_RIG_QUESTION)), 20000)).join('\n');
    assert.match(conv, /^plan +worker \w+ · live/m);
    assert.match(conv, /one line brief/);
    assert.doesNotMatch(screen.text(), /esc cancel/);
  } finally {
    await screen.close();
  }
});

test("end to end at 120×40: still in the planner's conversation when it finishes → the reviewer's, headed by the line; ← is the steps view", async (t) => {
  const rig = rigWithTeardown(t);
  const screen = rig.openScreen({ cols: 120, rows: 40, args: ['plan', BRIEF] });
  try {
    await screen.waitFor(new RegExp(esc(PLAN_RIG_QUESTION)), 20000);
    screen.send(ENTER); // the first option is selected: answer it, and the fake planner finishes
    const conv = (await screen.waitFor(/^review +worker/m, 30000)).join('\n');
    assert.match(conv, /^the planner finished; the reviewer has started\nreview +worker \w+/, 'the line heads the view');
    assert.equal(screen.overflows(), 0);
    screen.send(LEFT);
    const steps = (await screen.waitFor(/pick a step|Start the parallel build now\?/, 30000)).join('\n');
    assert.match(steps, /  ✔ plan +planner +plan written/);
    assert.match(steps, /▎ ✔ review +reviewer/, 'the row of the conversation just left is selected');
  } finally {
    await screen.close();
  }
});

test('end to end at 80×24: `pir plan` then esc → back to the shell, exit 0, no planning branch', async (t) => {
  const rig = rigWithTeardown(t);
  const screen = rig.openScreen({ cols: 80, rows: 24, args: ['plan'] });
  await screen.waitFor(/esc cancel/);
  screen.send('half a brief');
  await screen.waitFor(/half a brief/);
  screen.send('\x1b');
  // Wait for pir to leave on its own: close() ends the pty's input, which the relay answers with SIGTERM.
  await assert.rejects(screen.waitFor(() => false, 10000), /pir exited before/);
  const code = await screen.close();
  assert.equal(code, 0);
  assert.equal(git(rig.repoDir, 'branch', '--list', 'pir/*'), '', 'no branch pir/plan-* was created');
  assert.deepEqual(listRecords({ dir: indexDir({ env: rig.env }) }), [], 'no run recorded');
  assert.ok(!existsSync(join(rig.repoDir, 'plans')), 'no plans/ folder');
});

test('end to end: `pir plan` in a repo without main → the refusal line, and no box', (t) => {
  const rig = rigWithTeardown(t);
  git(rig.repoDir, 'branch', '-m', 'main', 'trunk');
  const pir = fileURLToPath(new URL('./pir.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [pir, 'plan'], { cwd: rig.repoDir, env: rig.env, encoding: 'utf8', timeout: 10000 });
  assert.equal(r.status, 1);
  assert.equal(r.stderr, "pir plan: this repo has no local 'main' branch — a plan is cut from main\n");
  assert.doesNotMatch(r.stdout, /esc cancel|new plan in/);
});

// ---- T14: the drill (DESIGN §2.8, §2.10–§2.14, §2.16). One test per defect the drill fixed, and the
// drill paths the earlier tasks' tests did not already drive. ----

const CTRL_R = '\x12';
const CTRL_S = '\x13';

// From the list to the list again through a chord pressed twice.
async function chordTwice(screen, key, armed, then, limit = 20000) {
  screen.send(key);
  await screen.waitFor(armed);
  screen.send(key);
  return screen.waitFor(then, limit);
}

test('end to end at 120×40: the reviewer asking a permission reads `allow a command?` on the steps, and → allows it from its conversation', async (t) => {
  const rig = rigWithTeardown(t, { scripts: 'reviewer-asks' });
  const screen = rig.openScreen({ cols: 120, rows: 40, args: ['plan', BRIEF] });
  try {
    await screen.waitFor(new RegExp(esc(PLAN_RIG_QUESTION)), 20000);
    screen.send(ENTER);
    const conv = (await screen.waitFor(/review wants to use Bash/, 30000)).join('\n');
    assert.match(conv, new RegExp(`^ +${esc(PLAN_RIG_REVIEW_COMMAND)}$`, 'm'));
    assert.match(conv, /↵ allow · n refuse/);
    screen.send(LEFT);
    const steps = (await screen.waitFor(/pick a step/)).join('\n');
    assert.match(steps, new RegExp(`${PLAN_RIG_SLUG} · reviewing · pir/${PLAN_RIG_SLUG}`));
    assert.match(steps, /▎ ● review +reviewer +asking you · allow a command\? +\d+:\d\d/);
    assert.match(steps, /● review — asking you; open it \(→\) to answer/);
    screen.send(LEFT);
    await screen.waitFor(new RegExp(`${PLAN_RIG_SLUG} +plan +● asking you +repo +plan ✓ review …`));
    screen.send(ENTER);
    await screen.waitFor(/▎ ● review/);
    screen.send(RIGHT);
    await screen.waitFor(/review wants to use Bash/);
    screen.send(ENTER);
    const allowed = (await screen.waitFor(new RegExp(esc(PLAN_RIG_REVIEW_ASK)), 20000)).join('\n');
    assert.match(allowed, /→ allowed/);
    assert.equal(screen.overflows(), 0);
  } finally {
    await screen.close();
  }
});

// Defects: a resumed session's conversation opened read-only ("exited, read only") because the log holds
// the old process's exit note, so the person could not answer it; the resume message showed mid-sentence
// line breaks (user: one paragraph); a finished step showed no time (user: show it).
test('end to end at 80×24: stop mid-review, Ctrl+R Ctrl+R, and the reviewer\'s conversation is live, answerable and carries on to the go', async (t) => {
  const rig = rigWithTeardown(t, { scripts: 'reviewer-asks' });
  const screen = rig.openScreen({ cols: 80, rows: 24, args: ['plan', BRIEF] });
  try {
    await screen.waitFor(new RegExp(esc(PLAN_RIG_QUESTION)), 20000);
    screen.send(ENTER);
    await screen.waitFor(/review wants to use Bash/, 30000);
    screen.send(ENTER);
    await screen.waitFor(new RegExp(esc(PLAN_RIG_REVIEW_ASK)), 20000);
    screen.send(LEFT);
    await screen.waitFor(/pick a step/);
    screen.send(LEFT);
    await screen.waitFor(/SLUG/);
    await chordTwice(screen, CTRL_S, /Ctrl\+S again to stop/, new RegExp(`${PLAN_RIG_SLUG} +plan +◼ stopped`));
    screen.send(ENTER);
    const stopped = (await screen.waitFor(/this frame is stale/)).join('\n');
    assert.match(stopped, /▎ ✗ review +reviewer +stopped/);
    assert.match(stopped, /Ctrl\+R Ctrl\+R on the list resumes it/);
    assert.doesNotMatch(stopped, /Ctrl\+S Ctrl\+S stop this run/, 'a stopped run offers no stop');
    screen.send(LEFT);
    await screen.waitFor(/SLUG/);
    await chordTwice(screen, CTRL_R, new RegExp(`Ctrl\\+R again to resume ${PLAN_RIG_SLUG}`), new RegExp(`${PLAN_RIG_SLUG} +plan +● reviewing`));
    screen.send(ENTER);
    await screen.waitFor(/▎ \S+ review +reviewer +reviewing/);
    screen.send(RIGHT);
    const resumed = (await screen.waitFor(/· resumed[\s\S]*remote control on/, 20000)).join('\n');
    assert.match(resumed, /^review +worker \w+ · live/m, 'the resumed session is live, not read only');
    assert.match(resumed, /^pir ▸ You were stopped and have been resumed in the same worktree\. Whatever you$/m);
    assert.match(resumed, /^ {6}were doing when you stopped may not have finished: check `git status` and$/m, 'one paragraph, wrapped only by the screen');
    assert.match(resumed, /↵ send · esc interrupt/);
    screen.send('yes, the name is fine');
    screen.send(ENTER);
    await screen.waitFor(new RegExp(`Plan ${PLAN_RIG_SLUG} is reviewed`), 30000);
    screen.send(LEFT);
    const go = (await screen.waitFor(/Start the parallel build now\?/, 30000)).join('\n');
    assert.match(go, /✔ plan +planner +plan written +\d+:\d\d/, 'a finished step shows its time');
    assert.match(go, /✔ review +reviewer +reviewed +\d+:\d\d/);
    assert.equal(screen.overflows(), 0);
  } finally {
    await screen.close();
  }
  const received = ndjson(rig.received).map((e) => e.line).filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(received.some((m) => m.type === 'user' && m.message?.content === resumeInstruction()), 'the resumed session was sent the one-paragraph message');
});

// Defect: stopping the planner while its question was open logged `answered-remotely`, so the
// conversation said "answered on claude.ai" for a question nobody answered; resumed, the dead question
// was still pinned as if the new session could take its answer.
test('end to end at 120×40: a planner stopped mid-question reads never answered, not answered on claude.ai; resumed, nothing stale is pinned', async (t) => {
  const rig = rigWithTeardown(t);
  const screen = rig.openScreen({ cols: 120, rows: 40, args: ['plan', BRIEF] });
  try {
    await screen.waitFor(new RegExp(esc(PLAN_RIG_QUESTION)), 20000);
    screen.send(LEFT);
    await screen.waitFor(/pick a step/);
    screen.send(LEFT);
    await screen.waitFor(/SLUG/);
    await chordTwice(screen, CTRL_S, /Ctrl\+S again to stop/, /◼ stopped/);
    screen.send(ENTER);
    await screen.waitFor(/this frame is stale/);
    screen.send(RIGHT);
    const dead = (await screen.waitFor(/exited, read only/)).join('\n');
    assert.doesNotMatch(dead, /answered on claude\.ai/);
    assert.match(dead, /→ never answered/);
    screen.send(LEFT);
    await screen.waitFor(/this frame is stale/);
    screen.send(LEFT);
    await screen.waitFor(/SLUG/);
    await chordTwice(screen, CTRL_R, /Ctrl\+R again to resume/, /● (planning|asking you)/);
    screen.send(ENTER);
    await screen.waitFor(/pick a step/);
    screen.send(RIGHT);
    const live = (await screen.waitFor(/You were stopped/, 20000)).join('\n');
    assert.match(live, /^plan +worker \w+ · live/m);
    assert.match(live, /→ never answered/);
    assert.doesNotMatch(live, /↑↓ move · ↵ choose and send/, 'the lost question is not offered for an answer');
    assert.equal(screen.overflows(), 0);
  } finally {
    await screen.close();
  }
});

// Defect: pir's message to the planner said "drop the `planned` report again" twice.
test('end to end at 80×24: taken slug — pir tells the planner once what to do, the planner renames, and the row and steps read the new slug', async (t) => {
  const rig = rigWithTeardown(t, { scripts: 'taken-slug' });
  const screen = rig.openScreen({ cols: 80, rows: 24, args: ['plan', BRIEF] });
  try {
    await screen.waitFor(new RegExp(esc(PLAN_RIG_QUESTION)), 20000);
    screen.send(ENTER);
    await screen.waitFor(/^review +worker/m, 30000);
    screen.send(LEFT);
    await screen.waitFor(/Start the parallel build now\?/, 30000);
    screen.send(UP);
    await screen.waitFor(/▎ ✔ plan/);
    screen.send(RIGHT);
    const planner = (await screen.waitFor(/did not accept/)).join('\n').replace(/\s+/g, ' ');
    assert.match(planner, new RegExp(`The name "${PLAN_RIG_SLUG}" is taken: a branch pir/${PLAN_RIG_SLUG} already exists`));
    assert.equal((planner.match(/report again/g) ?? []).length, 1, 'said once');
    assert.match(planner, new RegExp(`The plan ${PLAN_RIG_SLUG_2} is committed`));
    screen.send(LEFT);
    const steps = (await screen.waitFor(/Start the parallel build now\?/)).join('\n');
    assert.match(steps, new RegExp(`^${PLAN_RIG_SLUG_2} · reviewed · pir/${PLAN_RIG_SLUG_2}`, 'm'));
    screen.send(LEFT);
    await screen.waitFor(new RegExp(`${PLAN_RIG_SLUG_2} +plan +● your go`));
    assert.equal(screen.overflows(), 0);
  } finally {
    await screen.close();
  }
});

// Defects: a no-plan run's review step promised it "starts when the plan is written"; the steps view of a
// finished run offered Ctrl+S Ctrl+S, which does nothing on it.
test('end to end at 120×40: no-plan — plan ✗ on the row, review not started, the branch kept, and no stop offered', async (t) => {
  const rig = rigWithTeardown(t, { scripts: 'no-plan' });
  const screen = rig.openScreen({ cols: 120, rows: 40, args: ['plan', BRIEF] });
  try {
    await screen.waitFor(/No plan, as you asked/, 20000);
    screen.send(LEFT);
    const steps = (await screen.waitFor(/the planner ended without a plan/, 20000)).join('\n');
    assert.match(steps, new RegExp(`"${esc(LABEL)}" · finished · pir/plan-[0-9a-f]{4}`));
    assert.match(steps, /✗ plan +planner +no plan/);
    assert.match(steps, /○ review +reviewer +not started/);
    assert.match(steps, /○ build +— +not started/);
    assert.match(steps, /Its branch pir\/plan-[0-9a-f]{4} is kept\./);
    assert.match(steps, /↑↓ pick a step · → open it · ← back · esc quit/);
    assert.doesNotMatch(steps, /Ctrl\+S/);
    screen.send(LEFT);
    await screen.waitFor(new RegExp(`"${esc(LABEL)}" +plan +◌ finished +repo +plan ✗`));
    assert.equal(screen.overflows(), 0);
  } finally {
    await screen.close();
  }
});

test('end to end at 80×24: crash-planner — the row reads crashed, the steps show run.log, and Ctrl+R Ctrl+R carries it to the go', async (t) => {
  const rig = rigWithTeardown(t, { scripts: 'crash-planner' });
  const screen = rig.openScreen({ cols: 80, rows: 24, args: ['plan', BRIEF] });
  try {
    await screen.waitFor(new RegExp(esc(PLAN_RIG_QUESTION)), 20000);
    screen.send(ENTER);
    await screen.waitFor(/the worker exited \(code 1\)/, 30000);
    screen.send(LEFT);
    const steps = (await screen.waitFor(/the planning program died/, 20000)).join('\n');
    assert.match(steps, /✗ plan +planner +crashed/);
    assert.match(steps, /last lines of run\.log:/);
    assert.doesNotMatch(steps, /Ctrl\+S/);
    screen.send(LEFT);
    await screen.waitFor(new RegExp(`"${esc(LABEL)}" +plan +✕ crashed`));
    await chordTwice(screen, CTRL_R, /Ctrl\+R again to resume/, new RegExp(`${PLAN_RIG_SLUG} +plan +● your go`), 30000);
    assert.equal(screen.overflows(), 0);
  } finally {
    await screen.close();
  }
});

// Defect: `pir start {slug}` while its reviewer was live said "resume its planning run (Ctrl+R)" for a
// run that was not stopped (user: open it instead).
test('end to end at 80×24: `pir start {slug}` opens the steps view while its reviewer is live; stopped, it names resume', async (t) => {
  const rig = rigWithTeardown(t, { scripts: 'reviewer-asks' });
  const planning = rig.openScreen({ cols: 80, rows: 24, args: ['plan', BRIEF] });
  try {
    await planning.waitFor(new RegExp(esc(PLAN_RIG_QUESTION)), 20000);
    planning.send(ENTER);
    await planning.waitFor(/review wants to use Bash/, 30000);
  } finally {
    await planning.close();
  }
  const { screens } = await rig.driveScreen({ cols: 80, rows: 24, args: ['start', PLAN_RIG_SLUG], first: /pick a step/ });
  const text = screens[0].rows.join('\n');
  assert.match(text, new RegExp(`${PLAN_RIG_SLUG} · reviewing · pir/${PLAN_RIG_SLUG}`));
  assert.match(text, /● review +reviewer +asking you · allow a command\?/);

  for (const record of listRecords({ dir: indexDir({ env: rig.env }) })) if (record.finalState === null) await stopRun(record);
  const pir = fileURLToPath(new URL('./pir.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [pir, 'start', PLAN_RIG_SLUG], { cwd: rig.repoDir, env: rig.env, encoding: 'utf8', timeout: 10000 });
  assert.equal(r.status, 1);
  assert.equal(r.stderr, `'${PLAN_RIG_SLUG}' is not reviewed — resume its planning run in pir (Ctrl+R)\n`);
});

test('end to end: a bare slug as the command, and `pir start` with no slug — the messages, exit 2', (t) => {
  const rig = rigWithTeardown(t);
  const pir = fileURLToPath(new URL('./pir.mjs', import.meta.url));
  const run = (...a) => spawnSync(process.execPath, [pir, ...a], { cwd: rig.repoDir, env: rig.env, encoding: 'utf8', timeout: 10000 });
  const bare = run(PLAN_RIG_SLUG);
  assert.equal(bare.status, 2);
  assert.match(bare.stderr, new RegExp(`^pir: unknown command '${PLAN_RIG_SLUG}'\\. To build a plan: pir start ${PLAN_RIG_SLUG}\\nusage: pir `));
  const none = run('start');
  assert.equal(none.status, 2);
  assert.match(none.stderr, /^usage: pir {20}the dashboard\n {7}pir plan \["brief"\] {5}plan something new\n {7}pir start \{slug\} {7}build a reviewed plan\n {7}pir notify \[test\|off\] {2}phone alerts: set up, test, turn off\n/);
});

// ---- dashboard-plan-box T05: the new-plan box on the runs list starts a planning run (DESIGN §2.3–§2.5). ----

const TAB = '\t';

for (const [cols, rows] of SIZES) {
  test(`end to end at ${cols}×${rows}: \`pir\` → bare box → @re lists @repo; Tab; a brief; Enter lands in the planner's conversation`, async (t) => {
    const rig = rigWithTeardown(t);
    const screen = rig.openScreen({ cols, rows });
    try {
      const bare = (await screen.waitFor(/new plan {2}start with @repo/)).join('\n');
      assert.match(bare, /No runs yet — type after @ below to plan something new/);
      screen.send('@re'); // the habitual @ is absorbed into the box's own
      const pop = (await screen.waitFor(/→ @repo +\S/)).join('\n');
      assert.match(pop, /^@re\s*$/m, 'the box reads @re, not @@re');
      screen.send(TAB);
      await screen.waitFor(/new plan {2}in repo/);
      screen.send(BRIEF);
      await screen.waitFor(/↵ start planning · shift\+↵ new line · esc clear/);
      screen.send(ENTER);
      await screen.waitFor(/starting the planner…|pir ▸ Load the pir-plan skill/, 20000);
      const conv = (await screen.waitFor(new RegExp(esc(PLAN_RIG_QUESTION)), 20000)).join('\n');
      assert.match(conv, /^plan +worker \w+ · live/m, "the planner's conversation");
      assert.match(conv, /pir ▸ Load the pir-plan skill/, "pir's first message");
      assert.equal(screen.overflows(), 0);
    } finally {
      await screen.close();
    }
    const [record] = listRecords({ dir: indexDir({ env: rig.env }) });
    assert.equal(realpathSync(record.repoPath), realpathSync(rig.repoDir), 'planned in the repo the box named');
    assert.equal(readFileSync(join(record.controlDir, 'brief.md'), 'utf8'), BRIEF);
  });
}

test('end to end at 80×24: `@nope x` Enter → the no-repo note, text kept; Esc → @; Esc → pir exits 0', async (t) => {
  const rig = rigWithTeardown(t);
  const screen = rig.openScreen({ cols: 80, rows: 24 });
  let code;
  try {
    await screen.waitFor(/new plan {2}start with @repo/);
    screen.send('nope x');
    await screen.waitFor(/@nope is not a repo in/);
    screen.send(ENTER);
    const noted = (await screen.waitFor(/no repo @nope in/)).join('\n');
    // The rig's root is a long temp path, so the note is cut at 80 columns; ~/src would fit.
    assert.match(noted, /^no repo @nope in \/\S+/m);
    assert.match(noted, /^@nope x\s*$/m, 'the text is kept');
    screen.send('\x1b');
    const reset = (await screen.waitFor(/new plan {2}start with @repo/)).join('\n');
    assert.doesNotMatch(reset, /no repo @nope/);
    assert.doesNotMatch(reset, /@nope x/);
    assert.equal(screen.overflows(), 0);
    screen.send('\x1b');
    await assert.rejects(screen.waitFor(() => false, 5000), /pir exited before/, 'the second Esc quits pir');
  } finally {
    code = await screen.close();
  }
  assert.equal(code, 0);
  assert.deepEqual(listRecords({ dir: indexDir({ env: rig.env }) }), [], 'nothing was started');
});

test('end to end at 120×40: on a bare box ↓ and → still open a listed run; ← comes back to the box at @', async (t) => {
  const rig = startPlanRig();
  t.after(() => rig.cleanup());
  const dir = indexDir({ env: rig.env });
  for (const slug of ['rig-run-a', 'rig-run-b']) {
    writeRecord(
      { version: 1, slug, repo: 'repo', repoPath: rig.repoDir, controlDir: join(rig.root, `control-${slug}`), pid: 2147483646,
        startTime: 'Sat Sep 26 12:00:00 2026', startedAt: null, branch: `pir/${slug}`, finalState: 'finished', updatedAt: null },
      { dir },
    );
  }
  const screen = rig.openScreen({ cols: 120, rows: 40 });
  try {
    await screen.waitFor(/▎ rig-run-a/);
    screen.send('\x1b[B');
    await screen.waitFor(/▎ rig-run-b/);
    screen.send('\x1b[C');
    const opened = (await screen.waitFor((s) => /^rig-run-b/m.test(s) && !/new plan/.test(s))).join('\n');
    assert.doesNotMatch(opened, /new plan/, 'the run view has no box');
    screen.send(LEFT);
    const back = (await screen.waitFor(/new plan {2}start with @repo/)).join('\n');
    assert.match(back, /▎ rig-run-b/);
    assert.equal(screen.overflows(), 0);
  } finally {
    await screen.close();
  }
});

// ---- dashboard-plan-box T06: the drill, kept as end-to-end tests (DESIGN §2, §5 End to end). ----
// Each case below is an interaction the drill drove through the real `pir` under a pty; what it judged is in
// FINDINGS.md (worker-driven, 2026-09-27).

const DOWN = '\x1b[B';
const BS = '\x7f';
const TYPED = '↵ start planning · shift+↵ new line · esc clear';

// Finished runs rig-run-0…n-1, written into the rig's index.
function seedRuns(rig, n) {
  const dir = indexDir({ env: rig.env });
  for (let i = 0; i < n; i++) {
    const slug = `rig-run-${i}`;
    writeRecord(
      { version: 1, slug, repo: 'repo', repoPath: rig.repoDir, controlDir: join(rig.root, `control-${slug}`), pid: 2147483646,
        startTime: 'Sat Sep 26 12:00:00 2026', startedAt: null, branch: `pir/${slug}`, finalState: 'finished', updatedAt: null },
      { dir },
    );
  }
}

// A git repo on `main` with one commit, for the box's scan.
function makeRepo(path) {
  mkdirSync(path, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: path });
  execFileSync('git', ['-c', 'user.name=pir rig', '-c', 'user.email=rig@pir.invalid', 'commit', '-q', '--allow-empty', '-m', 'rig'], { cwd: path });
}

// Type text one stretch at a time, letting the screen settle between, as a person does: the @ pop-up is
// asynchronous, and an Enter sent in the same breath as the text can reach a pop-up that is about to close.
async function typeSettled(screen, ...parts) {
  for (const p of parts) {
    screen.send(p);
    await screen.waitFor();
  }
}

const lastLine = (rows) => rows.filter((l) => l !== '').at(-1);

test('end to end at 80×12: nine runs, ↓ through all and ↑ back — the selection always shows, and ↑/↓ n more count the cut rows', async (t) => {
  const rig = startPlanRig();
  t.after(() => rig.cleanup());
  const N = 9;
  seedRuns(rig, N);
  const screen = rig.openScreen({ cols: 80, rows: 12 });
  try {
    await screen.waitFor(/▎ rig-run-0/);
    const check = (rows, sel) => {
      const shown = rows.map((l) => /^[▎ ] rig-run-(\d)/.exec(l)).filter(Boolean).map((m) => Number(m[1]));
      assert.ok(rows.some((l) => l.startsWith(`▎ rig-run-${sel} `)), `rig-run-${sel} selected and visible\n${rows.join('\n')}`);
      const above = rows.map((l) => /^ {2}↑ (\d+) more$/.exec(l)).find(Boolean);
      const below = rows.map((l) => /^ {2}↓ (\d+) more$/.exec(l)).find(Boolean);
      assert.equal(above ? Number(above[1]) : 0, shown[0], `↑ counts the rows above\n${rows.join('\n')}`);
      assert.equal(below ? Number(below[1]) : 0, N - 1 - shown.at(-1), `↓ counts the rows below\n${rows.join('\n')}`);
      assert.ok(shown.length >= 1 && shown.every((v, i) => i === 0 || v === shown[i - 1] + 1), 'a contiguous window');
    };
    check(await screen.waitFor(), 0);
    for (let sel = 1; sel < N; sel++) {
      screen.send(DOWN);
      check(await screen.waitFor(new RegExp(`▎ rig-run-${sel} `)), sel);
    }
    for (let sel = N - 2; sel >= 0; sel--) {
      screen.send(UP);
      check(await screen.waitFor(new RegExp(`▎ rig-run-${sel} `)), sel);
    }
    assert.equal(screen.overflows(), 0);
  } finally {
    await screen.close();
  }
});

// pi-tui's Editor caps itself at 30% of the rows, minimum 5 lines of text, plus its two borders
// (FINDINGS 2026-09-27: 7/9/14 lines at 12/24/40 rows).
for (const [cols, rows, cap] of [[80, 12, 7], [80, 24, 9], [120, 40, 14]]) {
  test(`end to end at ${cols}×${rows}: a brief past 30% of the rows stops growing the box at ${cap} lines, scrolls, and the list stays`, async (t) => {
    const rig = startPlanRig();
    t.after(() => rig.cleanup());
    seedRuns(rig, 3);
    const screen = rig.openScreen({ cols, rows });
    try {
      await screen.waitFor(/▎ rig-run-0/);
      await typeSettled(screen, 'repo ', 'a very long brief that keeps going and going '.repeat(Math.ceil((cap * cols) / 40)).trim());
      const shot = await screen.waitFor(/↓ \d+ more|↑ \d+ more/);
      const head = shot.findIndex((l) => l.startsWith('new plan'));
      assert.equal(shot[head], 'new plan  in repo');
      assert.equal(shot.at(-1), TYPED);
      assert.equal(shot.length - 1 - (head + 1), cap, `the box is ${cap} lines\n${shot.join('\n')}`);
      assert.match(shot[head + 1], /─ ↑ \d+ more ─/, 'the box scrolled: the cursor at the end, its first lines cut');
      assert.ok(shot.slice(0, head).some((l) => l.startsWith('▎ rig-run-0')), 'the selected run still shows above the box');
      assert.match(shot.slice(0, head).join('\n'), /3 runs · /, 'the counts line stays');
      assert.equal(screen.overflows(), 0);
    } finally {
      await screen.close();
    }
  });
}

test('end to end at 80×24: every §2.5 refusal starts nothing and shows its exact note in full, the text kept; Esc clears both', async (t) => {
  const rig = rigWithTeardown(t);
  // Roots under the rig's HOME, so every {roots} and {path} reads with `~`, as the person's own ~/src would.
  const src = join(rig.home, 'src');
  const work = join(rig.home, 'work');
  for (const p of [join(src, 'repo'), join(src, 'twin'), join(work, 'twin')]) makeRepo(p);
  const env = { ...rig.env, PIR_REPOS: '~/src:~/work' };
  const screen = rig.openScreen({ cols: 80, rows: 24, env });
  const cases = [
    { keys: [BS, 'hello'], note: 'start with @repo, then say what to plan', text: 'hello' },
    { keys: [' hello'], note: 'start with @repo, then say what to plan', text: '@ hello' },
    { keys: ['nope ', 'x'], note: 'no repo @nope in ~/src, ~/work — pick one from the list', text: '@nope x' },
    { keys: ['twin', ' ', 'brief'], note: /^@twin is in more than one folder: (~\/src\/twin, ~\/work\/twin|~\/work\/twin, ~\/src\/twin)$/, text: '@twin brief' },
    { keys: ['repo', ' '], note: 'say what to plan after @repo', text: '@repo' },
    // startPlanRun's own refusal: `main` renamed between the pick and Enter.
    { keys: ['repo', ' ', 'a brief'], before: () => execFileSync('git', ['branch', '-m', 'main', 'trunk'], { cwd: join(src, 'repo') }),
      note: 'Could not start planning in repo: it has no local main branch', text: '@repo a brief' },
  ];
  try {
    await screen.waitFor(/new plan {2}start with @repo/);
    for (const c of cases) {
      await typeSettled(screen, ...c.keys);
      c.before?.();
      screen.send(ENTER);
      const noted = await screen.waitFor((s) => s.split('\n').some((l) => (typeof c.note === 'string' ? l === c.note : c.note.test(l))));
      const head = noted.findIndex((l) => l.startsWith('new plan'));
      assert.ok(typeof c.note === 'string' ? noted[head - 1] === c.note : c.note.test(noted[head - 1]), `the note, whole, above the head line: ${c.note}`);
      assert.equal(noted[head + 2].trimEnd(), c.text, 'the text is kept');
      screen.send('\x1b');
      const reset = await screen.waitFor(/new plan {2}start with @repo/);
      assert.equal(reset[reset.findIndex((l) => l.startsWith('new plan')) - 1], '', 'Esc cleared the note');
    }
    assert.equal(screen.overflows(), 0);
  } finally {
    await screen.close();
  }
  assert.deepEqual(listRecords({ dir: indexDir({ env: rig.env }) }), [], 'nothing was started');
});

test('end to end at 80×24: a repo named plan-implement-review under PIR_REPOS plans with no flag set (§2.8)', async (t) => {
  const rig = rigWithTeardown(t);
  const pir = join(rig.home, 'src', 'plan-implement-review');
  makeRepo(pir);
  const env = { ...rig.env, PIR_REPOS: '~/src' };
  assert.equal(env.PARALLEL_ALLOW_HERE, undefined);
  const screen = rig.openScreen({ cols: 80, rows: 24, env });
  try {
    await screen.waitFor(/new plan {2}start with @repo/);
    screen.send('plan-imp');
    await screen.waitFor(/→ @plan-implement-review +~\/src\/plan-implement-review/);
    await typeSettled(screen, TAB, 'plan something here');
    assert.equal(lastLine(await screen.waitFor(/new plan {2}in plan-implement-review/)), TYPED);
    screen.send(ENTER);
    await screen.waitFor(new RegExp(esc(PLAN_RIG_QUESTION)), 20000);
  } finally {
    await screen.close();
  }
  const [record] = listRecords({ dir: indexDir({ env: rig.env }) });
  assert.equal(realpathSync(record.repoPath), realpathSync(pir), 'planned in the plan-implement-review checkout');
});

test('end to end at 80×24: Ctrl+S Ctrl+S on a running row with a brief typed stops it and keeps the brief; typing disarms a half-press', async (t) => {
  const { rig, dir } = await startRigPlan(t);
  const screen = rig.openScreen({ cols: 80, rows: 24 });
  const boxLine = (rows) => rows[rows.findIndex((l) => l.startsWith('new plan')) + 2];
  try {
    await screen.waitFor(/▎ .*● asking you/, 20000);
    screen.send(CTRL_S);
    assert.match(lastLine(await screen.waitFor(/⚠ Ctrl\+S again/)), /^⚠ Ctrl\+S again to stop plan-\w+ now/);
    await typeSettled(screen, 'repo', ' ', 'my brief');
    assert.equal(lastLine(await screen.waitFor()), TYPED, 'typing disarmed the stop');
    screen.send(CTRL_S);
    const armed = await screen.waitFor(/⚠ Ctrl\+S again/);
    assert.match(armed.join('\n'), /▎ .*● asking you/, 'one press after typing did not stop it');
    assert.match(lastLine(armed), /^⚠ Ctrl\+S again to stop plan-\w+ now/, 'the warning shows over the typed box');
    assert.equal(boxLine(armed).trimEnd(), '@repo my brief');
    screen.send(CTRL_S);
    const stopped = await screen.waitFor(/▎ .*◼ stopped/, 20000);
    assert.equal(boxLine(stopped).trimEnd(), '@repo my brief', 'the brief survives the stop');
    assert.equal(lastLine(stopped), TYPED);
    assert.equal(screen.overflows(), 0);
  } finally {
    await screen.close();
  }
  assert.equal(listRecords({ dir })[0].finalState, 'stopped');
});

test('end to end: §2.6 hint and head lines — bare at 80 is the list footer alone, at 120 it gains the suffix; every line fits', async (t) => {
  const rig = startPlanRig();
  t.after(() => rig.cleanup());
  seedRuns(rig, 2);
  for (const [cols, rows] of [[80, 24], [120, 40], [80, 12]]) {
    const screen = rig.openScreen({ cols, rows });
    try {
      const bare = await screen.waitFor(/▎ rig-run-0/);
      assert.ok(bare.includes('new plan  start with @repo'));
      const footer = '↑↓ move · ↵ open · Ctrl+R resume · Ctrl+S stop · Ctrl+X remove · esc quit';
      assert.equal(bare.at(-1), cols >= 120 ? `${footer} · type to plan (@repo)` : footer);
      await typeSettled(screen, 'nope');
      const typed = await screen.waitFor(/new plan {2}@nope is not a repo in /);
      assert.equal(typed.at(-1), TYPED);
      assert.equal(screen.overflows(), 0, `${cols}×${rows}`);
    } finally {
      await screen.close();
    }
  }
});
