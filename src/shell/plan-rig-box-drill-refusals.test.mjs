// The planning rig (T10): a scratch repo, a scratch home and the fake `claude` first on PATH, with the
// real `pir` screen driven through a pseudo-terminal. No test here runs the real `claude` or writes the
// person's real `~/.pir`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DRILL_SLUG, drillPlanFiles } from './fake/sessions.mjs';
import { listRecords } from './index-store.mjs';
import { LEFT, ENTER, CTRL_S, typeSettled, lastLine, buildRig, headOf, showsPopup, boxText, pause, clearBox } from './plan-rig-helpers.mjs';

// ---- box-commands T05: the drill, kept as end-to-end tests (DESIGN §2, §5 End to end). ----
// Each case is an interaction the drill drove through the real `pir` under a pty; what it judged is in
// FINDINGS.md (worker-driven, 2026-09-29).

const SLUG_18 = 'an-eighteen-char-x';

// The pop-up's rows: under the box's bottom border (head, border, text, border), above the hint line.
const popupRows = (rows) => {
  const shown = rows.filter((l) => l !== '');
  return shown.slice(shown.findIndex((l) => l.startsWith('new  ')) + 4, -1);
};

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
