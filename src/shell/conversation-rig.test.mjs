// The conversation-view rig (T19): a pretend run the real `pir` screen can open, and a pty driver that
// works that screen with keys. Every worker here is the real Agent SDK on fake/claude-stream.mjs; no test
// runs the real `claude` or pays for a model.

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

function scratchHome(t) {
  const home = mkdtempSync(join(tmpdir(), 'pir-rig-home-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return { PIR_HOME: home };
}

async function waitFor(fn, { timeoutMs = 10000, what = 'the condition' } = {}) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

const logOf = (rig) => readFileSync(rig.logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
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

// pir-coordinator T06, end to end at 80×24 and 120×40: the coordinator agent holds T01's request, passes it
// on with a pointer in its own conversation, takes what the person types, and the run ends in `ready to merge`.
for (const [cols, rows] of [[80, 24], [120, 40]]) {
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
for (const [cols, rows] of [[80, 24], [120, 40]]) {
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
for (const [cols, rows] of [[80, 24], [120, 40]]) {
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
