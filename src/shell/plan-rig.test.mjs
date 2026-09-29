// The planning rig (T10): a scratch repo, a scratch home and the fake `claude` first on PATH, with the
// real `pir` screen driven through a pseudo-terminal. No test here runs the real `claude` or writes the
// person's real `~/.pir`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { startPlanRig, scriptSet, SCRIPT_SETS, PLAN_RIG_SLUG, PLAN_RIG_SLUG_2, PLAN_RIG_QUESTION, PLAN_RIG_REVIEW_ASK, PLAN_RIG_REVIEW_COMMAND } from './plan-rig.mjs';
import { DRILL_SLUG, PLANNER_MATCH, REVIEWER_MATCH, drillPlanFiles } from './fake/sessions.mjs';
import { mouseBytes } from './conversation-rig.mjs';
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
  assert.deepEqual(git(rig.repoDir, 'ls-files').split('\n').sort(), ['.pir/settings.json', 'README.md', 'package.json']);
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
    assert.match(done, new RegExp(`✔ ready to merge · git switch main && git merge pir/${PLAN_RIG_SLUG}\\n  report: plans/${PLAN_RIG_SLUG}/REPORT\\.md`));
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

// base-branch §2.9: each refusal reachable from `pir plan` prints its text, opens no box and leaves the
// repo as it was. The rig's HOME/PIR_HOME are scratch, so no real user settings file is read.
for (const [label, setup, text] of [
  ['a base branch that exists nowhere', (rig) => git(rig.repoDir, 'branch', '-m', 'main', 'trunk'),
    'pir: the base branch main (set in .pir/settings.json) does not exist locally, and this repo has no remote.\n'],
  ['no settings', (rig) => rmSync(join(rig.repoDir, '.pir'), { recursive: true }),
    'pir: no base branch is set for repo. Add .pir/settings.json with {"baseBranch": "<branch>"} (committed, for everyone), or ~/.pir/repo/settings.json (this machine only).\n'],
  ['a broken user settings file', (rig) => {
    mkdirSync(join(rig.home, '.pir', 'repo'), { recursive: true });
    writeFileSync(join(rig.home, '.pir', 'repo', 'settings.json'), '[]');
  }, (rig) => `pir: ${join(rig.home, '.pir', 'repo', 'settings.json')} is not usable: it is not a JSON object.\n`],
  ['an unreachable remote', (rig) => git(rig.repoDir, 'remote', 'add', 'origin', join(rig.root, 'gone.git')), /^pir: could not fetch main from origin: .+\. Nothing was created; try again when origin is reachable\.\n$/],
]) {
  test(`end to end: \`pir plan\` with ${label} → the §2.9 refusal line, no box, nothing created`, (t) => {
    const rig = rigWithTeardown(t);
    setup(rig);
    const heads = git(rig.repoDir, 'for-each-ref', '--format=%(refname)', 'refs/heads');
    const pir = fileURLToPath(new URL('./pir.mjs', import.meta.url));
    const r = spawnSync(process.execPath, [pir, 'plan'], { cwd: rig.repoDir, env: rig.env, encoding: 'utf8', timeout: 20000 });
    assert.equal(r.status, 1);
    if (text instanceof RegExp) assert.match(r.stderr, text);
    else assert.equal(r.stderr, typeof text === 'function' ? text(rig) : text);
    assert.doesNotMatch(r.stdout, /esc cancel|new plan in/);
    assert.equal(git(rig.repoDir, 'for-each-ref', '--format=%(refname)', 'refs/heads'), heads, 'no branch created');
    assert.ok(!existsSync(join(rig.repoDir, 'plans')), 'no plans/ folder');
    assert.deepEqual(listRecords({ dir: indexDir({ env: rig.env }) }), [], 'no run recorded');
  });
}

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
      const bare = (await screen.waitFor(/new {2}start with @repo/)).join('\n');
      assert.match(bare, /No runs yet — type after @ below to plan or build/);
      screen.send('@re'); // the habitual @ is absorbed into the box's own
      const pop = (await screen.waitFor(/→ @repo +\S/)).join('\n');
      assert.match(pop, /^@re\s*$/m, 'the box reads @re, not @@re');
      screen.send(TAB);
      await screen.waitFor(/new {2}in repo — \/plan or \/start/);
      // A repo pick writes `@repo/` and opens the command pop-up (box-commands §2.2); the command is typed.
      await typeSettled(screen, 'plan ');
      await screen.waitFor(/new {2}plan in repo/);
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
    await screen.waitFor(/new {2}start with @repo/);
    screen.send('nope x');
    await screen.waitFor(/@nope is not a repo in/);
    screen.send(ENTER);
    const noted = (await screen.waitFor(/no repo @nope in/)).join('\n');
    // The rig's root is a long temp path, so the note is cut at 80 columns; ~/src would fit.
    assert.match(noted, /^no repo @nope in \/\S+/m);
    assert.match(noted, /^@nope x\s*$/m, 'the text is kept');
    screen.send('\x1b');
    const reset = (await screen.waitFor(/new {2}start with @repo/)).join('\n');
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
    const opened = (await screen.waitFor((s) => /^rig-run-b/m.test(s) && !/^new {2}/m.test(s))).join('\n');
    assert.doesNotMatch(opened, /^new {2}/m, 'the run view has no box');
    screen.send(LEFT);
    const back = (await screen.waitFor(/new {2}start with @repo/)).join('\n');
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
// A repo with one commit on `branch`, carrying .pir/settings.json naming `base` (default `branch`), as
// every repo pir plans in needs (base-branch DESIGN §2.1); `base: null` leaves the settings out.
function makeRepo(path, { branch = 'main', base = branch } = {}) {
  mkdirSync(path, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', branch], { cwd: path });
  if (base !== null) {
    mkdirSync(join(path, '.pir'));
    writeFileSync(join(path, '.pir', 'settings.json'), JSON.stringify({ baseBranch: base }) + '\n');
    execFileSync('git', ['add', '-A'], { cwd: path });
  }
  execFileSync('git', ['-c', 'user.name=pir rig', '-c', 'user.email=rig@pir.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'rig'], { cwd: path });
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
      await typeSettled(screen, 'repo/plan ', 'a very long brief that keeps going and going '.repeat(Math.ceil((cap * cols) / 40)).trim());
      const shot = await screen.waitFor(/↓ \d+ more|↑ \d+ more/);
      const head = shot.findIndex((l) => l.startsWith('new  '));
      assert.equal(shot[head], 'new  plan in repo');
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
  makeRepo(join(src, 'nobase'), { base: null });
  const env = { ...rig.env, PIR_REPOS: '~/src:~/work' };
  const screen = rig.openScreen({ cols: 80, rows: 24, env });
  const cases = [
    { keys: [BS, 'hello'], note: 'start with @repo/plan or @repo/start', text: 'hello' },
    { keys: [' hello'], note: 'start with @repo/plan or @repo/start', text: '@ hello' },
    { keys: ['nope/plan ', 'x'], note: 'no repo @nope in ~/src, ~/work — pick one from the list', text: '@nope/plan x' },
    { keys: ['twin', '/plan ', 'brief'], note: /^@twin is in more than one folder: (~\/src\/twin, ~\/work\/twin|~\/work\/twin, ~\/src\/twin)$/, text: '@twin/plan brief' },
    { keys: ['repo', ' ', 'brief'], note: 'pick a command: @repo/plan or @repo/start', text: '@repo brief' },
    { keys: ['repo', '/plan', ' '], note: 'say what to plan after @repo/plan', text: '@repo/plan' },
    // startPlanRun's own refusals (base-branch §2.9 short form): a repo with no settings is listed and
    // refused on pick; a settings file naming `main` after `main` was renamed between the pick and Enter.
    { keys: ['nobase', '/plan ', 'a brief'], note: 'Could not start planning in nobase: no base branch is set', text: '@nobase/plan a brief' },
    { keys: ['repo', '/plan ', 'a brief'], before: () => execFileSync('git', ['branch', '-m', 'main', 'trunk'], { cwd: join(src, 'repo') }),
      note: 'Could not start planning in repo: main does not exist', text: '@repo/plan a brief' },
  ];
  try {
    await screen.waitFor(/new {2}start with @repo/);
    for (const c of cases) {
      await typeSettled(screen, ...c.keys);
      c.before?.();
      screen.send(ENTER);
      const noted = await screen.waitFor((s) => s.split('\n').some((l) => (typeof c.note === 'string' ? l === c.note : c.note.test(l))));
      const head = noted.findIndex((l) => l.startsWith('new  '));
      assert.ok(typeof c.note === 'string' ? noted[head - 1] === c.note : c.note.test(noted[head - 1]), `the note, whole, above the head line: ${c.note}`);
      assert.equal(noted[head + 2].trimEnd(), c.text, 'the text is kept');
      screen.send('\x1b');
      const reset = await screen.waitFor(/new {2}start with @repo/);
      assert.equal(reset[reset.findIndex((l) => l.startsWith('new  ')) - 1], '', 'Esc cleared the note');
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
    await screen.waitFor(/new {2}start with @repo/);
    screen.send('plan-imp');
    await screen.waitFor(/→ @plan-implement-review +~\/src\/plan-implement-review/);
    // A repo pick writes `@name/` (box-commands §2.2); the command and brief are typed after it.
    await typeSettled(screen, TAB, 'plan something here');
    assert.equal(lastLine(await screen.waitFor(/new {2}plan in plan-implement-review/)), TYPED);
    screen.send(ENTER);
    await screen.waitFor(new RegExp(esc(PLAN_RIG_QUESTION)), 20000);
  } finally {
    await screen.close();
  }
  const [record] = listRecords({ dir: indexDir({ env: rig.env }) });
  assert.equal(realpathSync(record.repoPath), realpathSync(pir), 'planned in the plan-implement-review checkout');
});

// base-branch T05: a repo with only `dev` and settings naming it plans from the box, at both sizes.
for (const [cols, rows] of [[80, 24], [120, 40]]) {
  test(`end to end at ${cols}×${rows}: @devrepo/plan in a dev-only repo opens the planner's conversation, cut from dev`, async (t) => {
    const rig = rigWithTeardown(t);
    const dev = join(rig.home, 'src', 'devrepo');
    makeRepo(dev, { branch: 'dev' });
    const devHead = execFileSync('git', ['rev-parse', 'dev'], { cwd: dev, encoding: 'utf8' }).trim();
    const env = { ...rig.env, PIR_REPOS: '~/src' };
    const screen = rig.openScreen({ cols, rows, env });
    try {
      await screen.waitFor(/new {2}start with @repo/);
      await typeSettled(screen, 'devrepo', '/plan ', 'a brief');
      screen.send(ENTER);
      await screen.waitFor(new RegExp(esc(PLAN_RIG_QUESTION)), 20000);
      assert.equal(screen.overflows(), 0);
    } finally {
      await screen.close();
    }
    const [record] = listRecords({ dir: indexDir({ env: rig.env }) });
    assert.equal(realpathSync(record.repoPath), realpathSync(dev));
    assert.equal(record.baseBranch, 'dev');
    const branch = record.branch;
    assert.equal(execFileSync('git', ['config', '--get', `branch.${branch}.pirBase`], { cwd: dev, encoding: 'utf8' }).trim(), 'dev');
    assert.equal(execFileSync('git', ['merge-base', '--is-ancestor', devHead, branch], { cwd: dev }).length, 0, 'the plan branch grows from dev');
    assert.equal(execFileSync('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads/main'], { cwd: dev, encoding: 'utf8' }), '', 'no main was invented');
  });
}

test('end to end at 80×24: Ctrl+S Ctrl+S on a running row with a brief typed stops it and keeps the brief; typing disarms a half-press', async (t) => {
  const { rig, dir } = await startRigPlan(t);
  const screen = rig.openScreen({ cols: 80, rows: 24 });
  const boxLine = (rows) => rows[rows.findIndex((l) => l.startsWith('new  ')) + 2];
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
      assert.ok(bare.includes('new  start with @repo'));
      const footer = '↑↓ move · ↵ open · Ctrl+R resume · Ctrl+S stop · Ctrl+X remove · esc quit';
      assert.equal(bare.at(-1), cols >= 120 ? `${footer} · type @repo to plan or build` : footer);
      await typeSettled(screen, 'nope');
      const typed = await screen.waitFor(/new {2}@nope is not a repo in /);
      assert.equal(typed.at(-1), TYPED);
      assert.equal(screen.overflows(), 0, `${cols}×${rows}`);
    } finally {
      await screen.close();
    }
  }
});

// ---- box-commands T04: `@repo/start` starts, or opens, a build from the box (DESIGN §2.2, §2.4). ----
// The coordinator-drill set commits the reviewed three-task plan DRILL_SLUG in the rig repo, so `/start` has a
// buildable plan; the build it starts runs on the fake claude and is stopped by the teardown.

function buildRig(t, scripts = 'coordinator-drill') {
  const rig = startPlanRig({ scripts });
  const dir = indexDir({ env: rig.env });
  t.after(async () => {
    for (const record of listRecords({ dir })) {
      if (record.finalState === null) await stopRun(record).catch(() => {});
    }
    rig.cleanup();
  });
  return { rig, dir };
}

// The build's live view: its head line names the slug, the running state and the repo, and it has no box.
const LIVE_VIEW = new RegExp(`^${DRILL_SLUG} {2}● running {2}· repo`, 'm');
const liveView = (s) => LIVE_VIEW.test(s) && !/^new {2}/m.test(s);

for (const [cols, rows] of SIZES) {
  test(`end to end at ${cols}×${rows}: @re, Enter, start, Enter, Enter, Enter starts the drill plan's build and shows its live view`, { timeout: 90000 }, async (t) => {
    const { rig, dir } = buildRig(t);
    const screen = rig.openScreen({ cols, rows });
    try {
      await screen.waitFor(/new {2}start with @repo/);
      screen.send('@re');
      await screen.waitFor(/→ @repo +\S/);
      screen.send(ENTER);
      const commands = (await screen.waitFor(/→ plan +plan something new/)).join('\n');
      assert.match(commands, /^@repo\/\s*$/m, 'the pick wrote @repo/');
      assert.match(commands, /^ {2}start +build a reviewed plan/m, 'start is listed under plan');
      screen.send(DOWN);
      await screen.waitFor(/→ start +build a reviewed plan/);
      screen.send(ENTER);
      const slugs = (await screen.waitFor(new RegExp(`→ ${DRILL_SLUG} +0/3 done`))).join('\n');
      assert.match(slugs, /^@repo\/start\s*$/m);
      assert.match(slugs, /new {2}build in repo/);
      screen.send(ENTER);
      const picked = (await screen.waitFor(new RegExp(`^@repo/start ${DRILL_SLUG}\\s*$`, 'm'))).join('\n');
      assert.match(picked, /↵ start the build · esc clear/);
      screen.send(ENTER);
      await screen.waitFor(liveView, 20000);
      assert.equal(screen.overflows(), 0);
    } finally {
      await screen.close();
    }
    const records = listRecords({ dir });
    assert.equal(records.length, 1, 'one run');
    assert.equal(records[0].slug, DRILL_SLUG);
    assert.equal(realpathSync(records[0].repoPath), realpathSync(rig.repoDir), 'built in the repo the box named');
  });
}

test('end to end at 120×40: with the build running, @repo/start reads · building, and Enter opens the same live view, no second run', { timeout: 90000 }, async (t) => {
  const { rig, dir } = buildRig(t);
  const screen = rig.openScreen({ cols: 120, rows: 40 });
  try {
    await screen.waitFor(/new {2}start with @repo/);
    await typeSettled(screen, 'repo/start ');
    await screen.waitFor(new RegExp(`→ ${DRILL_SLUG} +0/3 done`));
    await typeSettled(screen, ENTER, ENTER);
    await screen.waitFor(liveView, 20000);
    const first = listRecords({ dir });
    assert.equal(first.length, 1);
    screen.send(LEFT);
    await screen.waitFor(/new {2}start with @repo/);
    await typeSettled(screen, 'repo/start ');
    await screen.waitFor(new RegExp(`→ ${DRILL_SLUG} +\\d/3 done · building`));
    await typeSettled(screen, ENTER, ENTER);
    await screen.waitFor(liveView, 20000);
    const again = listRecords({ dir });
    assert.equal(again.length, 1, 'no second run');
    assert.equal(again[0].pid, first[0].pid, 'the same run, opened');
    assert.equal(screen.overflows(), 0);
  } finally {
    await screen.close();
  }
});

test('end to end at 80×24: `@repo a brief` → the no-command note; `@repo/start nope` → the unknown-slug note; text kept, nothing started', { timeout: 60000 }, async (t) => {
  const { rig, dir } = buildRig(t);
  const screen = rig.openScreen({ cols: 80, rows: 24 });
  try {
    for (const [typed, note] of [['repo a brief', 'pick a command: @repo/plan or @repo/start'], ['repo/start nope', 'nope is not a reviewed, unfinished plan in repo']]) {
      await screen.waitFor(/new {2}start with @repo/);
      await typeSettled(screen, ...typed.split(/(?<=[/ ])/));
      screen.send(ENTER);
      const noted = (await screen.waitFor(new RegExp(`^${esc(note)}$`, 'm'))).join('\n');
      assert.match(noted, new RegExp(`^@${esc(typed)}\\s*$`, 'm'), 'the text is kept');
      assert.equal(screen.overflows(), 0);
      screen.send('\x1b');
    }
  } finally {
    await screen.close();
  }
  assert.deepEqual(listRecords({ dir }), [], 'nothing was started');
});

test("end to end at 80×24: `@repo/plan a brief` (happy set) still lands in the planner's conversation", { timeout: 60000 }, async (t) => {
  const { rig, dir } = buildRig(t, 'happy');
  const screen = rig.openScreen({ cols: 80, rows: 24 });
  try {
    await screen.waitFor(/new {2}start with @repo/);
    await typeSettled(screen, 'repo/plan ', BRIEF);
    screen.send(ENTER);
    await screen.waitFor(new RegExp(esc(PLAN_RIG_QUESTION)), 20000);
  } finally {
    await screen.close();
  }
  const [record] = listRecords({ dir });
  assert.equal(record.kind, 'plan');
});

// ---- box-commands T05: the drill, kept as end-to-end tests (DESIGN §2, §5 End to end). ----
// Each case is an interaction the drill drove through the real `pir` under a pty; what it judged is in
// FINDINGS.md (worker-driven, 2026-09-29).

const START_HINT = '↵ start the build · esc clear';
const SLUG_18 = 'an-eighteen-char-x';
const headOf = (rows) => rows.find((l) => l.startsWith('new  '));
// The pop-up's rows: under the box's bottom border (head, border, text, border), above the hint line.
const popupRows = (rows) => {
  const shown = rows.filter((l) => l !== '');
  return shown.slice(shown.findIndex((l) => l.startsWith('new  ')) + 4, -1);
};
const showsPopup = (rows) => rows.some((l) => l.startsWith('→ '));
const boxText = (rows) => rows[rows.findIndex((l) => l.startsWith('new  ')) + 2].trimEnd();
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// Esc once closes an open pop-up (text kept), and once more resets to `@`; on a text with no pop-up one Esc resets.
async function clearBox(screen) {
  let rows = await screen.waitFor();
  while (!/^new {2}start with @repo$/m.test(rows.join('\n')) || boxText(rows) !== '@') {
    screen.send('\x1b');
    rows = await screen.waitFor();
  }
}

// A second reviewed plan, SLUG_18, committed beside the drill's, so a slug row carries an 18-character name.
function addPlan(rig, slug) {
  for (const [path, content] of Object.entries(drillPlanFiles(slug))) {
    mkdirSync(join(rig.repoDir, path, '..'), { recursive: true });
    writeFileSync(join(rig.repoDir, path), content);
  }
  execFileSync('git', ['-c', 'user.name=pir rig', '-c', 'user.email=rig@pir.invalid', 'add', '-A'], { cwd: rig.repoDir });
  execFileSync('git', ['-c', 'user.name=pir rig', '-c', 'user.email=rig@pir.invalid', 'commit', '-q', '-m', `plan(${slug})`], { cwd: rig.repoDir });
}

test('end to end at 80×24: every box-commands §2.4 refusal not covered above shows its exact note, text kept, nothing started', { timeout: 90000 }, async (t) => {
  const { rig, dir } = buildRig(t);
  const screen = rig.openScreen({ cols: 80, rows: 24 });
  const cases = [
    { keys: ['repo'], note: 'pick a command: @repo/plan or @repo/start', text: '@repo' },
    { keys: ['repo/'], note: 'pick a command: @repo/plan or @repo/start', text: '@repo/' },
    { keys: ['repo/', 'foo', ' x'], note: '@repo/foo is not a command — use /plan or /start', text: '@repo/foo x' },
    { keys: ['repo/start', ' '], note: 'name a plan to build after @repo/start', text: '@repo/start' },
    { keys: ['repo/start ', DRILL_SLUG, ' more'], note: '@repo/start takes one plan name', text: `@repo/start ${DRILL_SLUG} more` },
    // An exact name, never a prefix (§2.4).
    { keys: ['repo/start ', DRILL_SLUG.slice(0, 3)], note: `${DRILL_SLUG.slice(0, 3)} is not a reviewed, unfinished plan in repo`, text: `@repo/start ${DRILL_SLUG.slice(0, 3)}` },
    // startRun's own refusal: the plan's test block removed after the pop-up's scan listed it.
    { keys: ['repo/start ', DRILL_SLUG], before: () => writeFileSync(join(rig.repoDir, 'plans', DRILL_SLUG, 'DESIGN.md'), '# no block\n'),
      note: `Could not start ${DRILL_SLUG} in repo: no setup/test block`, text: `@repo/start ${DRILL_SLUG}` },
  ];
  try {
    await screen.waitFor(/new {2}start with @repo/);
    for (const c of cases) {
      await typeSettled(screen, ...c.keys);
      await pause(300);
      // Enter with a pop-up open picks (§2.2), so a person closes it first, as the drill did.
      if (showsPopup(await screen.waitFor())) await typeSettled(screen, '\x1b');
      c.before?.();
      screen.send(ENTER);
      const noted = await screen.waitFor((s) => s.split('\n').includes(c.note));
      assert.equal(noted[noted.findIndex((l) => l.startsWith('new  ')) - 1], c.note, 'the note, whole, above the head line');
      assert.equal(boxText(noted), c.text, 'the text is kept');
      await clearBox(screen);
    }
    assert.equal(screen.overflows(), 0);
  } finally {
    await screen.close();
  }
  assert.deepEqual(listRecords({ dir }), [], 'nothing was started');
});

for (const [cols, rows] of SIZES) {
  test(`end to end at ${cols}×${rows}: every §2.5 head line, and the hint bare, on /plan and on /start`, { timeout: 60000 }, async (t) => {
    const { rig } = buildRig(t);
    const screen = rig.openScreen({ cols, rows });
    const footer = '↑↓ move · ↵ open · Ctrl+R resume · Ctrl+S stop · Ctrl+X remove · esc quit';
    const cases = [
      { keys: [BS, 'hi'], head: 'start with @repo', hint: TYPED },
      { keys: ['nope'], head: /^@nope is not a repo in \//, hint: TYPED },
      { keys: ['repo'], head: 'in repo — /plan or /start' },
      { keys: ['repo/', 'bogus'], head: '/bogus is not a command — /plan or /start' },
      { keys: ['repo/plan ', 'x'], head: 'plan in repo', hint: TYPED },
      { keys: ['repo/start '], head: 'build in repo', hint: START_HINT },
    ];
    try {
      const bare = await screen.waitFor(/new {2}start with @repo/);
      assert.equal(headOf(bare), 'new  start with @repo');
      assert.equal(lastLine(bare), cols >= 120 ? `${footer} · type @repo to plan or build` : footer);
      for (const c of cases) {
        await typeSettled(screen, ...c.keys);
        const shot = await screen.waitFor();
        const head = headOf(shot).slice('new  '.length);
        if (typeof c.head === 'string') assert.equal(head, c.head, c.keys.join(''));
        else assert.match(head, c.head);
        if (c.hint && !showsPopup(shot)) assert.equal(lastLine(shot), c.hint, c.keys.join(''));
        if (c.hint && showsPopup(shot)) {
          await typeSettled(screen, '\x1b');
          assert.equal(lastLine(await screen.waitFor()), c.hint, c.keys.join(''));
        }
        await clearBox(screen);
      }
      assert.equal(screen.overflows(), 0);
    } finally {
      await screen.close();
    }
  });

  test(`end to end at ${cols}×${rows}: Esc closes each pop-up and keeps the text, Esc again resets; nothing reopens after Esc or a slug pick`, { timeout: 60000 }, async (t) => {
    const { rig } = buildRig(t);
    const screen = rig.openScreen({ cols, rows });
    // Each pop-up, the text it is opened on, and its first row.
    const popups = [
      { keys: ['re'], text: '@re', row: /^→ @repo +\S/ },
      { keys: ['repo/'], text: '@repo/', row: /^→ plan +plan something new/ },
      { keys: ['repo/start '], text: '@repo/start', row: new RegExp(`^→ ${DRILL_SLUG} +0/3 done`) },
    ];
    try {
      await screen.waitFor(/new {2}start with @repo/);
      for (const p of popups) {
        await typeSettled(screen, ...p.keys);
        await screen.waitFor((s) => s.split('\n').some((l) => p.row.test(l)));
        screen.send('\x1b');
        let shot = await screen.waitFor((s) => !/^→ /m.test(s));
        assert.equal(boxText(shot), p.text, 'Esc kept the text');
        await pause(800);
        shot = await screen.waitFor();
        assert.ok(!showsPopup(shot), `the pop-up stayed closed after Esc on ${p.text}\n${shot.join('\n')}`);
        screen.send('\x1b');
        shot = await screen.waitFor(/new {2}start with @repo/);
        assert.equal(boxText(shot), '@', 'the second Esc reset the box');
      }
      // A slug pick writes the slug and closes; it never reopens a one-row list of the slug just picked.
      await typeSettled(screen, 'repo/start ');
      await screen.waitFor(new RegExp(`→ ${DRILL_SLUG}`));
      screen.send(ENTER);
      await screen.waitFor(new RegExp(`^@repo/start ${DRILL_SLUG}\\s*$`, 'm'));
      await pause(800);
      const picked = await screen.waitFor();
      assert.ok(!showsPopup(picked), `no pop-up after the slug pick\n${picked.join('\n')}`);
      assert.equal(lastLine(picked), START_HINT);
      assert.equal(screen.overflows(), 0);
    } finally {
      await screen.close();
    }
  });

  test(`end to end at ${cols}×${rows}: a repo with no buildable plan — /start reads nothing to build and opens no pop-up`, { timeout: 60000 }, async (t) => {
    const { rig, dir } = buildRig(t, 'happy');
    const screen = rig.openScreen({ cols, rows });
    try {
      await screen.waitFor(/new {2}start with @repo/);
      await typeSettled(screen, 'repo/start ');
      await pause(800);
      const shot = await screen.waitFor(/new {2}nothing to build in repo$/m);
      assert.ok(!showsPopup(shot), `no slug pop-up\n${shot.join('\n')}`);
      assert.equal(boxText(shot), '@repo/start');
      screen.send(ENTER);
      const noted = await screen.waitFor(/^name a plan to build after @repo\/start$/m);
      assert.equal(headOf(noted), 'new  nothing to build in repo');
      assert.equal(screen.overflows(), 0);
    } finally {
      await screen.close();
    }
    assert.deepEqual(listRecords({ dir }), [], 'nothing was started');
  });
}

test('end to end at 80×24: an 18-character slug with · building fits the pop-up, and an armed chord wins over both hints', { timeout: 90000 }, async (t) => {
  const { rig } = buildRig(t);
  addPlan(rig, SLUG_18);
  const screen = rig.openScreen({ cols: 80, rows: 24 });
  try {
    await screen.waitFor(/new {2}start with @repo/);
    await typeSettled(screen, 'repo/start ');
    await screen.waitFor(new RegExp(`→ ${SLUG_18} +0/3 done`));
    await typeSettled(screen, 'an', ENTER, ENTER);
    await screen.waitFor((s) => new RegExp(`^${SLUG_18} {2}● running`, 'm').test(s) && !/^new {2}/m.test(s), 20000);
    screen.send(LEFT);
    await screen.waitFor(/new {2}start with @repo/);
    await typeSettled(screen, 'repo/start ');
    const pop = await screen.waitFor(new RegExp(`→ ${SLUG_18} +\\d/3 done · building`));
    const rowsShown = popupRows(pop);
    assert.equal(rowsShown.length, 2, pop.join('\n'));
    assert.match(rowsShown[0], new RegExp(`^→ ${SLUG_18} +\\d/3 done · building$`), 'the row is whole at 80 columns');
    assert.match(rowsShown[1], new RegExp(`^ {2}${DRILL_SLUG} +0/3 done$`));
    for (const l of pop) assert.ok([...l].length <= 80, `fits 80: ${l}`);
    // The chord's ⚠ line wins over the /start hint, and over the /plan hint.
    await typeSettled(screen, '\x1b', CTRL_S);
    assert.match(lastLine(await screen.waitFor(/⚠ Ctrl\+S again/)), new RegExp(`^⚠ Ctrl\\+S again to stop ${SLUG_18} now`));
    await clearBox(screen);
    await typeSettled(screen, 'repo/plan ', 'x', CTRL_S);
    const armed = await screen.waitFor(/⚠ Ctrl\+S again/);
    assert.equal(headOf(armed), 'new  plan in repo');
    assert.match(lastLine(armed), new RegExp(`^⚠ Ctrl\\+S again to stop ${SLUG_18} now`));
    assert.equal(screen.overflows(), 0);
  } finally {
    await screen.close();
  }
});


// --- the mouse on the real screen (mouse-navigation T05, DESIGN §2.1–§2.3): T01's SGR bytes to the real pir ---

// The 0-based screen row whose text matches, and the 1-based terminal row a mouse report names it by.
const rowOf = (rows, re) => {
  const y = rows.findIndex((l) => re.test(l));
  assert.ok(y >= 0, `${re} is on screen:\n${rows.join('\n')}`);
  return y;
};
const clickRow = (screen, rows, re, col = 5) => screen.send(mouseBytes.click(col, rowOf(rows, re) + 1));

for (const [cols, rows] of [[80, 24], [120, 40]]) {
  test(`end to end at ${cols}×${rows}: a click on the second run opens its live view; ← is the list with that run selected`, async (t) => {
    const rig = startPlanRig();
    t.after(() => rig.cleanup());
    seedRuns(rig, 3);
    const screen = rig.openScreen({ cols, rows });
    try {
      const list = await screen.waitFor(/▎ rig-run-0/);
      assert.ok([1000, 1002, 1003, 1006].every((m) => screen.modes().has(m)), 'mouse reporting is on');
      clickRow(screen, list, /^ {2}rig-run-1 /);
      const open = await screen.waitFor((x) => /^rig-run-1/m.test(x) && !/^new {2}/m.test(x));
      assert.ok(!open.some((l) => /rig-run-0/.test(l)), 'the live view of rig-run-1, not the list');
      screen.send(LEFT);
      const back = await screen.waitFor(/^new {2}/m);
      assert.ok(back.some((l) => l.startsWith('▎ rig-run-1 ')), `rig-run-1 selected:\n${back.join('\n')}`);
      assert.equal(screen.overflows(), 0);
    } finally {
      await screen.close();
    }
  });
}

test('end to end at 80×24: the pointer over a run row makes that row\'s text bold and no other row\'s', async (t) => {
  const rig = startPlanRig();
  t.after(() => rig.cleanup());
  seedRuns(rig, 3);
  const { NO_COLOR: _off, ...env } = rig.env; // hover is painted with colour only (§2.2)
  const screen = rig.openScreen({ cols: 80, rows: 24, env });
  try {
    const list = await screen.waitFor(/rig-run-2/);
    const y1 = rowOf(list, /^ {2}rig-run-1 /);
    const y2 = rowOf(list, /^ {2}rig-run-2 /);
    const boldRun = (y) => [...'rig-run-'].every((_, i) => screen.boldAt(y, 2 + i));
    assert.ok(!boldRun(y1) && !boldRun(y2), 'nothing hovered yet');
    screen.send(mouseBytes.move(10, y2 + 1));
    await screen.waitFor(() => boldRun(y2));
    assert.ok(!boldRun(y1), 'rig-run-1 is not bold');
    screen.send(mouseBytes.move(10, y1 + 1));
    await screen.waitFor(() => boldRun(y1));
    assert.ok(!boldRun(y2), 'the pointer left rig-run-2: not bold any more');
  } finally {
    await screen.close();
  }
});

test('end to end at 80×12: the wheel down past the window scrolls the list, and `↑ n more` appears', async (t) => {
  const rig = startPlanRig();
  t.after(() => rig.cleanup());
  seedRuns(rig, 9);
  const screen = rig.openScreen({ cols: 80, rows: 12 });
  try {
    const first = await screen.waitFor(/▎ rig-run-0/);
    assert.ok(!first.some((l) => /↑ \d+ more/.test(l)), 'no rows cut above at the start');
    for (let i = 1; i <= 6; i++) {
      screen.send(mouseBytes.wheel(10, 5, 'down'));
      await screen.waitFor(new RegExp(`▎ rig-run-${i} `));
    }
    const shot = await screen.waitFor(/↑ \d+ more/);
    assert.ok(shot.some((l) => l.startsWith('▎ rig-run-6 ')), 'one row a notch, and the selected row still shows');
    assert.equal(screen.overflows(), 0);
  } finally {
    await screen.close();
  }
});

test('end to end at 80×24: Ctrl+S, then a click on another run — no ⚠ line remains and nothing is stopped', async (t) => {
  const { rig, dir } = await startRigPlan(t);
  seedRuns(rig, 1);
  const screen = rig.openScreen({ cols: 80, rows: 24 });
  try {
    await screen.waitFor(/▎ .*● asking you/, 20000);
    screen.send(CTRL_S);
    const armed = await screen.waitFor(/⚠ Ctrl\+S again/);
    clickRow(screen, armed, /^ {2}rig-run-0 /);
    await screen.waitFor((x) => /^rig-run-0/m.test(x) && !/^new {2}/m.test(x));
    screen.send(LEFT);
    const back = await screen.waitFor(/^new {2}/m);
    assert.ok(!back.some((l) => l.includes('⚠')), `no ⚠ line:\n${back.join('\n')}`);
  } finally {
    await screen.close();
  }
  const planning = listRecords({ dir }).find((r) => r.kind === 'plan');
  assert.equal(planning.finalState, null, 'the planning run was not stopped');
});

// The coordinator drill's build (pir-coordinator T07), stopped and removed at the end.
function drillRig(t) {
  const rig = startPlanRig({ scripts: 'coordinator-drill' });
  t.after(async () => {
    for (const record of listRecords({ dir: indexDir({ env: rig.env }) })) {
      if (record.finalState === null) await stopRun(record).catch(() => {});
    }
    rig.cleanup();
  });
  return rig;
}

test('end to end at 120×40: in the drill\'s live view a click on a task with a worker opens it; a click on the agent\'s row opens the agent, and ← comes back to its row', { timeout: 120000 }, async (t) => {
  const rig = drillRig(t);
  const screen = rig.openScreen({ cols: 120, rows: 40, args: ['start', DRILL_SLUG] });
  try {
    let shot = await screen.waitFor(/T02 +reserved-ask +asking you · allow a command\?/, 30000);
    shot = await screen.waitFor(/◆ coordinator agent/, 30000);
    clickRow(screen, shot, /^[▎ ] . T02 /);
    await screen.waitFor(/git push --force origin HEAD/);
    screen.send(LEFT);
    shot = await screen.waitFor(/◆ coordinator agent/);
    assert.ok(shot.some((l) => /^▎ . T02 /.test(l)), `← lands on T02:\n${shot.join('\n')}`);
    clickRow(screen, shot, /◆ coordinator agent/);
    await screen.waitFor(/^coordinator +agent [0-9a-f]{8} · live/m);
    screen.send(LEFT);
    shot = await screen.waitFor(/◆ coordinator agent/);
    assert.ok(shot.some((l) => /^▎ ◆ coordinator agent/.test(l)), `← lands on the agent's row:\n${shot.join('\n')}`);
    assert.equal(screen.overflows(), 0);
  } finally {
    await screen.close();
  }
});

// ---- mouse-navigation T08: the drill, kept as end-to-end tests. Each case is an interaction the drill drove
// through the real `pir` under a pty and found wrong; what it judged is in FINDINGS.md (worker-driven, 2026-09-28).

// SIGTERM left bracketed paste (?2004) on: pi-tui's terminal turns it off only in its own stop, and the
// exit restore did not write it (§2.7). openScreen's close() is a SIGTERM (the pty relay sends it on EOF).
test('end to end at 80×24: after SIGTERM, and after esc, no mouse mode, bracketed paste or the alternate screen is left on', async (t) => {
  const rig = startPlanRig();
  t.after(() => rig.cleanup());
  seedRuns(rig, 1);
  const LEFT_ON = [1000, 1002, 1003, 1004, 1006, 2004, 1049];
  for (const how of ['SIGTERM', 'esc']) {
    const screen = rig.openScreen({ cols: 80, rows: 24 });
    await screen.waitFor(/rig-run-0/);
    assert.ok(LEFT_ON.every((m) => screen.modes().has(m)), `${how}: all on while pir runs`);
    if (how === 'esc') {
      screen.send('\x1b');
      await until(() => !screen.modes().has(1049), 'pir to leave the alternate screen on esc');
    }
    const code = await screen.close();
    assert.equal(code, how === 'esc' ? 0 : 143, `${how}: exit code`);
    assert.deepEqual(LEFT_ON.filter((m) => screen.modes().has(m)), [], `${how}: nothing left on`);
  }
});

// A double click on a row whose first click leaves the screen unchanged under the pointer (a step with no
// session shows a note) became pi-tui's word selection: `Copied!` and the clipboard replaced (§2.1: two
// clicks). The rig's `pbcopy` shim is the clipboard here, so the person's real one is never written.
test('end to end at 80×24: a double click on a step with no session shows its note and copies nothing', async (t) => {
  const { rig } = await startRigPlan(t);
  const screen = rig.openScreen({ cols: 80, rows: 24 });
  try {
    const list = await screen.waitFor(/● asking you/);
    clickRow(screen, list, /asking you/);
    const steps = await screen.waitFor(/○ review +reviewer/);
    const y = rowOf(steps, /○ review +reviewer/) + 1;
    screen.send(mouseBytes.click(8, y) + mouseBytes.click(8, y));
    const after = await screen.waitFor(/review has no session yet/);
    await new Promise((r) => setTimeout(r, 300)); // a copy is asynchronous: give pbcopy time to have run
    assert.ok(!after.join('\n').includes('Copied!'), `no Copied! flash:\n${after.join('\n')}`);
    assert.ok(!existsSync(rig.clipboard), 'nothing was copied');
  } finally {
    await screen.close();
  }
});

// A drag across rows is a text selection, never a click (§2.5): nothing opens, and the copy reaches the
// rig's pbcopy shim, which is where the person's clipboard would have been written before the shim.
test('end to end at 80×24: a drag across two run rows opens nothing and copies their text through pbcopy', async (t) => {
  const rig = startPlanRig();
  t.after(() => rig.cleanup());
  seedRuns(rig, 2);
  const screen = rig.openScreen({ cols: 80, rows: 24 });
  try {
    const list = await screen.waitFor(/rig-run-1/);
    const a = rowOf(list, /rig-run-0 /) + 1;
    const b = rowOf(list, /rig-run-1 /) + 1;
    screen.send(mouseBytes.press(3, a) + mouseBytes.drag(10, a) + mouseBytes.drag(11, b) + mouseBytes.release(11, b));
    await until(() => existsSync(rig.clipboard) && readFileSync(rig.clipboard, 'utf8'), 'the copy through the pbcopy shim');
    const shot = await screen.waitFor(/^new {2}/m);
    assert.ok(shot.some((l) => /runs on this machine/.test(l)), 'still the list: nothing opened');
    assert.match(readFileSync(rig.clipboard, 'utf8'), /^rig-run-0 +work +◌ finished[^\n]*\n {2}rig-run-1$/);
  } finally {
    await screen.close();
  }
});

// An asking row is amber bold throughout, so bold alone showed no hover on it; the user chose a brighter
// amber (FINDINGS 2026-09-28). The basic table is forced (no COLORTERM), so the codes are 33 → 93.
test('end to end at 120×40: the pointer over an asking task turns its amber brighter, and only that row\'s', { timeout: 120000 }, async (t) => {
  const rig = drillRig(t);
  const { NO_COLOR: _off, COLORTERM: _ct, ...env } = rig.env;
  const screen = rig.openScreen({ cols: 120, rows: 40, args: ['start', DRILL_SLUG], env });
  try {
    await screen.waitFor(/T03 +passed-question +asking you/, 30000);
    const shot = await screen.waitFor(/T02 +reserved-ask +asking you/, 30000);
    const y2 = rowOf(shot, /^ {2}● T02 /);
    const y3 = rowOf(shot, /^ {2}● T03 /);
    const idAt = (y) => screen.fgAt(y, 4); // the `T` of the task id
    assert.deepEqual([idAt(y2), idAt(y3)], ['33', '33'], 'both asking rows amber before the pointer comes');
    screen.send(mouseBytes.move(30, y2 + 1));
    await screen.waitFor(() => idAt(y2) === '93');
    assert.equal(idAt(y3), '33', 'the other asking row keeps its amber');
    assert.ok(screen.boldAt(y2, 4), 'still bold');
  } finally {
    await screen.close();
  }
});
