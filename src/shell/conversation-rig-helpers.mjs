// Shared by the conversation-rig test files (fast-tests T05). The original conversation-rig.test.mjs ran its
// 21 tests one after another in one process (~72 s); node --test runs files side by side, so the pty tests at
// each screen size live in their own file and register themselves from here. The test bodies are unchanged:
// each `define…` function is the body of the original `for (const [cols, rows] of …)` loop, called once per size.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startRig, openScreen, mouseBytes } from './conversation-rig.mjs';

export function scratchHome(t) {
  const home = mkdtempSync(join(tmpdir(), 'pir-rig-home-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return { PIR_HOME: home };
}

export async function waitFor(fn, { timeoutMs = 10000, what = 'the condition' } = {}) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

// pir-coordinator T06, end to end at 80×24 and 120×40: the coordinator agent holds T01's request, passes it
// on with a pointer in its own conversation, takes what the person types, and the run ends in `ready to merge`.
export function defineCoordinatorAgentTest([cols, rows]) {
  test(`the coordinator agent on the real pir screen at ${cols}×${rows}`, { timeout: 90000 }, async (t) => {
    const env = scratchHome(t);
    const rig = startRig({ env, scenario: 'coordinator', paceMs: 0, workMs: 300 });
    t.after(() => rig.stop());
    await waitFor(() => rig.platform.pending(rig.workerId)[0]?.requestId === 'perm-1', { what: 'T01 to ask' });
    await waitFor(() => existsSync(rig.agent.logPath) && readFileSync(rig.agent.logPath, 'utf8').includes('pretend coordinator agent'), { what: 'the agent to greet' });
    const ESC = '\x1b';
    const screen = openScreen({ cols, rows, env: { ...process.env, ...env } });
    try {
      await screen.waitFor(/rig +work +● running/);
      screen.send('\r');
      let s = (await screen.waitFor(/asking coordinator · allow a command\?/)).join('\n');
      assert.match(s, /T01 +coordinator +asking coordinator · allow a command\?/, 'the agent holds T01\'s request');
      assert.doesNotMatch(s, /asking you/, 'nothing asks the person yet');
      assert.match(s, /c coordinator/, 'the hint offers the agent');

      rig.pass();
      s = (await screen.waitFor(/T01 +coordinator +asking you · allow a command\?/)).join('\n');
      assert.match(s, /● T01 coordinator — asking you; open it \(→\) to answer/);

      screen.send('c');
      s = (await screen.waitFor(/coordinator ▸ T01 wants to push its task branch/)).join('\n');
      assert.match(s, /^coordinator {2}agent /m, 'the agent\'s conversation is open');

      screen.send('where are we?');
      await screen.waitFor(/where are we\?/);
      screen.send('\r');
      await screen.waitFor(/You said: where are we\?/, 20000);
      const sent = readFileSync(rig.agent.logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e.dir === 'out' && e.from === 'person');
      assert.deepEqual(sent.map((e) => [e.kind, e.text]), [['message', 'where are we?']], 'delivered to the agent\'s session through the inbox');

      screen.send(`${ESC}[D`);
      await screen.waitFor(/c coordinator/);
      rig.ready();
      s = (await screen.waitFor(/ready to merge · git merge pir\/rig/)).join('\n');
      assert.match(s, /report: plans\/rig\/REPORT\.md/);
      assert.match(s, /T01 +coordinator +merged/);

      screen.send(`${ESC}[D`);
      s = (await screen.waitFor(/● ready to merge/)).join('\n');
      assert.match(s, /rig +work +● ready to merge/, 'the dashboard row reads ready to merge');
      assert.match(s, /1 waiting for you/);

      for (const r of s.split('\n')) assert.ok([...r].length <= cols);
      assert.equal(screen.overflows(), 0, 'no frame was clipped to fit the window');
    } finally {
      await screen.close();
    }
  });
}

// mouse-navigation T06, end to end at 80×24 and 120×40: the wheel scrolls a worker's conversation three
// lines a notch, and a click in the typing box moves its caret. The tour's history fits a 120×40 screen,
// so this runs the `long` scenario (300 steps), which has more than fits at both sizes.
export function defineWheelTest([cols, rows]) {
  test(`the wheel scrolls a worker's conversation and a click moves the caret at ${cols}×${rows}`, { timeout: 90000 }, async (t) => {
    const env = scratchHome(t);
    const rig = startRig({ env, scenario: 'long', paceMs: 0, workMs: 300 });
    t.after(() => rig.stop());
    const screen = openScreen({ cols, rows, env: { ...process.env, ...env } });
    try {
      await screen.waitFor(/rig +work/);
      screen.send('\r');
      await screen.waitFor(/pick a task/);
      screen.send('\x1b[C');
      let s = await screen.waitFor(/That was 300 steps/, 30000);
      // group-commands §4: the 300 steps fold into one group line by default, so the history to scroll is
      // full detail's (Tab), every result line drawn.
      screen.send('\t');
      s = await screen.waitFor(/step 300 done/);
      assert.doesNotMatch(s.at(-1), /more below/);
      const mid = Math.floor(rows / 2);

      screen.send(mouseBytes.wheel(10, mid, 'up'));
      screen.send(mouseBytes.wheel(10, mid, 'up'));
      s = await screen.waitFor(/↓ 6 more below/);
      assert.match(s.at(-1), /^↓ 6 more below · ↵ send/);
      assert.doesNotMatch(s.join('\n'), /That was 300 steps|step 300 done/, 'the end scrolled out of view');
      assert.match(s.join('\n'), /line \d+ of a long result/, 'earlier lines came into view');

      screen.send(mouseBytes.wheel(10, mid, 'down'));
      screen.send(mouseBytes.wheel(10, mid, 'down'));
      s = await screen.waitFor((text) => !/more below/.test(text) && /That was 300 steps/.test(text));
      assert.match(s.at(-1), /^↵ send · esc interrupt/);

      screen.send('hello world');
      s = await screen.waitFor(/hello world/);
      const y = s.findIndex((l) => l.includes('hello world'));
      const x = s[y].indexOf('hello') + 2;
      screen.send(mouseBytes.click(x + 1, y + 1)); // the terminal counts from 1
      screen.send('X');
      await screen.waitFor(/heXllo world/);
      assert.equal(screen.overflows(), 0, 'no frame was clipped to fit the window');
    } finally {
      await screen.close();
    }
  });
}

// group-commands T02, end to end at 80×24 and 120×40: the tour's four opening steps fold into one group
// line as they finish; a click opens and folds it, two quick clicks are an open and a fold (never a word
// selection), a drag across it still copies, and Tab still shows full detail. Colour is on (NO_COLOR and
// COLORTERM dropped: the basic table), so the failed step's error style and the hover can be read. The
// rig's `pbcopy` shim is first on pir's PATH: a copy lands in its clipboard.txt, never the real clipboard.
const OPENING_GROUP = /▸ Read 1 file, searched 1 time, ran 1 shell command, edited 1 file · 1 failed/;
export function defineGroupLinesTest([cols, rows]) {
  test(`group lines fold the steps and a click opens them at ${cols}×${rows}`, { timeout: 120000 }, async (t) => {
    const home = scratchHome(t);
    const rig = startRig({ env: home, paceMs: 1500, workMs: 300 });
    t.after(() => rig.stop());
    const { NO_COLOR: _nc, COLORTERM: _ct, ...base } = process.env;
    const env = { ...base, ...home, PATH: `${rig.shimDir}:${process.env.PATH}` };
    const screen = openScreen({ cols, rows, env });
    const rowOf = (s, re) => s.findIndex((l) => re.test(l));
    const settle = () => new Promise((r) => setTimeout(r, 600));
    try {
      await screen.waitFor(/rig +work/);
      screen.send('\r');
      await screen.waitFor(/pick a task/);
      screen.send('\x1b[C');

      // A running step is on its own line; once finished it joins the group's count.
      let s = await screen.waitFor(/^ {2}⎿ (Read|Grep|Bash|Edit) /m, 20000);
      const running = s.find((l) => /^ {2}⎿ /.test(l));
      if (!/⎿ Read/.test(running)) assert.match(s.join('\n'), /▸ Read 1 file/, `the finished Read is counted beside the running step:\n${s.join('\n')}`);
      s = await screen.waitFor(OPENING_GROUP, 30000);
      assert.doesNotMatch(s.join('\n'), /⎿ (Read plans|Grep create|Bash npm test|Edit src)/, 'no finished step is left on its own line');

      // Hover brightens the group line.
      let y = rowOf(s, OPENING_GROUP);
      const x = s[y].indexOf('▸') + 3; // 1-based column of the label's first letter
      assert.ok(!screen.boldAt(y, x), 'plain before the pointer comes');
      screen.send(mouseBytes.move(x, y + 1));
      await screen.waitFor(() => screen.boldAt(y, x));

      // Click: open, four indented steps, the failed Bash one in the error style; click again: folded.
      screen.send(mouseBytes.click(x, y + 1));
      s = await screen.waitFor(/▾ Read 1 file/);
      y = rowOf(s, /▾ Read 1 file/);
      assert.match(s[y + 1], /^ {4}⎿ Read plans\/rig/);
      assert.match(s[y + 2], /^ {4}⎿ Grep createConversationView/);
      assert.match(s[y + 3], /^ {4}⎿ Bash npm test/);
      assert.match(s[y + 4], /^ {4}⎿ Edit src\/shell\/conversation-view\.mjs/);
      assert.equal(screen.fgAt(y + 3, 6), '31', 'the failed step is in the error style');
      assert.equal(screen.fgAt(y + 1, 6), '35', 'a passed one in the step style');
      screen.send(mouseBytes.click(x, y + 1));
      s = await screen.waitFor(OPENING_GROUP);
      assert.doesNotMatch(s.join('\n'), /▾ Read 1 file/);

      // Allow the push, refuse `rm -rf build/`: its group reads refused, not failed.
      await screen.waitFor(/↵ allow · n refuse/);
      screen.send('\r');
      // The request, pinned: the running `⎿ Bash rm -rf build/` line shows first, and an `n` then is typing.
      s = await screen.waitFor(/⚑ T01 wants to use Bash\s*\n\s*rm -rf build\/[\s\S]*↵ allow · n refuse/);
      screen.send('n');
      s = await screen.waitFor(/▸ Ran 1 shell command · 1 refused/);
      assert.doesNotMatch(s.join('\n'), /▸ Ran 1 shell command · 1 failed/);

      // Two quick clicks: an open and a fold, and no word selection copied.
      y = rowOf(s, OPENING_GROUP);
      screen.send(mouseBytes.click(x, y + 1) + mouseBytes.click(x, y + 1));
      await settle();
      s = await screen.waitFor(OPENING_GROUP);
      assert.equal(existsSync(rig.clipboard), false, 'nothing was copied');

      // A drag across the group line copies its text into the shim, and toggles nothing.
      y = rowOf(s, OPENING_GROUP);
      screen.send(mouseBytes.press(x, y + 1) + mouseBytes.drag(x + 10, y + 1) + mouseBytes.release(x + 10, y + 1));
      await waitFor(() => existsSync(rig.clipboard) && readFileSync(rig.clipboard, 'utf8').length > 0, { what: 'the drag to copy' });
      assert.match(readFileSync(rig.clipboard, 'utf8'), /Read 1 file/);
      await settle();
      assert.match(screen.text(), OPENING_GROUP, 'the drag did not open the group');

      // Tab: full detail, every step and its result lines; Tab back: grouped again.
      // Full detail is long: at 80×24 the npm test step is above the screen, so PgUp to it.
      screen.send('\t');
      await screen.waitFor(/⎿ Bash rm -rf build\/\s*\n\s*The person refused\./);
      const npmTest = /⎿ Bash npm test\s*\n\s*✖ conversation-view/;
      for (let i = 0; i < 6 && !npmTest.test(screen.text()); i++) {
        screen.send('\x1b[5~');
        await settle();
      }
      s = await screen.waitFor(npmTest);
      assert.match(s.join('\n'), /expected 80, got 90/);
      assert.doesNotMatch(s.join('\n'), /^ {2}[▸▾] /m);
      screen.send('\t\x1b[6~\x1b[6~\x1b[6~');
      await screen.waitFor(OPENING_GROUP);
      for (const r of screen.text().split('\n')) assert.ok([...r].length <= cols);
      assert.equal(screen.overflows(), 0, 'no frame was clipped to fit the window');
    } finally {
      await screen.close();
    }
  });
}
