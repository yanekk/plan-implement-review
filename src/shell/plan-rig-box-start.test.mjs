// The planning rig (T10): a scratch repo, a scratch home and the fake `claude` first on PATH, with the
// real `pir` screen driven through a pseudo-terminal. No test here runs the real `claude` or writes the
// person's real `~/.pir`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { PLAN_RIG_QUESTION } from './plan-rig.mjs';
import { DRILL_SLUG } from './fake/sessions.mjs';
import { listRecords } from './index-store.mjs';
import { BRIEF, SIZES, esc, LEFT, ENTER, DOWN, typeSettled, buildRig } from './plan-rig-helpers.mjs';

// ---- box-commands T04: `@repo/start` starts, or opens, a build from the box (DESIGN §2.2, §2.4). ----
// The coordinator-drill set commits the reviewed three-task plan DRILL_SLUG in the rig repo, so `/start` has a
// buildable plan; the build it starts runs on the fake claude and is stopped by the teardown.

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
    for (const [typed, note] of [['repo a brief', 'pick a command: @repo/plan, /start or /single'], ['repo/start nope', 'nope is not a reviewed, unfinished plan in repo']]) {
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
