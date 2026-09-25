import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripTerminalSequences } from '@earendil-works/pi-tui';
import { createConversationView, slashCommandsOf, slashProvider } from './conversation-view.mjs';
import { followLog } from './log-follow.mjs';
import { dropPersonInput } from './person-inbox.mjs';

// ---- followLog ----

const tmp = () => mkdtempSync(join(tmpdir(), 'pir-follow-'));

test('followLog: the tail of a large file starts at a line boundary', () => {
  const p = join(tmp(), 'c.ndjson');
  const lines = Array.from({ length: 200 }, (_, i) => `line-${String(i).padStart(3, '0')}-${'x'.repeat(40)}`);
  writeFileSync(p, lines.join('\n') + '\n');
  const got = [];
  const f = followLog(p, { tailBytes: 1000, onEntries: (l) => got.push(...l), watch: null });
  f.stop();
  assert.ok(got.length > 0 && got.length < 200, 'only the tail was read');
  assert.match(got[0], /^line-\d{3}-x+$/, 'the first line is whole, the cut half-line dropped');
  assert.equal(got.at(-1), lines.at(-1));
  assert.deepEqual(got, lines.slice(-got.length));
});

test('followLog: appended lines arrive; a partial line waits for its newline', () => {
  const p = join(tmp(), 'c.ndjson');
  writeFileSync(p, 'one\ntwo\npar');
  const got = [];
  const f = followLog(p, { onEntries: (l) => got.push(l), watch: null, pollMs: 60_000 });
  assert.deepEqual(got, [['one', 'two']], 'the partial last line is held back');
  appendFileSync(p, 'tial');
  f.check();
  assert.equal(got.length, 1, 'still no newline: nothing new');
  appendFileSync(p, '\nthree\n');
  f.check();
  assert.deepEqual(got.at(-1), ['partial', 'three']);
  f.check();
  assert.equal(got.length, 2, 'nothing appended: no call');
  f.stop();
});

test('followLog: a file that does not exist yet is read once it appears, and the watcher reads appends', async () => {
  const p = join(tmp(), 'later.ndjson');
  const got = [];
  const f = followLog(p, { onEntries: (l) => got.push(...l), pollMs: 20 });
  writeFileSync(p, 'a\n');
  for (let i = 0; i < 100 && got.length < 1; i++) await new Promise((r) => setTimeout(r, 10));
  appendFileSync(p, 'b\n');
  for (let i = 0; i < 100 && got.length < 2; i++) await new Promise((r) => setTimeout(r, 10));
  f.stop();
  assert.deepEqual(got, ['a', 'b']);
});

test('followLog: a character split across two appends is decoded whole', () => {
  const p = join(tmp(), 'c.ndjson');
  const bytes = Buffer.from('żółw\n');
  writeFileSync(p, bytes.subarray(0, 2));
  const got = [];
  const f = followLog(p, { onEntries: (l) => got.push(...l), watch: null, pollMs: 60_000 });
  appendFileSync(p, bytes.subarray(2));
  f.check();
  f.stop();
  assert.deepEqual(got, ['żółw']);
});

// ---- the view ----

let T = 1_790_000_000_000;
const entry = (e) => ({ t: T++, ...e });
const init = (slash = ['context', 'doctor', 'model', 'color', 'focus', 'reload-plugins'], terminal = ['doctor', 'color', 'focus', 'reload-plugins']) =>
  entry({ dir: 'in', event: { type: 'system', subtype: 'init', slash_commands: slash, terminal_slash_commands: terminal } });
const opening = entry({ dir: 'out', from: 'pir', kind: 'message', text: 'Build T05.' });
const said = (text) => entry({ dir: 'in', event: { type: 'assistant', message: { content: [{ type: 'text', text }] } } });
const permission = (over = {}) =>
  entry({
    dir: 'request',
    requestId: 'r1',
    toolName: 'Bash',
    input: { command: 'rm -rf fixtures' },
    description: 'Remove the fixtures',
    suggestions: [{ type: 'addRules', behavior: 'allow', destination: 'session', rules: [{ toolName: 'Bash', ruleContent: 'rm -rf fixtures' }] }],
    ...over,
  });
const questions = (over = {}) =>
  entry({
    dir: 'request',
    requestId: 'q1',
    toolName: 'AskUserQuestion',
    input: {
      questions: [
        { question: 'Which colour?', header: 'Colour', multiSelect: false, options: [{ label: 'Red', description: '' }, { label: 'Blue', description: '' }] },
        { question: 'Which sizes?', header: 'Size', multiSelect: true, options: [{ label: 'S', description: '' }, { label: 'M', description: '' }, { label: 'L', description: '' }] },
      ],
    },
    ...over,
  });

const KEY = { enter: '\r', esc: '\x1b', left: '\x1b[D', up: '\x1b[A', down: '\x1b[B', tab: '\t', ctrlC: '\x03', pgUp: '\x1b[5~', pgDn: '\x1b[6~', space: ' ' };

function makeView({ log = [init(), opening], live = true, alive = true, rows = 30, drop } = {}) {
  const drops = [];
  let backs = 0;
  let push = null;
  const v = createConversationView({
    run: { slug: 'plan', controlDir: '/nowhere' },
    worker: { taskId: 'T05', workerId: 'w-1', logPath: '/nowhere/T05-implement-1.ndjson', live },
    follow: (_path, { onEntries }) => {
      push = (...entries) => onEntries(entries.map((e) => (typeof e === 'string' ? e : JSON.stringify(e))));
      if (log.length) push(...log);
      return { stop() {} };
    },
    drop:
      drop ??
      ((dir, input, { coordinatorAlive }) => {
        if (!coordinatorAlive()) return { ok: false, reason: 'not-running' };
        drops.push(input);
        return { ok: true };
      }),
    alive: () => alive,
    onBack: () => (backs += 1),
    tui: { requestRender() {}, terminal: { rows } },
    colour: false,
  });
  const type = (s) => [...s].forEach((c) => v.handleInput(c));
  const screen = () => v.render(80).map((l) => stripTerminalSequences(l));
  const text = () => screen().join('\n');
  return { v, drops, type, screen, text, push: (...e) => push(...e), backs: () => backs, setAlive: (a) => (alive = a) };
}

test('the view renders exactly the terminal\'s rows: header, scrollback, box, hint', () => {
  const t = makeView({ log: [init(), opening, said('Starting on the task.')] });
  const lines = t.screen();
  assert.equal(lines.length, 30);
  assert.match(lines[0], /^T05 {2}worker w-1 · live {2}· plan/);
  assert.match(t.text(), /pir ▸ Build T05\./);
  assert.match(t.text(), /T05 ▸ Starting on the task\./);
  assert.match(lines.at(-1), /^↵ send · esc interrupt · ← back · Tab full detail/);
});

test('Enter with text drops a message; Esc drops an interrupt; ← with text does not navigate', () => {
  const t = makeView();
  t.type('hello there');
  t.v.handleInput(KEY.left);
  assert.equal(t.backs(), 0, '← moved the cursor in the box, it did not go back');
  t.v.handleInput(KEY.enter);
  assert.deepEqual(t.drops, [{ to: 'w-1', kind: 'message', text: 'hello there' }]);
  assert.equal(t.v.state.text, '', 'the box is cleared once sent');
  t.v.handleInput(KEY.esc);
  assert.deepEqual(t.drops.at(-1), { to: 'w-1', kind: 'interrupt' });
  t.v.handleInput(KEY.left);
  assert.equal(t.backs(), 1, '← with an empty box goes back');
});

test('Ctrl+C with text clears the box and drops nothing; with an empty box it drops an interrupt', () => {
  const t = makeView();
  t.type('draft');
  t.v.handleInput(KEY.ctrlC);
  assert.equal(t.v.state.text, '');
  assert.deepEqual(t.drops, []);
  t.v.handleInput(KEY.ctrlC);
  assert.deepEqual(t.drops, [{ to: 'w-1', kind: 'interrupt' }]);
});

test('y, n and a answer a pending permission through the gate; the prompt is pinned above the box', () => {
  for (const [key, decision] of [['y', 'allow'], ['n', 'deny'], ['a', 'allow-always']]) {
    const t = makeView({ log: [init(), opening, permission()] });
    assert.match(t.text(), /⚑ T05 wants to use Bash/);
    assert.match(t.text(), /y allow · n refuse · a allow, don't ask again/);
    t.v.handleInput(key);
    assert.deepEqual(t.drops, [{ to: 'w-1', kind: 'permission', requestId: 'r1', decision }], key);
    assert.equal(t.v.state.text, '', `${key} did not go into the box`);
    assert.match(t.text(), /answer sent — waiting for pir to deliver it/);
    t.v.handleInput('y');
    assert.equal(t.drops.length, 1, 'a second key does not answer the same request twice');
  }
});

test('a is not offered when the gate says so, and does nothing', () => {
  const t = makeView({ log: [init(), opening, permission({ suppressAlwaysAllowRule: true })] });
  assert.doesNotMatch(t.text(), /a allow, don't ask again/);
  t.v.handleInput('a');
  assert.deepEqual(t.drops, []);
});

test('a defaultToNo request needs y twice and shows the arming hint; any other key disarms', () => {
  const t = makeView({ log: [init(), opening, permission({ defaultToNo: true })] });
  t.v.handleInput('y');
  assert.deepEqual(t.drops, []);
  assert.match(t.text(), /press y again to allow/);
  t.v.handleInput(KEY.down);
  assert.doesNotMatch(t.text(), /press y again/, 'another key disarmed it');
  t.v.handleInput('y');
  t.v.handleInput('y');
  assert.deepEqual(t.drops, [{ to: 'w-1', kind: 'permission', requestId: 'r1', decision: 'allow' }]);
});

test('typed text with a pending permission refuses it with the text; y inside text is just a letter', () => {
  const t = makeView({ log: [init(), opening, permission()] });
  t.type('Maybe, but y first'); // a y/n/a only answers while the box is empty
  t.v.handleInput(KEY.enter);
  assert.deepEqual(t.drops, [{ to: 'w-1', kind: 'permission', requestId: 'r1', decision: 'deny', text: 'Maybe, but y first' }]);
});

test('the picker keys drive the question set and the final Enter drops the answers', () => {
  const t = makeView({ log: [init(), opening, questions()] });
  assert.match(t.text(), /\? T05 asks you 2 questions/);
  assert.match(t.text(), /Which colour\? \(pick one\)/);
  t.v.handleInput(KEY.enter);
  assert.equal(t.drops.length, 0, 'Enter on an unanswered question does nothing');
  t.v.handleInput(KEY.down);
  t.v.handleInput(KEY.space); // Blue
  t.v.handleInput(KEY.enter);
  assert.match(t.text(), /Which sizes\? \(pick any\)/);
  t.v.handleInput(KEY.space); // S
  t.v.handleInput(KEY.down);
  t.v.handleInput(KEY.down);
  t.v.handleInput(KEY.space); // L
  t.v.handleInput(KEY.enter);
  assert.deepEqual(t.drops, [{ to: 'w-1', kind: 'answers', requestId: 'q1', answers: { 'Which colour?': 'Blue', 'Which sizes?': 'S, L' } }]);
  assert.equal(t.v.state.text, '', 'no picker key reached the box');
});

test('the picker\'s Other line takes the typed text as the answer', () => {
  const t = makeView({ log: [init(), opening, questions()] });
  t.v.handleInput(KEY.up); // wraps to Other
  t.v.handleInput(KEY.space);
  t.type('Green');
  t.v.handleInput(KEY.enter);
  assert.deepEqual(t.drops, [], 'the text became the answer, not a message');
  assert.match(t.text(), /Other: Green/);
  t.v.handleInput(KEY.enter); // next question
  t.v.handleInput(KEY.space);
  t.v.handleInput(KEY.enter);
  assert.deepEqual(t.drops[0].answers, { 'Which colour?': 'Green', 'Which sizes?': 'S' });
});

test('typed text with a pending question set declines it with the text', () => {
  const t = makeView({ log: [init(), opening, questions()] });
  t.type('let us talk first');
  t.v.handleInput(KEY.enter);
  assert.deepEqual(t.drops, [{ to: 'w-1', kind: 'decline-questions', requestId: 'q1', text: 'let us talk first' }]);
});

test('the answer arriving in the log unpins the prompt; a new request pins fresh', () => {
  const t = makeView({ log: [init(), opening, permission()] });
  t.v.handleInput('y');
  t.push(entry({ dir: 'out', from: 'person', kind: 'reply', requestId: 'r1', result: { behavior: 'allow', updatedInput: {} } }));
  assert.doesNotMatch(t.text(), /answer sent/);
  assert.match(t.text(), /→ allowed/);
  t.push(permission({ requestId: 'r2', input: { command: 'git push' } }));
  assert.match(t.text(), /y allow · n refuse/);
  t.v.handleInput('n');
  assert.deepEqual(t.drops.at(-1), { to: 'w-1', kind: 'permission', requestId: 'r2', decision: 'deny' });
});

test('coordinator not alive: nothing is dropped, the view says the run is not running, the text stays', () => {
  const controlDir = mkdtempSync(join(tmpdir(), 'pir-conv-'));
  const t = makeView({ alive: false, drop: (dir, input, opts) => dropPersonInput(controlDir, input, opts) });
  t.type('are you there');
  t.v.handleInput(KEY.enter);
  assert.equal(t.v.state.text, 'are you there', 'the typed text is back in the box');
  assert.match(t.text(), /the run is not running — your message was not sent/);
  t.v.handleInput(KEY.ctrlC); // clears the box
  t.v.handleInput(KEY.esc);
  assert.match(t.text(), /the run is not running — the interrupt was not sent/);
  assert.ok(!existsSync(join(controlDir, 'inbox')) || readdirSync(join(controlDir, 'inbox')).length === 0, 'nothing written');
});

test('with the coordinator alive the real drop lands one file in the inbox', () => {
  const controlDir = mkdtempSync(join(tmpdir(), 'pir-conv-'));
  const t = makeView({ drop: (dir, input, opts) => dropPersonInput(controlDir, input, opts) });
  t.type('hi');
  t.v.handleInput(KEY.enter);
  const files = readdirSync(join(controlDir, 'inbox'));
  assert.equal(files.length, 1);
  assert.deepEqual(JSON.parse(readFileSync(join(controlDir, 'inbox', files[0]), 'utf8')), { to: 'w-1', kind: 'message', text: 'hi' });
});

test('read-only worker: no box, only ← and scrolling work', () => {
  const log = [init(), opening, ...Array.from({ length: 60 }, (_, i) => said(`step ${i}`)), permission()];
  const t = makeView({ log, live: false, rows: 20 });
  const s = t.screen();
  assert.match(s[0], /finished, read only/);
  assert.match(s.at(-1), /← back · PgUp\/PgDn scroll/);
  assert.match(t.text(), /T05 ▸ step 59/, 'it opens at the end');
  assert.doesNotMatch(t.text(), /y allow · n refuse/, 'nothing is pinned');
  for (const k of ['y', 'n', 'a', 'h', KEY.enter, KEY.esc, KEY.ctrlC, KEY.space]) t.v.handleInput(k);
  assert.deepEqual(t.drops, [], 'no key sends anything');
  assert.equal(t.v.state.text, null, 'there is no box');
  t.v.handleInput(KEY.pgUp);
  assert.doesNotMatch(t.text(), /step 59/, 'PgUp scrolled away from the end');
  assert.match(t.text(), /↓ \d+ more below/);
  t.v.handleInput(KEY.pgDn);
  assert.match(t.text(), /step 59/);
  t.v.handleInput(KEY.left);
  assert.equal(t.backs(), 1);
});

test('a live worker whose log says it exited turns read-only', () => {
  const t = makeView();
  t.push(entry({ dir: 'note', kind: 'exited', code: 0 }));
  assert.match(t.screen()[0], /exited, read only/);
  t.type('hi');
  t.v.handleInput(KEY.enter);
  assert.deepEqual(t.drops, []);
});

test('Tab switches between one line per step and full detail', () => {
  const use = entry({ dir: 'in', event: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'npm test' } }] } } });
  const res = entry({ dir: 'in', event: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'first out\n209 passed' }] } } });
  const t = makeView({ log: [init(), opening, use, res] });
  assert.match(t.text(), /⎿ Bash npm test {2}209 passed/);
  assert.doesNotMatch(t.text(), /first out/);
  t.v.handleInput(KEY.tab);
  assert.match(t.text(), /first out/);
  assert.equal(t.v.state.full, true);
  assert.match(t.screen().at(-1), /Tab one line per step/);
});

test('new lines follow the end; scrolled up, the view stays put', () => {
  const t = makeView({ log: [init(), opening, ...Array.from({ length: 40 }, (_, i) => said(`line ${i}`))], rows: 16 });
  t.push(said('fresh'));
  assert.match(t.text(), /fresh/);
  t.v.handleInput(KEY.pgUp);
  const before = t.screen().slice(2, 8);
  t.push(said('fresher'));
  assert.doesNotMatch(t.text(), /fresher/);
  assert.deepEqual(t.screen().slice(2, 8), before, 'the lines on screen did not move');
  t.v.handleInput(KEY.pgDn);
  t.v.handleInput(KEY.pgDn);
  assert.match(t.text(), /fresher/, 'back at the end it follows again');
});

test('autocomplete offers /context, never /doctor', async () => {
  const names = slashCommandsOf([init()]);
  assert.ok(names.includes('context'));
  assert.ok(!names.includes('doctor') && !names.includes('color') && !names.includes('focus') && !names.includes('reload-plugins'));
  const provider = slashProvider(names);
  const signal = new AbortController().signal;
  const got = await provider.getSuggestions(['/co'], 0, 3, { signal });
  const values = got.items.map((i) => i.value);
  assert.ok(values.includes('context'));
  assert.ok(!values.includes('color'));
  const doc = await provider.getSuggestions(['/doc'], 0, 4, { signal });
  assert.ok(!doc || !doc.items.some((i) => i.value === 'doctor'));
  assert.equal(await provider.getSuggestions(['@src'], 0, 4, { signal }), null, 'no file completion from pir\'s own folder');
});

test('the box shows the slash menu when / is typed', async () => {
  const t = makeView();
  t.type('/con');
  for (let i = 0; i < 50 && !/context/.test(t.text()); i++) await new Promise((r) => setTimeout(r, 10));
  assert.match(t.text(), /context/);
  assert.doesNotMatch(t.text(), /doctor/);
});

// ---- end to end: a fake run with the real SDK line, a real log and a real inbox ----

test('against a fake run: the view shows a permission from the real log, y answers it through the inbox, the worker carries on', async (t) => {
  const { createPlatform } = await import('./platform.mjs');
  const { startWorker } = await import('./worker-proc.mjs');
  const { startPersonInbox, createGrants } = await import('./person-inbox.mjs');
  const { fakeClaudeSpawner, canUseTool, initEvent, resultEvent } = await import('./fake/claude-stream.mjs');
  const { rmSync } = await import('node:fs');

  const dir = mkdtempSync(join(tmpdir(), 'pir-conv-e2e-'));
  const controlDir = join(dir, 'control');
  const script = [{ await: 'user' }, { emit: initEvent() }, { emit: canUseTool('r1', 'Bash', { command: 'git push -f' }) }, { await: 'control_response' }, { emit: resultEvent('success', 'pushed') }];
  const scriptPath = join(dir, 'script.json');
  writeFileSync(scriptPath, JSON.stringify(script));
  const start = (o) => startWorker({ ...o, spawnProcess: fakeClaudeSpawner({ script: scriptPath, received: join(dir, 'received.ndjson') }) });
  const grants = createGrants();
  const platform = createPlatform({ controlDir, transport: { drain: () => [] }, startWorker: start, claudePath: '/nonexistent/claude', grants });
  const inbox = startPersonInbox({ controlDir, platform, grants, watch: null });
  const id = platform.spawn({ cwd: tmpdir(), name: 'plan-implement-review / live-workers / T05 / conversation-view / implement', phase: 'implement' });

  let renders = 0;
  const v = createConversationView({
    run: { slug: 'live-workers', controlDir },
    worker: { taskId: 'T05', workerId: id, logPath: platform.logPathOf(id), live: true },
    alive: () => true,
    tui: { requestRender: () => (renders += 1), terminal: { rows: 30 } },
    colour: false,
    followOptions: { pollMs: 20 },
  });
  t.after(async () => {
    v.dispose();
    inbox.stop();
    for (const w of platform.list()) platform.close(w.id, { immediate: true });
    for (let i = 0; i < 500 && platform.list().length; i++) await new Promise((r) => setTimeout(r, 10));
    rmSync(dir, { recursive: true, force: true });
  });
  const text = () => v.render(80).map((l) => stripTerminalSequences(l)).join('\n');
  const waitFor = async (re, what) => {
    for (let i = 0; i < 500; i++) {
      if (re.test(text())) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.fail(`timed out waiting for ${what}:\n${text()}`);
  };

  await waitFor(/⚑ T05 wants to use Bash/, 'the permission request');
  assert.match(text(), /git push -f/);
  v.handleInput('y');
  await waitFor(/→ allowed/, 'the reply in the log');
  await waitFor(/^(?![\s\S]*● working)/, 'the turn to end');
  for (let i = 0; i < 500 && platform.list()[0]?.state !== 'idle'; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(platform.list()[0].state, 'idle', 'the fake worker carried on to its result');
  assert.ok(renders > 0, 'the follower asked for repaints as the log grew');
});
