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

test('a skill body Claude injects (isSynthetic user text) is not drawn; an interrupted marker still is (T18)', () => {
  const userText = (text, extra = {}) => ({ t: t++, dir: 'in', event: { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] }, ...extra } });
  const { lines } = buildConversation([
    use('s1', 'Skill', { skill: 'pir-worker' }),
    res('s1', 'Launching skill: pir-worker'),
    userText('Base directory for this skill: /x\n\n# worker\n\nline after line', { isSynthetic: true }),
    userText('[Request interrupted by user for tool use]'),
  ]);
  const text = all(lines).join('\n');
  assert.doesNotMatch(text, /Base directory|# worker|line after line/);
  assert.match(text, /⎿ Skill pir-worker/);
  assert.match(text, /\[Request interrupted by user for tool use\]/);
});

// Background work, as Claude Code 2.1.282 reported it on the T18 live run (user 2026-09-26: show it).
const sys = (event) => ({ t: t++, dir: 'in', event: { type: 'system', ...event } });
const bgStart = (id, toolUseId, description) => sys({ subtype: 'task_started', task_id: id, tool_use_id: toolUseId, description, is_backgrounded: true, task_type: 'local_bash' });
const bgEnd = (id, status = 'completed') => [
  sys({ subtype: 'task_updated', task_id: id, patch: { status } }),
  sys({ subtype: 'task_notification', task_id: id, status, summary: 'x' }),
];

test('background commands and a monitor get a line when they start and when they end; the count follows', () => {
  const start = [
    use('b1', 'Bash', { command: 'node slow.js', run_in_background: true }),
    bgStart('t1', 'b1', 'first slow command'),
    res('b1', 'Command running in background with ID: t1.'),
    use('m1', 'Monitor', { command: 'node ticks.js' }),
    bgStart('t2', 'm1', 'three ticks'),
    res('m1', 'Monitor started (task t2).'),
    done(),
  ];
  let conv = buildConversation(start);
  const text = () => all(conv.lines).join('\n');
  assert.match(text(), /↳ running in the background: first slow command/);
  assert.match(text(), /↳ monitor started: three ticks/);
  assert.equal(conv.background, 2);
  conv = buildConversation([...start, ...bgEnd('t1')]);
  assert.match(text(), /↳ finished in the background: first slow command/);
  assert.equal(conv.background, 1);
  conv = buildConversation([...start, ...bgEnd('t1'), ...bgEnd('t2')]);
  assert.match(text(), /↳ monitor ended: three ticks/);
  assert.equal(conv.background, 0);
  assert.equal((text().match(/finished in the background/g) ?? []).length, 1, 'task_updated draws no second end line');
});

test('a background command that fails is drawn as failed; a foreground task and other system events draw nothing', () => {
  const conv = buildConversation([
    use('b1', 'Bash', { command: 'false', run_in_background: true }),
    bgStart('t1', 'b1', 'doomed'),
    ...bgEnd('t1', 'failed'),
    sys({ subtype: 'task_started', task_id: 't9', description: 'a subagent', is_backgrounded: false }),
    sys({ subtype: 'task_notification', task_id: 't8', status: 'completed' }),
    sys({ subtype: 'rate_limit_event' }),
  ]);
  const lines = conv.lines.filter((l) => textOf(l).includes('↳'));
  assert.deepEqual(lines.map(textOf), ['  ↳ running in the background: doomed', '  ↳ failed in the background: doomed']);
  assert.equal(styleOf(lines[1]), 'bad');
  assert.equal(conv.background, 0);
});

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

test('without defaultToNo: one Enter allows, n refuses, a allows always, other keys (y too) do nothing', () => {
  const g = gateFor(request('r'));
  assert.equal(gateReducer(g, 'enter').send, 'allow');
  assert.deepEqual(gateReducer(g, 'y'), { gate: g, send: null }, 'Enter replaced y (user 2026-09-26)');
  assert.equal(gateReducer(g, 'n').send, 'deny');
  assert.equal(gateReducer(g, 'a').send, 'allow-always');
  assert.deepEqual(gateReducer(g, 'x'), { gate: g, send: null });
});

test('with defaultToNo: Enter arms, Enter Enter allows, Enter then another key disarms, n refuses at once', () => {
  const g = gateFor(request('r', 'Bash', { command: 'x' }, { defaultToNo: true }));
  const once = gateReducer(g, 'enter');
  assert.equal(once.send, null);
  assert.equal(once.gate.armed, 'allow');
  assert.ok(all(promptLines(once.gate, { width: 80 })).some((l) => l.includes('press ↵ again to allow')));
  assert.equal(gateReducer(once.gate, 'enter').send, 'allow');
  assert.equal(gateReducer(once.gate, 'enter').gate.armed, false);
  const disarmed = gateReducer(once.gate, 'x');
  assert.equal(disarmed.send, null);
  assert.equal(disarmed.gate.armed, false);
  assert.equal(gateReducer(disarmed.gate, 'enter').send, null, 'disarmed: the next Enter arms again');
  assert.equal(gateReducer(g, 'n').send, 'deny');
  assert.equal(gateReducer(once.gate, 'n').send, 'deny');
  // a approves too, so it arms the same way; Enter then a does not allow.
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
    "  ↵ allow · n refuse · a allow, don't ask again · or type a reply to refuse with it",
  ]);
  const plain = all(promptLines(gateFor(request('r', 'Bash', { command: 'x' }, { suggestions: [] })), { width: 200 }));
  assert.equal(plain.at(-1), '  ↵ allow · n refuse · or type a reply to refuse with it');
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

test('picker: single-select replaces the pick; up/down wrap over the options only (no Other line)', () => {
  let r = run(picker(), [{ type: 'toggle' }, { type: 'down' }, { type: 'toggle' }]);
  assert.deepEqual(r.picker.questions[0].picks, [1]);
  r = run(r.picker, [{ type: 'down' }]);
  assert.equal(r.picker.cursor, 0, 'down past the last option wraps to the top');
  r = run(r.picker, [{ type: 'up' }]);
  assert.equal(r.picker.cursor, 1, 'up from the top lands on the last option');
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

test('picker: typed text answers the question on screen and moves on (user 2026-09-26)', () => {
  // Single-select: the text replaces a pick.
  let r = run(picker(), [{ type: 'toggle' }, { type: 'typed', text: '  green  ' }]);
  assert.equal(r.picker.q, 1);
  assert.deepEqual(r.picker.questions[0], { ...QUESTIONS.questions[0], picks: [], other: 'green' });
  // Multi-select: the text joins the ticks, and on the last question it sends.
  r = run(r.picker, [{ type: 'down' }, { type: 'down' }, { type: 'toggle' }, { type: 'typed', text: 'fig' }]);
  assert.deepEqual(r.send, { answers: { 'Which colour?': 'green', 'Which fruits?': 'plum, fig' } });
  // Typed text alone answers a multi-select question too.
  const alone = run(picker(), [{ type: 'next' }, { type: 'typed', text: 'kiwi' }]);
  assert.deepEqual(alone.send, { answers: { 'Which colour?': 'red', 'Which fruits?': 'kiwi' } });
});

test('picker: single-select Enter picks the line under the cursor and moves on (user 2026-09-26)', () => {
  const r = run(picker(), [{ type: 'down' }, { type: 'next' }]);
  assert.equal(r.picker.q, 1);
  assert.deepEqual(r.picker.questions[0].picks, [1]);
  // A picked option is replaced by the one under the cursor at Enter.
  const moved = run(picker(), [{ type: 'toggle' }, { type: 'down' }, { type: 'next' }]);
  assert.deepEqual(moved.picker.questions[0].picks, [1]);
  // A lone single-select question sends at the first Enter.
  const lone = pickerFor({ requestId: 'q', questions: [QUESTIONS.questions[0]] });
  assert.deepEqual(pickerReducer(lone, { type: 'next' }).send, { answers: { 'Which colour?': 'red' } });
});

test('picker: next with no tick is a no-op on a multi-select question; blank typed text does nothing', () => {
  const p = picker();
  const blank = pickerReducer(p, { type: 'typed', text: '   ' });
  assert.deepEqual(blank, { picker: p, send: null });
  const onMulti = run(p, [{ type: 'next' }]).picker;
  assert.deepEqual(pickerReducer(onMulti, { type: 'next' }), { picker: onMulti, send: null });
  const last = run(p, [{ type: 'toggle' }, { type: 'next' }, { type: 'next' }]);
  assert.equal(last.picker.q, 1);
  assert.equal(last.send, null, 'the last question unanswered sends nothing');
  assert.deepEqual(pickerReducer(p, { type: 'bogus' }), { picker: p, send: null });
});

test('the picker prompt shows the current question, its boxes and the cursor, and no Other line', () => {
  const r = run(picker(), [{ type: 'down' }, { type: 'toggle' }]);
  assert.deepEqual(all(promptLines(r.picker, { width: 200, taskId: 'T05' })), [
    '? T05 asks you 2 questions  [Colour ✔] [Fruits]',
    '  Which colour? (pick one)',
    '    ( ) red  r',
    '  ❯ (•) blue  b',
    '  ↑↓ move · ↵ choose, next question · or type your own answer and ↵',
  ]);
  const multi = run(r.picker, [{ type: 'next' }, { type: 'toggle' }]);
  const lines = all(promptLines(multi.picker, { width: 200, taskId: 'T05' }));
  assert.ok(lines.includes('  ❯ [x] apple'));
  assert.ok(!lines.some((l) => l.includes('Other')));
  assert.equal(lines.at(-1), '  ↑↓ move · space tick · ↵ send answers · or type your own answer and ↵');
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
