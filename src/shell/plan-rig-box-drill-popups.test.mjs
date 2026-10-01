// The planning rig (T10): a scratch repo, a scratch home and the fake `claude` first on PATH, with the
// real `pir` screen driven through a pseudo-terminal. No test here runs the real `claude` or writes the
// person's real `~/.pir`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DRILL_SLUG } from './fake/sessions.mjs';
import { listRecords } from './index-store.mjs';
import { SIZES, ENTER, BS, TYPED, typeSettled, lastLine, buildRig, headOf, showsPopup, boxText, pause, clearBox } from './plan-rig-helpers.mjs';

// ---- box-commands T05: the drill, kept as end-to-end tests (DESIGN §2, §5 End to end). ----
// Each case is an interaction the drill drove through the real `pir` under a pty; what it judged is in
// FINDINGS.md (worker-driven, 2026-09-29).

const START_HINT = '↵ start the build · esc clear';

for (const [cols, rows] of SIZES) {
  test(`end to end at ${cols}×${rows}: every §2.5 head line, and the hint bare, on /plan and on /start`, { timeout: 60000 }, async (t) => {
    const { rig } = buildRig(t);
    const screen = rig.openScreen({ cols, rows });
    const footer = '↑↓ move · ↵ open · Ctrl+R resume · Ctrl+S stop · Ctrl+X remove · esc quit';
    const cases = [
      { keys: [BS, 'hi'], head: 'start with @repo', hint: TYPED },
      { keys: ['nope'], head: /^@nope is not a repo in \//, hint: TYPED },
      { keys: ['repo'], head: 'in repo — /plan, /start or /single' },
      { keys: ['repo/', 'bogus'], head: '/bogus is not a command — /plan, /start or /single' },
      { keys: ['repo/plan ', 'x'], head: 'plan in repo', hint: TYPED },
      { keys: ['repo/start '], head: 'build in repo', hint: START_HINT },
    ];
    try {
      const bare = await screen.waitFor(/new {2}start with @repo/);
      assert.equal(headOf(bare), 'new  start with @repo');
      assert.equal(lastLine(bare), cols >= 120 ? `${footer} · type @repo to plan or build` : footer);
      for (const c of cases) {
        await typeSettled(screen, ...c.keys);
        // The head line is waited for, not read off the first quiet frame: on a loaded machine that can still be
        // the frame from before the last key.
        const shows = (h) => (typeof c.head === 'string' ? h === c.head : c.head.test(h));
        const shot = await screen.waitFor((s) => shows((headOf(s.split('\n')) ?? '').slice('new  '.length)));
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
