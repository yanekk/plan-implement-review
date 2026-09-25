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
import { startRig, driveScreen, createScreenModel, scenarioScript, RIG_TASK } from './conversation-rig.mjs';
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
  assert.deepEqual(tasks[0].worker, { id: rig.workerId, live: true, logPath: rig.logPath });
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
      { keys: `${ESC}[C`, until: /y allow · n refuse · a allow, don't ask again/ },
      { keys: 'y', until: /→ allowed[\s\S]*⚑ T01 wants to use Bash\s*\n\s*rm -rf build\// },
      { keys: 'y', until: /press y again to allow/ },
      { keys: 'y', until: /⚑ T01 wants to use Write/ },
      { keys: 'y', until: /\? T01 asks you 2 questions/ },
      { keys: ' ', until: /\(•\) pir-rig/ },
      { keys: '\r', until: /Which scenarios should it ship with\? \(pick any\)/ },
      { keys: ' ', until: /\[x\] tour/ },
      { keys: `${ESC}[B`, until: /❯ \[ \] long/ },
      { keys: ' ', until: /\[x\] long/ },
      { keys: '\r', until: /Which scenarios should it ship with\? → tour, long/ },
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
    assert.match(s.rows.at(-1), /esc interrupt · ← back/, `the key hint is the last line:\n${s.rows.join('\n')}`);
    assert.match(s.rows.at(-2), /^─+$/, 'the box\'s lower edge is right above it');
  }
  const opened = screens[2].rows;
  assert.match(opened[0], new RegExp(`^T01  worker ${rig.workerId.slice(0, 8)} · live`), 'the header names the worker');
  const text = (i) => screens[i].rows.join('\n');
  assert.match(text(2), /⎿ Bash npm test/, 'the tool steps are in the scrollback, the failed one included');
  assert.match(text(12), /Which name should the rig command have\? → pir-rig/);
  assert.match(text(screens.length - 1), /T01/, '← returned to the run\'s live view');

  const sent = logOf(rig).filter((e) => e.dir === 'out' && e.from === 'person').map((e) => e.kind);
  assert.deepEqual(sent, ['reply', 'reply', 'reply', 'reply', 'message', 'message', 'interrupt'], 'every answer the screen gave went through the inbox to the worker');
});
