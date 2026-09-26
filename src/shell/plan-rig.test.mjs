// The planning rig (T10): a scratch repo, a scratch home and the fake `claude` first on PATH, with the
// real `pir` screen driven through a pseudo-terminal. No test here runs the real `claude` or writes the
// person's real `~/.pir`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { startPlanRig, scriptSet, SCRIPT_SETS, PLAN_RIG_SLUG, PLAN_RIG_SLUG_2, PLAN_RIG_QUESTION } from './plan-rig.mjs';
import { PLANNER_MATCH, REVIEWER_MATCH } from './fake/sessions.mjs';
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

test('end to end: a planning run lists as planning with its label, then as your go once planned and reviewed', async (t) => {
  const { rig, dir, started, request } = await startRigPlan(t);
  const planning = new RegExp(`"${esc(LABEL)}" +plan +● planning +repo +plan … +1`);
  for (const [cols, rows] of SIZES) {
    const { screens, overflows } = await rig.driveScreen({ cols, rows, first: planning });
    const text = screens[0].rows.join('\n');
    assert.match(text, /SLUG +TYPE +STATE +REPO +PROGRESS +WK/, `${cols}×${rows}`);
    assert.match(text, /1 run · 1 running · 0 finished · 0 crashed/);
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
    await screen.waitFor(new RegExp(`"${esc(LABEL)}" +plan +● planning`));
    screen.send('\x13');
    await screen.waitFor(/⚠ Ctrl\+S again to stop/);
    screen.send('\x13');
    await screen.waitFor(new RegExp(`"${esc(LABEL)}" +plan +◼ stopped`), 20000);
    assert.equal(listRecords({ dir }).find((r) => r.slug === started.runId).finalState, 'stopped');

    screen.send('\x12');
    await screen.waitFor(new RegExp(`⚠ Ctrl\\+R again to resume "${esc(LABEL)}"`));
    screen.send('\x12');
    await screen.waitFor(new RegExp(`"${esc(LABEL)}" +plan +● planning +repo +plan …`), 20000);
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
const LEFT = '\x1b[D';
const ENTER = '\r';

test('end to end: opening a planning run shows its steps — plan asking, review and build pending', async (t) => {
  const { rig } = await startRigPlan(t);
  for (const [cols, rows] of SIZES) {
    const { screens, overflows } = await rig.driveScreen({
      cols, rows, first: /● planning/,
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
  await screen.waitFor(/● planning/);
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
    // The fake task is worked on for a moment only, so every frame is looked at, not the settled one.
    await until(() => /T01 +first-task +(preparing|building|reviewing|merging)/.test(screen.text()), "the fake plan's task running", 30000);
    const record = listRecords({ dir }).find((r) => r.slug === PLAN_RIG_SLUG);
    assert.equal(record.kind, 'work', 'the row flipped from plan to work');
    const done = (await screen.waitFor(new RegExp(`git merge pir/${PLAN_RIG_SLUG}`), 90000)).join('\n');
    assert.match(done, /all 1 task\(s\) green/);
    assert.equal(git(rig.repoDir, 'rev-parse', 'main'), mainBefore, 'main is untouched');
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
