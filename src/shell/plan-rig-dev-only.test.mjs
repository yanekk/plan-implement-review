// The planning rig's dev-only flow (base-branch T09), in its own file so node --test runs it in its own
// process beside the other plan-rig files (fast-tests T04). The real `pir` under a pty against the fake
// `claude`; never the real one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PLAN_RIG_SLUG, PLAN_RIG_QUESTION, SINGLE_RIG_TEST_LINE } from './plan-rig.mjs';
import { git, BRIEF, SIZES, esc, LEFT, ENTER, rigWithTeardown } from './plan-rig-helpers.mjs';

// ---- base-branch T09: the whole flow in a repo with only `dev`, whose remote dev is ahead (DESIGN §1, §2.9).
// The drill judged every line naming a branch; each screen seen is kept so a stray `main` anywhere fails.

const DEV_RIG = { base: 'dev', remoteAhead: true, holdReportMs: 3000 };

test('startPlanRig({ base: dev, remoteAhead }) builds a dev-only repo whose origin/dev is one commit ahead', (t) => {
  const rig = rigWithTeardown(t, { base: 'dev', remoteAhead: true });
  assert.equal(git(rig.repoDir, 'branch', '--format=%(refname:short)'), 'dev');
  assert.equal(git(rig.repoDir, 'show', 'dev:.pir/settings.json'), JSON.stringify({ baseBranch: 'dev', setup: [], test: [SINGLE_RIG_TEST_LINE] }));
  assert.equal(git(rig.repoDir, 'ls-remote', '--heads', 'origin'), `${rig.remote.ahead}\trefs/heads/dev`);
  assert.equal(git(rig.repoDir, '--git-dir', rig.remote.path, 'rev-parse', `${rig.remote.ahead}^`), git(rig.repoDir, 'rev-parse', 'dev'));
  assert.equal(git(rig.repoDir, 'status', '--porcelain'), '');
  const bare = rigWithTeardown(t, { base: 'dev', settings: false });
  assert.ok(!existsSync(join(bare.repoDir, '.pir')), 'settings: false leaves the settings file out');
  assert.equal(bare.remote, null);
});

for (const [cols, rows] of SIZES) {
  test(`end to end at ${cols}×${rows}: \`pir plan\` in a dev-only repo plans from origin/dev, syncs with dev and hands over to the finisher on dev; no line says main`, { timeout: 120000 }, async (t) => {
    const rig = rigWithTeardown(t, DEV_RIG);
    const staleDev = git(rig.repoDir, 'rev-parse', 'dev');
    const screen = rig.openScreen({ cols, rows, args: ['plan', BRIEF] });
    const seen = new Set();
    const sampler = setInterval(() => seen.add(screen.text()), 40);
    try {
      const conv = (await screen.waitFor(new RegExp(esc(PLAN_RIG_QUESTION)), 20000)).join('\n');
      assert.match(conv, /^plan +worker \w+ · live/m, "the planner's conversation opens");
      screen.send(ENTER);
      await screen.waitFor(/^review +worker/m, 30000);
      screen.send(LEFT);
      const go = (await screen.waitFor(/Start the parallel build now\?/, 30000)).join('\n');
      assert.match(go, new RegExp(`${PLAN_RIG_SLUG} · reviewed · pir/${PLAN_RIG_SLUG}`));
      screen.send(ENTER);
      const preparing = (await screen.waitFor(/preparing: syncing dev, writing the report/, 60000)).join('\n');
      assert.doesNotMatch(preparing, /syncing main/);
      // A dev-based run hands over to the finisher as a main-based one does (user, 2026-09-30). The `ready
      // to merge` frame lasts one pass gap, so the end waited for is the finisher's row.
      const done = (await screen.waitFor(/◆ finisher +preparing/, 60000)).join('\n');
      assert.match(done, /T01 +first-task +merged/);
      assert.doesNotMatch(done, /git merge/, 'no merge line beside the finisher');
      assert.equal(screen.overflows(), 0);
    } finally {
      clearInterval(sampler);
      seen.add(screen.text());
      await screen.close();
    }
    // Every screen the person saw names dev, never main (the kept `main-sync` label aside, §2.9).
    const saysMain = [...seen].flatMap((shot) => shot.split('\n')).filter((l) => /\bmain\b/.test(l.replaceAll('main-sync', '')));
    assert.deepEqual([...new Set(saysMain)], [], 'no line on any screen says main');
    // The git side of the same run (§2.3, §2.5, §2.8): cut from origin/dev, the base remembered, dev only
    // fast-forwarded to origin/dev (its checkout was clean), no main made, the report synced with dev.
    const branch = `pir/${PLAN_RIG_SLUG}`;
    assert.equal(spawnSync('git', ['merge-base', '--is-ancestor', rig.remote.ahead, branch], { cwd: rig.repoDir }).status, 0, 'the plan was cut from origin/dev');
    assert.notEqual(staleDev, rig.remote.ahead);
    assert.equal(git(rig.repoDir, 'config', '--get', `branch.${branch}.pirBase`), 'dev');
    assert.equal(git(rig.repoDir, 'rev-parse', 'dev'), rig.remote.ahead, 'the clean local dev was moved forward to origin/dev');
    assert.equal(spawnSync('git', ['rev-parse', '--verify', '--quiet', 'refs/heads/main'], { cwd: rig.repoDir }).status, 1, 'no main was made');
    const report = git(rig.repoDir, 'show', `${branch}:plans/${PLAN_RIG_SLUG}/REPORT.md`);
    assert.match(report, new RegExp(`## Branch\\n\\nSynced with \`dev\` at \`${rig.remote.ahead.slice(0, 12)}\``));
  });
}

test('end to end: `pir plan` in the dev-only repo with .pir/settings.json removed → the no-base-setting text naming both files', (t) => {
  const rig = rigWithTeardown(t, { base: 'dev', remoteAhead: true, settings: false });
  const pir = fileURLToPath(new URL('./pir.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [pir, 'plan'], { cwd: rig.repoDir, env: rig.env, encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 1);
  assert.equal(
    r.stderr,
    'pir: no base branch is set for repo. Add .pir/settings.json with {"baseBranch": "<branch>"} (committed, for everyone), or ~/.pir/repo/settings.json (this machine only).\n',
  );
  assert.equal(git(rig.repoDir, 'for-each-ref', '--format=%(refname)', 'refs/heads'), 'refs/heads/dev', 'nothing created');
  assert.equal(git(rig.repoDir, 'rev-parse', 'dev'), git(rig.repoDir, '--git-dir', rig.remote.path, 'rev-parse', `${rig.remote.ahead}^`), 'dev not moved: no fetch before the refusal');
});
