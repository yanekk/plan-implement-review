import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripTerminalSequences } from '@earendil-works/pi-tui';
import { createConversationView, hasEnded, slashCommandsOf, slashProvider } from './conversation-view.mjs';
import { followLog } from './log-follow.mjs';
import { dropPersonInput } from './person-inbox.mjs';
import { withHeadLine } from './pir-tui.mjs';

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

test('followLog: opened inside a line still being written, the rest of that line is skipped, not shown as a line', () => {
  const p = join(tmp(), 'c.ndjson');
  writeFileSync(p, '{"a":1}\n{"big":"' + 'x'.repeat(2000));
  const got = [];
  const f = followLog(p, { tailBytes: 1000, onEntries: (l) => got.push(...l), watch: null, pollMs: 60_000 });
  appendFileSync(p, 'xx');
  f.check();
  appendFileSync(p, '"}\n{"b":2}\n');
  f.check();
  f.stop();
  assert.deepEqual(got, ['{"b":2}']);
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

const KEY = { enter: '\r', esc: '\x1b', left: '\x1b[D', right: '\x1b[C', up: '\x1b[A', down: '\x1b[B', tab: '\t', ctrlC: '\x03', pgUp: '\x1b[5~', pgDn: '\x1b[6~', space: ' ' };

function makeView({ log = [init(), opening], live = true, alive = true, rows = 30, drop, colour = false } = {}) {
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
    colour,
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
  assert.equal(lines.at(-1), '↵ send · esc interrupt · ← back · Tab detail · PgUp/PgDn scroll');
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

test('Enter, n and a answer a pending permission through the gate; the prompt is pinned above the box', () => {
  for (const [key, decision] of [[KEY.enter, 'allow'], ['n', 'deny'], ['a', 'allow-always']]) {
    const t = makeView({ log: [init(), opening, permission()] });
    assert.match(t.text(), /⚑ T05 wants to use Bash/);
    assert.match(t.text(), /↵ allow · n refuse · a allow, don't ask again/);
    t.v.handleInput(key);
    assert.deepEqual(t.drops, [{ to: 'w-1', kind: 'permission', requestId: 'r1', decision }], key);
    assert.equal(t.v.state.text, '', `${key} did not go into the box`);
    assert.match(t.text(), /answer sent — waiting for pir to deliver it/);
    t.v.handleInput(KEY.enter);
    assert.equal(t.drops.length, 1, 'a second key does not answer the same request twice');
  }
});

test('a is not offered when the gate says so, and does nothing', () => {
  const t = makeView({ log: [init(), opening, permission({ suppressAlwaysAllowRule: true })] });
  assert.doesNotMatch(t.text(), /a allow, don't ask again/);
  t.v.handleInput('a');
  assert.deepEqual(t.drops, []);
});

test('a defaultToNo request needs Enter twice and shows the arming hint; any other key disarms', () => {
  const t = makeView({ log: [init(), opening, permission({ defaultToNo: true })] });
  t.v.handleInput(KEY.enter);
  assert.deepEqual(t.drops, []);
  assert.match(t.text(), /press ↵ again to allow/);
  t.v.handleInput(KEY.down);
  assert.doesNotMatch(t.text(), /press ↵ again/, 'another key disarmed it');
  t.v.handleInput(KEY.enter);
  t.v.handleInput(KEY.enter);
  assert.deepEqual(t.drops, [{ to: 'w-1', kind: 'permission', requestId: 'r1', decision: 'allow' }]);
});

test('typed text with a pending permission refuses it with the text; a leading y is just a letter', () => {
  const t = makeView({ log: [init(), opening, permission()] });
  t.type('yes, but later'); // Enter/n/a only answer while the box is empty, and y is no key any more
  t.v.handleInput(KEY.enter);
  assert.deepEqual(t.drops, [{ to: 'w-1', kind: 'permission', requestId: 'r1', decision: 'deny', text: 'yes, but later' }]);
});

test('the picker keys drive the question set and the final Enter drops the answers', () => {
  const t = makeView({ log: [init(), opening, questions()] });
  assert.match(t.text(), /\? T05 asks you 2 questions/);
  assert.match(t.text(), /Which colour\? \(pick one\)/);
  t.v.handleInput(KEY.down);
  t.v.handleInput(KEY.enter); // one Enter chooses Blue on a single-select question (user 2026-09-26)
  assert.match(t.text(), /Which sizes\? \(pick any\)/);
  t.v.handleInput(KEY.enter);
  assert.equal(t.drops.length, 0, 'Enter on an unticked multi-select question does nothing');
  t.v.handleInput(KEY.space); // S
  t.v.handleInput(KEY.down);
  t.v.handleInput(KEY.down);
  t.v.handleInput(KEY.space); // L
  t.v.handleInput(KEY.enter);
  assert.deepEqual(t.drops, [{ to: 'w-1', kind: 'answers', requestId: 'q1', answers: { 'Which colour?': 'Blue', 'Which sizes?': 'S, L' } }]);
  assert.equal(t.v.state.text, '', 'no picker key reached the box');
});

test('typing with a question set pending lands next to "Other:", not in the box (user 2026-09-26)', () => {
  const t = makeView({ log: [init(), opening, questions()] });
  t.type('Green é');
  assert.equal(t.v.state.text, '', 'the box stays empty');
  assert.match(t.text(), /❯ \(•\) Other: Green é▏/);
  t.v.handleInput('\x7f'); // backspace
  t.v.handleInput('\x7f');
  t.v.handleInput(KEY.enter);
  assert.deepEqual(t.drops, [], 'the first of two questions: nothing sent yet');
  assert.match(t.text(), /Which sizes\? \(pick any\)/, 'moved to the next question');
  t.v.handleInput(KEY.space); // S
  t.type('XL');
  assert.match(t.text(), /esc to talk instead/, 'with a question pinned, the footer says how to talk instead');
  t.v.handleInput(KEY.enter);
  assert.deepEqual(t.drops, [{ to: 'w-1', kind: 'answers', requestId: 'q1', answers: { 'Which colour?': 'Green', 'Which sizes?': 'S, XL' } }]);
});



test('on a typed Other answer ←/→ move its caret; ← goes back only once it is emptied (user 2026-09-27)', () => {
  const t = makeView({ log: [init(), opening, questions()] });
  t.type('Grn');
  t.v.handleInput(KEY.left);
  t.v.handleInput(KEY.left);
  assert.equal(t.backs(), 0, '← moved the caret, it did not go back');
  t.type('r');
  t.v.handleInput(KEY.right);
  t.type('e');
  assert.match(t.text(), /Other: Grre▏n/);
  for (let i = 0; i < 4; i += 1) t.v.handleInput('\x7f');
  assert.match(t.text(), /Other: ▏n/);
  t.v.handleInput(KEY.right);
  t.v.handleInput('\x7f');
  t.v.handleInput(KEY.left);
  assert.equal(t.backs(), 1, 'with the answer emptied, ← goes back');
});

test('text already in the box when a question arrives moves onto its Other line on Enter', () => {
  const t = makeView({ log: [init(), opening] });
  t.type('Jan');
  t.push(questions());
  t.v.handleInput(KEY.enter);
  assert.deepEqual(t.drops, []);
  assert.equal(t.v.state.text, '');
  assert.match(t.text(), /❯ \(•\) Other: Jan▏/);
});



test('the answer arriving in the log unpins the prompt; a new request pins fresh', () => {
  const t = makeView({ log: [init(), opening, permission()] });
  t.v.handleInput(KEY.enter);
  t.push(entry({ dir: 'out', from: 'person', kind: 'reply', requestId: 'r1', result: { behavior: 'allow', updatedInput: {} } }));
  assert.doesNotMatch(t.text(), /answer sent/);
  assert.match(t.text(), /→ allowed/);
  t.push(permission({ requestId: 'r2', input: { command: 'git push' } }));
  assert.match(t.text(), /↵ allow · n refuse/);
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
  assert.doesNotMatch(t.text(), /↵ allow · n refuse/, 'nothing is pinned');
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

test('Tab switches between grouped steps and full detail', () => {
  const use = entry({ dir: 'in', event: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'npm test' } }] } } });
  const res = entry({ dir: 'in', event: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'first out\n209 passed' }] } } });
  const t = makeView({ log: [init(), opening, use, res] });
  // group-commands §4: the default view folds the step into its group line; full detail shows it whole.
  assert.match(t.text(), /▸ Ran 1 shell command/);
  assert.doesNotMatch(t.text(), /⎿ Bash|first out/);
  t.v.handleInput(KEY.tab);
  assert.match(t.text(), /⎿ Bash npm test/);
  assert.match(t.text(), /first out/);
  assert.equal(t.v.state.full, true);
  assert.match(t.screen().at(-1), /Tab detail/, 'the hint names the key, the same both ways');
});

// T20 (user 2026-09-26): at 80 columns the hint with a request pending was 90 wide and lost
// `PgUp/PgDn scroll`; a read-only one lost `read only`. The shorter wording fits every state.
test('the key hint fits 80 columns in every state', () => {
  const fits = (t, want) => {
    const hint = t.screen().at(-1);
    assert.equal(hint, want);
    assert.ok([...hint].length <= 80, `${[...hint].length} wide: ${hint}`);
  };
  const live = makeView();
  fits(live, '↵ send · esc interrupt · ← back · Tab detail · PgUp/PgDn scroll');
  live.push(permission());
  fits(live, 'answer above or type a reply · esc interrupt · ← back · Tab detail · PgUp/PgDn');
  live.v.handleInput(KEY.tab);
  fits(live, 'answer above or type a reply · esc interrupt · ← back · Tab detail · PgUp/PgDn');
  const finished = makeView({ live: false });
  fits(finished, '← back · PgUp/PgDn scroll · Tab detail · finished, read only');
  const exited = makeView();
  exited.push(entry({ dir: 'note', kind: 'exited', code: 0 }));
  exited.v.handleInput(KEY.tab);
  fits(exited, '← back · PgUp/PgDn scroll · Tab detail · exited, read only');
});

// T20 review (user 2026-09-26): scrolled up, `↓ N more below · ` leads the hint and pushed it to 96 columns
// with a request pending; the live hints drop a phrase then, and still fit with a four-digit count.
test('scrolled up, the key hint with its more-below count fits 80 columns', () => {
  const long = [init(), opening, ...Array.from({ length: 2000 }, (_, i) => said(`line ${i}`))];
  const fits = (t, want) => {
    const hint = t.screen().at(-1);
    assert.equal(hint, want);
    assert.ok([...hint].length <= 80, `${[...hint].length} wide: ${hint}`);
  };
  const t = makeView({ log: long, rows: 20 });
  for (let i = 0; i < 100; i++) t.v.handleInput(KEY.pgUp);
  const n = t.v.state.scrollBack;
  assert.ok(n >= 1000, `${n} lines below`);
  fits(t, `↓ ${n} more below · ↵ send · esc interrupt · ← back · Tab detail · PgUp/PgDn`);
  t.screen();
  t.push(permission());
  t.screen();
  const m = t.v.state.scrollBack;
  fits(t, `↓ ${m} more below · esc interrupt · ← back · Tab detail · PgUp/PgDn`);
  const ro = makeView({ log: long, rows: 20, live: false });
  for (let i = 0; i < 100; i++) ro.v.handleInput(KEY.pgUp);
  ro.screen();
  fits(ro, `↓ ${ro.v.state.scrollBack} more below · ← back · PgUp/PgDn scroll · Tab detail · finished, read only`);
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

// T20: the pinned prompt or the `● working…` line appearing below the scrollback shrank it from the top,
// so the lines a scrolled-up person was reading jumped up by that many rows.
test('scrolled up, a prompt pinned below the scrollback does not move the lines being read', () => {
  const t = makeView({ log: [init(), opening, ...Array.from({ length: 40 }, (_, i) => said(`line ${i}`))], rows: 20 });
  t.v.handleInput(KEY.pgUp);
  const before = t.screen().slice(2, 6);
  t.push(permission());
  assert.match(t.text(), /↵ allow · n refuse/, 'the request is pinned');
  assert.deepEqual(t.screen().slice(2, 6), before, 'the top of the scrollback stayed where it was');
  t.v.handleInput(KEY.pgDn);
  t.v.handleInput(KEY.pgDn);
  t.v.handleInput(KEY.pgDn);
  assert.doesNotMatch(t.text(), /more below/, 'PgDn still reaches the end');
});

// T20 review: the `↓ N more below` count was built before the offset absorbed a height change, so the frame
// a prompt appeared on showed the old count; the next paint, with nothing changed, showed another.
test('scrolled up, the more-below count is the one the frame shows, the paint a prompt appears on too', () => {
  const t = makeView({ log: [init(), opening, ...Array.from({ length: 40 }, (_, i) => said(`line ${i}`))], rows: 20 });
  t.v.handleInput(KEY.pgUp);
  t.screen();
  t.push(permission());
  const first = t.screen().at(-1);
  assert.match(first, /↓ \d+ more below/);
  assert.equal(first, t.screen().at(-1), 'a second paint with nothing changed reads the same');
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
  v.handleInput('\r');
  await waitFor(/→ allowed/, 'the reply in the log');
  await waitFor(/^(?![\s\S]*● working)/, 'the turn to end');
  for (let i = 0; i < 500 && platform.list()[0]?.state !== 'idle'; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(platform.list()[0].state, 'idle', 'the fake worker carried on to its result');
  assert.ok(renders > 0, 'the follower asked for repaints as the log grew');
});

// T18 drill (user 2026-09-26): a worker waiting on background work must not look idle.
test('the status line counts background work: alone when the worker waits, beside working… when busy', () => {
  const bg = (id, description) => entry({ dir: 'in', event: { type: 'system', subtype: 'task_started', task_id: id, description, is_backgrounded: true } });
  const end = (id) => entry({ dir: 'in', event: { type: 'system', subtype: 'task_notification', task_id: id, status: 'completed' } });
  const result = () => entry({ dir: 'in', event: { type: 'result', subtype: 'success' } });
  const t = makeView({ log: [init(), opening, bg('a', 'one'), bg('b', 'two'), result()] });
  assert.match(t.text(), /◌ 2 running in the background/);
  assert.doesNotMatch(t.text(), /● working…/);
  t.push(said('still waiting'));
  assert.match(t.text(), /● working… · 2 running in the background/);
  t.push(result());
  t.push(end('a'));
  assert.match(t.text(), /◌ 1 running in the background/);
  t.push(end('b'));
  assert.doesNotMatch(t.text(), /running in the background$/m);
});

// T14: a planning session resumed into the log it exited in is live again; only an exit after the last
// `resumed` note ends it.
test('hasEnded: an exit ends the log until a `resumed` note, and an exit after it ends it again', () => {
  const note = (kind) => ({ dir: 'note', kind });
  assert.equal(hasEnded([{ dir: 'out' }]), false);
  assert.equal(hasEnded([note('exited')]), true);
  assert.equal(hasEnded([note('sdk-error')]), true);
  assert.equal(hasEnded([note('exited'), note('resumed')]), false);
  assert.equal(hasEnded([note('exited'), note('resumed'), { dir: 'in' }, note('exited')]), true);
});

// pir-coordinator T06 (DESIGN §2.5, §2.8, §2.9): the coordinator agent's conversation is a worker's view with
// taskId `coordinator`. Its pointer is its own reply; the hand-off is pir's message and the agent's reply.
test('the coordinator agent\'s conversation shows its pointer reply, pir\'s hand-off message and its reply, and takes typing', () => {
  const drops = [];
  let push = null;
  const v = createConversationView({
    run: { slug: 'demo', controlDir: '/nowhere' },
    worker: { taskId: 'coordinator', workerId: 'sess-1', logPath: '/nowhere/conversations/coordinator-1.ndjson', live: true },
    follow: (_p, { onEntries }) => {
      push = (...es) => onEntries(es.map((e) => JSON.stringify(e)));
      return { stop() {} };
    },
    drop: (_dir, input) => (drops.push(input), { ok: true }),
    alive: () => true,
    tui: { requestRender() {}, terminal: { rows: 30 } },
    colour: false,
  });
  push(
    init(),
    entry({ dir: 'out', from: 'pir', kind: 'message', text: 'Invoke the pir-coordinator skill for plan demo.' }),
    said('T01 (layout) has a question I will not decide: it picks the public API name. I would pick `render`. Answer it in T01\'s conversation.'),
    entry({ dir: 'out', from: 'pir', kind: 'message', text: 'The run is ready to merge. Report: plans/demo/REPORT.md. Merge with: git merge pir/demo' }),
    said('All five tasks are built and the branch is ready: git merge pir/demo. The report is plans/demo/REPORT.md.'),
  );
  const text = () => v.render(80).map((l) => stripTerminalSequences(l)).join('\n');
  assert.match(text(), /^coordinator {2}agent sess-1/m, "headed as the coordinator agent, not a worker (T07 drill)");
  assert.match(text(), /coordinator ▸ T01 \(layout\) has a question I will not decide/);
  assert.match(text(), /pir ▸ The run is ready to merge\. Report: plans\/demo\/REPORT\.md\./);
  assert.match(text(), /coordinator ▸ All five tasks are built and the branch is ready: git merge\s+pir\/demo\./);

  [...'where are we?'].forEach((c) => v.handleInput(c));
  v.handleInput('\r');
  assert.deepEqual(drops, [{ to: 'sess-1', kind: 'message', text: 'where are we?' }]);
  v.dispose();
});

// ---- the mouse (mouse-navigation T06, DESIGN §2.3, §2.6) ----

// A pi-tui TuiMouseEvent as the view receives it: y is the view's own row, wheelDelta ±3 a notch (T04).
const mouse = (type, { x = 10, y = 5, width = 80, height = 30, wheelDelta, button = 'left' } = {}) => ({
  type, button, x, y, width, height, screenX: x, screenY: y, ...(wheelDelta === undefined ? {} : { wheelDelta }),
});
const wheel = (dir, over) => mouse('wheel', { ...over, wheelDelta: dir === 'up' ? -3 : 3, button: dir === 'up' ? 'wheelUp' : 'wheelDown' });
const longLog = () => [init(), opening, ...Array.from({ length: 60 }, (_, i) => said(`step ${i}`))];

test('mouse: a wheel notch up scrolls back 3 lines and shows the count; down returns to the end', () => {
  const t = makeView({ log: longLog(), rows: 20 });
  t.screen();
  assert.deepEqual(t.v.handleMouse(wheel('up')), { handled: true });
  assert.match(t.screen().at(-1), /^↓ 3 more below · /);
  assert.equal(t.v.state.scrollBack, 3);
  t.v.handleMouse(wheel('up'));
  assert.match(t.screen().at(-1), /^↓ 6 more below · /);
  t.v.handleMouse(wheel('down'));
  t.v.handleMouse(wheel('down'));
  assert.doesNotMatch(t.screen().at(-1), /more below/);
  assert.match(t.text(), /step 59/);
});

test('mouse: wheel down at the end stays at the end; wheel up at the top stays at the top', () => {
  const t = makeView({ log: longLog(), rows: 20 });
  t.screen();
  t.v.handleMouse(wheel('down'));
  assert.equal(t.v.state.scrollBack, 0);
  assert.doesNotMatch(t.screen().at(-1), /more below/);
  for (let i = 0; i < 40; i++) {
    t.v.handleMouse(wheel('up'));
    t.screen();
  }
  const top = t.screen();
  assert.match(top.join('\n'), /pir ▸ Build T05\./, 'the start of the history is on screen');
  t.v.handleMouse(wheel('up'));
  assert.deepEqual(t.screen(), top, 'one more notch up changes nothing');
});

test('mouse: a read-only view scrolls with the wheel and has no box to click', () => {
  const t = makeView({ log: longLog(), live: false, rows: 20 });
  const s = t.screen();
  t.v.handleMouse(wheel('up'));
  assert.match(t.screen().at(-1), /^↓ 3 more below · ← back/);
  for (let y = 0; y < s.length; y++) assert.equal(t.v.handleMouse(mouse('click', { y })), undefined, `row ${y} takes no click`);
  assert.equal(t.v.state.text, null);
});

test('mouse: the coordinator agent\'s conversation scrolls the same way', () => {
  let push = null;
  const v = createConversationView({
    run: { slug: 'demo', controlDir: '/nowhere' },
    worker: { taskId: 'coordinator', workerId: 'sess-1', logPath: '/nowhere/conversations/coordinator-1.ndjson', live: true },
    follow: (_p, { onEntries }) => {
      push = (...es) => onEntries(es.map((e) => JSON.stringify(e)));
      return { stop() {} };
    },
    drop: () => ({ ok: true }),
    alive: () => true,
    tui: { requestRender() {}, terminal: { rows: 20 } },
    colour: false,
  });
  push(...longLog());
  const last = () => stripTerminalSequences(v.render(80).at(-1));
  last();
  v.handleMouse(wheel('up'));
  assert.match(last(), /^↓ 3 more below · /);
  v.handleMouse(wheel('down'));
  assert.doesNotMatch(last(), /more below/);
  v.dispose();
});

test('mouse: a click in the box moves the caret; a click on the scrollback changes nothing', () => {
  const t = makeView({ rows: 20 });
  t.type('hello world');
  const s = t.screen();
  const y = s.findIndex((l) => l.includes('hello world'));
  const x = s[y].indexOf('hello') + 2;
  const r = t.v.handleMouse(mouse('click', { x, y }));
  assert.ok(r?.handled && r.focus, 'the Editor took the click');
  t.type('X');
  assert.equal(t.v.state.text, 'heXllo world', 'the caret moved to where the click landed');
  assert.equal(t.v.handleMouse(mouse('click', { x: 4, y: 3 })), undefined, 'the scrollback takes no click');
  for (const type of ['press', 'drag', 'release']) assert.equal(t.v.handleMouse(mouse(type, { x, y })), undefined, `${type} stays pi-tui's selection`);
  t.type('Y');
  assert.equal(t.v.state.text, 'heXYllo world');
});

test('mouse: the permission gate and the question picker take no clicks', () => {
  for (const request of [permission(), questions()]) {
    const t = makeView({ log: [init(), opening, request], rows: 30 });
    const s = t.screen();
    const pinned = s.map((l, y) => [l, y]).filter(([l]) => /⚑|Red|Blue|↵ allow/.test(l));
    assert.ok(pinned.length > 0, 'the request is pinned on screen');
    const before = JSON.stringify(t.v.state.prompt);
    for (const [, y] of pinned) assert.equal(t.v.handleMouse(mouse('click', { x: 4, y })), undefined, `row ${y}`);
    assert.equal(JSON.stringify(t.v.state.prompt), before, 'the prompt did not move');
    assert.deepEqual(t.drops, [], 'nothing was answered');
  }
});

// ---- group lines (group-commands T02, DESIGN §2.4–§2.7) ----

const use = (id, name, input) => entry({ dir: 'in', event: { type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input } ] } } });
const result = (id, content, isError = false) => entry({ dir: 'in', event: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] } } });
// Four finished steps, the Bash one failed, then a message: one group line.
const groupLog = (prefix = 'g') => [
  use(`${prefix}1`, 'Read', { file_path: 'src/a.mjs' }), result(`${prefix}1`, 'a'),
  use(`${prefix}2`, 'Grep', { pattern: 'x' }), result(`${prefix}2`, 'hit'),
  use(`${prefix}3`, 'Bash', { command: 'npm test' }), result(`${prefix}3`, '1 failing', true),
  use(`${prefix}4`, 'Edit', { file_path: 'src/a.mjs' }), result(`${prefix}4`, 'updated'),
];
const GROUP = /▸ Read 1 file, searched 1 time, ran 1 shell command, edited 1 file · 1 failed/;
const rowOf = (t, re) => t.screen().findIndex((l) => re.test(l));

test('group click: a left click on a folded group line opens it; another click folds it', () => {
  const t = makeView({ log: [init(), opening, ...groupLog(), said('all done')] });
  const y = rowOf(t, GROUP);
  assert.ok(y >= 2, t.text());
  assert.deepEqual(t.v.handleMouse(mouse('click', { y })), { handled: true, rowClick: true });
  const s = t.screen();
  assert.match(s[y], /^ {2}▾ Read 1 file/, 'the marker turned');
  assert.match(s[y + 1], /^ {4}⎿ Read src\/a\.mjs/);
  assert.match(s[y + 3], /^ {4}⎿ Bash npm test/);
  assert.match(s[y + 4], /^ {4}⎿ Edit/);
  assert.match(s[y + 5], /all done/);
  assert.deepEqual(t.v.state.open, ['g1']);
  assert.deepEqual(t.v.handleMouse(mouse('click', { y })), { handled: true, rowClick: true });
  assert.match(t.screen()[y], GROUP);
  assert.doesNotMatch(t.text(), /⎿/);
  assert.deepEqual(t.v.state.open, []);
});

test('group click: a message, a running step, the header, a blank row and the box are not group lines', () => {
  const t = makeView({ log: [init(), opening, ...groupLog(), said('all done'), use('run1', 'Bash', { command: 'sleep 9' })], rows: 30 });
  t.type('hello');
  const s = t.screen();
  const rows = [0, 1, rowOf(t, /all done/), rowOf(t, /⎿ Bash sleep 9/), rowOf(t, /Build T05/), s.findIndex((l, i) => i > 2 && l === '')];
  for (const y of rows) {
    assert.ok(y >= 0, `row found: ${rows}`);
    assert.equal(t.v.handleMouse(mouse('click', { x: 4, y })), undefined, `row ${y}: ${s[y]}`);
  }
  const boxY = s.findIndex((l) => l.includes('hello'));
  const r = t.v.handleMouse(mouse('click', { x: 3, y: boxY }));
  assert.ok(r?.handled && !r.rowClick, 'the box row is still the Editor\'s');
  assert.deepEqual(t.v.state.open, [], 'nothing was toggled');
  assert.match(t.text(), GROUP);
});

test('group click: press, drag, release and a right click on a group line are declined and toggle nothing', () => {
  const t = makeView({ log: [init(), opening, ...groupLog()] });
  const y = rowOf(t, GROUP);
  for (const type of ['press', 'drag', 'release']) assert.equal(t.v.handleMouse(mouse(type, { y })), undefined, type);
  for (const button of ['right', 'middle']) assert.equal(t.v.handleMouse(mouse('click', { y, button })), undefined, button);
  assert.deepEqual(t.v.state.open, []);
  assert.match(t.screen()[y], GROUP);
});

test('group click: works in a read-only view', () => {
  const t = makeView({ log: [init(), opening, ...groupLog()], live: false });
  const y = rowOf(t, GROUP);
  assert.deepEqual(t.v.handleMouse(mouse('click', { y })), { handled: true, rowClick: true });
  assert.match(t.screen()[y], /▾ Read 1 file/);
});

test('group hover: the group line under the pointer is bold with colour on; off it, or with colour off, it is plain', () => {
  const t = makeView({ log: [init(), opening, ...groupLog(), said('all done')], colour: true });
  const raw = () => t.v.render(80);
  const y = rowOf(t, GROUP);
  const msg = rowOf(t, /all done/);
  assert.ok(!raw()[y].includes('\x1b[1m'), 'plain before the pointer comes');
  assert.deepEqual(t.v.handleMouse(mouse('move', { y })), { handled: true });
  assert.ok(raw()[y].includes('\x1b[1m'), 'bold under the pointer');
  t.v.handleMouse(mouse('move', { y: msg }));
  assert.ok(!raw()[y].includes('\x1b[1m'), 'plain once the pointer leaves');
  assert.equal(raw()[msg], t.v.render(80)[msg]);
  const before = raw()[msg];
  t.v.handleMouse(mouse('move', { y: msg }));
  assert.equal(raw()[msg], before, 'a message line under the pointer is not hovered');
  const off = makeView({ log: [init(), opening, ...groupLog()], colour: false });
  const oy = rowOf(off, GROUP);
  const plain = off.v.render(80)[oy];
  off.v.handleMouse(mouse('move', { y: oy }));
  assert.equal(off.v.render(80)[oy], plain, 'no hover with colour off');
});

test('group click: following the end, opening the last group scrolls just enough to show its steps', () => {
  const log = [init(), opening, ...Array.from({ length: 30 }, (_, i) => said(`line ${i}`)), ...groupLog()];
  const t = makeView({ log, rows: 16 });
  const s = t.screen();
  const y = rowOf(t, GROUP);
  assert.equal(t.v.state.scrollBack, 0);
  t.v.handleMouse(mouse('click', { y }));
  const after = t.screen();
  assert.match(after.join('\n'), /▾ Read 1 file/, 'the group line is still on screen');
  assert.match(after.join('\n'), /⎿ Edit src\/a\.mjs/, 'its last step is visible');
  assert.equal(t.v.state.scrollBack, 0, 'still following the end');
  assert.ok(after.findIndex((l) => /▾ Read 1 file/.test(l)) < y, 'it moved up just enough');
  assert.notDeepEqual(after, s);
});

test('group click: an open group taller than the screen keeps its line at the top, never above it', () => {
  const many = [];
  for (let i = 0; i < 30; i++) many.push(use(`m${i}`, 'Read', { file_path: `f${i}` }), result(`m${i}`, 'x'));
  const t = makeView({ log: [init(), opening, ...Array.from({ length: 30 }, (_, i) => said(`line ${i}`)), ...many], rows: 16 });
  const y = rowOf(t, /▸ Read 30 files/);
  t.v.handleMouse(mouse('click', { y }));
  assert.match(t.screen()[2], /▾ Read 30 files/, 'the clicked line is the top scrollback row');
});

test('group click: scrolled up, the clicked line stays on its row, opening and folding', () => {
  const log = [init(), opening, ...Array.from({ length: 10 }, (_, i) => said(`early ${i}`)), ...groupLog('a'), said('between'), ...Array.from({ length: 40 }, (_, i) => said(`line ${i}`))];
  const t = makeView({ log, rows: 20 });
  for (let i = 0; i < 3; i++) t.v.handleInput(KEY.pgUp);
  let y = rowOf(t, GROUP);
  for (let i = 0; i < 5 && (y < 4 || y > 12); i++) {
    t.v.handleMouse(wheel(y < 4 ? 'up' : 'down'));
    y = rowOf(t, GROUP);
  }
  assert.ok(y >= 4 && y <= 12, `the group sits mid-screen: ${y}\n${t.text()}`);
  assert.ok(t.v.state.scrollBack > 0);
  t.v.handleMouse(mouse('click', { y }));
  const s = t.screen();
  assert.match(s[y], /▾ Read 1 file/, 'same row after opening');
  assert.match(s[y + 1], /⎿ Read src\/a\.mjs/);
  t.v.handleMouse(mouse('click', { y }));
  assert.match(t.screen()[y], GROUP, 'same row after folding');
});

test('group click: Tab shows full detail with no group lines; Tab back keeps the group open', () => {
  const t = makeView({ log: [init(), opening, ...groupLog()] });
  t.v.handleMouse(mouse('click', { y: rowOf(t, GROUP) }));
  t.v.handleInput(KEY.tab);
  assert.doesNotMatch(t.text(), /^ {2}[▸▾] /m);
  assert.match(t.text(), /⎿ Bash npm test/);
  for (let y = 0; y < 30; y++) assert.equal(t.v.handleMouse(mouse('click', { y }))?.rowClick, undefined, `row ${y} is not clickable in full detail`);
  t.v.handleInput(KEY.tab);
  assert.match(t.text(), /▾ Read 1 file/);
  assert.deepEqual(t.v.state.open, ['g1']);
});

test('group arrival: scrolled up, a running step folding into its group does not move the top line (§2.7)', () => {
  const log = [init(), opening, ...Array.from({ length: 40 }, (_, i) => said(`line ${i}`)), ...groupLog(), use('late', 'Bash', { command: 'npm run slow' })];
  const t = makeView({ log, rows: 20 });
  t.v.handleInput(KEY.pgUp);
  const before = t.screen().slice(2, 8);
  assert.ok(t.v.state.scrollBack > 0);
  t.push(result('late', 'ok'));
  assert.deepEqual(t.screen().slice(2, 8), before, 'the lines being read did not move');
  t.v.handleInput(KEY.pgDn);
  t.v.handleInput(KEY.pgDn);
  assert.match(t.text(), /ran 2 shell commands/, 'the step joined the count');
  assert.doesNotMatch(t.text(), /⎿ Bash npm run slow/);
});

test('group click: a new view for the same worker starts with every group folded', () => {
  const log = [init(), opening, ...groupLog()];
  const a = makeView({ log });
  a.v.handleMouse(mouse('click', { y: rowOf(a, GROUP) }));
  assert.deepEqual(a.v.state.open, ['g1']);
  const b = makeView({ log });
  assert.deepEqual(b.v.state.open, []);
  assert.match(b.text(), GROUP);
});

test('withHeadLine: a wheel on its head line is ignored; one below it reaches the inner view shifted by one', () => {
  const got = [];
  const host = { requestRender() {}, terminal: { rows: 24, columns: 80 } };
  const v = withHeadLine('following T05', () => ({ render: () => [], handleInput() {}, invalidate() {}, dispose() {}, handleMouse: (ev) => (got.push(ev), { handled: true }) }), { host, colour: false });
  assert.equal(v.handleMouse(wheel('up', { y: 0 })), undefined);
  assert.deepEqual(got, []);
  assert.deepEqual(v.handleMouse(wheel('up', { y: 4 })), { handled: true });
  assert.equal(got.length, 1);
  assert.equal(got[0].y, 3);
  assert.equal(got[0].wheelDelta, -3);
  const bare = withHeadLine('following T05', () => ({ render: () => [], handleInput() {}, invalidate() {}, dispose() {} }), { host, colour: false });
  assert.equal(bare.handleMouse(wheel('up', { y: 2 })), undefined, 'an inner view without a handler declines');
});

test('group hover: the pointer moving from a group line straight into the typing box drops the hover', () => {
  // Idle (the turn ended), so no `● working…` row stands between the scrollback and the box, and enough
  // history that the group line is the last scrollback row.
  const turnEnd = entry({ dir: 'in', event: { type: 'result', subtype: 'success' } });
  const t = makeView({ log: [init(), opening, ...Array.from({ length: 20 }, (_, i) => said(`line ${i}`)), ...groupLog(), turnEnd], colour: true, rows: 12 });
  const raw = () => t.v.render(80);
  const s = t.screen();
  const y = rowOf(t, GROUP);
  assert.ok(y >= 0, t.text());
  t.v.handleMouse(mouse('move', { y }));
  assert.ok(raw()[y].includes('\x1b[1m'), 'bold under the pointer');
  const boxY = y + 1;
  assert.match(s[boxY], /─/, `the box sits right under the group line:\n${s.join('\n')}`);
  t.v.handleMouse(mouse('move', { y: boxY }));
  assert.ok(!raw()[y].includes('\x1b[1m'), 'plain once the pointer is in the box');
});
