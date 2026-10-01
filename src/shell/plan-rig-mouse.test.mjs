// The planning rig (T10): a scratch repo, a scratch home and the fake `claude` first on PATH, with the
// real `pir` screen driven through a pseudo-terminal. No test here runs the real `claude` or writes the
// person's real `~/.pir`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { startPlanRig } from './plan-rig.mjs';
import { DRILL_SLUG } from './fake/sessions.mjs';
import { mouseBytes } from './conversation-rig.mjs';
import { indexDir, listRecords } from './index-store.mjs';
import { stopRun } from './control-run.mjs';
import { until, startRigPlan, LEFT, CTRL_S, seedRuns } from './plan-rig-helpers.mjs';

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
      // pir restores the screen before it exits, and close() is a SIGTERM: sent in that gap it kills pir
      // with its handler already gone, and the relay reports 241 (-15 & 0xff) for a clean esc.
      await until(() => screen.exited(), 'pir to exit by itself on esc');
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
