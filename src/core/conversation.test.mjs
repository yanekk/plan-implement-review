// The conversation model (T02; DESIGN §2.3, §2.6, §2.7, §2.11): log entries → styled lines, and the
// permission gate and question-set picker reducers. What the view in T13 paints is decided here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildConversation, gateFor, gateReducer, pickerFor, pickerReducer, promptLines, mainArg } from './conversation.mjs';

const SAMPLE = readFileSync(fileURLToPath(new URL('./fixtures/stream-sample.ndjson', import.meta.url)), 'utf8')
  .split('\n')
  .filter((l) => l.trim() !== '');

const textOf = (line) => line.map((s) => s.text).join('');
const styleOf = (line) => line[0]?.style;
const all = (lines) => lines.map(textOf);

// Entry builders, shaped as worker-proc logs them (DESIGN §2.3).
let t = 1000;
const out = (from, text) => ({ t: t++, dir: 'out', from, kind: 'message', text });
const say = (text) => ({ t: t++, dir: 'in', event: { type: 'assistant', message: { content: [{ type: 'text', text }] } } });
const use = (id, name, input) => ({ t: t++, dir: 'in', event: { type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } } });
const res = (id, content, isError = false) => ({
  t: t++,
  dir: 'in',
  event: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] } },
});
const done = (subtype = 'success', extra = {}) => ({ t: t++, dir: 'in', event: { type: 'result', subtype, result: '', is_error: subtype !== 'success', ...extra } });
const ADD_RULES = [{ type: 'addRules', behavior: 'allow', destination: 'session', rules: [{ toolName: 'Bash', ruleContent: 'npm test' }] }];
const request = (requestId, toolName = 'Bash', input = { command: 'npm test' }, extra = {}) => ({
  t: t++,
  dir: 'request',
  requestId,
  toolName,
  input,
  suggestions: ADD_RULES,
  reason: '',
  description: 'Run the tests',
  ...extra,
});
const reply = (requestId, result) => ({ t: t++, dir: 'out', from: 'person', kind: 'reply', requestId, result });
const QUESTIONS = {
  questions: [
    { question: 'Which colour?', header: 'Colour', multiSelect: false, options: [{ label: 'red', description: 'r' }, { label: 'blue', description: 'b' }] },
    {
      question: 'Which fruits?',
      header: 'Fruits',
      multiSelect: true,
      options: [{ label: 'apple', description: '' }, { label: 'pear', description: '' }, { label: 'plum', description: '' }],
    },
  ],
};

// ---- Messages ----

test('pir, person and worker messages each carry their own style and prefix', () => {
  const { lines } = buildConversation([out('pir', 'build T05'), out('person', 'hurry up'), say('on it')], { width: 80, taskId: 'T05' });
  assert.deepEqual(all(lines), ['pir ▸ build T05', 'you ▸ hurry up', 'T05 ▸ on it']);
  assert.deepEqual(lines.map(styleOf), ['pir', 'person', 'worker']);
});

test('worker text is wrapped, never truncated, with continuation lines under the text', () => {
  const long = 'word '.repeat(40).trim();
  const { lines } = buildConversation([say(`${long}\nsecond paragraph`)], { width: 30, taskId: 'T05' });
  assert.ok(lines.length > 2);
  for (const l of lines) assert.ok([...textOf(l)].length <= 30, textOf(l));
  assert.ok(textOf(lines[0]).startsWith('T05 ▸ '));
  assert.ok(lines.slice(1).every((l) => textOf(l).startsWith('      ')), 'continuations indented under the prefix');
  const words = lines.map((l) => textOf(l).replace(/^T05 ▸ /, '').trim()).join(' ');
  assert.equal(words, `${long} second paragraph`, 'nothing lost');
  assert.ok(lines.every((l) => styleOf(l) === 'worker'));
});

// ---- Steps ----

test('one tool use renders as exactly one line by default, regardless of result length', () => {
  const body = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n');
  const { lines } = buildConversation([use('u1', 'Bash', { command: 'npm test\n--verbose' }), res('u1', `${body}\n\n`)], { width: 80, taskId: 'T05' });
  assert.equal(lines.length, 1);
  assert.equal(textOf(lines[0]), '  ⎿ Bash npm test  line 50');
  assert.deepEqual(lines[0].map((s) => s.style), ['step', 'dim']);
});

test('a step line is truncated to width by code point and never splits a surrogate pair', () => {
  const { lines } = buildConversation([use('u1', 'Bash', { command: `echo ${'😀'.repeat(60)}` }), res('u1', 'ok')], { width: 30 });
  const text = textOf(lines[0]);
  assert.equal([...text].length, 30);
  assert.ok(text.endsWith('…'));
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(text), 'no lone high surrogate');
  const exact = buildConversation([use('u1', 'Read', { file_path: 'a'.repeat(19) })], { width: 30 }).lines[0];
  assert.equal(textOf(exact), `  ⎿ Read ${'a'.repeat(19)}`, 'a line that fits exactly is not clipped');
});

test('a step with no result yet shows just the step; the main argument follows the tool', () => {
  const { lines } = buildConversation(
    [
      use('a', 'Read', { file_path: '/x/y.mjs' }),
      use('b', 'Grep', { pattern: 'TODO', path: 'src' }),
      use('c', 'TodoWrite', { todos: [] }),
      use('d', 'NewTool', { n: 1, what: 'thing' }),
    ],
    { width: 80 },
  );
  assert.deepEqual(all(lines), ['  ⎿ Read /x/y.mjs', '  ⎿ Grep TODO', '  ⎿ TodoWrite', '  ⎿ NewTool thing']);
  assert.equal(mainArg('Bash', { description: 'x' }), '', 'a known tool missing its field shows nothing');
});

test('a failing tool result styles the step line step-error', () => {
  const { lines } = buildConversation([use('u1', 'Bash', { command: 'false' }), res('u1', 'exit 1', true)], { width: 80 });
  assert.equal(styleOf(lines[0]), 'step-error');
  const full = buildConversation([use('u1', 'Bash', { command: 'false' }), res('u1', 'exit 1', true)], { width: 80, full: true });
  assert.equal(styleOf(full.lines[0]), 'step-error');
});

test('full mode shows every result line; toggling changes nothing else', () => {
  const entries = [
    out('pir', 'go'),
    use('u1', 'Bash', { command: 'npm test' }),
    res('u1', [{ type: 'text', text: 'one\ntwo\nthree' }]),
    say('done'),
  ];
  const brief = buildConversation(entries, { width: 80, taskId: 'T05' }).lines;
  const full = buildConversation(entries, { width: 80, taskId: 'T05', full: true }).lines;
  assert.deepEqual(all(full), ['pir ▸ go', '  ⎿ Bash npm test', '      one', '      two', '      three', 'T05 ▸ done']);
  assert.deepEqual(full.slice(2, 5).map(styleOf), ['dim', 'dim', 'dim']);
  const withoutSteps = (lines) => all(lines).filter((l) => !l.startsWith('  ⎿') && !l.startsWith('      '));
  assert.deepEqual(withoutSteps(full), withoutSteps(brief));
});

// ---- Requests ----

test('a pending permission appears as pinned, not in lines; once answered it moves into lines with the answer', () => {
  const pendingLog = [use('u1', 'Bash', { command: 'npm test' }), request('r1')];
  const pending = buildConversation(pendingLog, { width: 80, taskId: 'T05' });
  assert.equal(pending.pinned.kind, 'permission');
  assert.equal(pending.pinned.requestId, 'r1');
  assert.ok(!all(pending.lines).some((l) => l.includes('wants to use')));

  const allowed = buildConversation([...pendingLog, reply('r1', { behavior: 'allow', updatedInput: { command: 'npm test' } })], { width: 80, taskId: 'T05' });
  assert.equal(allowed.pinned, null);
  const text = all(allowed.lines);
  assert.ok(text.includes('⚑ T05 wants to use Bash'));
  assert.ok(text.includes('  npm test'));
  assert.ok(text.includes('  (Run the tests)'));
  assert.equal(allowed.lines.at(-1)[0].style, 'ok');
  assert.equal(text.at(-1), '  → allowed');

  const refused = buildConversation([...pendingLog, reply('r1', { behavior: 'deny', message: 'The person refused.' })], { width: 80, taskId: 'T05' });
  assert.equal(all(refused.lines).at(-1), '  → refused');
  assert.equal(refused.lines.at(-1)[0].style, 'bad');
  const typed = buildConversation([...pendingLog, reply('r1', { behavior: 'deny', message: 'use npm ci' })], { width: 80 });
  assert.equal(all(typed.lines).at(-1), '  → refused: use npm ci');
});

test('a pending question set is pinned as a picker; answered, it shows each answer', () => {
  const log = [request('q1', 'AskUserQuestion', QUESTIONS)];
  const { pinned, lines } = buildConversation(log, { width: 80, taskId: 'T05' });
  assert.equal(pinned.kind, 'questions');
  assert.equal(lines.length, 0);
  const answered = buildConversation(
    [...log, reply('q1', { behavior: 'allow', updatedInput: { ...QUESTIONS, answers: { 'Which colour?': 'blue', 'Which fruits?': 'apple, pear' } } })],
    { width: 80, taskId: 'T05' },
  );
  assert.deepEqual(all(answered.lines), ['? T05 asks you 2 questions', '  Which colour? → blue', '  Which fruits? → apple, pear']);
  const declined = buildConversation([...log, reply('q1', { behavior: 'deny', message: 'let us talk' })], { width: 80, taskId: 'T05' });
  assert.equal(all(declined.lines).at(-1), '  → replied in text instead: let us talk');
});

test('two pending requests: the oldest is pinned, the other waits in lines', () => {
  const { pinned, lines } = buildConversation([request('r1'), request('r2', 'Read', { file_path: '/a' })], { width: 80, taskId: 'T05' });
  assert.equal(pinned.requestId, 'r1');
  assert.ok(all(lines).includes('⚑ T05 wants to use Read'));
  assert.equal(lines.at(-1)[0].style, 'prompt');
});

test('read-only pins nothing and marks a pending request never answered', () => {
  const { pinned, lines } = buildConversation([request('r1'), { t: t++, dir: 'note', kind: 'exited', code: 0 }], { width: 80, taskId: 'T05', readOnly: true });
  assert.equal(pinned, null);
  assert.deepEqual(all(lines).slice(-2), ['  → never answered', '· the worker exited (code 0)']);
});

test('a request cancelled by an interrupt says so, and the interrupt turn end is not shown as a failure', () => {
  const log = [out('person', 'go'), request('r1'), { t: t++, dir: 'out', from: 'person', kind: 'interrupt' }, done('error_during_execution')];
  const { pinned, lines } = buildConversation(log, { width: 80, taskId: 'T05' });
  assert.equal(pinned, null);
  const text = all(lines);
  assert.ok(text.includes('  → cancelled by the interrupt'));
  assert.ok(text.includes('you ▸ ⎋ interrupted the worker'));
  assert.ok(!text.some((l) => l.includes('failed')));
});

test('a turn that fails on its own is shown bad', () => {
  const { lines } = buildConversation([done('error_max_turns')], { width: 80 });
  assert.equal(textOf(lines[0]), '✕ the turn failed (error_max_turns)');
  assert.equal(styleOf(lines[0]), 'bad');
  assert.equal(buildConversation([done('success')], { width: 80 }).lines.length, 0);
});

test('a request allowed by a grant is answered by its dim note, not pinned', () => {
  const log = [request('r1'), { t: t++, dir: 'note', kind: 'delivered-by-grant', requestId: 'r1', toolName: 'Bash' }];
  const { pinned, lines } = buildConversation(log, { width: 80, taskId: 'T05' });
  assert.equal(pinned, null);
  assert.equal(textOf(lines.at(-1)), '· pir allowed Bash: you said not to ask again for this');
  assert.equal(styleOf(lines.at(-1)), 'dim');
  assert.ok(!all(lines).some((l) => l.includes('→')));
});

// ---- Notes, raw, system ----

test('raw and system entries never crash the builder; notes, known and unknown, render dim', () => {
  const log = [
    'not json {',
    42,
    null,
    { t: 1 },
    { t: 2, dir: 'in', event: { type: 'rate_limit_event' } },
    { t: 3, dir: 'in', event: { type: 'system', subtype: 'init', session_id: 's' } },
    { t: 4, dir: 'in', event: { type: 'brand_new' } },
    { t: 5, dir: 'note', kind: 'undelivered', what: 'reply', reason: 'no such request' },
    { t: 6, dir: 'note', kind: 'exited', signal: 'SIGTERM' },
    { t: 7, dir: 'note', kind: 'mystery' },
    { t: 8, dir: 'note', kind: 'sdk-error', message: 'boom' },
  ];
  const { lines, pinned } = buildConversation(log, { width: 80 });
  assert.equal(pinned, null);
  const text = all(lines);
  assert.equal(text.filter((l) => l === '· an unreadable log line').length, 4);
  assert.ok(text.includes('· not delivered: the reply (no such request)'));
  assert.ok(text.includes('· the worker exited (signal SIGTERM)'));
  assert.ok(text.includes('· mystery'));
  assert.ok(text.includes("· the worker's line failed: boom"));
  assert.ok(lines.every((l) => styleOf(l) === 'dim'));
  assert.deepEqual(buildConversation(undefined).lines, []);
});

// ---- The committed sample (T01) ----

test("T01's sample gives one line per step and every message", () => {
  const { lines, pinned } = buildConversation(SAMPLE, { width: 100, taskId: 'T05' });
  assert.equal(pinned, null);
  const text = all(lines);
  const steps = text.filter((l) => l.startsWith('  ⎿ '));
  assert.deepEqual(steps.map((l) => l.split('  ').slice(0, 2).join('  ')), [
    '  ⎿ Bash echo probe-one > probe.txt',
    '  ⎿ AskUserQuestion',
    '  ⎿ Bash rm probe.txt',
    '  ⎿ Bash sleep 4 && echo bg-done',
  ]);
  assert.equal(lines.find((l) => textOf(l).startsWith('  ⎿ Bash rm'))[0].style, 'step-error');
  // Every message sent, and every worker reply, appears.
  for (const e of SAMPLE.map((l) => JSON.parse(l))) {
    if (e.dir === 'out' && e.kind === 'message') assert.ok(text.join(' ').includes(e.text.split(' ').slice(0, 5).join(' ')), e.text);
  }
  for (const w of ['T05 ▸ done', 'T05 ▸ The command was refused.', 'T05 ▸ started', 'T05 ▸ The background task has completed.', 'T05 ▸ 1. Aardvark']) {
    assert.ok(text.includes(w), w);
  }
  assert.ok(text.includes('  → allowed'));
  assert.ok(text.includes('  → refused'));
  assert.ok(text.includes('  Which fruits? → apple, pear'));
  assert.equal(text.at(-1), '· the worker exited');
  assert.ok(!text.some((l) => l.includes('failed')), 'the interrupted turn is not a failure');
});

// ---- The permission gate ----

test('canAlwaysAllow is false with no addRules suggestion or with suppressAlwaysAllowRule', () => {
  assert.equal(gateFor(request('r')).canAlwaysAllow, true);
  assert.equal(gateFor(request('r', 'Bash', { command: 'x' }, { suggestions: [] })).canAlwaysAllow, false);
  assert.equal(gateFor(request('r', 'Bash', { command: 'x' }, { suggestions: [{ type: 'setMode', mode: 'acceptEdits' }] })).canAlwaysAllow, false);
  assert.equal(gateFor(request('r', 'Bash', { command: 'x' }, { suppressAlwaysAllowRule: true })).canAlwaysAllow, false);
  const g = gateFor(request('r', 'Bash', { command: 'rm -rf x' }, { reason: 'This command requires approval', defaultToNo: true }));
  assert.deepEqual(g, {
    kind: 'permission',
    requestId: 'r',
    tool: 'Bash',
    summary: 'rm -rf x',
    description: 'Run the tests',
    reason: 'This command requires approval',
    canAlwaysAllow: true,
    confirmAllow: true,
    armed: false,
  });
  // a without canAlwaysAllow is just another key.
  assert.equal(gateReducer(gateFor(request('r', 'Bash', {}, { suggestions: [] })), 'a').send, null);
});

test('without defaultToNo: one y allows, n refuses, a allows always, other keys do nothing', () => {
  const g = gateFor(request('r'));
  assert.equal(gateReducer(g, 'y').send, 'allow');
  assert.equal(gateReducer(g, 'n').send, 'deny');
  assert.equal(gateReducer(g, 'a').send, 'allow-always');
  assert.deepEqual(gateReducer(g, 'x'), { gate: g, send: null });
});

test('with defaultToNo: y arms, y y allows, y then another key disarms, n refuses at once', () => {
  const g = gateFor(request('r', 'Bash', { command: 'x' }, { defaultToNo: true }));
  const once = gateReducer(g, 'y');
  assert.equal(once.send, null);
  assert.equal(once.gate.armed, 'allow');
  assert.ok(all(promptLines(once.gate, { width: 80 })).some((l) => l.includes('press y again to allow')));
  assert.equal(gateReducer(once.gate, 'y').send, 'allow');
  assert.equal(gateReducer(once.gate, 'y').gate.armed, false);
  const disarmed = gateReducer(once.gate, 'x');
  assert.equal(disarmed.send, null);
  assert.equal(disarmed.gate.armed, false);
  assert.equal(gateReducer(disarmed.gate, 'y').send, null, 'disarmed: the next y arms again');
  assert.equal(gateReducer(g, 'n').send, 'deny');
  assert.equal(gateReducer(once.gate, 'n').send, 'deny');
  // a approves too, so it arms the same way; y then a does not allow.
  const a1 = gateReducer(g, 'a');
  assert.equal(a1.send, null);
  assert.equal(gateReducer(a1.gate, 'a').send, 'allow-always');
  assert.equal(gateReducer(once.gate, 'a').send, null);
});

test('the gate prompt names the keys it offers', () => {
  const offered = all(promptLines(gateFor(request('r')), { width: 200, taskId: 'T05' }));
  assert.deepEqual(offered, [
    '⚑ T05 wants to use Bash',
    '  npm test',
    '  (Run the tests)',
    "  y allow · n refuse · a allow, don't ask again · or type a reply to refuse with it",
  ]);
  const plain = all(promptLines(gateFor(request('r', 'Bash', { command: 'x' }, { suggestions: [] })), { width: 200 }));
  assert.equal(plain.at(-1), '  y allow · n refuse · or type a reply to refuse with it');
  assert.deepEqual(promptLines(null), []);
});

// ---- The question-set picker ----

const picker = () => pickerFor(buildConversation([request('q1', 'AskUserQuestion', QUESTIONS)]).pinned);
const run = (p, events) => events.reduce((acc, e) => pickerReducer(acc.picker, e), { picker: p, send: null });

test('pickerFor starts at the first question with nothing picked', () => {
  const p = picker();
  assert.equal(p.kind, 'questions');
  assert.equal(p.requestId, 'q1');
  assert.equal(p.q, 0);
  assert.equal(p.cursor, 0);
  assert.deepEqual(p.questions.map((x) => [x.picks, x.other]), [[[], ''], [[], '']]);
});

test('picker: single-select replaces the pick, up/down wrap through Other', () => {
  let r = run(picker(), [{ type: 'toggle' }, { type: 'down' }, { type: 'toggle' }]);
  assert.deepEqual(r.picker.questions[0].picks, [1]);
  r = run(r.picker, [{ type: 'down' }, { type: 'down' }]);
  assert.equal(r.picker.cursor, 0, 'down past Other wraps to the top');
  r = run(r.picker, [{ type: 'up' }]);
  assert.equal(r.picker.cursor, 2, 'up from the top lands on Other');
});

test('picker: multi-select toggles, and the answer keeps option order', () => {
  let r = run(picker(), [{ type: 'toggle' }, { type: 'next' }]);
  assert.equal(r.picker.q, 1);
  assert.equal(r.picker.cursor, 0);
  r = run(r.picker, [{ type: 'down' }, { type: 'down' }, { type: 'toggle' }, { type: 'up' }, { type: 'toggle' }, { type: 'up' }, { type: 'toggle' }, { type: 'toggle' }]);
  assert.deepEqual(r.picker.questions[1].picks.sort(), [1, 2]);
  r = run(r.picker, [{ type: 'next' }]);
  assert.deepEqual(r.send, { answers: { 'Which colour?': 'red', 'Which fruits?': 'pear, plum' } });
});

test('picker: Other takes typed text; single-select picks give way to it, multi keeps both', () => {
  let r = run(picker(), [{ type: 'toggle' }, { type: 'down' }, { type: 'down' }, { type: 'toggle' }]);
  assert.equal(r.picker.typingOther, true);
  assert.deepEqual(r.picker.questions[0].picks, [0], 'toggling Other does not pick yet');
  r = run(r.picker, [{ type: 'other', text: '  green  ' }]);
  assert.equal(r.picker.typingOther, false);
  assert.deepEqual(r.picker.questions[0], { ...QUESTIONS.questions[0], picks: [], other: 'green' });
  r = run(r.picker, [{ type: 'next' }, { type: 'down' }, { type: 'down' }, { type: 'toggle' }, { type: 'down' }, { type: 'other', text: 'fig' }, { type: 'next' }]);
  assert.deepEqual(r.send, { answers: { 'Which colour?': 'green', 'Which fruits?': 'plum, fig' } });
  // Picking an option after Other clears the Other text on a single-select question.
  const back = run(picker(), [{ type: 'other', text: 'green' }, { type: 'toggle' }]);
  assert.deepEqual([back.picker.questions[0].picks, back.picker.questions[0].other], [[0], '']);
});

test('picker: next with no answer is a no-op; empty Other text is no answer', () => {
  const p = picker();
  assert.deepEqual(pickerReducer(p, { type: 'next' }), { picker: p, send: null });
  const r = run(p, [{ type: 'other', text: '   ' }, { type: 'next' }]);
  assert.equal(r.picker.q, 0);
  assert.equal(r.send, null);
  const last = run(p, [{ type: 'toggle' }, { type: 'next' }, { type: 'next' }]);
  assert.equal(last.picker.q, 1);
  assert.equal(last.send, null, 'the last question unanswered sends nothing');
  assert.deepEqual(pickerReducer(p, { type: 'bogus' }), { picker: p, send: null });
});

test('the picker prompt shows the current question, its boxes and the cursor', () => {
  const r = run(picker(), [{ type: 'down' }, { type: 'toggle' }]);
  assert.deepEqual(all(promptLines(r.picker, { width: 200, taskId: 'T05' })), [
    '? T05 asks you 2 questions  [Colour ✔] [Fruits]',
    '  Which colour? (pick one)',
    '    ( ) red  r',
    '  ❯ (•) blue  b',
    '    ( ) Other  type your own answer in the box',
    '  ↑↓ move · space choose · ↵ next question · or type a reply to explain instead',
  ]);
  const multi = run(r.picker, [{ type: 'next' }, { type: 'toggle' }, { type: 'down' }, { type: 'down' }, { type: 'down' }, { type: 'toggle' }]);
  const lines = all(promptLines(multi.picker, { width: 200, taskId: 'T05' }));
  assert.ok(lines.includes('    [x] apple'));
  assert.ok(lines.includes('  ❯ [ ] Other  type your own answer in the box'));
  assert.equal(lines.at(-1), '  type your answer in the box, then ↵');
  const typed = run(multi.picker, [{ type: 'other', text: 'fig' }]);
  const done = all(promptLines(typed.picker, { width: 200, taskId: 'T05' }));
  assert.ok(done.includes('  ❯ [x] Other: fig  type your own answer in the box'));
  assert.ok(done.at(-1).includes('↵ send answers'));
});

test('terminal escapes and control characters in worker text and tool output never reach the lines', () => {
  const dirty = '\x1b[31mFAIL\x1b[0m a\tb\x1b[2J 50%\r100%';
  const log = [use('u1', 'Bash\x1b[2J', { command: 'npm\x1b[1m test' }), res('u1', dirty), say('hi \x1b]0;title\x07there'), request('r1', 'Bash\x1b[2J')];
  for (const full of [false, true]) {
    const { lines, pinned } = buildConversation(log, { width: 80, taskId: 'T05', full });
    const painted = [...lines, ...promptLines(pinned, { width: 80, taskId: 'T05' })];
    for (const l of painted) for (const s of l) assert.ok(!/[\x00-\x1f\x7f-\x9f]/.test(s.text), JSON.stringify(s.text));
    if (!full) assert.equal(textOf(lines[0]), '  ⎿ Bash npm test  100%');
    assert.ok(all(lines).includes('T05 ▸ hi there'));
  }
});
