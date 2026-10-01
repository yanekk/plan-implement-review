// Shared by the conversation-rig test files (fast-tests T05). The original conversation-rig.test.mjs ran its
// 21 tests one after another in one process (~72 s); node --test runs files side by side, so the pty tests at
// each screen size live in their own file and register themselves from here. The test bodies are unchanged:
// each `define…` function is the body of the original `for (const [cols, rows] of …)` loop, called once per size.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startRig, openScreen, mouseBytes, RIG_DONE_SUMMARY, RIG_STUCK_SUMMARY, RIG_RESERVED_COMMAND } from './conversation-rig.mjs';
import { BASIC_SGR } from './palette.mjs';
import { indexDir, updateRecord } from './index-store.mjs';

// The helpers scenario's run row, listed live. The script runs on its own clock from the opening message:
// A asks its permission a few steps (5 × stepMs) after the start, and the row turns from `running` to
// `asking you`. Under load pir draws its first list later than that, so the row is waited for in either
// live state; the test needs only the row to open, and what follows is waited for on its own screen.
export const HELPERS_ROW = /rig +work +● (running|asking you)/;

export function scratchHome(t) {
  const home = mkdtempSync(join(tmpdir(), 'pir-rig-home-'));
  // Registered before the caller's `t.after(() => rig.stop())`, so it runs first (node:test runs after hooks
  // first in, first out) while the rig may still be writing its index here. node:test skips every later
  // hook once one throws, and a skipped rig.stop leaves the rig's timer and fakes holding the file open
  // forever, so a failed rm is retried and then left behind, never thrown: a stray temp dir is harmless.
  t.after(() => {
    try {
      rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {
      /* left in the temp dir */
    }
  });
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

export const logOf = (rig) => readFileSync(rig.logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

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
      s = (await screen.waitFor(/ready to merge · git switch main && git merge pir\/rig/)).join('\n');
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

// finisher T07, end to end at 80×24 and 120×40: the run waits at its end on the finisher. The list reads
// `● ready for your go`, the live view pins the finisher's row in amber with the footer naming `c`, `c` opens
// its conversation with the ready summary, the steps and the go question, and `Go` there takes the row
// through `finishing` to `done` and the run to `finished`.
export function defineFinisherTest([cols, rows]) {
  test(`the finisher on the real pir screen at ${cols}×${rows}`, { timeout: 90000 }, async (t) => {
    const env = scratchHome(t);
    const rig = startRig({ env, scenario: 'finisher', paceMs: 0, workMs: 300, finishingMs: 5000 });
    t.after(() => rig.stop());
    await waitFor(() => rig.finisher.view().state === 'awaiting-go', { what: 'the finisher to be ready', timeoutMs: 15000 });
    const ESC = '\x1b';
    const screen = openScreen({ cols, rows, env: { ...process.env, ...env } });
    try {
      let s = (await screen.waitFor(/rig +work +● ready for your go/)).join('\n');
      assert.match(s, /1 waiting for you/, 'the dashboard counts it as waiting');

      screen.send('\r');
      s = (await screen.waitFor(/◆ finisher +waiting for your go/)).join('\n');
      assert.match(s, /◆ finisher ready · c to review and say go/, 'the footer names c');
      assert.match(s, /c finisher/, 'the hint offers the finisher');
      assert.doesNotMatch(s, /git merge|coordinator agent/, 'no merge line and no agent row beside the finisher');
      // The amber itself is the renderer's (render.test.mjs); the suite runs with NO_COLOR, so none is drawn here.

      screen.send('c');
      s = (await screen.waitFor(/Ready to finish\? 2 steps from project rules/)).join('\n');
      assert.match(s, /^finisher {2}agent /m, 'the finisher\'s conversation is open');
      assert.match(s, /main has not moved/, 'the ready summary');
      assert.match(s, /merge pir\/rig/, 'the steps');

      screen.send('\r'); // one Enter picks the highlighted option, Go
      await screen.waitFor(/Ready to finish\? 2 steps from project rules → Go/);
      screen.send(`${ESC}[D`);
      s = (await screen.waitFor(/◆ finisher +finishing/)).join('\n');
      assert.match(s, /◆ finisher finishing · c to watch/);
      s = (await screen.waitFor(/◆ finisher +done/, 20000)).join('\n');
      s = (await screen.waitFor(/finished · this frame is stale\. The finisher is done\./, 20000)).join('\n');
      assert.doesNotMatch(s, /git merge/);

      screen.send(`${ESC}[D`);
      s = (await screen.waitFor(/rig +work +◌ finished/)).join('\n');
      for (const r of s.split('\n')) assert.ok([...r].length <= cols);
      assert.equal(screen.overflows(), 0, 'no frame was clipped to fit the window');
      const sent = rig.finisher.ledger().map((l) => l.kind);
      assert.ok(sent.includes('go'), `the person's Go reached the finisher: ${sent}`);
      // finisher T09: what the phone was told (DESIGN §2.9).
      const ready = assertReadyAlert(rig);
      assert.ok(cleared(rig, ready.seq), 'the ready alert is cleared once the go is in');
      assertDoneAlert(rig);
    } finally {
      await screen.close();
    }
  });
}

// finisher T09, the drill's cases kept as tests at 80×24 and 120×40 (DESIGN §2.7–§2.9, §2.11). Each drives
// the real pir screen through the conversation rig and checks what the pretend phone was sent: the ready
// alert names the step count, the rules' source and the first step; the stuck alert carries the stuck
// summary; a reserved request is `{slug} · finisher` with the permission wording; each phase alert is cleared
// once the phase leaves it; the done alert carries the done summary. No `ready to merge` alert is ever sent.
const sends = (rig) => rig.alerts().filter((a) => a.type === 'send');
const cleared = (rig, seq) => rig.alerts().some((a) => a.type === 'clear' && a.seq === seq);
function assertReadyAlert(rig) {
  const ready = sends(rig).find((a) => a.title === 'rig · ready for your go');
  assert.ok(ready, `the ready alert was sent: ${JSON.stringify(rig.alerts())}`);
  assert.match(ready.message, /^2 steps from project rules: git -C \S+ merge pir\/rig$/);
  return ready;
}
function assertDoneAlert(rig) {
  const done = sends(rig).at(-1);
  assert.deepEqual({ title: done.title, message: done.message, tags: done.tags }, { title: 'rig · finished', message: RIG_DONE_SUMMARY, tags: ['tada'] });
  assert.ok(!sends(rig).some((a) => /ready to merge/.test(a.title)), 'no ready-to-merge alert for a run the finisher takes over');
}
async function openFinisher(screen, cols) {
  await screen.waitFor(/rig +work +● ready for your go/);
  screen.send('\r');
  await screen.waitFor(/◆ finisher +waiting for your go/);
  screen.send('c');
  return (await screen.waitFor(/Ready to finish\? 2 steps from project rules \(pick one\)/)).join('\n');
}
function assertFits(screen, s, cols) {
  for (const r of s.split('\n')) assert.ok([...r].length <= cols, `a line fits ${cols} columns: ${r}`);
  assert.equal(screen.overflows(), 0, 'no frame was clipped to fit the window');
}

export function defineFinisherDrillTests([cols, rows]) {
  test(`finisher drill: a Not yet leaves the row waiting, and a later Go finishes, at ${cols}×${rows}`, { timeout: 90000 }, async (t) => {
    const env = scratchHome(t);
    const rig = startRig({ env, scenario: 'finisher-notyet', paceMs: 0, workMs: 300, finishingMs: 1500 });
    t.after(() => rig.stop());
    await waitFor(() => rig.finisher.view().state === 'awaiting-go', { what: 'the finisher to be ready', timeoutMs: 15000 });
    const ESC = '\x1b';
    const screen = openScreen({ cols, rows, env: { ...process.env, ...env } });
    try {
      await openFinisher(screen, cols);
      screen.send(`${ESC}[B`); // down to Not yet
      screen.send('\r');
      // The screen draws the picked answer itself, a frame before the finisher's reply can arrive: wait for
      // the frame that holds both, not the first one with the answer (it failed on a loaded machine).
      let s = (await screen.waitFor((text) => /project rules → Not yet/.test(text) && /Not yet, then\. Nothing has changed/.test(text))).join('\n');
      assert.equal(rig.finisher.phase(), 'awaiting-go', 'a Not yet is not a go');
      await waitFor(() => rig.finisher.ledger().some((l) => l.kind === 'not-yet'), { what: 'the Not yet in the ledger (the next pass drains it)' });
      assert.equal(rig.finisher.phase(), 'awaiting-go', 'still no go once it is drained');

      screen.send(`${ESC}[D`);
      s = (await screen.waitFor(/◆ finisher +waiting for your go/)).join('\n');
      assert.match(s, /◆ finisher ready · c to review and say go/, 'the row and footer are unchanged');
      screen.send(`${ESC}[D`);
      await screen.waitFor(/rig +work +● ready for your go/);
      screen.send('\r');
      await screen.waitFor(/◆ finisher +waiting for your go/);

      screen.send('c');
      await screen.waitFor(/project rules → Not yet/);
      screen.send('ask me again');
      await screen.waitFor(/ask me again/);
      screen.send('\r');
      await screen.waitFor((text) => /Asking again\./.test(text) && /\(pick one\)/.test(text));
      screen.send('\r'); // Go
      await screen.waitFor(/project rules → Go/);
      screen.send(`${ESC}[D`);
      s = (await screen.waitFor(/finished · this frame is stale\. The finisher is done\./, 20000)).join('\n');
      assertFits(screen, s, cols);

      assert.deepEqual(rig.finisher.ledger().filter((l) => l.kind !== 'status').map((l) => l.kind), ['not-yet', 'go']);
      const ready = assertReadyAlert(rig);
      assert.equal(sends(rig).filter((a) => a.title === ready.title).length, 1, 'asking again is the same wait: one ready alert');
      assert.ok(cleared(rig, ready.seq), 'the ready alert is cleared once the go is in');
      assertDoneAlert(rig);
    } finally {
      await screen.close();
    }
  });

  test(`finisher drill: a failed step turns the row stuck, and a second Go finishes, at ${cols}×${rows}`, { timeout: 90000 }, async (t) => {
    const env = scratchHome(t);
    const rig = startRig({ env, scenario: 'finisher-stuck', paceMs: 0, workMs: 300, finishingMs: 2500 });
    t.after(() => rig.stop());
    await waitFor(() => rig.finisher.view().state === 'awaiting-go', { what: 'the finisher to be ready', timeoutMs: 15000 });
    const ESC = '\x1b';
    const screen = openScreen({ cols, rows, env: { ...process.env, ...env } });
    try {
      await openFinisher(screen, cols);
      screen.send('\r'); // Go
      await screen.waitFor(/project rules → Go/);
      screen.send(`${ESC}[D`);
      let s = (await screen.waitFor(/◆ finisher +stuck · needs you/, 20000)).join('\n');
      assert.match(s, /◆ finisher stuck · c to review and say go/, 'the footer says so and names c');
      assert.equal(rig.finisher.phase(), 'stuck');
      screen.send(`${ESC}[D`);
      s = (await screen.waitFor(/rig +work +● asking you/)).join('\n');
      assert.match(s, /1 waiting for you/, 'the dashboard counts the stuck run as waiting');

      screen.send('\r');
      await screen.waitFor(/◆ finisher +stuck/);
      screen.send('c');
      s = (await screen.waitFor(/Retry the install\? 1 step from project rules \(pick one\)/)).join('\n');
      assert.match(s, /install\.sh failed/, 'the stuck summary is in the conversation');
      screen.send('\r'); // the second Go
      await screen.waitFor(/Retry the install\? 1 step from project rules → Go/);
      screen.send(`${ESC}[D`);
      s = (await screen.waitFor(/finished · this frame is stale\. The finisher is done\./, 20000)).join('\n');
      assertFits(screen, s, cols);

      assert.deepEqual(rig.finisher.ledger().map((l) => (l.kind === 'status' ? `${l.from}→${l.to}` : `${l.kind} ${l.from}→${l.to}`)), [
        'preparing→awaiting-go', 'go awaiting-go→finishing', 'finishing→stuck', 'go stuck→finishing', 'finishing→done',
      ]);
      const ready = assertReadyAlert(rig);
      const stuck = sends(rig).find((a) => a.title === 'rig · finisher stuck');
      assert.ok(stuck, 'the stuck alert was sent');
      assert.equal(stuck.message, RIG_STUCK_SUMMARY);
      assert.ok(cleared(rig, ready.seq) && cleared(rig, stuck.seq), 'each phase alert is cleared when its phase ends');
      assertDoneAlert(rig);
    } finally {
      await screen.close();
    }
  });

  test(`finisher drill: a reserved request after the go reads asking you and is answered in the conversation, at ${cols}×${rows}`, { timeout: 90000 }, async (t) => {
    const env = scratchHome(t);
    const rig = startRig({ env, scenario: 'finisher-reserved', paceMs: 0, workMs: 300, finishingMs: 1500 });
    t.after(() => rig.stop());
    await waitFor(() => rig.finisher.view().state === 'awaiting-go', { what: 'the finisher to be ready', timeoutMs: 15000 });
    const ESC = '\x1b';
    const screen = openScreen({ cols, rows, env: { ...process.env, ...env } });
    try {
      await openFinisher(screen, cols);
      screen.send('\r'); // Go
      await screen.waitFor(/project rules → Go/);
      screen.send(`${ESC}[D`);
      let s = (await screen.waitFor(/◆ finisher +asking you/, 20000)).join('\n');
      assert.match(s, /◆ finisher asking you · c to answer/);
      assert.equal(rig.finisher.phase(), 'finishing', 'the go stands; only the request waits');
      screen.send(`${ESC}[D`);
      s = (await screen.waitFor(/rig +work +● asking you/)).join('\n');
      assert.match(s, /1 waiting for you/);

      screen.send('\r');
      await screen.waitFor(/◆ finisher +asking you/);
      screen.send('c');
      s = (await screen.waitFor(/↵ allow · n refuse/)).join('\n');
      assert.match(s, new RegExp(RIG_RESERVED_COMMAND.replace(/[/-]/g, '\\$&')));
      screen.send('\r'); // allow
      await screen.waitFor(/Cleared\. Running the install\./, 20000);
      screen.send(`${ESC}[D`);
      s = (await screen.waitFor(/finished · this frame is stale\. The finisher is done\./, 20000)).join('\n');
      assertFits(screen, s, cols);

      const reserved = sends(rig).find((a) => a.title === 'rig · finisher');
      assert.ok(reserved, `the reserved request was alerted: ${JSON.stringify(rig.alerts())}`);
      assert.equal(reserved.message, `Needs your yes: wants to run Bash ${RIG_RESERVED_COMMAND}`);
      const ready = assertReadyAlert(rig);
      assert.ok(cleared(rig, ready.seq) && cleared(rig, reserved.seq), 'both alerts are cleared once answered');
      assertDoneAlert(rig);
    } finally {
      await screen.close();
    }
  });
}

// visible-helpers T03, end to end at 80×24 and 120×40 (DESIGN §2.2–§2.4): one updating line per helper, the
// helpers' steps only on Tab and labelled, a helper's permission named after it, and the status line
// naming the helper still running once the parent's turn has ended. 60×20 is the T06 drill's narrow size,
// where the step text is shortened so A's step count and time stay on screen (person, 2026-09-29).
export function defineHelperLinesTest([cols, rows]) {
  test(`the helpers scenario draws one line per helper on the real pir screen at ${cols}×${rows}`, { timeout: 60000 }, async (t) => {
    const env = scratchHome(t);
    // A helper reports a step every stepMs and each one repaints, so the driver's quiet time must be shorter.
    const rig = startRig({ env, scenario: 'helpers', stepMs: 400, workMs: 300 });
    t.after(() => rig.stop());
    const screen = openScreen({ cols, rows, env: { ...process.env, ...env }, settleMs: 100 });
    const lineOfA = (s) => s.match(/↳ helper · Survey the code · .*/)?.[0] ?? null;
    try {
      await screen.waitFor(HELPERS_ROW);
      screen.send('\r');
      await screen.waitFor(/pick a task/);
      screen.send('\x1b[C');
      let s = (await screen.waitFor(/↳ helper · Survey the code · [\s\S]*↳ helper · Check the tests · /)).join('\n');
      assert.doesNotMatch(s, /running in the background/, 'no background line for a helper');

      s = (await screen.waitFor(/⚑ helper "Survey the code" wants to use Bash[\s\S]*↵ allow/)).join('\n');
      assert.doesNotMatch(s, /⎿ Read/, 'none of the helpers\' steps in the default view');
      assert.doesNotMatch(s, /The worker process and the run state/, 'none of a helper\'s words either');
      screen.send('\r');

      s = (await screen.waitFor(/helper finished · Check the tests · \d+ steps?[\s\S]*◌ 1 helper running/)).join('\n');
      assert.match(s, /→ allowed/, 'Enter allowed the helper\'s request');
      assert.match(s, /⚑ helper "Survey the code" wants to use Bash/, 'the answered request still names the helper');
      assert.doesNotMatch(s, /⎿ (Read|Bash git log)/);

      // A keeps working while the parent is idle: its line's step and count move on a later frame.
      const first = lineOfA(s);
      assert.ok(first, `A's line is on screen:\n${s}`);
      assert.match(first, / · \d+ steps? · \d+s$/, 'the step count and time end the line at every size');
      s = (await screen.waitFor((text) => {
        const now = lineOfA(text);
        return now && now !== first;
      })).join('\n');
      const [, n1] = first.match(/(\d+) steps?\b/);
      const [, n2] = lineOfA(s).match(/(\d+) steps?\b/);
      assert.ok(Number(n2) > Number(n1), `the step count grew: ${first} → ${lineOfA(s)}`);

      screen.send('\t');
      s = (await screen.waitFor(/helper ⎿ Read/)).join('\n');
      assert.doesNotMatch(s, /^\s*⎿ Read/m, 'every helper step is labelled');
      for (const r of s.split('\n')) assert.ok([...r].length <= cols);
      assert.equal(screen.overflows(), 0, 'no frame was clipped to fit the window');
    } finally {
      await screen.close();
    }
  });
}

// visible-helpers T05, end to end at 80×24 and 120×40 (DESIGN §2.5, §2.6): Esc while a helper runs warns and
// sends nothing, another key disarms, a second Esc interrupts and stops the helper, and the person's next
// message carries pir's note naming it, to the model before the text and on screen under the message.
export function defineEscWarnsTest([cols, rows]) {
  test(`Esc warns before stopping a helper, and the next message carries the note, at ${cols}×${rows}`, { timeout: 90000 }, async (t) => {
    const env = scratchHome(t);
    const rig = startRig({ env, scenario: 'helpers', stepMs: 400, workMs: 300 });
    t.after(() => rig.stop());
    const screen = openScreen({ cols, rows, env: { ...process.env, ...env }, settleMs: 100 });
    const ESC = '\x1b';
    const WARNING = 'esc again to interrupt · this also stops 1 helper: Survey the code';
    const wire = () =>
      (existsSync(rig.received) ? readFileSync(rig.received, 'utf8') : '')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
        .filter((x) => x.line)
        .map((x) => JSON.parse(x.line));
    const interrupts = () => wire().filter((m) => m.type === 'control_request' && m.request?.subtype === 'interrupt').length;
    const userTexts = () => wire().filter((m) => m.type === 'user').map((m) => m.message.content);
    try {
      await screen.waitFor(HELPERS_ROW);
      screen.send('\r');
      await screen.waitFor(/pick a task/);
      screen.send(`${ESC}[C`);
      await screen.waitFor(/⚑ helper "Survey the code" wants to use Bash[\s\S]*↵ allow/);
      screen.send('\r');
      await screen.waitFor(/helper finished · Check the tests[\s\S]*◌ 1 helper running/);

      // First Esc: the warning on the status line, and nothing reaches the worker.
      screen.send(ESC);
      let s = (await screen.waitFor((text) => text.includes(WARNING))).join('\n');
      assert.ok(s.split('\n').some((r) => r.trim() === WARNING), `the warning is the status line:\n${s}`);
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(interrupts(), 0, 'the fake received no interrupt');

      // Another key disarms and does what it always does.
      screen.send('x');
      s = (await screen.waitFor((text) => !text.includes(WARNING) && /◌ 1 helper running/.test(text))).join('\n');
      assert.match(s, /^\S*\s*x\s*\S*$/m, `x is in the box:\n${s}`);
      assert.equal(interrupts(), 0);

      // Clear, then Esc, Esc: interrupted, and A reads stopped.
      screen.send('\x03');
      await screen.waitFor((text) => !/^\S*\s*x\s*\S*$/m.test(text));
      screen.send(ESC);
      await screen.waitFor((text) => text.includes(WARNING));
      screen.send(ESC);
      s = (await screen.waitFor(/you ▸ ⎋ interrupted the worker[\s\S]*/)).join('\n');
      s = (await screen.waitFor(/↳ helper stopped · Survey the code/)).join('\n');
      await waitFor(() => interrupts() === 1, { what: 'the interrupt at the fake' });

      // The next message: the note under it on screen, and note, blank line, text at the model.
      screen.send('continue');
      await screen.waitFor(/continue/);
      screen.send('\r');
      s = (await screen.waitFor(/you ▸ continue\n\s*pir ▸ \[pir\] Before this message, the person's interrupt stopped your/, 20000)).join('\n');
      assert.match(s.replace(/\s+/g, ' '), /"Survey the code"/, 'the note names the helper');
      await waitFor(() => userTexts().some((c) => c.endsWith('\n\ncontinue')), { what: 'the note and the text at the fake' });
      const noted = userTexts().find((c) => c.endsWith('\n\ncontinue'));
      assert.match(noted, /^\[pir\] Before this message, the person's interrupt stopped your helper: "Survey the code"\. It will not report back\./);
      // The fake echoes the whole user message, note and all.
      await screen.waitFor(/T01 ▸ Done with "\[pir\] Before this message[\s\S]*continue"\./, 20000);

      // The one after carries no note.
      screen.send('again');
      await screen.waitFor(/again/);
      screen.send('\r');
      s = (await screen.waitFor(/you ▸ again/, 20000)).join('\n');
      await waitFor(() => userTexts().includes('again'), { what: 'the plain message at the fake' });
      assert.doesNotMatch(s, /you ▸ again\n\s*pir ▸/, 'no note under the second message');
      const outs = logOf(rig).filter((e) => e.dir === 'out' && e.from === 'person' && e.kind === 'message');
      assert.deepEqual(outs.map((e) => [e.text, e.helpersStopped ?? null]), [['continue', ['a0fake00000000a01']], ['again', null]]);

      for (const r of s.split('\n')) assert.ok([...r].length <= cols);
      assert.equal(screen.overflows(), 0, 'no frame was clipped to fit the window');
    } finally {
      await screen.close();
    }
  });
}

// bang-commands T06, end to end at 60×20, 80×24 and 120×40 (DESIGN §2.1, §2.2, §2.4, §2.8): the person's `!` on
// the real pir screen, run by the rig's real forwarder in a real shell, its result reaching the fake worker.
// Colour is on (NO_COLOR and COLORTERM dropped: the basic table), so the `!`'s shell style can be read.
export function defineBangTest([cols, rows]) {
  test(`the person's ! runs a command in the conversation at ${cols}×${rows}`, { timeout: 120000 }, async (t) => {
    const home = scratchHome(t);
    const rig = startRig({ env: home, scenario: 'bang', paceMs: 0 });
    t.after(() => rig.stop());
    const { NO_COLOR: _nc, COLORTERM: _ct, ...base } = process.env;
    const screen = openScreen({ cols, rows, env: { ...base, ...home } });
    const ESC = '\x1b';
    const PINK = BASIC_SGR.shell.slice(2, -1); // '38;5;212', as fgAt reports it
    const wire = () =>
      (existsSync(rig.received) ? readFileSync(rig.received, 'utf8') : '')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
        .filter((x) => x.line)
        .map((x) => JSON.parse(x.line));
    const interrupts = () => wire().filter((m) => m.type === 'control_request' && m.request?.subtype === 'interrupt').length;
    const ends = () => logOf(rig).filter((e) => e.dir === 'shell' && e.kind === 'end');
    const boxRow = (s, re) => s.findLastIndex((l) => re.test(l));
    try {
      await screen.waitFor(/rig +work/);
      screen.send('\r');
      await screen.waitFor(/pick a task/);
      screen.send(`${ESC}[C`);
      await screen.waitFor(/pretend worker/, 20000);
      await waitFor(() => rig.platform.list()[0]?.state === 'idle', { what: 'the opening turn to end' });

      // `!` puts the box in command mode: the hint, and the `!` and the border in the shell style.
      screen.send('!');
      let s = await screen.waitFor((text) => text.split('\n').at(-1).startsWith('! command'));
      if (cols >= 80) assert.equal(s.at(-1).trimEnd(), "! command · ↵ run in this session's folder · ⌫ the ! to leave");
      assert.match(s.at(-1), /^! command · ↵ run in this session/);
      const y = boxRow(s, /^!\s*$/);
      assert.ok(y > 0, `the box holds the !:\n${s.join('\n')}`);
      assert.equal(screen.fgAt(y, 0), PINK, 'the ! is in the shell style');
      assert.equal(screen.fgAt(y - 1, 0), PINK, 'the box border is in the shell style');

      // A command with two lines of output: the block, its end line, then the worker's reply.
      screen.send(" printf 'one\\ntwo\\n'");
      await screen.waitFor(/printf 'one\\ntwo\\n'/);
      screen.send('\r');
      s = await screen.waitFor(/✓ exit 0 · \d+s · sent to T01[\s\S]*T01 ▸ Thanks, I read the output\./, 30000);
      let at = s.findIndex((l) => l.startsWith("you ! printf 'one\\ntwo\\n'"));
      assert.ok(at >= 0, s.join('\n'));
      assert.deepEqual(s.slice(at + 1, at + 4).map((l) => l.trimEnd()), ['  one', '  two', s[at + 3].trimEnd()]);
      assert.match(s[at + 3], /^ {2}✓ exit 0 · \d+s · sent to T01\s*$/);
      assert.match(s.slice(at + 4).join('\n'), /T01 ▸ Thanks, I read the output\./);
      assert.doesNotMatch(s.join('\n'), /you ▸ \[pir\] The person ran/, 'the message sent is not drawn a second time');
      assert.match(s.at(-1), /^↵ send · esc interrupt/, 'out of command mode once sent');

      // 200 lines: the last 12 under the count; Tab shows every one, by scrolling.
      screen.send('! seq 1 200');
      await screen.waitFor(/! seq 1 200/);
      screen.send('\r');
      await waitFor(() => ends().length === 2, { what: 'seq to end', timeoutMs: 20000 });
      s = await screen.waitFor(/ {2}200\s*\n {2}✓ exit 0/, 20000);
      const shown = () => new Set(screen.text().split('\n').map((l) => l.match(/^ {2}(\d+)\s*$/)?.[1]).filter(Boolean).map(Number));
      // Up from the end until the count line shows; nothing before 189 is ever drawn grouped.
      const grouped = new Set();
      for (let i = 0; i < 5 && !/… 188 earlier lines · Tab shows all/.test(screen.text()); i++) {
        for (const n of shown()) grouped.add(n);
        screen.send(`${ESC}[5~`);
        await screen.waitFor(null);
      }
      for (const n of shown()) grouped.add(n);
      assert.match(screen.text(), /… 188 earlier lines · Tab shows all/);
      assert.deepEqual([...grouped].filter((n) => n <= 200 && n > 2).sort((a, b) => a - b), Array.from({ length: 12 }, (_, i) => 189 + i), 'the last 12 lines and no others');
      screen.send(`${ESC}[6~`.repeat(5));
      await screen.waitFor((text) => !/more below/.test(text));
      screen.send('\t');
      await screen.waitFor(/ {2}200\s*\n {2}✓ exit 0/);
      const all = new Set();
      for (let i = 0; i < 40 && !all.has(1); i++) {
        for (const n of shown()) all.add(n);
        screen.send(`${ESC}[5~`);
        await screen.waitFor(null);
        for (const n of shown()) all.add(n);
      }
      for (let n = 1; n <= 200; n++) assert.ok(all.has(n), `line ${n} was shown in full detail`);
      screen.send('\t');
      screen.send(`${ESC}[6~`.repeat(40));
      await screen.waitFor((text) => !/more below/.test(text));

      // A long command: the status line; a second `!` is refused; Esc stops the command, not the worker.
      screen.send('! sleep 30');
      await screen.waitFor(/! sleep 30/);
      screen.send('\r');
      s = await screen.waitFor(/● running your command · \d+s · esc stops it/, 20000);
      assert.match(s.at(-1), /esc stops it/);
      screen.send('!ls');
      await screen.waitFor(/^!ls\s*$/m);
      screen.send('\r');
      s = await screen.waitFor(/a command is already running · esc stops it/);
      assert.ok(s.some((l) => /^!ls\s*$/.test(l)), 'the text stays in the box');
      screen.send('\x03'); // Ctrl+C with text only clears the box
      await screen.waitFor((text) => !/^!ls\s*$/m.test(text));
      assert.equal(ends().length, 2, 'clearing the box did not stop the command');
      screen.send(ESC);
      s = await screen.waitFor(/✗ stopped by you · \d+s · sent to T01/, 20000);
      assert.doesNotMatch(s.join('\n'), /● running your command/);
      await waitFor(() => logOf(rig).filter((e) => e.dir === 'in' && e.event?.type === 'result' && e.event.result === 'Thanks, I read the output.').length === 3, { what: 'the reply to the stopped command', timeoutMs: 20000 });
      assert.equal(interrupts(), 0, 'the worker was never interrupted');
      assert.equal(logOf(rig).filter((e) => e.dir === 'out' && e.kind === 'interrupt').length, 0);

      // The run stopped (its index record no longer running): the not-running refusal, the text kept.
      updateRecord({ repo: rig.repo, slug: rig.slug }, { finalState: 'stopped' }, { dir: indexDir({ env: home }) });
      screen.send('! ls');
      await screen.waitFor(/^! ls\s*$/m);
      screen.send('\r');
      s = await screen.waitFor(/the run is not running — your command was not sent/);
      assert.ok(s.some((l) => /^! ls\s*$/.test(l)), 'the text stays in the box');
      assert.equal(ends().length, 3, 'nothing ran');

      for (const r of screen.text().split('\n')) assert.ok([...r].length <= cols);
      assert.equal(screen.overflows(), 0, 'no frame was clipped to fit the window');
    } finally {
      await screen.close();
    }
  });
}

// bang-commands T07, end to end at 60×20, 80×24 and 120×40 (DESIGN §2.6, §2.7, §2.8): a command the worker hands
// the person, on the real pir screen. The hand-drill worker hands `printf handed` four times in one turn; the person
// runs it, edits and runs it, declines it with `n`, and declines it with a typed reply, and the live view row reads
// `asking you · run a command` while a request is pending and stops once the last is answered.
export const HAND_DECLINE_TEXT = 'later, please';
export function defineHandTest([cols, rows]) {
  test(`a command the worker hands the person, on the pir screen at ${cols}×${rows}`, { timeout: 120000 }, async (t) => {
    const home = scratchHome(t);
    const rig = startRig({ env: home, scenario: 'hand-drill', paceMs: 0 });
    t.after(() => rig.stop());
    const { NO_COLOR: _nc, COLORTERM: _ct, ...base } = process.env;
    const screen = openScreen({ cols, rows, env: { ...base, ...home } });
    const ESC = '\x1b';
    const PINK = BASIC_SGR.shell.slice(2, -1);
    const wire = () =>
      (existsSync(rig.received) ? readFileSync(rig.received, 'utf8') : '')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
        .filter((x) => x.line)
        .map((x) => JSON.parse(x.line));
    const answerTo = (id) => wire().find((m) => m.type === 'control_response' && m.response?.request_id === id)?.response?.response;
    const pending = () => rig.platform.pending(rig.workerId).map((r) => r.requestId);
    const PIN = /^! T01 asks you to run a command\s*$/m;
    try {
      await screen.waitFor(/rig +work/);
      screen.send('\r');
      await screen.waitFor(/pick a task/);
      let s = (await screen.waitFor(/T01 +hand-drill +asking you · run a command/, 20000)).join('\n');
      assert.match(s, /T01 +hand-drill +asking you · run a command/, 'the live view row asks');
      screen.send(`${ESC}[C`);

      // The pin: head (its ! pink), the command, why, the keys.
      s = await screen.waitFor(PIN, 20000);
      let y = s.findIndex((l) => /^! T01 asks you to run a command/.test(l));
      assert.match(s[y + 1], /^ {2}printf handed\s*$/);
      assert.match(s[y + 2], /^ {2}why: the rig needs your pretend login\s*$/);
      assert.match(s.slice(y + 3).join(' '), /↵ run · e edit first · n decline · or type a reply/);
      assert.equal(screen.fgAt(y, 0), PINK, 'the pinned ! is in the shell style');
      assert.equal(screen.fgAt(y + 1, 2), PINK, 'the command is in the shell style');

      // ↵: the command runs as handed; the agent gets pirResult as the tool's result and replies.
      screen.send('\r');
      s = await screen.waitFor(/✓ exit 0 · \d+s · sent to T01[\s\S]*T01 ▸ Got the result of the command I handed you\. \(1\)/, 30000);
      let at = s.findIndex((l) => /^! T01 asked you to run: printf handed/.test(l));
      assert.ok(at >= 0, s.join('\n'));
      assert.deepEqual(s.slice(at + 1, at + 3).map((l) => l.trimEnd()), ['you ! printf handed', '  handed']);
      const first = answerTo('hand-1');
      assert.equal(first.behavior, 'allow');
      assert.match(first.updatedInput.pirResult, /^\[pir\] The person ran your command:\n\$ printf handed\nexit 0/);
      await waitFor(() => pending().join() === 'hand-2', { what: 'the second hand request' });
      await screen.waitFor(PIN);

      // `e`: the box holds `! printf handed`, the pin stays; edited and run, the lead says it was edited.
      screen.send('e');
      s = await screen.waitFor(/^! printf handed\s*$/m);
      assert.match(s.join('\n'), PIN, 'still pinned while editing');
      screen.send('\x7f'.repeat('handed'.length));
      screen.send('edited');
      await screen.waitFor(/^! printf edited\s*$/m);
      screen.send('\r');
      s = await screen.waitFor(/T01 ▸ Got the result of the command I handed you\. \(2\)/, 30000);
      at = s.findIndex((l) => /^you ! printf edited/.test(l));
      assert.ok(at >= 0, s.join('\n'));
      assert.match(s[at + 1], /^ {2}edited\s*$/);
      const second = answerTo('hand-2');
      assert.equal(second.behavior, 'allow');
      assert.match(second.updatedInput.pirResult, /^\[pir\] The person edited your command and ran it:\n\$ printf edited\nexit 0/);
      await waitFor(() => pending().join() === 'hand-3', { what: 'the third hand request' });
      await screen.waitFor(PIN);

      // `n`: declined in the scrollback; the deny reached the fake.
      screen.send('n');
      s = await screen.waitFor(/T01 ▸ Got the result of the command I handed you\. \(3\)/, 30000);
      at = s.findLastIndex((l) => /^! T01 asked you to run: printf handed/.test(l));
      assert.match(s[at + 1], /^ {2}· declined\s*$/);
      assert.deepEqual([answerTo('hand-3').behavior, answerTo('hand-3').message], ['deny', 'The person declined to run it.']);
      await waitFor(() => pending().join() === 'hand-4', { what: 'the fourth hand request' });
      await screen.waitFor(PIN);

      // A typed reply declines with its words.
      screen.send(HAND_DECLINE_TEXT);
      await screen.waitFor(new RegExp(`^${HAND_DECLINE_TEXT}\\s*$`, 'm'));
      screen.send('\r');
      s = await screen.waitFor(/T01 ▸ Got the result of the command I handed you\. \(4\)/, 30000);
      assert.match(s.join('\n'), new RegExp(`^! T01 asked you to run: printf handed\\s*\\n {2}· declined: ${HAND_DECLINE_TEXT}\\s*$`, 'm'));
      assert.deepEqual([answerTo('hand-4').behavior, answerTo('hand-4').message], ['deny', `The person declined to run it. They said: ${HAND_DECLINE_TEXT}`]);
      assert.doesNotMatch(s.join('\n'), PIN, 'nothing is pinned once the last is answered');
      assert.deepEqual(pending(), []);

      // Back in the live view the row no longer asks.
      screen.send(`${ESC}[D`);
      s = (await screen.waitFor((text) => /T01 +hand-drill/.test(text) && !/asking you/.test(text), 20000)).join('\n');
      assert.match(s, /T01 +hand-drill +building/, s);

      for (const r of screen.text().split('\n')) assert.ok([...r].length <= cols);
      assert.equal(screen.overflows(), 0, 'no frame was clipped to fit the window');
    } finally {
      await screen.close();
    }
  });
}

// bang-commands T08, the drill (DESIGN §2.2): the screen is a reader, so a command keeps running with it closed
// and its result still reaches the worker. The person starts `sleep 3; echo done`, closes pir while it runs, and
// on reopening the conversation the block holds `done` and its end line says it was sent.
export function defineBangReopenTest([cols, rows]) {
  test(`a command keeps running with the pir screen closed, and reads done on reopening, at ${cols}×${rows}`, { timeout: 120000 }, async (t) => {
    const home = scratchHome(t);
    const rig = startRig({ env: home, scenario: 'bang', paceMs: 0 });
    t.after(() => rig.stop());
    const env = { ...process.env, ...home };
    const ends = () => logOf(rig).filter((e) => e.dir === 'shell' && e.kind === 'end');
    const open = async () => {
      const screen = openScreen({ cols, rows, env });
      await screen.waitFor(/rig +work/);
      screen.send('\r');
      await screen.waitFor(/pick a task/);
      screen.send('\x1b[C');
      await screen.waitFor(/pretend worker/, 20000);
      return screen;
    };
    let screen = await open();
    try {
      await waitFor(() => rig.platform.list()[0]?.state === 'idle', { what: 'the opening turn to end' });
      screen.send('! sleep 3; echo done');
      await screen.waitFor(/^! sleep 3; echo done\s*$/m);
      screen.send('\r');
      await screen.waitFor(/● running your command/, 20000);
    } finally {
      await screen.close();
    }
    assert.equal(ends().length, 0, 'still running when the screen closed');
    const [end] = await waitFor(() => (ends().length ? ends() : null), { what: 'the command to end with no screen open', timeoutMs: 20000 });
    assert.deepEqual([end.code, end.stopped, end.sent], [0, null, 'message']);
    await waitFor(() => logOf(rig).some((e) => e.dir === 'in' && e.event?.type === 'result' && e.event.result === 'Thanks, I read the output.'), { what: "the worker's reply", timeoutMs: 20000 });
    screen = await open();
    try {
      const s = await screen.waitFor(/T01 ▸ Thanks, I read the output\./, 20000);
      const at = s.findIndex((l) => /^you ! sleep 3; echo done/.test(l));
      assert.ok(at >= 0, s.join('\n'));
      assert.match(s[at + 1], /^ {2}done\s*$/);
      // `sleep 3` can take no less than 3s; a loaded machine stretches it past 4s, so only the floor is held.
      const endLine = s[at + 2].match(/^ {2}✓ exit 0 · (\d+)s · sent to T01\s*$/);
      assert.ok(endLine && Number(endLine[1]) >= 3, s[at + 2]);
      assert.doesNotMatch(s.join('\n'), /● running your command/);
      for (const r of s) assert.ok([...r].length <= cols);
      assert.equal(screen.overflows(), 0, 'no frame was clipped to fit the window');
    } finally {
      await screen.close();
    }
  });
}
