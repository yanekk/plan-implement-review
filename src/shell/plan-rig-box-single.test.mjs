// The planning rig's box, `@repo/single <change>` (single-runs T09, DESIGN §2.1, §2.8): the third command
// driven through the real `pir` screen under a pty, with the fake builder and reviewer. The seatbelts are
// the rig's: a scratch repo, a scratch home, the fake `claude` first on PATH.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SINGLE_ID_RE } from '../core/singleflow.mjs';
import { indexDir, listRecords } from './index-store.mjs';
import { SINGLE_HINT } from './list-view.mjs';
import { SINGLE_RIG_NAME, SINGLE_RIG_QUESTION } from './plan-rig.mjs';
import { git, SIZES, ENTER, LEFT, TAB, esc, until, typeSettled, lastLine, rigWithTeardown, headOf, showsPopup, boxText, clearBox, SPAWNED_MS } from './plan-rig-helpers.mjs';

const recordsOf = (rig) => listRecords({ dir: indexDir({ env: rig.env }) });
// The pop-up's rows: under the box's bottom border (head, border, text, border), above the hint line.
const popupRows = (rows) => {
  const shown = rows.filter((l) => l !== '');
  return shown.slice(shown.findIndex((l) => l.startsWith('new  ')) + 4, -1);
};

for (const [cols, rows] of SIZES) {
  test(`end to end at ${cols}×${rows}: @repo/single fix the typo, Enter → the builder's conversation; its question answered there, the view follows into the reviewer's`, { timeout: 120000 }, async (t) => {
    const rig = rigWithTeardown(t, { scripts: 'single-asks' });
    const screen = rig.openScreen({ cols, rows });
    try {
      await screen.waitFor(/new {2}start with @repo/);
      await typeSettled(screen, 'repo/single ', 'fix the typo');
      const typed = await screen.waitFor();
      assert.equal(headOf(typed), 'new  change in repo');
      assert.equal(boxText(typed), '@repo/single fix the typo');
      assert.equal(lastLine(typed), SINGLE_HINT);
      screen.send(ENTER);

      // The builder's conversation, with its question showing: the box is gone.
      const asked = await screen.waitFor(new RegExp(esc(SINGLE_RIG_QUESTION)), SPAWNED_MS);
      assert.match(asked[0], /^build {2}worker \S+ · live/, asked.join('\n'));
      assert.ok(!asked.some((l) => l.startsWith('new  ')), 'no box in the conversation');
      assert.ok(asked.some((l) => l.includes('I read the change that was asked for.')), "the builder's own words");
      const [record] = recordsOf(rig);
      assert.deepEqual([recordsOf(rig).length, record.kind, record.label], [1, 'single', 'fix the typo']);
      assert.match(record.slug, SINGLE_ID_RE);

      // The person answers in the conversation (the first option is selected) and the builder goes on.
      screen.send(ENTER);
      // The builder is closed, the run renamed, and the reviewer starts under the open view: it follows.
      const followed = await screen.waitFor(/the builder finished; the reviewer has started/, 60000);
      assert.equal(followed[0], 'the builder finished; the reviewer has started');
      assert.match(followed[1], /^review {2}worker \S+/, followed.join('\n'));
      await screen.waitFor(new RegExp(`pir/${SINGLE_RIG_NAME} is reviewed\\.`), 60000);
      await until(() => recordsOf(rig).find((r) => r.slug === SINGLE_RIG_NAME && r.finalState === 'finished'), 'the run finished', 60000);

      // ← the run, ← the list: the box was reset to `@` when the run started.
      screen.send(LEFT);
      await screen.waitFor((s) => !/the builder finished/.test(s));
      screen.send(LEFT);
      const list = await screen.waitFor(/new {2}start with @repo/);
      assert.equal(boxText(list), '@');
      assert.ok(list.some((l) => new RegExp(`${SINGLE_RIG_NAME} .* repo `).test(l)), list.join('\n'));
      assert.equal(screen.overflows(), 0);
    } finally {
      await screen.close();
    }
  });
}

// The note lines, straight above the head line: every row from the counts line's spacer down to the head.
const notesOf = (rows) => {
  const head = rows.findIndex((l) => l.startsWith('new  '));
  let from = head;
  while (from > 0 && rows[from - 1] !== '') from -= 1;
  return rows.slice(from, head);
};

for (const [cols, rows] of SIZES) {
  test(`end to end at ${cols}×${rows}: the command pop-up ends with single, Tab on @repo/sin writes it, and each /single refusal shows its note whole with the text kept`, { timeout: 90000 }, async (t) => {
    const rig = rigWithTeardown(t, { scripts: 'single-happy' });
    const screen = rig.openScreen({ cols, rows });
    const settings = join(rig.repoDir, '.pir', 'settings.json');
    const NO_COMMANDS = 'Could not start the change in repo: no setup/test commands in its .pir/settings.json';
    const BROKEN = 'Could not start the change in repo: its pir settings are broken: "test" must be a non-empty list of commands';
    // At 80 columns the two long notes wrap at a word onto a second line (user, 2026-09-30).
    const wide = cols >= 120;
    try {
      await screen.waitFor(/new {2}start with @repo/);
      await typeSettled(screen, 'repo/');
      const commands = popupRows(await screen.waitFor(/→ plan +plan something new/));
      assert.deepEqual(commands.map((l) => l.replace(/ +/g, ' ').trim()), ['→ plan plan something new', 'start build a reviewed plan', 'single change something small']);
      for (const l of commands) assert.ok([...l].length <= cols, l);

      await typeSettled(screen, 'sin');
      assert.deepEqual(popupRows(await screen.waitFor(/→ single +change something small/)).length, 1);
      screen.send(TAB);
      const picked = await screen.waitFor((s) => /new {2}change in repo$/m.test(s) && !/^→ /m.test(s));
      assert.equal(boxText(picked), '@repo/single', 'the pick wrote `@repo/single `');
      assert.equal(lastLine(picked), SINGLE_HINT);
      await typeSettled(screen, 'x');
      assert.equal(boxText(await screen.waitFor()), '@repo/single x', 'a space follows the command');
      assert.ok(!showsPopup(await screen.waitFor()), 'no pop-up after the pick');
      await clearBox(screen);

      // No prompt.
      await typeSettled(screen, 'repo/single', '\x1b', ENTER);
      let noted = await screen.waitFor(/^say what to change after @repo\/single$/m);
      assert.deepEqual(notesOf(noted), ['say what to change after @repo/single']);
      assert.equal(boxText(noted), '@repo/single', 'the text is kept');
      await clearBox(screen);

      // The repo's settings name no test commands: refused before anything is created.
      writeFileSync(settings, JSON.stringify({ baseBranch: 'main' }) + '\n');
      await typeSettled(screen, 'repo/single ', 'fix the typo', ENTER);
      noted = await screen.waitFor(/\.pir\/settings\.json$/m);
      assert.deepEqual(notesOf(noted), wide ? [NO_COMMANDS] : ['Could not start the change in repo: no setup/test commands in its', '.pir/settings.json']);
      assert.equal(notesOf(noted).join(' '), NO_COMMANDS);
      assert.equal(boxText(noted), '@repo/single fix the typo', 'the text is kept');
      assert.equal(headOf(noted), 'new  change in repo');

      // A settings file with a key of the wrong shape: the note says what is wrong with it.
      writeFileSync(settings, JSON.stringify({ baseBranch: 'main', setup: [], test: [] }) + '\n');
      screen.send(ENTER);
      noted = await screen.waitFor(/list of commands$/m);
      assert.equal(notesOf(noted).join(' '), BROKEN);
      assert.equal(notesOf(noted).length, wide ? 1 : 2);
      assert.equal(boxText(noted), '@repo/single fix the typo');
      for (const l of noted) assert.ok([...l].length <= cols, l);
      assert.equal(screen.overflows(), 0);
    } finally {
      await screen.close();
    }
    assert.deepEqual(recordsOf(rig), [], 'nothing was started');
    assert.equal(git(rig.repoDir, 'branch', '--list', 'pir/*'), '', 'no branch was cut');
  });
}
