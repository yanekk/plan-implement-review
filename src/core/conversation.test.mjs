// The conversation model (T02; DESIGN §2.3, §2.6, §2.7, §2.11): log entries → styled lines, and the
// permission gate and question-set picker reducers. What the view in T13 paints is decided here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildConversation, gateFor, gateReducer, pickerFor, pickerReducer, promptLines, mainArg, onOther, helperTime } from './conversation.mjs';

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

test('a request answered over Remote Control is answered by its dim note, not pinned', () => {
  const log = [request('r1'), { t: t++, dir: 'note', kind: 'answered-remotely', requestId: 'r1', toolName: 'Bash' }];
  const { pinned, lines } = buildConversation(log, { width: 80, taskId: 'T05' });
  assert.equal(pinned, null);
  assert.equal(textOf(lines.at(-1)), '· answered on claude.ai');
  assert.ok(!all(lines).some((l) => l.includes('cancelled by the interrupt')));
});

test('Remote Control switching on, off and failing render as dim notes', () => {
  const log = [
    { t: t++, dir: 'note', kind: 'remote-control', on: true, url: 'https://claude.ai/code/session_x' },
    { t: t++, dir: 'note', kind: 'remote-control', on: false },
    { t: t++, dir: 'note', kind: 'remote-control-failed', on: true, message: 'Remote Control is disabled' },
  ];
  const { lines } = buildConversation(log, { width: 200 });
  assert.deepEqual(lines.map(textOf), [
    '· remote control on: answer from claude.ai or the Claude app (https://claude.ai/code/session_x)',
    '· remote control off',
    '· remote control could not be switched on: Remote Control is disabled',
  ]);
  assert.ok(lines.every((l) => styleOf(l) === 'dim'));
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
    helper: null,
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

test('picker: single-select replaces the pick; up/down wrap through the Other line', () => {
  let r = run(picker(), [{ type: 'toggle' }, { type: 'down' }, { type: 'toggle' }]);
  assert.deepEqual(r.picker.questions[0].picks, [1]);
  r = run(r.picker, [{ type: 'down' }]);
  assert.equal(onOther(r.picker), true, 'the line after the options is Other');
  r = run(r.picker, [{ type: 'down' }]);
  assert.equal(r.picker.cursor, 0, 'down past Other wraps to the top');
  r = run(r.picker, [{ type: 'up' }]);
  assert.equal(onOther(r.picker), true, 'up from the top lands on Other');
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

test('picker: typing lands on the Other line, from anywhere, and is edited there (user 2026-09-26)', () => {
  // From an option, the first character moves the cursor onto Other.
  let r = run(picker(), [{ type: 'char', text: 'g' }, { type: 'char', text: 'reen' }, { type: 'toggle' }, { type: 'char', text: 'x' }, { type: 'backspace' }, { type: 'backspace' }]);
  assert.equal(onOther(r.picker), true);
  assert.equal(r.picker.questions[0].other, 'green', 'space typed a space on Other; backspace deleted');
  // Leaving the line keeps the text; Enter on an option then answers with the option instead.
  const left = run(r.picker, [{ type: 'down' }, { type: 'next' }]);
  assert.deepEqual([left.picker.q, left.picker.questions[0].picks, left.picker.questions[0].other], [1, [0], '']);
  // Enter on Other answers with the text.
  r = run(r.picker, [{ type: 'next' }]);
  assert.deepEqual([r.picker.q, r.picker.questions[0].other, r.picker.questions[0].picks], [1, 'green', []]);
  // Multi-select: the text joins the ticks, and the last Enter sends.
  r = run(r.picker, [{ type: 'down' }, { type: 'down' }, { type: 'toggle' }, { type: 'char', text: 'fig' }, { type: 'next' }]);
  assert.deepEqual(r.send, { answers: { 'Which colour?': 'green', 'Which fruits?': 'plum, fig' } });
  // Enter on an empty Other line does nothing; backspace off the Other line does nothing.
  const empty = run(picker(), [{ type: 'up' }]).picker;
  assert.deepEqual(pickerReducer(empty, { type: 'next' }), { picker: empty, send: null });
  const p = picker();
  assert.deepEqual(pickerReducer(p, { type: 'backspace' }), { picker: p, send: null });
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

test('the picker prompt shows the question, its boxes, the cursor and the Other line as a text field', () => {
  const r = run(picker(), [{ type: 'down' }, { type: 'toggle' }]);
  assert.deepEqual(all(promptLines(r.picker, { width: 200, taskId: 'T05' })), [
    '? T05 asks you 2 questions  [Colour ✔] [Fruits]',
    '  Which colour? (pick one)',
    '    ( ) red  r',
    '  ❯ (•) blue  b',
    '    ( ) Other: type your own answer',
    '  ↑↓ move · ↵ choose, next question · or just type your own answer',
  ]);
  const typing = all(promptLines(run(r.picker, [{ type: 'char', text: 'teal' }]).picker, { width: 200, taskId: 'T05' }));
  assert.equal(typing.at(-2), '  ❯ ( ) Other: teal▏');
  assert.equal(typing.at(-1), '  type your answer here · ↵ next question · ↑↓ leave it');
  const multi = run(r.picker, [{ type: 'next' }, { type: 'toggle' }, { type: 'char', text: 'fig' }, { type: 'up' }]);
  const lines = all(promptLines(multi.picker, { width: 200, taskId: 'T05' }));
  assert.ok(lines.includes('    [x] apple'));
  assert.ok(lines.includes('    [x] Other: fig'), 'typed text reads as ticked, and stays when the cursor leaves');
  assert.equal(lines.at(-1), '  ↑↓ move · space tick · ↵ send answers · or just type your own answer');
});



test('option descriptions and the Other answer word-wrap under their label instead of clipping (user 2026-09-27)', () => {
  const long = { label: 'Split it', description: 'two tasks, one for the parser and one for the view' };
  const p = pickerFor({ requestId: 'q', questions: [{ question: 'How?', header: 'How', multiSelect: false, options: [long] }] });
  const lines = all(promptLines(p, { width: 40, taskId: 'T05' }));
  assert.deepEqual(lines.slice(2, 5), ['  ❯ ( ) Split it  two tasks, one for the', '        parser and one for the view', '    ( ) Other: type your own answer']);
  assert.ok(lines.every((l) => [...l].length <= 40 && !l.includes('…')));
  const typed = run(p, [{ type: 'char', text: 'first the parser then the view in a later task' }]).picker;
  const other = all(promptLines(typed, { width: 40, taskId: 'T05' })).slice(4, 6);
  assert.deepEqual(other, ['  ❯ (•) Other: first the parser then the', '        view in a later task▏']);
});

test('picker: left/right move the Other caret; typing and backspace work at it', () => {
  let r = run(picker(), [{ type: 'char', text: 'tel' }, { type: 'left' }, { type: 'char', text: 'a' }, { type: 'left' }, { type: 'left' }, { type: 'left' }, { type: 'left' }]);
  assert.deepEqual([r.picker.questions[0].other, r.picker.questions[0].caret], ['teal', 0], 'the caret stops at the start');
  r = run(r.picker, [{ type: 'right' }, { type: 'backspace' }, { type: 'right' }, { type: 'right' }, { type: 'right' }, { type: 'right' }]);
  assert.deepEqual([r.picker.questions[0].other, r.picker.questions[0].caret], ['eal', 3], 'the caret stops at the end');
  // Off the Other line, left/right do nothing; typing from an option appends at the end.
  const off = run(r.picker, [{ type: 'left' }, { type: 'up' }]).picker;
  assert.deepEqual(pickerReducer(off, { type: 'left' }), { picker: off, send: null });
  assert.equal(pickerReducer(off, { type: 'char', text: '!' }).picker.questions[0].other, 'eal!');
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

// T14: a question pending when a planning session was stopped died with it; once resumed into the same
// log the view is live again, and that question must read never answered, not pinned as answerable.
test('buildConversation: a request pending at a `resumed` note is never answered and is not pinned', () => {
  const q = { question: 'Which way?', header: 'Way', multiSelect: false, options: [{ label: 'Small', description: '' }] };
  const entries = [
    { t: 1, dir: 'out', from: 'pir', kind: 'message', text: 'go' },
    { t: 2, dir: 'request', requestId: 'q1', toolName: 'AskUserQuestion', input: { questions: [q] } },
    { t: 3, dir: 'note', kind: 'exited', code: 143 },
    { t: 4, dir: 'note', kind: 'resumed', sessionId: 's' },
  ];
  const conv = buildConversation(entries, { width: 80, readOnly: false });
  assert.equal(conv.pinned, null);
  assert.match(conv.lines.map((l) => (Array.isArray(l) ? l.map((x) => x.text ?? x).join('') : String(l.text ?? l))).join('\n'), /never answered/);
});

// T14 review: only what was still pending at the `resumed` note died with the old process; a request an
// interrupt cancelled earlier keeps reading cancelled after the resume.
test('buildConversation: a request cancelled before a stop still reads cancelled after the resume', () => {
  const log = [
    out('person', 'go'), request('r1'), { t: t++, dir: 'out', from: 'person', kind: 'interrupt' }, done('error_during_execution'),
    { t: t++, dir: 'note', kind: 'exited', code: 143 }, { t: t++, dir: 'note', kind: 'resumed', sessionId: 's' },
  ];
  const text = all(buildConversation(log, { width: 80, taskId: 'T05', readOnly: false }).lines);
  assert.ok(text.includes('  → cancelled by the interrupt'));
  assert.ok(!text.includes('  → never answered'));
});

// ---- What the phone was told (reliable-notifications T07, DESIGN §2.8) ----

test('the alert notes render dim: sent, reminder, and a failure by its error or status', () => {
  const log = [
    { t: t++, dir: 'note', kind: 'notified', reminder: false },
    { t: t++, dir: 'note', kind: 'notified', reminder: true },
    { t: t++, dir: 'note', kind: 'notify-failed', status: 500, error: 'HTTP 500' },
    { t: t++, dir: 'note', kind: 'notify-failed', status: null, error: 'fetch failed: ENOTFOUND' },
    { t: t++, dir: 'note', kind: 'notify-failed', status: 429 },
  ];
  const { lines } = buildConversation(log, { width: 200 });
  assert.deepEqual(lines.map(textOf), [
    '· alert sent to your phone',
    '· reminder sent to your phone',
    '· alert not sent: HTTP 500',
    '· alert not sent: fetch failed: ENOTFOUND',
    '· alert not sent: HTTP 429',
  ]);
  assert.ok(lines.every((l) => styleOf(l) === 'dim'));
});

test('an alert note answers nothing: a pending request stays pending after it (not an ANSWER_NOTES kind)', async () => {
  const { workerActivity } = await import('./stream.mjs');
  for (const kind of ['notified', 'notify-failed']) {
    const log = [request('r1'), { t: t++, dir: 'note', kind, requestId: 'r1' }];
    assert.deepEqual(workerActivity(log).pending.map((p) => p.requestId), ['r1'], kind);
    assert.notEqual(buildConversation(log, { width: 80 }).pinned, null, `${kind}: the request is still pinned`);
  }
});

// ---- Helpers (visible-helpers T03; DESIGN §2.2–§2.4) ----

const HELPER_SAMPLE = readFileSync(fileURLToPath(new URL('./fixtures/helper-sample.ndjson', import.meta.url)), 'utf8')
  .split('\n')
  .filter((l) => l.trim() !== '');
const inHelper = (callId, entry) => ({ ...entry, event: { ...entry.event, parent_tool_use_id: callId } });
const hStart = (id, callId, description, background = true) =>
  sys({ subtype: 'task_started', task_id: id, tool_use_id: callId, description, subagent_type: 'Explore', task_type: 'local_agent', is_backgrounded: background });
const hProgress = (id, callId, description, toolUses, durationMs) =>
  sys({ subtype: 'task_progress', task_id: id, tool_use_id: callId, description, usage: { tool_uses: toolUses, duration_ms: durationMs } });
const hEnd = (id, status) => [sys({ subtype: 'task_updated', task_id: id, patch: { status } }), sys({ subtype: 'task_notification', task_id: id, status })];
const helperLines = (lines) => all(lines).filter((l) => l.startsWith('  ↳ helper'));

test('helperTime: seconds under a minute, minutes and seconds from one; nothing without a duration', () => {
  assert.equal(helperTime(59_999), '59s');
  assert.equal(helperTime(60_000), '1m 0s');
  assert.equal(helperTime(72_400), '1m 12s');
  assert.equal(helperTime(null), '');
});

test('the helper line in each state, with and without progress, clipped at 40 columns', () => {
  const base = [use('ag', 'Agent', { description: 'Survey the code' }), hStart('h1', 'ag', 'Survey the code'), res('ag', 'Async agent launched')];
  const line = (extra) => buildConversation([...base, ...extra], { width: 200 });
  let conv = line([]);
  assert.deepEqual(helperLines(conv.lines), ['  ↳ helper · Survey the code · starting · 0 steps']);
  assert.equal(conv.helpers, 1);
  assert.equal(conv.background, 0, 'a helper is not background work');
  conv = line([hProgress('h1', 'ag', 'Reading a.mjs', 1, 2_000)]);
  assert.deepEqual(helperLines(conv.lines), ['  ↳ helper · Survey the code · Reading a.mjs · 1 step · 2s'], 'one step is singular');
  conv = line([hProgress('h1', 'ag', 'Reading a.mjs', 9, 21_000)]);
  assert.deepEqual(helperLines(conv.lines), ['  ↳ helper · Survey the code · Reading a.mjs · 9 steps · 21s']);
  assert.equal(conv.lines.find((l) => textOf(l).startsWith('  ↳ helper'))[0].style, 'dim');
  conv = line([hProgress('h1', 'ag', 'Reading a.mjs', 20, 59_000)]);
  assert.match(helperLines(conv.lines)[0], /· 59s$/);
  conv = line([hProgress('h1', 'ag', 'Reading a.mjs', 20, 60_000)]);
  assert.match(helperLines(conv.lines)[0], /· 1m 0s$/);
  for (const [status, word, style] of [['completed', 'finished', 'dim'], ['killed', 'stopped', 'bad'], ['stopped', 'stopped', 'bad'], ['failed', 'failed', 'bad']]) {
    conv = line([hProgress('h1', 'ag', 'Reading a.mjs', 20, 72_000), ...hEnd('h1', status)]);
    const l = conv.lines.find((x) => textOf(x).startsWith('  ↳ helper'));
    assert.equal(textOf(l), `  ↳ helper ${word} · Survey the code · 20 steps · 1m 12s`, status);
    assert.equal(l[0].style, style, status);
    assert.equal(conv.helpers, 0);
  }
  conv = line([...hEnd('h1', 'failed')]);
  assert.deepEqual(helperLines(conv.lines), ['  ↳ helper failed · Survey the code · 0 steps'], 'ended before any progress: no time');
  const narrow = buildConversation([...base, hProgress('h1', 'ag', 'Reading a very long file name.mjs', 9, 21_000)], { width: 40 });
  const clipped = helperLines(narrow.lines);
  assert.equal(clipped.length, 1, 'clipped, never wrapped');
  assert.equal([...clipped[0]].length, 40);
  assert.ok(clipped[0].endsWith('…'));
});

test('on the plan-0339 log the default view has one helper line and none of the helper\'s steps or words', () => {
  const { lines, background, helpers } = buildConversation(HELPER_SAMPLE, { width: 100, taskId: 'plan' });
  const text = all(lines);
  assert.deepEqual(helperLines(lines), ['  ↳ helper stopped · Survey end-of-run machinery · 20 steps · 52s']);
  const agentStep = text.findIndex((l) => l.startsWith('  ⎿ Agent Survey end-of-run machinery'));
  assert.equal(text[agentStep + 1], '  ↳ helper stopped · Survey end-of-run machinery · 20 steps · 52s', 'directly under its Agent step');
  assert.ok(!text.some((l) => /Now notify\.mjs endAlert/.test(l)), 'the helper\'s sentence is hidden');
  assert.ok(!text.some((l) => /⎿ (Read|Bash (git log|ls &&|grep))/.test(l)), 'the helper\'s steps are hidden');
  assert.ok(!text.some((l) => /running in the background/.test(l)), 'the old background line for a helper is gone');
  assert.equal(background, 0);
  assert.equal(helpers, 0);
  // The parent's own lines, in order.
  const order = [/^pir ▸ Load the pir-plan skill/, /^  ⎿ Agent /, /^  ⎿ AskUserQuestion/, /^you ▸ ⎋ interrupted/, /^you ▸ continue/, /^plan ▸ I'll go with the finisher/, /^  ⎿ AskUserQuestion/, /^  ⎿ Bash ls node_modules/, /^you ▸ ⎋ interrupted/, /^plan ▸ The requirements are agreed/];
  let at = -1;
  for (const re of order) {
    const next = text.findIndex((l, i) => i > at && re.test(l));
    assert.ok(next > at, `${re} after line ${at}`);
    at = next;
  }
});

test('on the plan-0339 log the detail view draws the helper\'s steps and words labelled, in log order', () => {
  const text = all(buildConversation(HELPER_SAMPLE, { full: true, width: 200, taskId: 'plan' }).lines);
  const helperish = text.filter((l) => /^(  helper ⎿|helper ▸)/.test(l));
  assert.deepEqual(helperish.map((l) => l.replace(/^(  helper ⎿ \w+|helper ▸).*$/, '$1')), [
    '  helper ⎿ Bash', '  helper ⎿ Bash', '  helper ⎿ Read', 'helper ▸', '  helper ⎿ Bash',
  ]);
  assert.ok(text.includes('helper ▸ Now notify.mjs endAlert, index-store, and the naming module.'));
  assert.ok(!text.some((l) => /^plan ▸ Now notify/.test(l)), 'never as the parent\'s');
  const styled = buildConversation(HELPER_SAMPLE, { full: true, width: 200, taskId: 'plan' }).lines.find((l) => textOf(l).startsWith('helper ▸'));
  assert.equal(styleOf(styled), 'dim');
});

test('a foreground helper gets the same line under its Agent step', () => {
  const { lines } = buildConversation([
    use('ag', 'Agent', { description: 'Check the tests' }),
    hStart('h2', 'ag', 'Check the tests', false),
    hProgress('h2', 'ag', 'Running npm test', 3, 8000),
    inHelper('ag', use('x1', 'Bash', { command: 'npm test' })),
    inHelper('ag', res('x1', 'ok')),
  ], { width: 100 });
  assert.deepEqual(all(lines), ['  ⎿ Agent Check the tests', '  ↳ helper · Check the tests · Running npm test · 3 steps · 8s']);
});

test('a helper whose Agent call is not in the log gets its line where it started; one never started gets none', () => {
  const { lines } = buildConversation([
    hStart('h1', 'gone', 'Survey'),
    inHelper('gone', say('reading')),
    inHelper('nostart', say('from a helper we never saw start')),
  ], { width: 100 });
  assert.deepEqual(all(lines), ['  ↳ helper · Survey · starting · 0 steps']);
});

test('the parent\'s background commands keep their two lines; a helper\'s own has none by default, `helper ↳` in full', () => {
  const log = [
    use('ag', 'Agent', { description: 'Survey' }),
    hStart('h1', 'ag', 'Survey'),
    use('b1', 'Bash', { command: 'node slow.js', run_in_background: true }),
    bgStart('t1', 'b1', 'parent slow command'),
    inHelper('ag', use('hb', 'Bash', { command: 'node helper.js', run_in_background: true })),
    bgStart('t2', 'hb', 'helper slow command'),
    ...bgEnd('t1'),
    ...bgEnd('t2'),
  ];
  const text = all(buildConversation(log).lines);
  assert.ok(text.includes('  ↳ running in the background: parent slow command'));
  assert.ok(text.includes('  ↳ finished in the background: parent slow command'));
  assert.ok(!text.some((l) => /helper slow command/.test(l)));
  const full = all(buildConversation(log, { full: true }).lines);
  assert.ok(full.includes('  helper ↳ running in the background: helper slow command'));
  assert.ok(full.includes('  helper ↳ finished in the background: helper slow command'));
  assert.ok(full.includes('  ↳ running in the background: parent slow command'));
  assert.equal(buildConversation(log.slice(0, 6)).background, 1, 'only the parent\'s command counts');
});

test('a helper\'s permission request names the helper, pinned and answered; unknown agentId reads `a helper`', () => {
  const base = [use('ag', 'Agent', { description: 'Survey the code' }), hStart('h1', 'ag', 'Survey the code')];
  const ask = request('p1', 'Bash', { command: 'git log' }, { agentId: 'h1' });
  let conv = buildConversation([...base, ask], { taskId: 'T05' });
  assert.equal(conv.pinned.helper.description, 'Survey the code');
  assert.equal(textOf(promptLines(conv.pinned, { taskId: 'T05' })[0]), '⚑ helper "Survey the code" wants to use Bash');
  conv = buildConversation([...base, ask, reply('p1', { behavior: 'allow', updatedInput: {} })], { taskId: 'T05' });
  const text = all(conv.lines);
  assert.ok(text.includes('⚑ helper "Survey the code" wants to use Bash'));
  assert.ok(text.includes('  → allowed'));

  const qs = request('q1', 'AskUserQuestion', { questions: [QUESTIONS.questions[0]] }, { agentId: 'h1' });
  conv = buildConversation([...base, qs], { taskId: 'T05' });
  assert.match(textOf(promptLines(conv.pinned, { taskId: 'T05' })[0]), /^\? helper "Survey the code" asks you 1 question/);
  conv = buildConversation([...base, qs, reply('q1', { behavior: 'allow', updatedInput: { answers: { 'Which colour?': 'red' } } })], { taskId: 'T05' });
  assert.ok(all(conv.lines).includes('? helper "Survey the code" asks you 1 question'));

  conv = buildConversation([...base, request('p2', 'Bash', { command: 'ls' }, { agentId: 'nobody' })], { taskId: 'T05' });
  assert.equal(textOf(promptLines(conv.pinned, { taskId: 'T05' })[0]), '⚑ a helper wants to use Bash');
  conv = buildConversation([...base, request('p3', 'Bash', { command: 'ls' })], { taskId: 'T05' });
  assert.equal(conv.pinned.helper, null);
  assert.equal(textOf(promptLines(conv.pinned, { taskId: 'T05' })[0]), '⚑ T05 wants to use Bash');
});
