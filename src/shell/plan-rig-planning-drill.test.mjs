// The planning rig (T10): a scratch repo, a scratch home and the fake `claude` first on PATH, with the
// real `pir` screen driven through a pseudo-terminal. No test here runs the real `claude` or writes the
// person's real `~/.pir`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PLAN_RIG_SLUG, PLAN_RIG_SLUG_2, PLAN_RIG_QUESTION, PLAN_RIG_REVIEW_ASK, PLAN_RIG_REVIEW_COMMAND } from './plan-rig.mjs';
import { resumeInstruction } from '../core/planflow.mjs';
import { indexDir, listRecords } from './index-store.mjs';
import { stopRun } from './control-run.mjs';
import { BRIEF, LABEL, esc, ndjson, RIGHT, UP, LEFT, ENTER, rigWithTeardown, CTRL_S } from './plan-rig-helpers.mjs';

// ---- T14: the drill (DESIGN §2.8, §2.10–§2.14, §2.16). One test per defect the drill fixed, and the
// drill paths the earlier tasks' tests did not already drive. ----

const CTRL_R = '\x12';

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
    // A → before the resumed program's first snapshot opens it read only; pir turns it live on a later
    // refresh (reliveWorker), so the header is waited for, not read from the first frame.
    const resumed = (await screen.waitFor((x) => /· resumed[\s\S]*remote control on/.test(x) && /^review +worker \w+ · live/m.test(x), 20000)).join('\n');
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
    const live = (await screen.waitFor((x) => /You were stopped/.test(x) && /^plan +worker \w+ · live/m.test(x), 20000)).join('\n');
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
