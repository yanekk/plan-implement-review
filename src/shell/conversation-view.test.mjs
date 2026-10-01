import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripTerminalSequences } from '@earendil-works/pi-tui';
import { carryPending, createConversationView, hasEnded, slashCommandsOf, slashProvider, statusParts } from './conversation-view.mjs';
import { followLog } from './log-follow.mjs';
import { dropPersonInput } from './person-inbox.mjs';
import { withHeadLine } from './pir-tui.mjs';
import { SGR } from './pir-view.mjs';

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

test('followLog: carry gets the lines before the cut and the tail, and its lines lead the first batch only', () => {
  const p = join(tmp(), 'c.ndjson');
  const lines = Array.from({ length: 100 }, (_, i) => `line-${String(i).padStart(3, '0')}-${'x'.repeat(40)}`);
  writeFileSync(p, lines.join('\n') + '\n');
  const got = [];
  const calls = [];
  const carry = (skipped, tail) => {
    calls.push({ skipped, tail });
    return [skipped[0]];
  };
  const f = followLog(p, { tailBytes: 1000, carry, onEntries: (l) => got.push(l), watch: null, pollMs: 60_000 });
  appendFileSync(p, 'after\n');
  f.check();
  f.stop();
  assert.equal(calls.length, 1, 'carried once, at open');
  assert.deepEqual([...calls[0].skipped, ...calls[0].tail], lines, 'skipped and tail are the whole file, cut at a line boundary');
  assert.deepEqual(got[0], [lines[0], ...calls[0].tail], 'the carried line leads the tail');
  assert.deepEqual(got[1], ['after'], 'an append carries nothing');
});

test('followLog: a file that fits the tail is not cut, and carry is never called', () => {
  const p = join(tmp(), 'c.ndjson');
  writeFileSync(p, 'one\ntwo\n');
  let called = false;
  const got = [];
  const f = followLog(p, { carry: () => ((called = true), []), onEntries: (l) => got.push(...l), watch: null, pollMs: 60_000 });
  f.stop();
  assert.equal(called, false);
  assert.deepEqual(got, ['one', 'two']);
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

// visible-helpers T03 (DESIGN §2.2): helpers are named apart from background commands on the status line.
test('the status line names running helpers apart from background commands, idle and busy', () => {
  const helper = (id, callId, description) => entry({ dir: 'in', event: { type: 'system', subtype: 'task_started', task_id: id, tool_use_id: callId, task_type: 'local_agent', description, is_backgrounded: true } });
  const bg = (id, description) => entry({ dir: 'in', event: { type: 'system', subtype: 'task_started', task_id: id, description, is_backgrounded: true, task_type: 'local_bash' } });
  const end = (id) => entry({ dir: 'in', event: { type: 'system', subtype: 'task_notification', task_id: id, status: 'completed' } });
  const result = () => entry({ dir: 'in', event: { type: 'result', subtype: 'success' } });
  const t = makeView({ log: [init(), opening, helper('h1', 'c1', 'Survey'), helper('h2', 'c2', 'Tests'), result()] });
  assert.match(t.text(), /^◌ 2 helpers running$/m);
  t.push(end('h2'));
  t.push(said('still going'));
  assert.match(t.text(), /^● working… · 1 helper running$/m);
  t.push(bg('b1', 'slow'));
  assert.match(t.text(), /^● working… · 1 helper running · 1 running in the background$/m);
  t.push(result());
  assert.match(t.text(), /^◌ 1 helper running · 1 running in the background$/m);
  t.push(end('h1'));
  assert.match(t.text(), /^◌ 1 running in the background$/m, 'no helper: today\'s text');
  assert.equal(statusParts({ helpers: 0, background: 0 }), '');
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

// ---- visible-helpers T05 (DESIGN §2.5, §2.6): the Esc warning while helpers run, and the note on the next message. ----

const hStart = (id, callId, description) => entry({ dir: 'in', event: { type: 'system', subtype: 'task_started', task_id: id, tool_use_id: callId, task_type: 'local_agent', description, is_backgrounded: true } });
const hEnd = (id, status) => entry({ dir: 'in', event: { type: 'system', subtype: 'task_notification', task_id: id, status } });
const hResult = () => entry({ dir: 'in', event: { type: 'result', subtype: 'success' } });
const outInterrupt = () => entry({ dir: 'out', from: 'person', kind: 'interrupt' });
const WARNING = 'esc again to interrupt · this also stops 1 helper: Survey the code';

test('Esc with no helper running drops an interrupt at once, with no warning', () => {
  const t = makeView({ log: [init(), opening, hStart('h1', 'c1', 'Survey the code'), hEnd('h1', 'completed'), hResult()] });
  t.v.handleInput(KEY.esc);
  assert.deepEqual(t.drops, [{ to: 'w-1', kind: 'interrupt' }]);
  assert.equal(t.v.state.warning, '');
});

test('Esc with a helper running drops nothing and shows the warning on the status line; Esc again interrupts', () => {
  const t = makeView({ log: [init(), opening, hStart('h1', 'c1', 'Survey the code'), hResult()] });
  assert.match(t.text(), /^◌ 1 helper running$/m);
  t.v.handleInput(KEY.esc);
  assert.deepEqual(t.drops, []);
  assert.equal(t.v.state.warning, WARNING);
  const lines = t.screen();
  assert.ok(lines.includes(WARNING), 'the warning is its own line');
  assert.doesNotMatch(t.text(), /^◌ 1 helper running$/m, 'the warning takes the status line\'s place');
  t.v.handleInput(KEY.esc);
  assert.deepEqual(t.drops, [{ to: 'w-1', kind: 'interrupt' }]);
  assert.equal(t.v.state.warning, '');
  assert.match(t.text(), /interrupt sent/);
});

test('armed, then a typed character: the warning goes, the character is in the box, nothing is dropped', () => {
  const t = makeView({ log: [init(), opening, hStart('h1', 'c1', 'Survey the code'), hResult()] });
  t.v.handleInput(KEY.esc);
  t.type('x');
  assert.equal(t.v.state.warning, '');
  assert.equal(t.v.state.text, 'x');
  assert.deepEqual(t.drops, []);
  assert.doesNotMatch(t.text(), /esc again to interrupt/);
  t.v.handleInput(KEY.ctrlC);
  assert.equal(t.v.state.text, '', 'Ctrl+C with text still clears the box');
  t.v.handleInput(KEY.esc);
  assert.deepEqual(t.drops, [], 'the first Esc after disarming warns again');
  assert.equal(t.v.state.warning, WARNING);
});

test('Ctrl+C on an empty box behaves as Esc while helpers run; Ctrl+C with text only clears the box and disarms', () => {
  const t = makeView({ log: [init(), opening, hStart('h1', 'c1', 'Survey the code'), hResult()] });
  t.v.handleInput(KEY.ctrlC);
  assert.equal(t.v.state.warning, WARNING);
  assert.deepEqual(t.drops, []);
  t.v.handleInput(KEY.ctrlC);
  assert.deepEqual(t.drops, [{ to: 'w-1', kind: 'interrupt' }]);
  t.type('draft');
  t.v.handleInput(KEY.ctrlC);
  assert.equal(t.v.state.text, '');
  assert.equal(t.drops.length, 1);
  // Esc then Ctrl+C on the empty box: either key confirms.
  t.v.handleInput(KEY.esc);
  t.v.handleInput(KEY.ctrlC);
  assert.equal(t.drops.length, 2);
});

test('armed with a question pinned, Esc again sends the interrupt; the warning shows under the pinned prompt', () => {
  const t = makeView({ log: [init(), opening, hStart('h1', 'c1', 'Survey the code'), questions()] });
  t.v.handleInput(KEY.esc);
  assert.deepEqual(t.drops, []);
  assert.ok(t.screen().includes(WARNING));
  assert.match(t.text(), /Which colour\?/, 'the question stays pinned');
  t.v.handleInput(KEY.esc);
  assert.deepEqual(t.drops, [{ to: 'w-1', kind: 'interrupt' }]);
});

test('the warning wraps rather than clips, so every helper it would stop is named at 80 columns', () => {
  const t = makeView({ log: [init(), opening, hStart('h1', 'c1', 'Survey end-of-run machinery'), hStart('h2', 'c2', 'Check the tests'), hResult()] });
  t.v.handleInput(KEY.esc);
  const lines = t.screen();
  assert.equal(lines.length, 30, 'the view still fills exactly the terminal');
  for (const l of lines) assert.ok([...l].length <= 80, l);
  const shown = lines.join(' ').replace(/\s+/g, ' ');
  assert.match(shown, /this also stops 2 helpers: Survey end-of-run machinery; Check the tests/);
  assert.deepEqual(t.drops, []);
});

test('a helper that ended between the two presses: the second Esc still interrupts', () => {
  const t = makeView({ log: [init(), opening, hStart('h1', 'c1', 'Survey the code'), hResult()] });
  t.v.handleInput(KEY.esc);
  t.push(hEnd('h1', 'completed'));
  t.v.handleInput(KEY.esc);
  assert.deepEqual(t.drops, [{ to: 'w-1', kind: 'interrupt' }]);
});

test('a read-only view shows no warning and drops nothing on Esc', () => {
  const t = makeView({ live: false, log: [init(), opening, hStart('h1', 'c1', 'Survey the code')] });
  t.v.handleInput(KEY.esc);
  assert.deepEqual(t.drops, []);
  assert.doesNotMatch(t.text(), /esc again/);
});

test('after an interrupt that stopped a helper, the next message carries the note and the ids; the one after carries neither', () => {
  const t = makeView({ log: [init(), opening, hStart('h1', 'c1', 'Survey the code'), hResult(), outInterrupt(), hEnd('h1', 'stopped')] });
  t.type('continue');
  t.v.handleInput(KEY.enter);
  const d = t.drops.at(-1);
  assert.equal(d.text, 'continue');
  assert.deepEqual(d.helpersStopped, ['h1']);
  assert.match(d.preface, /^\[pir\] Before this message, the person's interrupt stopped your helper: "Survey the code"\./);
  // The worker logs the message with both fields; the view reads that back as already reported.
  t.push(entry({ dir: 'out', from: 'person', kind: 'message', text: 'continue', preface: d.preface, helpersStopped: ['h1'] }));
  t.type('again');
  t.v.handleInput(KEY.enter);
  assert.deepEqual(t.drops.at(-1), { to: 'w-1', kind: 'message', text: 'again' });
});

test('a permission refusal with text and question answers never carry the note', () => {
  const stopped = [init(), opening, hStart('h1', 'c1', 'Survey the code'), hResult(), outInterrupt(), hEnd('h1', 'stopped')];
  const t = makeView({ log: [...stopped, permission()] });
  t.type('stop, not that');
  t.v.handleInput(KEY.enter);
  assert.deepEqual(t.drops, [{ to: 'w-1', kind: 'permission', requestId: 'r1', decision: 'deny', text: 'stop, not that' }]);

  const q = makeView({ log: [...stopped, questions()] });
  q.v.handleInput(KEY.enter); // Red
  q.v.handleInput(KEY.space); // S
  q.v.handleInput(KEY.enter);
  const d = q.drops.at(-1);
  assert.equal(d.kind, 'answers');
  assert.equal(d.preface, undefined);
  assert.equal(d.helpersStopped, undefined);
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

// plan-0077: a planner asked a question set, then its helpers wrote ~420 KB in eight minutes; the row read
// `asking you` from the whole log while the view, opened on the last 256 KB, showed no question.
test('a question asked before the tail the view opens on is still pinned; one answered back there is not', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pir-carry-'));
  const logPath = join(dir, 'plan-1.ndjson');
  const answered = entry({ dir: 'request', requestId: 'r0', toolName: 'Bash', input: { command: 'ls' } });
  const reply = entry({ dir: 'out', from: 'person', kind: 'reply', requestId: 'r0', result: { behavior: 'allow', updatedInput: {} } });
  const filler = Array.from({ length: 200 }, (_, i) => said(`helper output ${i} ${'x'.repeat(200)}`));
  const log = [init(), opening, answered, reply, questions(), ...filler];
  writeFileSync(logPath, log.map((e) => JSON.stringify(e)).join('\n') + '\n');
  const v = createConversationView({
    run: { slug: 'plan', controlDir: dir },
    worker: { taskId: 'plan', workerId: 'w-1', logPath, live: true },
    tui: { requestRender() {}, terminal: { rows: 30 } },
    colour: false,
    followOptions: { tailBytes: 8000, watch: null, pollMs: 60_000 },
  });
  const text = v.render(80).map((l) => stripTerminalSequences(l)).join('\n');
  v.dispose();
  assert.doesNotMatch(text, /helper output 0 /, 'the view opened on the tail, not the whole log');
  assert.match(text, /Which colour\? \(pick one\)/, 'the unanswered question is pinned');
  assert.doesNotMatch(text, /wants to use Bash/, 'the request answered before the tail is not brought back');
});

test('carryPending: only still-pending requests come back; one an interrupt cancelled does not', () => {
  const q = JSON.stringify(questions({ requestId: 'q9' }));
  const p = JSON.stringify(permission({ requestId: 'p9' }));
  const interrupt = JSON.stringify(entry({ dir: 'out', from: 'person', kind: 'interrupt' }));
  const result = JSON.stringify(entry({ dir: 'in', event: { type: 'result', subtype: 'error_during_execution' } }));
  assert.deepEqual(carryPending([q, JSON.stringify(said('hi'))], [JSON.stringify(said('more'))]), [q]);
  assert.deepEqual(carryPending([q], [interrupt, result]), [], 'cancelled by an interrupt in the tail');
  assert.deepEqual(carryPending([q, p, 'not json'], []), [q, p], 'both pending, in log order; a bad line is skipped');
});

// ---- The person's `!` (bang-commands T06, DESIGN §2.1, §2.2, §2.4) ----

const shStart = (id, command) => entry({ dir: 'shell', kind: 'start', id, command, cwd: '/w' });
const shEnd = (id) => entry({ dir: 'shell', kind: 'end', id, code: 0, signal: null, stopped: null, ms: 1000, sent: 'message' });

test('typing ! sets command mode and its hint; backspace over it leaves the mode', () => {
  const t = makeView();
  t.type('!');
  assert.equal(t.v.state.commandMode, true);
  assert.equal(t.screen().at(-1), "! command · ↵ run in this session's folder · ⌫ the ! to leave");
  t.v.handleInput('\x7f');
  assert.equal(t.v.state.text, '');
  assert.equal(t.v.state.commandMode, false);
  assert.match(t.screen().at(-1), /^↵ send · esc interrupt/);
  t.type(' !ls');
  assert.equal(t.v.state.commandMode, false, 'a leading space is not command mode');
});

test('the command hint fits 80 columns, scrolled up as well', () => {
  const t = makeView({ log: [init(), opening, ...Array.from({ length: 80 }, (_, i) => said(`line ${i}`))] });
  t.type('!');
  t.v.handleInput(KEY.pgUp);
  for (const l of t.screen()) assert.ok([...l].length <= 80, l);
  assert.match(t.screen().at(-1), /more below · ! command/);
});

test('Enter with ! alone sends nothing and keeps the !; Enter with ! ls drops a shell input', () => {
  const t = makeView();
  t.type('!');
  t.v.handleInput(KEY.enter);
  assert.deepEqual(t.drops, []);
  assert.equal(t.v.state.text, '!');
  t.type(' ls');
  t.v.handleInput(KEY.enter);
  assert.deepEqual(t.drops, [{ to: 'w-1', kind: 'shell', command: 'ls' }]);
  assert.equal(t.v.state.text, '', 'the box is cleared once sent');
});

test('Esc with a command running drops shell-stop, not interrupt; Esc with none interrupts as before', () => {
  const t = makeView({ log: [init(), opening, shStart('sh-1', 'sleep 30')] });
  t.v.handleInput(KEY.esc);
  assert.deepEqual(t.drops, [{ to: 'w-1', kind: 'shell-stop' }]);
  t.v.handleInput(KEY.ctrlC);
  assert.deepEqual(t.drops.at(-1), { to: 'w-1', kind: 'shell-stop' }, 'Ctrl+C on an empty box does the same');
  t.push(shEnd('sh-1'));
  t.v.handleInput(KEY.esc);
  assert.deepEqual(t.drops.at(-1), { to: 'w-1', kind: 'interrupt' });
});

test('a running command shows its status line with the elapsed time, and the hint says Esc stops it', () => {
  let clock = 0;
  const log = [init(), opening, entry({ dir: 'in', event: { type: 'result', subtype: 'success' } }), shStart('sh-1', 'sleep 30')];
  const drops = [];
  const v = createConversationView({
    run: { slug: 'plan', controlDir: '/nowhere' },
    worker: { taskId: 'T05', workerId: 'w-1', logPath: '/nowhere/x.ndjson', live: true },
    follow: (_p, { onEntries }) => (onEntries(log.map((e) => JSON.stringify(e))), { stop() {} }),
    drop: (_d, input) => (drops.push(input), { ok: true }),
    alive: () => true,
    tui: { requestRender() {}, terminal: { rows: 30 } },
    colour: false,
    now: () => clock,
  });
  clock = log[3].t + 4200;
  let lines = v.render(80).map((l) => stripTerminalSequences(l));
  assert.ok(lines.includes('● running your command · 4s · esc stops it'), lines.join('\n'));
  assert.equal(lines.at(-1), '↵ send · esc stops it · ← back · Tab detail · PgUp/PgDn scroll');
  clock += 68000;
  lines = v.render(80).map((l) => stripTerminalSequences(l));
  assert.ok(lines.includes('● running your command · 1m 12s · esc stops it'));
  v.dispose();
  // Busy as well, the worker's own work is named after it.
  const t = makeView({ log: [init(), opening, shStart('sh-1', 'sleep 30')] });
  assert.match(t.text(), /^● running your command · .* · esc stops it · working…$/m);
  t.v.dispose();
});

test('a helper running and a command running: Esc stops the command with no helper warning', () => {
  const hStart2 = entry({ dir: 'in', event: { type: 'system', subtype: 'task_started', task_id: 'h1', tool_use_id: 'c1', description: 'Survey the code', task_type: 'local_agent' } });
  const t = makeView({ log: [init(), opening, hStart2, entry({ dir: 'in', event: { type: 'result', subtype: 'success' } }), shStart('sh-1', 'sleep 30')] });
  t.v.handleInput(KEY.esc);
  assert.equal(t.v.state.warning, '', 'no warning: no interrupt is sent, so no helper is stopped');
  assert.deepEqual(t.drops, [{ to: 'w-1', kind: 'shell-stop' }]);
});

test('a second ! while one runs is refused in the view with the status text, and the text stays', () => {
  const t = makeView({ log: [init(), opening, shStart('sh-1', 'sleep 30')] });
  t.type('!ls');
  t.v.handleInput(KEY.enter);
  assert.deepEqual(t.drops, []);
  assert.equal(t.v.state.text, '!ls');
  assert.match(t.text(), /a command is already running · esc stops it/);
  t.v.handleInput(KEY.ctrlC); // clears the box
  t.type('hello');
  t.v.handleInput(KEY.enter);
  assert.deepEqual(t.drops, [{ to: 'w-1', kind: 'message', text: 'hello' }], 'a typed message still sends while a command runs');
});

test('a ! while a permission is pinned runs the command and leaves the request pinned', () => {
  const t = makeView({ log: [init(), opening, permission()] });
  t.type('!ls');
  t.v.handleInput(KEY.enter);
  assert.deepEqual(t.drops, [{ to: 'w-1', kind: 'shell', command: 'ls' }], 'not a refusal of the request');
  assert.match(t.text(), /⚑ T05 wants to use Bash/);
  assert.match(t.text(), /↵ allow · n refuse/);
  t.v.handleInput(KEY.enter);
  assert.deepEqual(t.drops.at(-1), { to: 'w-1', kind: 'permission', requestId: 'r1', decision: 'allow' }, 'the request still answers');
});

test('a ! with the run not running: the not-running refusal, and the text stays in the box', () => {
  const t = makeView({ alive: false });
  t.type('! ls');
  t.v.handleInput(KEY.enter);
  assert.deepEqual(t.drops, []);
  assert.equal(t.v.state.text, '! ls');
  assert.match(t.text(), /the run is not running — your command was not sent/);
});

test('colour on: the box border and the ! take the shell style in command mode; off it, the border is dim', () => {
  const t = makeView({ colour: true });
  const boxOf = () => t.v.render(80).slice(-4, -1);
  const dimBorder = boxOf()[0];
  t.type('!ls');
  const [top, text, bottom] = boxOf();
  const pink = SGR.shell;
  assert.ok(pink, 'the palette has a shell style');
  assert.ok(top.startsWith(pink), 'the top border is pink');
  assert.ok(bottom.startsWith(pink), 'the bottom border is pink');
  assert.ok(text.includes(`${pink}!`), 'the ! is pink');
  assert.notEqual(top, dimBorder);
  t.v.handleInput('\x7f');
  t.v.handleInput('\x7f');
  t.v.handleInput('\x7f');
  assert.equal(boxOf()[0], dimBorder, 'out of command mode the border is back');
});

test('a question set pinned while a command runs: the hint says Esc stops the command, and Esc does', () => {
  const t = makeView({ log: [init(), opening, shStart('sh-1', 'sleep 30'), questions()] });
  assert.match(t.screen().at(-1), /esc stops it/);
  assert.doesNotMatch(t.screen().at(-1), /esc to talk instead/);
  t.v.handleInput(KEY.esc);
  assert.deepEqual(t.drops, [{ to: 'w-1', kind: 'shell-stop' }]);
});

// ---- A command the agent hands the person (bang-commands T07, DESIGN §2.6) ----

const hand = (over = {}) => entry({ dir: 'request', requestId: 'h1', toolName: 'mcp__pir__hand_command', input: { command: 'printf handed', reason: 'the rig needs your login' }, ...over });
const handStart = (id, command) => entry({ dir: 'shell', kind: 'start', id, command, cwd: '/w', requestId: 'h1' });

test('a hand request is pinned with the command, why and its keys, and no `a`', () => {
  const t = makeView({ log: [init(), opening, hand()] });
  const s = t.text();
  assert.match(s, /^! T05 asks you to run a command\n {2}printf handed\n {2}why: the rig needs your login\n {2}↵ run · e edit first · n decline · or type a reply to decline with it$/m);
  assert.doesNotMatch(s, /don't ask again/);
  t.v.handleInput('a');
  assert.deepEqual(t.drops, [], '`a` is no key here');
  assert.equal(t.v.state.text, 'a', 'it went to the box');
});

test('Enter on the empty box drops shell with the requestId, once', () => {
  const t = makeView({ log: [init(), opening, hand()] });
  t.v.handleInput(KEY.enter);
  assert.deepEqual(t.drops, [{ to: 'w-1', kind: 'shell', command: 'printf handed', requestId: 'h1' }]);
  assert.match(t.text(), /answer sent — waiting for pir to deliver it/);
  t.v.handleInput(KEY.enter);
  assert.equal(t.drops.length, 1, 'not run twice');
  // Once its run starts the pin goes: the block under the request's line is its answer.
  t.push(handStart('sh-1', 'printf handed'));
  const s = t.text();
  assert.doesNotMatch(s, /asks you to run a command|answer sent/);
  assert.match(s, /^! T05 asked you to run: printf handed\nyou ! printf handed$/m);
});

test('`e` fills the box with ! and the command and keeps the pin; the edited Enter carries the requestId', () => {
  const t = makeView({ log: [init(), opening, hand()] });
  t.v.handleInput('e');
  assert.equal(t.v.state.text, '! printf handed');
  assert.equal(t.v.state.commandMode, true);
  assert.deepEqual(t.drops, []);
  assert.match(t.text(), /! T05 asks you to run a command/, 'still pinned');
  for (let i = 0; i < 'handed'.length; i++) t.v.handleInput('\x7f');
  t.type('edited');
  t.v.handleInput(KEY.enter);
  assert.deepEqual(t.drops, [{ to: 'w-1', kind: 'shell', command: 'printf edited', requestId: 'h1' }]);
});

test('`n` declines; a typed reply declines with its text; a `!` typed by hand answers it too', () => {
  let t = makeView({ log: [init(), opening, hand()] });
  t.v.handleInput('n');
  assert.deepEqual(t.drops, [{ to: 'w-1', kind: 'permission', requestId: 'h1', decision: 'deny' }]);
  assert.equal(t.v.state.text, '');

  t = makeView({ log: [init(), opening, hand()] });
  // A reply's first letter must not be a key: `n` and `e` on the empty box are the pin's (as `n` is a permission's).
  t.type('later, thanks');
  t.v.handleInput(KEY.enter);
  assert.deepEqual(t.drops, [{ to: 'w-1', kind: 'permission', requestId: 'h1', decision: 'deny', text: 'later, thanks' }]);

  t = makeView({ log: [init(), opening, hand()] });
  t.type('!ls');
  t.v.handleInput(KEY.enter);
  assert.deepEqual(t.drops, [{ to: 'w-1', kind: 'shell', command: 'ls', requestId: 'h1' }]);
});

test('with text in the box Enter, e and n are the box\'s, not the pin\'s', () => {
  const t = makeView({ log: [init(), opening, hand()] });
  t.type('x');
  t.v.handleInput('e');
  t.v.handleInput('n');
  assert.equal(t.v.state.text, 'xen');
  assert.deepEqual(t.drops, []);
});

test('Enter on a hand request while another command runs is refused here, and drops nothing', () => {
  const t = makeView({ log: [init(), opening, shStart('sh-0', 'sleep 30'), hand()] });
  t.v.handleInput(KEY.enter);
  assert.deepEqual(t.drops, []);
  assert.match(t.text(), /a command is already running · esc stops it/);
  assert.match(t.text(), /! T05 asks you to run a command/, 'still pinned');
});

test('declined, the scrollback reads `· declined: {text}` once the reply is logged', () => {
  const t = makeView({ log: [init(), opening, hand()] });
  t.push(entry({ dir: 'out', from: 'person', kind: 'reply', requestId: 'h1', result: { behavior: 'deny', message: 'The person declined to run it. They said: not now' } }));
  assert.match(t.text(), /^! T05 asked you to run: printf handed\n {2}· declined: not now$/m);
  assert.doesNotMatch(t.text(), /asks you to run a command/);
});

test('a hand run the host refused, or one that ended with the request still pending, brings the pin back', () => {
  let t = makeView({ log: [init(), opening, hand()] });
  t.v.handleInput(KEY.enter);
  assert.equal(t.drops.length, 1);
  t.push(entry({ dir: 'note', kind: 'shell-refused', command: 'printf handed', reason: 'busy' }));
  let s = t.text();
  assert.doesNotMatch(s, /answer sent/);
  assert.match(s, /! T05 asks you to run a command/);
  t.v.handleInput(KEY.enter);
  assert.equal(t.drops.length, 2, 'Enter runs it again');

  t = makeView({ log: [init(), opening, hand()] });
  t.v.handleInput(KEY.enter);
  t.push(handStart('sh-1', 'printf handed'));
  t.push(entry({ dir: 'shell', kind: 'end', id: 'sh-1', code: 0, signal: null, stopped: null, ms: 1000, sent: 'undelivered' }));
  s = t.text();
  assert.doesNotMatch(s, /answer sent/);
  assert.match(s, /! T05 asks you to run a command/);
});
