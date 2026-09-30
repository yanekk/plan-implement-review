// The conversation-view rig (T19): a pretend run the real `pir` screen can open, and a pty driver that
// works that screen with keys. Every worker here is the real Agent SDK on fake/claude-stream.mjs; no test
// runs the real `claude` or pays for a model.
// The pty tests at each screen size are in conversation-rig-80x24.test.mjs, conversation-rig-120x40.test.mjs
// and conversation-rig-60x20.test.mjs (fast-tests T05), so node --test runs them side by side with this file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startRig, driveScreen, openScreen, createScreenModel, scenarioScript, mouseBytes, RIG_TASK } from './conversation-rig.mjs';
import { loadDashboard } from './pir-tui.mjs';
import { indexDir, listRecords } from './index-store.mjs';
import { dropPersonInput } from './person-inbox.mjs';

const RIG = fileURLToPath(new URL('./conversation-rig.mjs', import.meta.url));
import { scratchHome, waitFor, logOf } from './conversation-rig-helpers.mjs';

const events = (rig) => logOf(rig).filter((e) => e.dir === 'in').map((e) => e.event);
const toolResultOf = (rig, id) =>
  events(rig)
    .filter((e) => e.type === 'user' && Array.isArray(e.message?.content))
    .flatMap((e) => e.message.content)
    .find((b) => b.type === 'tool_result' && b.tool_use_id === `toolu_${id}`);
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test("the rig's run is listed by loadDashboard as running, with one task whose worker is live", async (t) => {
  const env = scratchHome(t);
  const rig = startRig({ env, paceMs: 0 });
  t.after(() => rig.stop());
  const dash = await waitFor(() => {
    const d = loadDashboard({ dir: indexDir({ env }) });
    return d.rows[0]?.snap?.runState?.tasks?.[0]?.worker ? d : null;
  }, { what: 'the snapshot to name the worker' });
  assert.equal(dash.rows.length, 1);
  const row = dash.rows[0];
  assert.equal(row.state, 'running', 'pid and start time are the rig\'s own, so classifyRun says running');
  assert.equal(row.slug, 'rig');
  assert.equal(row.repo, rig.repo);
  const tasks = row.snap.runState.tasks;
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].id, RIG_TASK);
  assert.deepEqual(tasks[0].worker, { id: rig.workerId, live: true, logPath: rig.logPath, cwd: rig.repoRoot });
});

test('each tour step reaches the log in order, and the fake answers replies and an interrupt as a real worker', async (t) => {
  const env = scratchHome(t);
  const rig = startRig({ env, paceMs: 0, workMs: 400 });
  t.after(() => rig.stop());
  const drop = (input) => assert.deepEqual(dropPersonInput(rig.controlDir, { to: rig.workerId, ...input }, { coordinatorAlive: true }), { ok: true });
  const pendingIs = (id) => waitFor(() => rig.platform.pending(rig.workerId)[0]?.requestId === id, { what: `${id} to be pending` });

  await pendingIs('perm-rules');
  const reqs = logOf(rig).filter((e) => e.dir === 'request');
  assert.deepEqual(reqs[0].suggestions, [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'git push:*' }], behavior: 'allow', destination: 'localSettings' }]);
  drop({ kind: 'permission', requestId: 'perm-rules', decision: 'allow' });
  await waitFor(() => toolResultOf(rig, 'perm-rules'), { what: 'the push result' });
  assert.equal(toolResultOf(rig, 'perm-rules').content, 'Everything up-to-date');
  assert.equal(toolResultOf(rig, 'perm-rules').is_error, false);

  await pendingIs('perm-no');
  assert.equal(rig.platform.pending(rig.workerId)[0].defaultToNo, true, 'the second ask is flagged defaultToNo');
  drop({ kind: 'permission', requestId: 'perm-no', decision: 'deny', text: 'leave build/ alone' });
  await waitFor(() => toolResultOf(rig, 'perm-no'), { what: 'the refusal result' });
  assert.deepEqual([toolResultOf(rig, 'perm-no').content, toolResultOf(rig, 'perm-no').is_error], ['leave build/ alone', true], 'a refusal comes back as the tool\'s error, with the person\'s words');

  await pendingIs('perm-suppress');
  assert.equal(rig.platform.pending(rig.workerId)[0].suppressAlwaysAllowRule, true, 'the third ask is flagged suppressAlwaysAllowRule');
  drop({ kind: 'permission', requestId: 'perm-suppress', decision: 'allow' });

  await pendingIs('ask-1');
  const qs = rig.platform.pending(rig.workerId)[0];
  assert.equal(qs.kind, 'questions');
  assert.deepEqual(qs.questions.map((q) => q.multiSelect), [false, true], 'one single-select and one multi-select question');
  drop({ kind: 'answers', requestId: 'ask-1', answers: { [qs.questions[0].question]: 'pir-rig', [qs.questions[1].question]: 'tour, long' } });
  await waitFor(() => toolResultOf(rig, 'ask-1'), { what: 'the answers result' });
  assert.match(toolResultOf(rig, 'ask-1').content, /^User has answered your questions: "Which name should the rig command have\?"="pir-rig", "Which scenarios should it ship with\?"="tour, long"/);

  await waitFor(() => rig.platform.list()[0]?.state === 'idle', { what: 'the tour turn to end' });
  drop({ kind: 'message', text: 'hello rig' });
  await waitFor(() => events(rig).some((e) => e.type === 'result' && e.result === 'Done with "hello rig".'), { what: 'the reply' });

  drop({ kind: 'message', text: 'stop me' });
  await waitFor(() => events(rig).some((e) => e.type === 'assistant' && e.message.content[0]?.text === 'You said: stop me. Working on it.'), { what: 'the second turn to start' });
  drop({ kind: 'interrupt' });
  await waitFor(() => events(rig).some((e) => e.type === 'result' && e.subtype === 'error_during_execution'), { what: 'the interrupted result' });
  const tail = events(rig).slice(-2);
  assert.deepEqual(tail[0].message.content, [{ type: 'text', text: '[Request interrupted by user]' }], 'the CLI\'s own interrupted line');
  assert.ok(!events(rig).some((e) => e.type === 'result' && e.result === 'Done with "stop me".'), 'the interrupted turn never replies');

  // Every step, in the order the scenario runs them.
  const uses = events(rig).filter((e) => e.type === 'assistant').flatMap((e) => e.message.content).filter((b) => b.type === 'tool_use').map((b) => b.id);
  assert.deepEqual(uses, ['read1', 'grep1', 'bash1', 'edit1', 'perm-rules', 'perm-no', 'perm-suppress', 'ask-1', 'chat_1', 'chat_2'].map((x) => `toolu_${x}`));
  assert.equal(toolResultOf(rig, 'bash1').is_error, true, 'one step failed');
  const init = events(rig).find((e) => e.type === 'system' && e.subtype === 'init');
  assert.ok(init.slash_commands.includes('context'));
  for (const c of ['doctor', 'color', 'focus', 'reload-plugins']) {
    assert.ok(init.slash_commands.includes(c) && init.terminal_slash_commands.includes(c), `${c} is offered and marked terminal-only`);
  }
});

test('the long scenario puts the log over 256 KB', async (t) => {
  const env = scratchHome(t);
  const rig = startRig({ env, scenario: 'long', paceMs: 0 });
  t.after(() => rig.stop());
  await waitFor(() => rig.platform.list()[0]?.activity.turns >= 1, { what: 'the long turn to end', timeoutMs: 20000 });
  assert.ok(statSync(rig.logPath).size > 262144, `the log is ${statSync(rig.logPath).size} bytes`);
});

test('an unknown scenario is refused', () => {
  assert.throws(() => scenarioScript('nope'), /unknown scenario "nope"/);
});

test('teardown leaves no child process, no index record and no scratch folder; --keep keeps the folder', async (t) => {
  const env = scratchHome(t);
  const rig = startRig({ env, paceMs: 0 });
  await waitFor(() => rig.platform.pending(rig.workerId).length, { what: 'the worker to ask' });
  assert.ok(rig.pid && alive(rig.pid));
  await rig.stop();
  assert.equal(alive(rig.pid), false, 'the fake claude has exited');
  assert.deepEqual(rig.platform.list(), []);
  assert.deepEqual(listRecords({ dir: indexDir({ env }) }), []);
  assert.equal(existsSync(rig.repoRoot), false);

  const into = join(mkdtempSync(join(tmpdir(), 'pir-rig-keep-')), 'repo');
  t.after(() => rmSync(join(into, '..'), { recursive: true, force: true }));
  const kept = startRig({ env, into, keep: true, paceMs: 0 });
  await kept.stop();
  assert.ok(existsSync(join(into, 'plans', 'rig', 'PROGRESS.md')), '--keep leaves the scratch repo');
  assert.throws(() => startRig({ env, into }), /not empty/, 'the rig never builds into, or later deletes, a folder that has things in it');
});

test('the command runs in the foreground and tears down on Ctrl+C', async (t) => {
  const env = scratchHome(t);
  const into = join(mkdtempSync(join(tmpdir(), 'pir-rig-cmd-')), 'repo');
  t.after(() => rmSync(join(into, '..'), { recursive: true, force: true }));
  const child = spawn(process.execPath, [RIG, '--into', into, '--scenario', 'tour'], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  const exited = new Promise((r) => child.once('exit', (code) => r(code)));
  await waitFor(() => out.includes('rig running'), { what: 'the rig to start' });
  const [record] = listRecords({ dir: indexDir({ env }) });
  assert.equal(record.pid, child.pid, 'the index record carries the rig\'s own pid');
  const workers = JSON.parse(await waitFor(() => { try { return readFileSync(join(record.controlDir, 'workers.json'), 'utf8'); } catch { return null; } }));
  child.kill('SIGINT');
  assert.equal(await exited, 0);
  assert.match(out, /torn down/);
  assert.deepEqual(listRecords({ dir: indexDir({ env }) }), []);
  assert.equal(existsSync(into), false);
  for (const w of workers) assert.equal(alive(w.pid), false, 'the worker went with the rig');
});

test('the screen model keeps a row the cursor is parked on, and drops colour, OSC, APC and split escapes', () => {
  const m = createScreenModel({ rows: 3, cols: 10 });
  m.write('\x1b[?1049h\x1b[2J\x1b[H\x1b[1;1H\x1b[2K\x1b[32mhello\x1b[0m\x1b]8;;\x07');
  m.write('\x1b[2;1H\x1b[2K> box\x1b_Gx\x1b\\');
  m.write('\x1b[2;3H\x1b[?25h'); // the cursor parked inside the box: no text written
  m.write('\x1b[3;1H\x1b[2Kwide 界 and more text past the edge');
  m.write('\x1b[1;');
  m.write('7Hworld'); // an escape split across two writes
  assert.deepEqual(m.rows(), ['hello world', '> box', 'wide 界 an'].map((r) => r.slice(0, 10)));
  const past = m.overflows();
  assert.ok(past > 0, 'text past the right edge is counted');
  m.write('\x1b[4;1H');
  m.write('\x1b[3;1H\n');
  assert.equal(m.overflows(), past + 2, 'a row address below the grid and a line feed on the last row are counted');
});

// mouse-navigation T01: the bytes a terminal sends for the mouse under SGR (1006) reporting.
test('mouseBytes emits the exact SGR sequences, every button included', () => {
  assert.equal(mouseBytes.press(5, 3), '\x1b[<0;5;3M');
  assert.equal(mouseBytes.press(5, 3, { button: 'middle' }), '\x1b[<1;5;3M');
  assert.equal(mouseBytes.press(5, 3, { button: 'right' }), '\x1b[<2;5;3M');
  assert.equal(mouseBytes.release(5, 3), '\x1b[<0;5;3m');
  assert.equal(mouseBytes.release(5, 3, { button: 'right' }), '\x1b[<2;5;3m', 'SGR release keeps the button code');
  assert.equal(mouseBytes.release(5, 3, { button: 'middle' }), '\x1b[<1;5;3m');
  assert.equal(mouseBytes.click(12, 7), '\x1b[<0;12;7M\x1b[<0;12;7m');
  assert.equal(mouseBytes.move(1, 1), '\x1b[<35;1;1M');
  assert.equal(mouseBytes.drag(40, 20), '\x1b[<32;40;20M');
  assert.equal(mouseBytes.wheel(10, 4, 'up'), '\x1b[<64;10;4M');
  assert.equal(mouseBytes.wheel(10, 4, 'down'), '\x1b[<65;10;4M');
  assert.throws(() => mouseBytes.press(1, 1, { button: 'side' }), /unknown mouse button/);
  assert.throws(() => mouseBytes.wheel(1, 1, 'left'), /up or down/);
});

test('the screen model reads private modes: set, reset, several at once, and split across writes', () => {
  const m = createScreenModel({ rows: 3, cols: 10 });
  assert.deepEqual([...m.modes()], []);
  m.write('\x1b[?1000h\x1b[?1003h');
  assert.deepEqual([...m.modes()].sort(), [1000, 1003]);
  m.write('\x1b[?1003l');
  assert.deepEqual([...m.modes()], [1000]);
  m.write('\x1b[?1000;1006h');
  assert.deepEqual([...m.modes()].sort(), [1000, 1006]);
  m.write('\x1b[?1006;1000l');
  assert.deepEqual([...m.modes()], []);
  m.write('\x1b[?10');
  assert.deepEqual([...m.modes()], [], 'half a sequence sets nothing yet');
  m.write('49hhi');
  assert.deepEqual([...m.modes()], [1049], 'the pending path completes it');
  m.write('\x1b[?2026$p\x1b[>1u\x1b[2 q');
  assert.deepEqual([...m.modes()], [1049], 'a mode query, a Kitty keyboard push and a cursor style are not modes');
  m.modes().add(7);
  assert.deepEqual([...m.modes()], [1049], 'modes() hands out a copy');
  assert.equal(m.rows()[0], 'hi', 'mode sequences draw nothing');
});

test('the screen model keeps which cells are bold, and colour parameters never read as bold', () => {
  const m = createScreenModel({ rows: 4, cols: 12 });
  m.write('\x1b[1;1Hab\x1b[1mcd\x1b[0mef');
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((c) => m.boldAt(0, c)), [false, false, true, true, false, false]);
  m.write('\x1b[2;1H\x1b[1mxy\x1b[22mzw');
  assert.deepEqual([0, 1, 2, 3].map((c) => m.boldAt(1, c)), [true, true, false, false], 'SGR 22 clears bold');
  m.write('\x1b[3;1H\x1b[38;2;1;2;3mq\x1b[48;5;1mr\x1b[38;2;1;1;1;1ms\x1b[m');
  assert.deepEqual([0, 1, 2].map((c) => m.boldAt(2, c)), [false, false, true], '38;2;r;g;b and 48;5;n are stepped over; a 1 after them is bold');
  m.write('\x1b[4;1H\x1b[1;38;5;2mt\x1b[mu');
  assert.deepEqual([m.boldAt(3, 0), m.boldAt(3, 1)], [true, false], 'bold with colour in one SGR, then an empty SGR resets');
  m.write('\x1b[4;1H\x1b[1m\x1b[38:2::1:2:3mv\x1b[1;mw');
  assert.deepEqual([m.boldAt(3, 0), m.boldAt(3, 1)], [true, false], 'a lone colon colour keeps bold; an empty parameter resets');
  m.write('\x1b[1;3H\x1b[2K');
  assert.equal(m.boldAt(0, 2), false, 'an erased cell is not bold');
  assert.equal(m.boldAt(9, 99), false, 'off the grid is not bold');
  m.write('\x1b[2J');
  assert.equal(m.boldAt(1, 0), false);
});

// T08: the foreground each cell was drawn in, so a pty test can see the hovered asking row's brighter amber.
test('the screen model keeps each cell\'s foreground: basic, 256 and 24-bit codes, reset by 0 and 39', () => {
  const m = createScreenModel({ rows: 3, cols: 12 });
  m.write('\x1b[1;1Ha\x1b[1;33mb\x1b[0mc\x1b[93md\x1b[39me');
  assert.deepEqual([0, 1, 2, 3, 4].map((c) => m.fgAt(0, c)), [null, '33', null, '93', null]);
  m.write('\x1b[2;1H\x1b[1;38;2;252;241;215mf\x1b[48;5;236mg\x1b[38;5;2mh\x1b[mi');
  assert.deepEqual([0, 1, 2, 3].map((c) => m.fgAt(1, c)), ['38;2;252;241;215', '38;2;252;241;215', '38;5;2', null], 'a background leaves the foreground');
  assert.equal(m.boldAt(1, 0), true, 'bold is still read with a colour in the same SGR');
  m.write('\x1b[2;1H\x1b[2K');
  assert.equal(m.fgAt(1, 0), null, 'an erased cell has no colour');
  assert.equal(m.fgAt(9, 99), null, 'off the grid');
});

// mouse-navigation T04: pir runs with mouse reporting on, and every exit it can see turns it off again.
// Only the mouse modes are checked afterwards: pi-tui leaves others (?7 autowrap) set (FINDINGS).
const MOUSE_MODES = [1000, 1002, 1003, 1004, 1006];
const mouseModesOn = (modes) => MOUSE_MODES.filter((m) => modes.has(m));

test('pir switches the alternate screen and mouse reporting on, with all-motion for hover', { timeout: 30000 }, async (t) => {
  const env = scratchHome(t);
  const screen = openScreen({ cols: 80, rows: 24, env: { ...process.env, ...env } });
  try {
    await screen.waitFor((text) => text.trim() !== '');
    const modes = screen.modes();
    assert.ok(modes.has(1049), `the alternate screen is on: ${[...modes]}`);
    for (const m of [1000, 1003, 1006]) assert.ok(modes.has(m), `mouse mode ${m} is on: ${[...modes]}`);
  } finally {
    await screen.close();
  }
});

test('Esc quits pir and leaves no mouse mode set', { timeout: 30000 }, async (t) => {
  const env = scratchHome(t);
  const screen = openScreen({ cols: 80, rows: 24, env: { ...process.env, ...env } });
  let code;
  try {
    await screen.waitFor((text) => text.trim() !== '');
    assert.ok(screen.modes().has(1000));
    screen.send('\x1b');
    await waitFor(() => mouseModesOn(screen.modes()).length === 0 && !screen.modes().has(1049), { what: 'the mouse modes and the alternate screen to be switched off' });
    // The restore is written a moment before pir's process exits, with its signal handlers already off. Closing
    // the input in that gap SIGTERMs it (exit 241 under a loaded full suite), so wait for the exit itself.
    await waitFor(() => screen.exited(), { what: 'pir to exit on Esc by itself' });
  } finally {
    code = await screen.close();
  }
  assert.equal(code, 0, 'pir quit on Esc by itself, before its input closed');
  assert.deepEqual(mouseModesOn(screen.modes()), []);
});

// The rig's close() ends pir's input, and the pty relay then sends pir SIGTERM, the signal a `kill` sends.
test('SIGTERM to pir leaves no mouse mode set, and pir exits 143 through its own handler', { timeout: 30000 }, async (t) => {
  const env = scratchHome(t);
  const screen = openScreen({ cols: 80, rows: 24, env: { ...process.env, ...env } });
  await screen.waitFor((text) => text.trim() !== '');
  assert.ok(screen.modes().has(1003), 'the mouse was on before the signal');
  const code = await screen.close();
  assert.equal(code, 143, 'exited 128 + SIGTERM from the restore handler, not killed by the signal');
  const modes = screen.modes();
  assert.deepEqual(mouseModesOn(modes), [], `no mouse mode is left set: ${[...modes]}`);
  assert.ok(!modes.has(1049), 'and the alternate screen was left');
});

// The driver on the tour: open the rig's run from the dashboard, open its worker, answer everything, talk
// to it, interrupt it, step back out. Each capture waits for what that key should bring up.
test('the driver walks the tour on the real pir screen', { timeout: 90000 }, async (t) => {
  const env = scratchHome(t);
  const rig = startRig({ env, paceMs: 0, workMs: 4000 });
  t.after(() => rig.stop());
  const cols = 100;
  const rows = 30;
  const ESC = '\x1b';
  const { screens, overflows } = await driveScreen({
    cols,
    rows,
    env: { ...process.env, ...env },
    first: new RegExp(rig.repo),
    keys: [
      { keys: '\r', until: /pick a task/ },
      { keys: `${ESC}[C`, until: /↵ allow · n refuse · a allow, don't ask again/ },
      { keys: '\r', until: /→ allowed[\s\S]*⚑ T01 wants to use Bash\s*\n\s*rm -rf build\// },
      { keys: '\r', until: /press ↵ again to allow/ },
      { keys: '\r', until: /⚑ T01 wants to use Write/ },
      { keys: '\r', until: /\? T01 asks you 2 questions/ },
      // One Enter chooses the highlighted line of a single-select question (user 2026-09-26, T18 drill).
      { keys: '\r', until: /Which scenarios should it ship with\? \(pick any\)/ },
      { keys: ' ', until: /\[x\] tour/ },
      { keys: `${ESC}[B`, until: /❯ \[ \] long/ },
      { keys: ' ', until: /\[x\] long/ },
      // Typing lands on the Other line, next to "Other:", not in the box (user 2026-09-26, T18 drill).
      { keys: 'mine too', until: /❯ \[x\] Other: mine too▏/ },
      { keys: '\r', until: /Which scenarios should it ship with\? → tour, long, mine too/ },
      { keys: 'hello rig', until: /hello rig/ },
      { keys: '\r', until: /Done with "hello rig"\./, timeoutMs: 20000 },
      { keys: 'stop me\r', until: /You said: stop me\. Working on it\./ },
      { keys: ESC, until: /⎋ interrupted the worker[\s\S]*\[Request interrupted by user\]/ },
      { keys: `${ESC}[D`, until: /pick a task/ },
    ],
  });

  for (const s of screens) assert.equal(s.rows.length, rows, 'every captured screen is exactly `rows` lines');
  assert.equal(overflows, 0, 'pir never addressed, scrolled or wrote past the window, so no frame was clipped to fit');
  const conversation = screens.slice(2, -1);
  for (const s of conversation) {
    assert.match(s.rows.at(-1), /esc (interrupt|to talk instead) · ← back/, `the key hint is the last line:\n${s.rows.join('\n')}`);
    assert.match(s.rows.at(-2), /^─+$/, 'the box\'s lower edge is right above it');
  }
  const opened = screens[2].rows;
  assert.match(opened[0], new RegExp(`^T01  worker ${rig.workerId.slice(0, 8)} · live`), 'the header names the worker');
  const text = (i) => screens[i].rows.join('\n');
  // group-commands §4: the four opening steps fold into one group line, flagged with the failed npm test.
  assert.match(text(2), /▸ Read 1 file, searched 1 time, ran 1 shell command, edited 1 file · 1 failed/, 'the tool steps are in the scrollback, the failed one included');
  assert.match(text(13), /Which name should the rig command have\? → pir-rig/);
  assert.match(text(screens.length - 1), /T01/, '← returned to the run\'s live view');

  const sent = logOf(rig).filter((e) => e.dir === 'out' && e.from === 'person').map((e) => e.kind);
  assert.deepEqual(sent, ['reply', 'reply', 'reply', 'reply', 'message', 'message', 'interrupt'], 'every answer the screen gave went through the inbox to the worker');
});

// visible-helpers T02: the helpers scenario on the real pir screen. The run is listed running, and T01's
// conversation opens on the worker's opening message and its first helper's Agent step. What the screen
// then makes of the helpers is T03's and T05's to test on this same scenario.
test('the helpers scenario drives the real pir screen', { timeout: 60000 }, async (t) => {
  const env = scratchHome(t);
  const rig = startRig({ env, scenario: 'helpers', stepMs: 100, workMs: 300 });
  t.after(() => rig.stop());
  const screen = openScreen({ cols: 100, rows: 30, env: { ...process.env, ...env } });
  try {
    await screen.waitFor(/rig +work +● running/);
    screen.send('\r');
    await screen.waitFor(/pick a task/);
    screen.send('\x1b[C');
    // The Agent step folds into its group (group-commands §2.1), and the helper's line follows it.
    const s = (await screen.waitFor(/↳ helper · Survey the code/)).join('\n');
    assert.match(s, /▸ Ran 1 agent\n +↳ helper · Survey the code/, 'the helper line sits under its Agent step\'s group');
    assert.match(s, /I'm the pretend worker of the helpers rig/, 'the opening message is on screen');
    assert.match(s, new RegExp(`^T01  worker ${rig.workerId.slice(0, 8)} · live`, 'm'), 'T01\'s conversation is the one open');
    assert.equal(screen.overflows(), 0);
  } finally {
    await screen.close();
  }
});

test('the helpers scenario runs its script in order: two helpers, A asks, B ends, A killed by an idle interrupt, then chat', { timeout: 30000 }, async (t) => {
  const env = scratchHome(t);
  const rig = startRig({ env, scenario: 'helpers', stepMs: 20, workMs: 200 });
  t.after(() => rig.stop());
  const drop = (input) => assert.deepEqual(dropPersonInput(rig.controlDir, { to: rig.workerId, ...input }, { coordinatorAlive: true }), { ok: true });
  const sys = (subtype) => events(rig).filter((e) => e.type === 'system' && e.subtype === subtype);
  const A = 'a0fake00000000a01';
  const B = 'a0fake00000000b02';

  await waitFor(() => rig.platform.pending(rig.workerId)[0]?.requestId === 'helperA-perm', { what: 'helper A to ask' });
  const started = sys('task_started');
  assert.deepEqual(started.map((e) => [e.task_id, e.tool_use_id, e.description, e.task_type, e.is_backgrounded]), [
    [A, 'toolu_agentA', 'Survey the code', 'local_agent', true],
    [B, 'toolu_agentB', 'Check the tests', 'local_agent', true],
  ]);
  const helperFrames = events(rig).filter((e) => e.parent_tool_use_id);
  assert.ok(helperFrames.some((e) => e.parent_tool_use_id === 'toolu_agentA' && e.message.content[0].type === 'text'), 'a helper text frame');
  assert.ok(helperFrames.some((e) => e.parent_tool_use_id === 'toolu_agentB'), 'B has frames of its own');
  assert.ok(!events(rig).some((e) => e.type === 'user' && e.parent_tool_use_id === 'toolu_agentA' && e.message.content[0]?.tool_use_id === 'toolu_helperA-perm'), 'A\'s asked-for step has no result before the answer');

  drop({ kind: 'permission', requestId: 'helperA-perm', decision: 'allow' });
  await waitFor(() => events(rig).some((e) => e.type === 'result' && e.result === 'waiting for Survey the code'), { what: 'the parent to end its turn' });
  const ask = events(rig).find((e) => e.type === 'user' && e.message.content[0]?.tool_use_id === 'toolu_helperA-perm');
  assert.equal(ask.parent_tool_use_id, 'toolu_agentA', 'the asked-for step\'s result is A\'s');
  assert.deepEqual(sys('task_updated').map((e) => [e.task_id, e.patch.status]), [[B, 'completed']]);
  assert.deepEqual(sys('task_notification').map((e) => [e.task_id, e.status]), [[B, 'completed']]);
  assert.deepEqual(sys('background_tasks_changed').at(-1).tasks.map((x) => x.task_id), [A], 'the list shrank to A');

  // A keeps progressing while the parent is idle, its counts growing.
  const progressOfA = () => sys('task_progress').filter((e) => e.task_id === A);
  const before = progressOfA().length;
  await waitFor(() => progressOfA().length >= before + 3, { what: 'A to keep working while the parent is idle' });
  const uses = progressOfA().map((e) => e.usage.tool_uses);
  assert.deepEqual(uses, [...uses].sort((a, b) => a - b), 'tool_uses only grows');

  // The parent is idle here, its `result` sent; how pir reads a worker whose helper still works is T01's.
  const results = events(rig).filter((e) => e.type === 'result').length;
  drop({ kind: 'interrupt' });
  await waitFor(() => sys('task_notification').some((e) => e.task_id === A), { what: 'A to be killed' });
  assert.deepEqual([sys('task_updated').at(-1).task_id, sys('task_updated').at(-1).patch.status], [A, 'killed']);
  assert.equal(sys('task_notification').at(-1).status, 'stopped');
  assert.deepEqual(sys('background_tasks_changed').at(-1).tasks, []);
  const stopped = progressOfA().length;
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(progressOfA().length, stopped, 'A reports nothing after its kill');
  assert.equal(events(rig).filter((e) => e.type === 'result').length, results, 'no result follows an interrupt of an idle parent');

  drop({ kind: 'message', text: 'is it still running?' });
  await waitFor(() => events(rig).some((e) => e.type === 'result' && e.result === 'Done with "is it still running?".'), { what: 'the chat reply' });
  const got = readFileSync(rig.received, 'utf8');
  assert.match(got, /is it still running\?/, 'the fake records the text the model received');
});
