// The planning rig (T10): a scratch repo, a scratch home and the fake `claude` first on PATH, with the
// real `pir` screen driven through a pseudo-terminal. No test here runs the real `claude` or writes the
// person's real `~/.pir`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startPlanRig, PLAN_RIG_QUESTION } from './plan-rig.mjs';
import { indexDir, listRecords, writeRecord } from './index-store.mjs';
import { git, BRIEF, SIZES, esc, LEFT, ENTER, rigWithTeardown, TAB, typeSettled } from './plan-rig-helpers.mjs';

// ---- T13: the brief box, and where `pir plan` lands, end to end (DESIGN §2.12, §2.13). ----

const SHIFT_ENTER = '\x1b[13;2u';

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
    // The fake reviewer finishes on its own a moment after it starts; under load ← can land while it still
    // reads `reviewing`, so the steps view is waited for with the review done, not read on its first frame.
    const steps = (await screen.waitFor((x) => /pick a step|Start the parallel build now\?/.test(x) && /✔ review +reviewer/.test(x), 30000)).join('\n');
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

// ---- dashboard-plan-box T05: the new-plan box on the runs list starts a planning run (DESIGN §2.3–§2.5). ----

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
