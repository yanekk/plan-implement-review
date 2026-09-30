// The planning rig (T10): a scratch repo, a scratch home and the fake `claude` first on PATH, with the
// real `pir` screen driven through a pseudo-terminal. No test here runs the real `claude` or writes the
// person's real `~/.pir`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startPlanRig, PLAN_RIG_QUESTION } from './plan-rig.mjs';
import { indexDir, listRecords } from './index-store.mjs';
import { esc, startRigPlan, UP, ENTER, rigWithTeardown, CTRL_S, TAB, DOWN, BS, TYPED, seedRuns, typeSettled, lastLine } from './plan-rig-helpers.mjs';

// ---- dashboard-plan-box T06: the drill, kept as end-to-end tests (DESIGN §2, §5 End to end). ----
// Each case below is an interaction the drill drove through the real `pir` under a pty; what it judged is in
// FINDINGS.md (worker-driven, 2026-09-27).

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
