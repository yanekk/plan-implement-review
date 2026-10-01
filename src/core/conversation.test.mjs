// The conversation model (T02; DESIGN §2.3, §2.6, §2.7, §2.11): log entries → styled lines, and the
// permission gate and question-set picker reducers. What the view in T13 paints is decided here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildConversation, gateFor, gateReducer, pickerFor, pickerReducer, promptLines, mainArg, onOther, helperTime, stepKind, groupLabel, shellEndLine, shellRunningLine, handGateFor, handReducer } from './conversation.mjs';
import { grantFrom } from './person-input.mjs';
import { HAND_TOOL, handDeclineMessage } from './bang.mjs';

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
  ], { open: new Set(['s1']) });
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

// group-commands §4: a step line is now drawn inside an open group, two columns deeper.
test('one tool use in an open group renders as exactly one step line, regardless of result length', () => {
  const body = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n');
  const { lines } = buildConversation([use('u1', 'Bash', { command: 'npm test\n--verbose' }), res('u1', `${body}\n\n`)], { width: 80, taskId: 'T05', open: new Set(['u1']) });
  assert.equal(lines.length, 2);
  assert.equal(textOf(lines[0]), '  ▾ Ran 1 shell command');
  assert.equal(textOf(lines[1]), '    ⎿ Bash npm test  line 50');
  assert.deepEqual(lines[1].map((s) => s.style), ['step', 'dim']);
});

test('a step line is truncated to width by code point and never splits a surrogate pair', () => {
  const { lines } = buildConversation([use('u1', 'Bash', { command: `echo ${'😀'.repeat(60)}` }), res('u1', 'ok')], { width: 30, open: new Set(['u1']) });
  const text = textOf(lines[1]);
  assert.equal([...text].length, 30);
  assert.ok(text.endsWith('…'));
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(text), 'no lone high surrogate');
  const exact = buildConversation([use('u1', 'Read', { file_path: 'a'.repeat(19) })], { width: 30 }).lines[0];
  assert.equal(textOf(exact), `  ⎿ Read ${'a'.repeat(19)}`, 'a running line that fits is not clipped');
  const openExact = buildConversation([use('u1', 'Read', { file_path: 'a'.repeat(19) }), res('u1', '')], { width: 30, open: new Set(['u1']) }).lines[1];
  assert.equal(textOf(openExact), `    ⎿ Read ${'a'.repeat(19)}`, 'an open step that fits exactly is not clipped');
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
  const { lines } = buildConversation([use('u1', 'Bash', { command: 'false' }), res('u1', 'exit 1', true)], { width: 80, open: new Set(['u1']) });
  assert.equal(styleOf(lines[1]), 'step-error');
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
  const withoutSteps = (lines) => all(lines).filter((l) => !l.startsWith('  ⎿') && !l.startsWith('  ▸') && !l.startsWith('      '));
  assert.deepEqual(all(brief), ['pir ▸ go', '  ▸ Ran 1 shell command', 'T05 ▸ done']);
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

test("T01's sample gives one group line per run of steps, one step line each when open, and every message", () => {
  const folded = buildConversation(SAMPLE, { width: 100, taskId: 'T05' }).lines;
  // The sample predates `toolUseId` on requests and its requestIds are not tool-use ids, so the refused rm
  // reads failed, as its isError says (group-commands §2.2).
  assert.deepEqual(all(folded).filter((l) => l.startsWith('  ▸ ')), [
    '  ▸ Ran 1 shell command',
    '  ▸ Asked 1 question set',
    '  ▸ Ran 1 shell command · 1 failed',
    '  ▸ Ran 1 shell command',
  ]);
  const ids = new Set(folded.filter((l) => l.hit).map((l) => l.hit.id));
  assert.equal(ids.size, 4);
  const { lines, pinned } = buildConversation(SAMPLE, { width: 100, taskId: 'T05', open: ids });
  assert.equal(pinned, null);
  const text = all(lines);
  const steps = text.filter((l) => l.startsWith('    ⎿ '));
  assert.deepEqual(steps.map((l) => l.split('  ').slice(0, 3).join('  ')), [
    '    ⎿ Bash echo probe-one > probe.txt',
    '    ⎿ AskUserQuestion',
    '    ⎿ Bash rm probe.txt',
    '    ⎿ Bash sleep 4 && echo bg-done',
  ]);
  assert.equal(lines.find((l) => textOf(l).startsWith('    ⎿ Bash rm'))[0].style, 'step-error');
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
  assert.ok(!text.some((l) => l.includes('the turn failed')), 'the interrupted turn is not a failure');
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
    const { lines, pinned } = buildConversation(log, { width: 80, taskId: 'T05', full, open: new Set(['u1']) });
    const painted = [...lines, ...promptLines(pinned, { width: 80, taskId: 'T05' })];
    for (const l of painted) for (const s of l) assert.ok(!/[\x00-\x1f\x7f-\x9f]/.test(s.text), JSON.stringify(s.text));
    if (!full) assert.equal(textOf(lines[1]), '    ⎿ Bash npm test  100%');
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
  assert.ok(clipped[0].endsWith('…'), 'no room for any step text: the whole line is clipped at the edge');
});

// T06 drill (person, 2026-09-29): at 60 columns the step text used to push the count and time off the edge.
test('a running helper\'s step text is shortened first, so its step count and time stay on screen', () => {
  const base = [use('ag', 'Agent', { description: 'Survey the code' }), hStart('h1', 'ag', 'Survey the code'), res('ag', 'Async agent launched')];
  const at = (width, step) => helperLines(buildConversation([...base, hProgress('h1', 'ag', step, 9, 21_000)], { width }).lines)[0];
  assert.equal(at(60, 'Reading src/shell/conversation-view.mjs'), '  ↳ helper · Survey the code · Reading src/… · 9 steps · 21s');
  assert.equal([...at(60, 'Reading src/shell/conversation-view.mjs')].length, 60);
  const fits = '  ↳ helper · Survey the code · Reading src/shell/conversation-view.mjs · 9 steps · 21s';
  assert.equal(at(90, 'Reading src/shell/conversation-view.mjs'), fits, 'a line that fits is untouched');
  const long = at(80, `Reading ${'a/'.repeat(40)}x.mjs`);
  assert.match(long, /^  ↳ helper · Survey the code · Reading a\/a\/.*… · 9 steps · 21s$/);
  assert.equal([...long].length, 80);
  assert.equal(at(80, 'line one\nline two'), '  ↳ helper · Survey the code · line one line two · 9 steps · 21s', 'a newline in a step reads as a space');
  // Two columns of room is the least that shortens; with less, the whole line is clipped at the edge.
  const tight = '  ↳ helper · Survey the code ·  · 9 steps · 21s'.length + 2;
  assert.equal(at(tight, 'Reading x.mjs'), '  ↳ helper · Survey the code · R… · 9 steps · 21s');
  assert.ok(at(tight - 1, 'Reading x.mjs').endsWith('…'));
});

test('on the plan-0339 log the default view has one helper line and none of the helper\'s steps or words', () => {
  // Folded, the helper line follows the group its Agent step closes; the helper's hidden frames end no group.
  const folded = all(buildConversation(HELPER_SAMPLE, { width: 100, taskId: 'plan' }).lines);
  const group = folded.indexOf('  ▸ Ran 1 agent');
  assert.equal(folded[group + 1], '  ↳ helper stopped · Survey end-of-run machinery · 20 steps · 52s', 'directly under its group');
  // Every group open, so the parent's steps can be read one by one (group-commands DESIGN §4).
  const ids = buildConversation(HELPER_SAMPLE, { width: 100, taskId: 'plan' }).lines.filter((l) => l.hit).map((l) => l.hit.id);
  const { lines, background, helpers } = buildConversation(HELPER_SAMPLE, { width: 100, taskId: 'plan', open: new Set(ids) });
  const text = all(lines);
  assert.deepEqual(helperLines(lines), ['  ↳ helper stopped · Survey end-of-run machinery · 20 steps · 52s']);
  const agentStep = text.findIndex((l) => l.startsWith('    ⎿ Agent Survey end-of-run machinery'));
  assert.equal(text[agentStep + 1], '  ↳ helper stopped · Survey end-of-run machinery · 20 steps · 52s', 'directly under its Agent step');
  assert.ok(!text.some((l) => /Now notify\.mjs endAlert/.test(l)), 'the helper\'s sentence is hidden');
  assert.ok(!text.some((l) => /⎿ (Read|Bash (git log|ls &&|grep))/.test(l)), 'the helper\'s steps are hidden');
  assert.ok(!text.some((l) => /running in the background/.test(l)), 'the old background line for a helper is gone');
  assert.equal(background, 0);
  assert.equal(helpers, 0);
  // The parent's own lines, in order.
  const order = [/^pir ▸ Load the pir-plan skill/, /^ +⎿ Agent /, /^ +⎿ AskUserQuestion/, /^you ▸ ⎋ interrupted/, /^you ▸ continue/, /^plan ▸ I'll go with the finisher/, /^ +⎿ AskUserQuestion/, /^ +⎿ Bash ls node_modules/, /^you ▸ ⎋ interrupted/, /^plan ▸ The requirements are agreed/];
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

// visible-helpers T05 (DESIGN §2.6): the note pir put before the person's message is drawn under it.
test('a sent message with a preface draws `you ▸ {text}` then the note as a `pir ▸` line; without one, no note', () => {
  const note = '[pir] Before this message, the person\'s interrupt stopped your helper: "Survey the code". It will not report back. Start it again or do the work yourself if it is still needed.';
  const log = [
    { t: t++, dir: 'out', from: 'person', kind: 'message', text: 'continue', preface: note, helpersStopped: ['h1'] },
    out('person', 'again'),
  ];
  const { lines } = buildConversation(log, { width: 400, taskId: 'T05' });
  assert.deepEqual(all(lines), ['you ▸ continue', `pir ▸ ${note}`, 'you ▸ again']);
  assert.equal(styleOf(lines[1]), 'pir');
  const narrow = all(buildConversation(log, { width: 60, taskId: 'T05' }).lines);
  assert.ok(narrow[1].startsWith('pir ▸ [pir] Before this message'));
  assert.ok(narrow.length > 3, 'the note wraps like any message');
});

// ---- Grouped steps (group-commands T01; DESIGN §2.1–§2.6) ----

const groupLinesOf = (lines) => lines.filter((l) => l.hit);
const step = (id, name, input = {}, result = 'ok', isError = false) => [use(id, name, input), res(id, result, isError)];

test('four consecutive finished steps fold into one group line, capitalised only on the first word', () => {
  const { lines } = buildConversation([
    ...step('a', 'Read', { file_path: '/x' }),
    ...step('b', 'Grep', { pattern: 'x' }),
    ...step('c', 'Bash', { command: 'ls' }),
    ...step('d', 'Edit', { file_path: '/x' }),
  ]);
  assert.deepEqual(all(lines), ['  ▸ Read 1 file, searched 1 time, ran 1 shell command, edited 1 file']);
  assert.deepEqual(lines[0].map((s) => s.style), ['step']);
});

test('one finished Bash reads Ran 1 shell command; two read Ran 2 shell commands', () => {
  assert.deepEqual(all(buildConversation(step('a', 'Bash')).lines), ['  ▸ Ran 1 shell command']);
  assert.deepEqual(all(buildConversation([...step('a', 'Bash'), ...step('b', 'Bash')]).lines), ['  ▸ Ran 2 shell commands']);
});

test('every kind in the §2.2 table, singular and plural; shared phrases share a count; an unknown tool keeps its name', () => {
  const table = [
    ['Bash', 'ran 1 shell command', 'ran 2 shell commands'],
    ['Read', 'read 1 file', 'read 2 files'],
    ['Write', 'wrote 1 file', 'wrote 2 files'],
    ['Edit', 'edited 1 file', 'edited 2 files'],
    ['MultiEdit', 'edited 1 file', 'edited 2 files'],
    ['NotebookEdit', 'edited 1 file', 'edited 2 files'],
    ['Grep', 'searched 1 time', 'searched 2 times'],
    ['Glob', 'searched 1 time', 'searched 2 times'],
    ['WebFetch', 'fetched 1 page', 'fetched 2 pages'],
    ['WebSearch', 'searched the web 1 time', 'searched the web 2 times'],
    ['Task', 'ran 1 agent', 'ran 2 agents'],
    ['Agent', 'ran 1 agent', 'ran 2 agents'],
    ['Skill', 'loaded 1 skill', 'loaded 2 skills'],
    ['TodoWrite', 'updated the to-do list 1 time', 'updated the to-do list 2 times'],
    ['AskUserQuestion', 'asked 1 question set', 'asked 2 question sets'],
    ['Monitor', 'started 1 monitor', 'started 2 monitors'],
    ['mcp__x__y', 'used mcp__x__y 1 time', 'used mcp__x__y 2 times'],
  ];
  const cap = (s) => s[0].toUpperCase() + s.slice(1);
  for (const [name, one, two] of table) {
    assert.equal(groupLabel([{ name }]).text, cap(one), name);
    assert.equal(groupLabel([{ name }, { name }]).text, cap(two), name);
    assert.deepEqual(all(buildConversation(step('a', name)).lines), [`  ▸ ${cap(one)}`], name);
  }
  assert.equal(groupLabel([{ name: 'Edit' }, { name: 'MultiEdit' }]).text, 'Edited 2 files');
  assert.equal(groupLabel([{ name: 'Grep' }, { name: 'Glob' }]).text, 'Searched 2 times');
  assert.equal(groupLabel([{ name: 'Bash' }, { name: 'Task' }]).text, 'Ran 1 shell command, ran 1 agent', 'same verb, different kind');
  assert.deepEqual(stepKind('mcp__x__y'), { key: 'tool:mcp__x__y', verb: 'used mcp__x__y', one: 'time', many: 'times' });
  assert.equal(stepKind('Edit').key, stepKind('MultiEdit').key);
  assert.equal(stepKind('toString').verb, 'used toString', 'an inherited property name is still an unknown tool');
  assert.deepEqual(groupLabel([]), { text: '', failed: 0, refused: 0 });
});

test('kinds are listed in the order each first appeared', () => {
  const { lines } = buildConversation([...step('a', 'Bash'), ...step('b', 'Read'), ...step('c', 'Bash')]);
  assert.deepEqual(all(lines), ['  ▸ Ran 2 shell commands, read 1 file']);
});

test('a failed step adds a step-error suffix that survives clipping; the label is cut first', () => {
  const log = [...step('a', 'Read'), ...step('b', 'Grep'), ...step('c', 'Bash', { command: 'false' }, 'exit 1', true), ...step('d', 'Edit')];
  const wide = buildConversation(log).lines[0];
  assert.equal(textOf(wide), '  ▸ Read 1 file, searched 1 time, ran 1 shell command, edited 1 file · 1 failed');
  assert.deepEqual(wide.map((s) => s.style), ['step', 'step-error']);
  const narrow = buildConversation(log, { width: 30 }).lines[0];
  assert.equal([...textOf(narrow)].length, 30);
  assert.equal(narrow[0].text, '  ▸ Read 1 file, s…');
  assert.deepEqual(narrow.slice(1), [{ text: ' · 1 failed', style: 'step-error' }]);
  assert.equal(groupLabel([{ name: 'Bash', isError: true }, { name: 'Bash' }]).failed, 1);
});

test('a refused request reads refused, dim, not failed: permission with or without a message, and a question set answered in text', () => {
  const deny = (message) => ({ behavior: 'deny', message });
  const refusedBash = (id, message) => [
    use(id, 'Bash', { command: 'rm x' }),
    request(`r-${id}`, 'Bash', { command: 'rm x' }, { toolUseId: id }),
    reply(`r-${id}`, deny(message)),
    res(id, message ?? 'refused', true),
  ];
  for (const message of [undefined, 'not that file']) {
    const { lines } = buildConversation(refusedBash('a', message));
    const line = groupLinesOf(lines)[0];
    assert.equal(textOf(line), '  ▸ Ran 1 shell command · 1 refused');
    assert.deepEqual(line.map((s) => s.style), ['step', 'dim']);
  }
  const asked = [
    use('q', 'AskUserQuestion', QUESTIONS),
    request('r-q', 'AskUserQuestion', QUESTIONS, { toolUseId: 'q' }),
    reply('r-q', deny('just pick red')),
    res('q', 'just pick red', true),
  ];
  assert.equal(textOf(groupLinesOf(buildConversation(asked).lines)[0]), '  ▸ Asked 1 question set · 1 refused');
  assert.deepEqual(groupLabel([{ name: 'Bash', isError: true, refused: true }]), { text: 'Ran 1 shell command', failed: 0, refused: 1 });
});

test('a failure and a refusal in one group: failed first, then refused, both kept at a narrow width', () => {
  // An answered request draws in the scrollback and so ends its group; its step's result arrives before
  // the reply here, so both steps are in the group ahead of the request's lines.
  const log = [
    ...step('f', 'Bash', { command: 'false' }, 'exit 1', true),
    use('a', 'Bash', { command: 'rm x' }),
    res('a', 'refused', true),
    request('ra', 'Bash', { command: 'rm x' }, { toolUseId: 'a' }),
    reply('ra', { behavior: 'deny' }),
  ];
  const line = groupLinesOf(buildConversation(log).lines)[0];
  assert.equal(textOf(line), '  ▸ Ran 2 shell commands · 1 failed · 1 refused');
  assert.deepEqual(line.map((s) => s.style), ['step', 'step-error', 'dim']);
  const narrow = groupLinesOf(buildConversation(log, { width: 30 }).lines)[0];
  assert.equal([...textOf(narrow)].length, 30);
  assert.deepEqual(narrow.slice(1).map((s) => s.text), [' · 1 failed', ' · 1 refused']);
});

test('a request is tied to its step by toolUseId, else by a requestId equal to it; untied, the step reads failed', () => {
  const refused = (reqExtra, requestId) => [
    use('tu1', 'Bash', { command: 'rm x' }),
    res('tu1', 'refused', true),
    request(requestId, 'Bash', { command: 'rm x' }, reqExtra),
    reply(requestId, { behavior: 'deny' }),
  ];
  const label = (log) => textOf(groupLinesOf(buildConversation(log).lines)[0]);
  assert.equal(label(refused({ toolUseId: 'tu1' }, 'req-9')), '  ▸ Ran 1 shell command · 1 refused', 'by toolUseId');
  assert.equal(label(refused({}, 'tu1')), '  ▸ Ran 1 shell command · 1 refused', 'an old log: by requestId');
  assert.equal(label(refused({}, 'req-9')), '  ▸ Ran 1 shell command · 1 failed', 'tied to no step: failed');
  assert.equal(label(refused({ toolUseId: 'other' }, 'tu1')), '  ▸ Ran 1 shell command · 1 failed', 'a toolUseId wins over the requestId');
  const allowed = [use('tu1', 'Bash'), res('tu1', 'boom', true), request('r', 'Bash', {}, { toolUseId: 'tu1' }), reply('r', { behavior: 'allow', updatedInput: {} })];
  assert.equal(label(allowed), '  ▸ Ran 1 shell command · 1 failed', 'an allowed step that then fails is failed');
  // Open, the refused step keeps today's step-error one-liner.
  const open = buildConversation(refused({ toolUseId: 'tu1' }, 'req-9'), { open: new Set(['tu1']) }).lines;
  assert.equal(textOf(open[1]), '    ⎿ Bash rm x  refused');
  assert.equal(styleOf(open[1]), 'step-error');
});

test('every §2.1 breaker between two steps makes two groups', () => {
  const sysEv = (event) => ({ t: t++, dir: 'in', event: { type: 'system', ...event } });
  const breakers = {
    'worker text': [say('thinking')],
    'person sent': [out('person', 'hi')],
    'pir sent': [out('pir', 'go on')],
    'a drawn permission': [request('rp', 'Bash'), reply('rp', { behavior: 'allow', updatedInput: {} })],
    'a drawn question set': [request('rq', 'AskUserQuestion', QUESTIONS), reply('rq', { behavior: 'allow', updatedInput: { answers: {} } })],
    interrupt: [{ t: t++, dir: 'out', from: 'person', kind: 'interrupt' }],
    'failed result': [done('error_max_turns')],
    note: [{ t: t++, dir: 'note', kind: 'exited', code: 0 }],
    'background start': [sysEv({ subtype: 'task_started', task_id: 'bg1', tool_use_id: 'a', description: 'slow', is_backgrounded: true })],
    'raw line': ['not json {'],
  };
  for (const [name, between] of Object.entries(breakers)) {
    const { lines } = buildConversation([...step('a', 'Bash'), ...between, ...step('b', 'Bash')]);
    assert.deepEqual(groupLinesOf(lines).map((l) => l.hit.id), ['a', 'b'], name);
    assert.ok(lines.indexOf(groupLinesOf(lines)[0]) < lines.indexOf(groupLinesOf(lines)[1]) - 1, `${name} drew something between`);
  }
  // A background end: the task started earlier, behind a message, and ends between two steps.
  const endLog = [
    use('z', 'Bash', { command: 'slow', run_in_background: true }),
    sysEv({ subtype: 'task_started', task_id: 'bg2', tool_use_id: 'z', description: 'slow', is_backgrounded: true }),
    res('z', 'running'),
    say('started'),
    ...step('a', 'Bash'),
    sysEv({ subtype: 'task_updated', task_id: 'bg2', patch: { status: 'completed' } }),
    sysEv({ subtype: 'task_notification', task_id: 'bg2', status: 'completed' }),
    ...step('b', 'Bash'),
  ];
  const ended = buildConversation(endLog).lines;
  assert.deepEqual(groupLinesOf(ended).map((l) => l.hit.id), ['z', 'a', 'b']);
  assert.ok(all(ended).includes('  ↳ finished in the background: slow'));
});

test('events that draw nothing between steps keep them in one group', () => {
  const userText = (text, extra = {}) => ({ t: t++, dir: 'in', event: { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] }, ...extra } });
  const silent = {
    'tool results': [],
    init: [{ t: t++, dir: 'in', event: { type: 'system', subtype: 'init', session_id: 's' } }],
    'synthetic text': [userText('skill body', { isSynthetic: true })],
    'empty text': [say('  ')],
    'success result': [done()],
    'non-background system event': [{ t: t++, dir: 'in', event: { type: 'system', subtype: 'rate_limit_event' } }],
  };
  for (const [name, between] of Object.entries(silent)) {
    const log = name === 'tool results'
      ? [use('a', 'Bash'), use('b', 'Read'), res('a', 'ok'), res('b', 'ok')]
      : [...step('a', 'Bash'), ...between, ...step('b', 'Read')];
    assert.deepEqual(all(buildConversation(log).lines), ['  ▸ Ran 1 shell command, read 1 file'], name);
  }
  // The pinned request is drawn below the scrollback, not in it.
  const pinnedLog = [...step('a', 'Bash'), use('b', 'Read'), request('rb', 'Read', { file_path: '/x' })];
  const pinned = buildConversation(pinnedLog);
  assert.equal(pinned.pinned.requestId, 'rb');
  assert.deepEqual(all(pinned.lines), ['  ▸ Ran 1 shell command', '  ⎿ Read'], 'one group: the running Read after its line');
  assert.deepEqual(groupLinesOf(pinned.lines).map((l) => l.hit.id), ['a']);
});

test('a running step has its own line, joins the count once its result arrives', () => {
  const alone = buildConversation([use('a', 'Bash', { command: 'npm test' })]).lines;
  assert.deepEqual(all(alone), ['  ⎿ Bash npm test'], 'no group line while every step runs');
  assert.equal(groupLinesOf(alone).length, 0);
  const log = [...step('a', 'Bash', { command: 'ls' }), use('b', 'Bash', { command: 'npm test' })];
  assert.deepEqual(all(buildConversation(log).lines), ['  ▸ Ran 1 shell command', '  ⎿ Bash npm test']);
  const later = buildConversation([...log, res('b', 'ok')]).lines;
  assert.deepEqual(all(later), ['  ▸ Ran 2 shell commands']);
});

test('parallel tool uses: a running step before a finished one is drawn after the group line', () => {
  const { lines } = buildConversation([use('a', 'Bash', { command: 'slow' }), use('b', 'Read', { file_path: '/x' }), res('b', 'ok')]);
  assert.deepEqual(all(lines), ['  ▸ Read 1 file', '  ⎿ Bash slow']);
  assert.deepEqual(lines[0].hit, { kind: 'group', id: 'a' }, 'the id is the first step, running or not');
});

test('an open group draws ▾ and one indented step line per finished step, running lines after', () => {
  const log = [
    ...step('a', 'Read', { file_path: '/x/y.mjs' }, 'one\ntwo'),
    ...step('b', 'Bash', { command: 'false' }, 'exit 1', true),
    use('c', 'Bash', { command: 'npm test' }),
  ];
  const { lines } = buildConversation(log, { open: new Set(['a']) });
  assert.deepEqual(all(lines), [
    '  ▾ Read 1 file, ran 1 shell command · 1 failed',
    '    ⎿ Read /x/y.mjs  two',
    '    ⎿ Bash false  exit 1',
    '  ⎿ Bash npm test',
  ]);
  assert.deepEqual(lines[1].map((s) => s.style), ['step', 'dim']);
  assert.equal(styleOf(lines[2]), 'step-error');
  assert.equal(styleOf(lines[3]), 'step');
  assert.deepEqual(all(buildConversation(log, { open: new Set(['b']) }).lines)[0], '  ▸ Read 1 file, ran 1 shell command · 1 failed', 'an id that is not a group opens nothing');
});

test('hit is on group lines only, and a group keeps its id as the log grows', () => {
  const first = [out('pir', 'go'), ...step('a', 'Bash')];
  const check = (log, ids) => {
    const { lines } = buildConversation(log);
    assert.deepEqual(groupLinesOf(lines).map((l) => l.hit), ids.map((id) => ({ kind: 'group', id })));
    for (const l of lines) if (!textOf(l).startsWith('  ▸ ')) assert.equal(l.hit, undefined, textOf(l));
  };
  check(first, ['a']);
  check([...first, ...step('b', 'Read')], ['a']);
  check([...first, ...step('b', 'Read'), use('c', 'Bash')], ['a']);
  check([...first, ...step('b', 'Read'), use('c', 'Bash'), say('done'), ...step('d', 'Edit')], ['a', 'd']);
  const opened = buildConversation([...first, ...step('b', 'Read')], { open: new Set(['a']) }).lines;
  assert.deepEqual(opened.filter((l) => l.hit).length, 1, 'open step lines carry no hit');
});

test('full mode is unchanged: identical to the output before grouping, no group lines, no hits', () => {
  const snapshot = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/stream-sample.full-lines.json', import.meta.url)), 'utf8'));
  for (const w of [40, 100]) {
    const { lines } = buildConversation(SAMPLE, { width: w, taskId: 'T05', full: true, open: new Set(['toolu_01872VZK1V56qz21PomU1BX5']) });
    assert.deepEqual(lines.map((l) => [...l]), snapshot[w], `width ${w}`);
    assert.ok(lines.every((l) => l.hit === undefined));
  }
  const log = [...step('a', 'Read'), ...step('b', 'Bash', { command: 'ls' }, 'x\ny'), use('c', 'Edit', { file_path: '/z' })];
  assert.deepEqual(all(buildConversation(log, { full: true }).lines), ['  ⎿ Read', '      ok', '  ⎿ Bash ls', '      x', '      y', '  ⎿ Edit /z']);
});

test('read-only: a step that never got a result stays its own line', () => {
  const log = [...step('a', 'Read'), use('b', 'Bash', { command: 'npm test' }), { t: t++, dir: 'note', kind: 'exited', signal: 'SIGKILL' }];
  assert.deepEqual(all(buildConversation(log, { readOnly: true }).lines), ['  ▸ Read 1 file', '  ⎿ Bash npm test', '· the worker exited (signal SIGKILL)']);
});

// ---- The person's own command, its block (bang-commands T06, DESIGN §2.8). ----

const shStart = (id, command, extra = {}) => ({ t: t++, dir: 'shell', kind: 'start', id, command, cwd: '/w', ...extra });
const shOut = (id, text, extra = {}) => ({ t: t++, dir: 'shell', kind: 'output', id, text, ...extra });
const shEnd = (id, extra = {}) => ({ t: t++, dir: 'shell', kind: 'end', id, code: 0, signal: null, stopped: null, ms: 6000, sent: 'message', ...extra });
const shSent = (id, text = '[pir] The person ran a command in your working folder:\n$ x\nexit 0 · 6s\nhi') => ({ t: t++, dir: 'out', from: 'person', kind: 'message', text, shell: id });

test('a finished command block: you ! command, its output indented, the end line, and the agent\'s reply after it', () => {
  const { lines } = buildConversation([out('pir', 'Build T05.'), shStart('sh-1', "printf 'one\\ntwo\\n'"), shOut('sh-1', 'one\ntwo\n'), shSent('sh-1'), shEnd('sh-1'), say('Thanks.')], { taskId: 'T05' });
  assert.deepEqual(all(lines), ['pir ▸ Build T05.', "you ! printf 'one\\ntwo\\n'", '  one', '  two', '  ✓ exit 0 · 6s · sent to T05', 'T05 ▸ Thanks.']);
  const head = lines[1];
  assert.deepEqual(head.map((s) => [s.text, s.style]), [['you ', 'person'], ['!', 'shell'], [" printf 'one\\ntwo\\n'", 'person']]);
  assert.equal(styleOf(lines[2]), null, 'output is plain');
  assert.equal(styleOf(lines[4]), 'ok');
});

test('the message a command sent is not drawn a second time; one whose block is not in the entries still shows', () => {
  const { lines } = buildConversation([shStart('sh-1', 'ls'), shSent('sh-1', 'the text'), shEnd('sh-1')], { taskId: 'T05' });
  assert.ok(!all(lines).some((l) => l.includes('the text')), 'hidden: the block is its representation');
  const orphan = buildConversation([shSent('sh-9', 'the text')], { taskId: 'T05' }).lines;
  assert.deepEqual(all(orphan), ['you ▸ the text'], 'its start was cut off the tail: the text is all there is');
});

test('a running block has no end line; agent lines while it runs come after the whole block', () => {
  const { lines } = buildConversation([shStart('sh-1', 'sleep 30'), shOut('sh-1', 'a\n'), say('still here'), shOut('sh-1', 'b')], { taskId: 'T05' });
  assert.deepEqual(all(lines), ['you ! sleep 30', '  a', '  b', 'T05 ▸ still here']);
});

test('an empty-output block shows only its head and end', () => {
  const { lines } = buildConversation([shStart('sh-1', 'true'), shEnd('sh-1', { ms: 400 })], { taskId: 'T05' });
  assert.deepEqual(all(lines), ['you ! true', '  ✓ exit 0 · 0s · sent to T05']);
});

test('the end line for a failure, a stop, a signal and each sent value', () => {
  const endText = (extra) => all(buildConversation([shStart('s', 'x'), shEnd('s', extra)], { taskId: 'T05' }).lines).at(-1);
  assert.equal(endText({ code: 1, ms: 2000 }), '  ✗ exit 1 · 2s · sent to T05');
  assert.equal(endText({ code: null, signal: 'SIGHUP', stopped: 'person', ms: 72000 }), '  ✗ stopped by you · 1m 12s · sent to T05');
  assert.equal(endText({ code: null, signal: 'SIGKILL', ms: 2000 }), '  ✗ killed by SIGKILL · 2s · sent to T05');
  assert.equal(endText({ sent: 'answer' }), '  ✓ exit 0 · 6s · sent to T05', 'a hand request answered is sent too');
  assert.equal(endText({ sent: 'undelivered' }), '  ✗ not sent: the session has ended');
  assert.equal(endText({ code: null, stopped: 'session-closed', sent: 'none' }), '  ✗ not sent: the session has ended');
  assert.equal(endText({ code: null, stopped: 'pir-restart', sent: 'none', ms: undefined }), '  ✗ cut off by a pir restart');
  assert.equal(endText({ sent: 'none' }), '  ✗ exit 0 · 6s · not sent');
  const bad = buildConversation([shStart('s', 'x'), shEnd('s', { code: 1 })], { taskId: 'T05' }).lines.at(-1);
  assert.equal(styleOf(bad), 'bad');
  assert.equal(all(buildConversation([shStart('s', 'x'), shEnd('s')], { taskId: 'planner' }).lines).at(-1), '  ✓ exit 0 · 6s · sent to planner', 'the session\'s label');
});

test('a clipped block says the rest was not kept', () => {
  const { lines } = buildConversation([shStart('s', 'yes'), shOut('s', 'y\ny\n'), shOut('s', '', { clipped: true }), shEnd('s', { code: null, stopped: 'person' })], { taskId: 'T05' });
  assert.deepEqual(all(lines), ['you ! yes', '  y', '  y', '  · the rest of the output was not kept (over 1 MB)', '  ✗ stopped by you · 6s · sent to T05']);
  assert.equal(styleOf(lines[3]), 'dim');
});

test('grouped, a long block shows its last 12 lines under the count; full detail shows every line', () => {
  const seq = Array.from({ length: 200 }, (_, i) => `${i + 1}\n`).join('');
  const entries = [shStart('s', 'seq 1 200'), shOut('s', seq), shEnd('s')];
  const grouped = all(buildConversation(entries, { taskId: 'T05' }).lines);
  assert.deepEqual(grouped, ['you ! seq 1 200', '  … 188 earlier lines · Tab shows all', ...Array.from({ length: 12 }, (_, i) => `  ${189 + i}`), '  ✓ exit 0 · 6s · sent to T05']);
  const full = all(buildConversation(entries, { taskId: 'T05', full: true }).lines);
  assert.equal(full.length, 202);
  assert.equal(full[1], '  1');
  assert.equal(full[200], '  200');
  const thirteen = all(buildConversation([shStart('s', 'x'), shOut('s', Array.from({ length: 13 }, (_, i) => `l${i}`).join('\n'))], { taskId: 'T05' }).lines);
  assert.equal(thirteen[1], '  … 1 earlier line · Tab shows all');
  const twelve = all(buildConversation([shStart('s', 'x'), shOut('s', Array.from({ length: 12 }, (_, i) => `l${i}`).join('\n'))], { taskId: 'T05' }).lines);
  assert.equal(twelve.length, 13, 'exactly 12 lines need no count');
});

test('a command block ends an open group of steps, and a step after it starts a new one', () => {
  const { lines } = buildConversation([...step('a', 'Read', { file_path: 'x' }), shStart('s', 'ls'), shEnd('s'), ...step('b', 'Read', { file_path: 'y' })], { taskId: 'T05' });
  assert.deepEqual(all(lines), ['  ▸ Read 1 file', 'you ! ls', '  ✓ exit 0 · 6s · sent to T05', '  ▸ Read 1 file']);
});

test('a forwarder refusal is drawn as a note', () => {
  const note = (reason) => ({ t: t++, dir: 'note', kind: 'shell-refused', command: 'ls', reason });
  assert.deepEqual(all(buildConversation([note('busy'), note('no-session')]).lines), [
    '· your command was not run: a command is already running (ls)',
    '· your command was not run: the session has ended (ls)',
  ]);
});

test('shellRunningLine: the status part with its elapsed time, read from the given clock', () => {
  assert.equal(shellRunningLine({ id: 's', command: 'x', t: 1000 }, 5400), '● running your command · 4s · esc stops it');
  assert.equal(shellRunningLine({ id: 's', command: 'x', t: 0 }, 72000), '● running your command · 1m 12s · esc stops it');
  assert.equal(shellRunningLine({ id: 's', command: 'x', t: null }, 5), '● running your command · esc stops it');
  assert.equal(shellRunningLine(null, 5), '');
});

test('shellEndLine is ok only for a clean exit that reached the session', () => {
  assert.deepEqual(shellEndLine({ code: 0, signal: null, stopped: null, ms: 1000, sent: 'message' }, 'agent'), { text: '✓ exit 0 · 1s · sent to agent', ok: true });
  assert.equal(shellEndLine({ code: 0, stopped: 'person', ms: 1000, sent: 'message' }).ok, false);
});

// ---- A command an agent hands the person (bang-commands T07; DESIGN §2.6, §2.8) ----

const HAND_INPUT = { command: 'gcloud auth login --no-launch-browser', reason: 'the deploy check needs your Google login' };
const handReq = (requestId = 'h1', extra = {}) => request(requestId, HAND_TOOL, HAND_INPUT, extra);

test('a hand request has no grant, so no `a`; its keys line is the run/edit/decline one', () => {
  assert.equal(grantFrom({ toolName: HAND_TOOL, input: HAND_INPUT, suggestions: [{ type: 'addRules', behavior: 'allow', rules: [{ toolName: HAND_TOOL }] }] }), null);
  const { pinned } = buildConversation([handReq()], { taskId: 'T05' });
  const lines = all(promptLines(pinned, { width: 80, taskId: 'T05' }));
  assert.equal(lines.at(-1), '  ↵ run · e edit first · n decline · or type a reply to decline with it');
  assert.ok(!lines.some((l) => /don't ask again/.test(l)));
});

test('handReducer: enter runs it as handed, e edits first, n declines, anything else is null', () => {
  const gate = handGateFor({ requestId: 'h1', command: 'printf handed', reason: 'why' });
  assert.deepEqual(gate, { kind: 'command', requestId: 'h1', command: 'printf handed', reason: 'why', helper: null });
  assert.deepEqual(handReducer(gate, 'enter'), { send: { kind: 'shell', command: 'printf handed', requestId: 'h1' } });
  assert.deepEqual(handReducer(gate, 'e'), { edit: '! printf handed' });
  assert.deepEqual(handReducer(gate, 'n'), { send: { kind: 'permission', requestId: 'h1', decision: 'deny' } });
  for (const key of ['a', 'y', 'space', 'escape', 'up', '!']) assert.equal(handReducer(gate, key), null, key);
  assert.equal(handReducer(null, 'enter'), null);
});

test('a pending hand request is pinned with its command, why and keys; the !s and the command take the shell style', () => {
  const { lines, pinned } = buildConversation([say('I need you to log in.'), use('h1', HAND_TOOL, HAND_INPUT), handReq()], { taskId: 'T05' });
  assert.equal(pinned.kind, 'command');
  assert.ok(!all(lines).some((l) => l.includes('asks you to run')), 'pinned, not in the scrollback');
  const p = promptLines(pinned, { width: 80, taskId: 'T05' });
  assert.deepEqual(all(p), [
    '! T05 asks you to run a command',
    '  gcloud auth login --no-launch-browser',
    '  why: the deploy check needs your Google login',
    '  ↵ run · e edit first · n decline · or type a reply to decline with it',
  ]);
  assert.deepEqual(p[0].map((s) => s.style), ['shell', 'prompt']);
  assert.equal(styleOf(p[1]), 'shell');
  assert.equal(styleOf(p[2]), 'dim');
  // A narrow screen wraps it, never past the width.
  for (const l of promptLines(pinned, { width: 30, taskId: 'T05' })) assert.ok([...textOf(l)].length <= 30, textOf(l));
});

// T08 drill (the person, 2026-10-01): the hand tool's own step is not drawn by default. Its pin and its
// `! T05 asked you to run:` line already say it in plain words; Tab's full detail still shows the step.
test('the hand tool\'s step is hidden by default and shown in full detail; it leaves a group of steps open', () => {
  const log = [say('I need you to log in.'), ...step('r1', 'Read', { file_path: 'a.mjs' }), use('h1', HAND_TOOL, HAND_INPUT), res('h1', 'ran'), ...step('r2', 'Read', { file_path: 'b.mjs' })];
  const grouped = all(buildConversation(log, { taskId: 'T05' }).lines);
  assert.ok(!grouped.some((l) => l.includes('hand_command')), grouped.join('\n'));
  assert.deepEqual(grouped.filter((l) => /Read|Used/.test(l)).length, 1, `one group of the two reads:\n${grouped.join('\n')}`);
  const pending = all(buildConversation([say('I need you to log in.'), use('h1', HAND_TOOL, HAND_INPUT), handReq()], { taskId: 'T05' }).lines);
  assert.deepEqual(pending, ['T05 ▸ I need you to log in.']);
  const full = all(buildConversation(log, { taskId: 'T05', full: true }).lines);
  assert.ok(full.some((l) => l.includes(`⎿ ${HAND_TOOL}`)), full.join('\n'));
});

test('a helper\'s hand request names the helper; one with no reason has no why line', () => {
  const helperLog = [use('ag', 'Agent', { description: 'Survey the code' }), hStart('a1', 'ag', 'Survey the code'), handReq('h1', { agentId: 'a1', input: { command: 'ls' } })];
  const { pinned } = buildConversation(helperLog, { taskId: 'T05' });
  assert.deepEqual(all(promptLines(pinned, { taskId: 'T05' })), [
    '! helper "Survey the code" asks you to run a command',
    '  ls',
    '  ↵ run · e edit first · n decline · or type a reply to decline with it',
  ]);
});

test('answered: run, the line then its block; declined, `· declined` or `· declined: {text}`', () => {
  const ran = buildConversation([
    handReq('h1'),
    shStart('sh-1', HAND_INPUT.command, { requestId: 'h1' }),
    shOut('sh-1', 'ok\n'),
    shEnd('sh-1', { sent: 'answer' }),
    reply('h1', { behavior: 'allow', updatedInput: { ...HAND_INPUT, pirResult: 'x' } }),
    say('Thanks.'),
  ], { taskId: 'T05' });
  assert.equal(ran.pinned, null);
  assert.deepEqual(all(ran.lines), [
    `! T05 asked you to run: ${HAND_INPUT.command}`,
    `you ! ${HAND_INPUT.command}`,
    '  ok',
    '  ✓ exit 0 · 6s · sent to T05',
    'T05 ▸ Thanks.',
  ]);
  assert.deepEqual(ran.lines[0].map((s) => s.style), ['shell', 'prompt']);

  const declined = buildConversation([handReq('h1'), reply('h1', { behavior: 'deny', message: handDeclineMessage() })], { taskId: 'T05' });
  assert.deepEqual(all(declined.lines), [`! T05 asked you to run: ${HAND_INPUT.command}`, '  · declined']);
  assert.equal(styleOf(declined.lines[1]), 'bad');
  const said = buildConversation([handReq('h1'), reply('h1', { behavior: 'deny', message: handDeclineMessage('not now') })], { taskId: 'T05' });
  assert.deepEqual(all(said.lines), [`! T05 asked you to run: ${HAND_INPUT.command}`, '  · declined: not now']);
});

test('a hand request the person\'s run is answering is not pinned while it runs; it is again if still pending after', () => {
  const running = buildConversation([handReq('h1'), shStart('sh-1', 'printf edited', { requestId: 'h1', edited: true }), shOut('sh-1', 'edited')], { taskId: 'T05' });
  assert.equal(running.pinned, null);
  assert.deepEqual(all(running.lines), [`! T05 asked you to run: ${HAND_INPUT.command}`, 'you ! printf edited', '  edited']);
  // A permission behind it is pinned meanwhile.
  const behind = buildConversation([handReq('h1'), shStart('sh-1', 'x', { requestId: 'h1' }), request('p2')], { taskId: 'T05' });
  assert.equal(behind.pinned?.requestId, 'p2');
  // Ended with the request still pending (its answer did not land): it is pinned again.
  const after = buildConversation([handReq('h1'), shStart('sh-1', 'x', { requestId: 'h1' }), shEnd('sh-1', { sent: 'answer' })], { taskId: 'T05' });
  assert.equal(after.pinned?.kind, 'command');
});

test('a hand request read-only and never answered, and one waiting behind another', () => {
  const ro = buildConversation([handReq('h1')], { taskId: 'T05', readOnly: true });
  assert.deepEqual(all(ro.lines), [`! T05 asked you to run: ${HAND_INPUT.command}`, '  → never answered']);
  const two = buildConversation([request('p1'), handReq('h1')], { taskId: 'T05' });
  assert.equal(two.pinned.requestId, 'p1');
  assert.deepEqual(all(two.lines), [`! T05 asked you to run: ${HAND_INPUT.command}`, '  → waiting: answer the request above first']);
});
