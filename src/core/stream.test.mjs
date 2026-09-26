import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  readEntry, workerActivity, userMessage, allowResult, denyResult, answersResult, declineQuestionsResult,
  DEFAULT_REFUSAL,
} from './stream.mjs';

// The committed recording: one real SDK-driven conversation (T01 probe, Claude Code 2.1.282, SDK
// 0.3.282, haiku, default mode). Turns: a Bash allow, a two-question set, a Bash refusal, an
// interrupted list, a background job whose notification opened a sixth turn by itself.
const SAMPLE_PATH = new URL('./fixtures/stream-sample.ndjson', import.meta.url);
const sampleLines = readFileSync(SAMPLE_PATH, 'utf8').split('\n').filter(Boolean);
const sample = sampleLines.map((l) => JSON.parse(l));
const events = sample.flatMap((e) => readEntry(e));
const kinds = (evs) => evs.map((e) => e.kind);

// Small builders for synthetic entries.
let clock = 1000;
const at = (e) => ({ t: clock++, ...e });
const inMsg = (event) => at({ dir: 'in', event });
const sent = (text = 'go') => at({ dir: 'out', from: 'pir', kind: 'message', text });
const result = (subtype = 'success') => inMsg({ type: 'result', subtype, result: '', is_error: subtype !== 'success' });
const init = () => inMsg({ type: 'system', subtype: 'init', session_id: 's', slash_commands: ['a'], tools: [], permissionMode: 'auto' });
const request = (requestId, toolName = 'Bash', input = { command: 'ls' }) => at({ dir: 'request', requestId, toolName, input, suggestions: [] });
const reply = (requestId, behavior = 'allow') => at({ dir: 'out', from: 'person', kind: 'reply', requestId, result: { behavior } });
const interrupt = () => at({ dir: 'out', from: 'person', kind: 'interrupt' });

// ---- readEntry over the real recording ----

test('the sample holds every entry kind: in, request, out message/reply/interrupt, note', () => {
  const dirs = new Set(sample.map((e) => (e.dir === 'out' ? `out:${e.kind}` : e.dir)));
  for (const d of ['in', 'request', 'out:message', 'out:reply', 'out:interrupt', 'note']) assert.ok(dirs.has(d), d);
});

test('every kind in the fixture reads to the right event, and nothing in it reads as raw', () => {
  const seen = new Set(kinds(events));
  for (const k of ['init', 'text', 'tool-use', 'tool-result', 'permission', 'questions', 'reply', 'sent', 'interrupt', 'result', 'system', 'note']) {
    assert.ok(seen.has(k), `missing ${k}`);
  }
  assert.ok(!seen.has('raw'));
});

test('init reads the session, slash commands, terminal-only commands, tools and mode', () => {
  const ev = events.find((e) => e.kind === 'init');
  assert.equal(ev.sessionId, '463a6175-7971-445d-a34b-168cba131070');
  assert.ok(ev.slashCommands.length > 0);
  assert.deepEqual(ev.terminalSlashCommands, ['doctor', 'color', 'focus', 'reload-plugins']);
  assert.ok(ev.tools.includes('Bash') && ev.tools.includes('AskUserQuestion'));
  assert.equal(ev.permissionMode, 'default');
});

test('tool use, tool result, text and result read from the sample with their fields', () => {
  const use = events.find((e) => e.kind === 'tool-use');
  assert.equal(use.name, 'Bash');
  assert.equal(use.input.command, 'echo probe-one > probe.txt');
  const res = events.find((e) => e.kind === 'tool-result' && e.toolUseId === use.toolUseId);
  assert.equal(res.text, '(Bash completed with no output)');
  assert.equal(res.isError, false);
  const refused = events.find((e) => e.kind === 'tool-result' && e.text === DEFAULT_REFUSAL);
  assert.equal(refused.isError, true);
  assert.ok(events.some((e) => e.kind === 'text' && e.role === 'assistant' && e.text === 'done'));
  assert.ok(events.some((e) => e.kind === 'text' && e.role === 'user' && e.text === '[Request interrupted by user]'));
  const results = events.filter((e) => e.kind === 'result');
  assert.deepEqual(results.map((r) => r.subtype), ['success', 'success', 'success', 'error_during_execution', 'success', 'success']);
  assert.equal(results[0].text, 'done');
  assert.equal(results[3].isError, true);
});

test('the sample\'s requests read as two permissions and one question set', () => {
  const perms = events.filter((e) => e.kind === 'permission');
  assert.deepEqual(perms.map((p) => p.input.command), ['echo probe-one > probe.txt', 'rm probe.txt']);
  assert.equal(perms[0].description, 'Write probe-one to probe.txt');
  assert.equal(perms[0].reason, ''); // default mode sends no decisionReason (T00)
  assert.equal(perms[0].suggestions[0].type, 'addRules');
  assert.equal(perms[0].defaultToNo, false);
  assert.equal(perms[0].suppressAlwaysAllowRule, false);
  const qs = events.find((e) => e.kind === 'questions');
  assert.deepEqual(qs.questions.map((q) => [q.question, q.header, q.multiSelect, q.options.map((o) => o.label)]), [
    ['Which colour?', 'Colour', false, ['red', 'blue']],
    ['Which fruits?', 'Fruits', true, ['apple', 'pear', 'plum']],
  ]);
  assert.equal(qs.questions[1].options[2].description, 'A small stone fruit');
});

test('out entries read as sent, reply and interrupt, with the sender', () => {
  assert.deepEqual(readEntry(sent('hi')), [{ kind: 'sent', from: 'pir', text: 'hi' }]);
  assert.deepEqual(readEntry(reply('r1', 'deny')), [{ kind: 'reply', requestId: 'r1', behavior: 'deny', from: 'person' }]);
  assert.deepEqual(readEntry(interrupt()), [{ kind: 'interrupt', from: 'person' }]);
});

test('a note keeps its kind and fields', () => {
  assert.deepEqual(readEntry({ t: 1, dir: 'note', kind: 'exited', code: 0 }), [{ kind: 'note', note: 'exited', code: 0 }]);
});

test('an unknown message type becomes system, not an error; so does an unknown system subtype', () => {
  const [ev] = readEntry(inMsg({ type: 'brand_new_thing', x: 1 }));
  assert.equal(ev.kind, 'system');
  assert.equal(ev.subtype, 'brand_new_thing');
  const rl = events.find((e) => e.kind === 'system' && e.subtype === 'rate_limit_event');
  assert.ok(rl, 'rate_limit_event reads as system');
  assert.equal(readEntry(inMsg({ type: 'system', subtype: 'task_notification' }))[0].subtype, 'task_notification');
});

// ---- raw ----

test('a non-object entry, an entry missing dir, and a truncated last log line all become raw', () => {
  for (const bad of [null, 42, 'x', [], { t: 1 }, { t: 1, dir: 7 }, { t: 1, dir: 'sideways' }]) {
    const evs = readEntry(bad);
    assert.equal(evs.length, 1);
    assert.equal(evs[0].kind, 'raw');
  }
  const truncated = sampleLines.at(-2).slice(0, 40);
  assert.deepEqual(readEntry(truncated), [{ kind: 'raw', raw: truncated }]);
  // A whole line given as a string reads like its parsed entry.
  assert.deepEqual(readEntry(sampleLines[0]), readEntry(sample[0]));
});

test('malformed inner shapes become raw, never a throw', () => {
  for (const bad of [
    { dir: 'in' }, { dir: 'in', event: 'x' }, { dir: 'in', event: {} },
    { dir: 'request', toolName: 'Bash' }, { dir: 'out', kind: 'reply' }, { dir: 'out', kind: 'wave' }, { dir: 'note' },
  ]) {
    assert.equal(readEntry(bad)[0].kind, 'raw', JSON.stringify(bad));
  }
  assert.deepEqual(readEntry({ dir: 'in', event: { type: 'assistant' } }), []);
  assert.deepEqual(readEntry({ dir: 'in', event: { type: 'assistant', message: { content: [null, 3] } } }), []);
});

test('an assistant message carrying several content blocks yields each block in order', () => {
  const evs = readEntry(inMsg({ type: 'assistant', message: { content: [
    { type: 'thinking', thinking: '' },
    { type: 'text', text: 'Running it.' },
    { type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ls' } },
    { type: 'text', text: 'Then this.' },
  ] } }));
  assert.deepEqual(evs, [
    { kind: 'text', role: 'assistant', text: 'Running it.' },
    { kind: 'tool-use', toolUseId: 'tu1', name: 'Bash', input: { command: 'ls' } },
    { kind: 'text', role: 'assistant', text: 'Then this.' },
  ]);
});

test('a tool result given as content blocks joins their text', () => {
  const [ev] = readEntry(inMsg({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: [{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }] }] } }));
  assert.deepEqual(ev, { kind: 'tool-result', toolUseId: 'x', text: 'a\nb', isError: false });
});

test('an AskUserQuestion request becomes questions, any other tool becomes permission', () => {
  assert.equal(readEntry(request('r1', 'AskUserQuestion', { questions: [] }))[0].kind, 'questions');
  for (const tool of ['Bash', 'Edit', 'Write', 'mcp__x__y']) assert.equal(readEntry(request('r1', tool))[0].kind, 'permission');
  const flagged = readEntry(at({ dir: 'request', requestId: 'r', toolName: 'Bash', input: {}, defaultToNo: true, suppressAlwaysAllowRule: true, reason: 'This command requires approval' }))[0];
  assert.equal(flagged.defaultToNo, true);
  assert.equal(flagged.suppressAlwaysAllowRule, true);
  assert.equal(flagged.reason, 'This command requires approval');
});

// ---- result builders, against the shapes the probe sent and Claude accepted ----

const permReq = sample.find((e) => e.dir === 'request' && e.toolName === 'Bash');
const askReq = sample.find((e) => e.dir === 'request' && e.toolName === 'AskUserQuestion');
const repliedWith = (requestId) => sample.find((e) => e.dir === 'out' && e.kind === 'reply' && e.requestId === requestId).result;

test('allowResult keeps updatedInput = the request input and carries no updatedPermissions', () => {
  const r = allowResult(permReq);
  assert.deepEqual(r, { behavior: 'allow', updatedInput: permReq.input });
  assert.deepEqual(r, repliedWith(permReq.requestId));
  assert.ok(!('updatedPermissions' in r));
  // Works on a read permission event too.
  assert.deepEqual(allowResult(readEntry(permReq)[0]), r);
});

test('denyResult carries the message, defaulting to the refusal wording', () => {
  const rmReq = sample.filter((e) => e.dir === 'request' && e.toolName === 'Bash')[1];
  assert.deepEqual(denyResult(rmReq), repliedWith(rmReq.requestId));
  assert.deepEqual(denyResult(rmReq), { behavior: 'deny', message: 'The person refused.' });
  assert.deepEqual(denyResult(rmReq, 'Not that file.'), { behavior: 'deny', message: 'Not that file.' });
  assert.deepEqual(denyResult(rmReq, '   '), { behavior: 'deny', message: 'The person refused.' });
});

test('answersResult keeps the request input and adds answers; multi-select labels joined ", "', () => {
  const r = answersResult(askReq, { 'Which colour?': 'blue', 'Which fruits?': ['apple', 'pear'] });
  assert.deepEqual(r, repliedWith(askReq.requestId));
  assert.deepEqual(r.updatedInput.questions, askReq.input.questions);
  assert.deepEqual(r.updatedInput.answers, { 'Which colour?': 'blue', 'Which fruits?': 'apple, pear' });
  // Already-joined strings pass through.
  assert.deepEqual(answersResult(askReq, { 'Which fruits?': 'apple, pear' }).updatedInput.answers, { 'Which fruits?': 'apple, pear' });
  assert.ok(!('answers' in askReq.input), 'the request is not mutated');
});

test('declineQuestionsResult refuses with the typed text', () => {
  assert.deepEqual(declineQuestionsResult(askReq, 'Let us talk first.'), { behavior: 'deny', message: 'Let us talk first.' });
});

test('userMessage builds the SDK user message pushed into the input queue', () => {
  assert.deepEqual(userMessage('hello', 'sid'), { type: 'user', message: { role: 'user', content: 'hello' }, parent_tool_use_id: null, session_id: 'sid' });
});

// ---- workerActivity ----

test('activity over the committed sample ends idle with six turns and the last t', () => {
  const a = workerActivity(sample);
  assert.equal(a.state, 'idle');
  assert.equal(a.turns, 6);
  assert.deepEqual(a.pending, []);
  assert.equal(a.lastEventAt, sample.at(-1).t);
  assert.ok(a.slashCommands.length > 0);
});

test('activity at each point of the sample: busy mid-turn, permission, questions, idle between turns', () => {
  const stateAt = (pred) => workerActivity(sample.slice(0, sample.findIndex(pred) + 1)).state;
  assert.equal(stateAt((e) => e.dir === 'out' && e.kind === 'message'), 'busy');
  assert.equal(stateAt((e) => e.dir === 'request' && e.toolName === 'Bash'), 'permission');
  assert.equal(stateAt((e) => e.dir === 'request' && e.toolName === 'AskUserQuestion'), 'questions');
  assert.equal(stateAt((e) => e.dir === 'out' && e.kind === 'reply'), 'busy');
  assert.equal(stateAt((e) => e.event?.type === 'result'), 'idle');
  assert.equal(stateAt((e) => e.dir === 'out' && e.kind === 'interrupt'), 'busy');
});

test('activity: nothing yet → starting; message out → busy; result → idle', () => {
  assert.equal(workerActivity([]).state, 'starting');
  assert.equal(workerActivity([]).lastEventAt, null);
  const log = [sent()];
  assert.equal(workerActivity(log).state, 'busy');
  log.push(init(), result());
  const a = workerActivity(log);
  assert.equal(a.state, 'idle');
  assert.equal(a.turns, 1);
  assert.deepEqual(a.slashCommands, ['a']);
});

test('activity: request → permission or questions; its reply → back to busy', () => {
  const log = [sent(), init(), request('r1')];
  assert.equal(workerActivity(log).state, 'permission');
  assert.equal(workerActivity(log).pending[0].requestId, 'r1');
  log.push(reply('r1'));
  assert.equal(workerActivity(log).state, 'busy');
  log.push(request('q1', 'AskUserQuestion', { questions: [] }));
  assert.equal(workerActivity(log).state, 'questions');
  log.push(reply('q1'));
  assert.equal(workerActivity(log).state, 'busy');
});

test('two pending requests at once: the oldest decides the state; a reply to an unknown id changes nothing', () => {
  const log = [sent(), request('q1', 'AskUserQuestion', { questions: [] }), request('r2')];
  let a = workerActivity(log);
  assert.equal(a.state, 'questions');
  assert.deepEqual(a.pending.map((p) => p.requestId), ['q1', 'r2']);
  log.push(reply('nope'));
  const b = workerActivity(log);
  assert.equal(b.state, 'questions');
  assert.deepEqual(b.pending.map((p) => p.requestId), ['q1', 'r2']);
  log.push(reply('q1'));
  a = workerActivity(log);
  assert.equal(a.state, 'permission');
  assert.deepEqual(a.pending.map((p) => p.requestId), ['r2']);
});

test('a request allowed from pir\'s grant list is answered by its delivered-by-grant note', () => {
  const log = [sent(), request('r1'), at({ dir: 'note', kind: 'delivered-by-grant', requestId: 'r1' })];
  assert.equal(workerActivity(log).state, 'busy');
});

test('interrupt while busy → next result (error_during_execution) → idle', () => {
  const log = [sent(), init(), interrupt()];
  assert.equal(workerActivity(log).state, 'busy');
  log.push(result('error_during_execution'));
  assert.equal(workerActivity(log).state, 'idle');
  assert.equal(workerActivity(log).turns, 1);
});

test('an interrupt while a request is pending cancels it: the turn\'s result leaves the worker idle (T01 review probe)', () => {
  // Measured: interrupt() while canUseTool was pending aborted its signal; Claude logged the tool as
  // rejected and ended the turn with error_during_execution. No reply is ever written for the request.
  const log = [sent(), init(), request('r1'), interrupt()];
  assert.equal(workerActivity(log).state, 'permission', 'still shown until the turn ends');
  log.push(inMsg({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'rejected', is_error: true }] } }));
  log.push(result('error_during_execution'));
  const a = workerActivity(log);
  assert.equal(a.state, 'idle');
  assert.deepEqual(a.pending, []);
  // A request raised after the interrupt is not cancelled by it.
  const later = [sent(), request('r1'), interrupt(), request('r2'), result('error_during_execution')];
  assert.deepEqual(workerActivity(later).pending.map((p) => p.requestId), ['r2']);
});

test('a background task notification after a result: the turn it opens is busy with no message sent (T01 probe)', () => {
  // Measured: result, then background_tasks_changed, task_updated, task_notification, then a new
  // init, assistant text and result, all without pir sending anything.
  const log = [sent(), init(), result()];
  log.push(inMsg({ type: 'system', subtype: 'task_notification', status: 'completed' }));
  assert.equal(workerActivity(log).state, 'idle', 'the notification alone does not open a turn');
  log.push(init());
  assert.equal(workerActivity(log).state, 'busy');
  log.push(inMsg({ type: 'assistant', message: { content: [{ type: 'text', text: 'It finished.' }] } }), result());
  assert.equal(workerActivity(log).state, 'idle');
  assert.equal(workerActivity(log).turns, 2);
  // The recorded sample has exactly this shape at its end.
  const last = sample.map((e) => e.event?.subtype ?? e.event?.type ?? e.dir).slice(-12);
  assert.ok(last.includes('task_notification'));
});

test('a request after the turn ended (a background job asking) still shows as waiting', () => {
  const log = [sent(), result(), request('r1')];
  assert.equal(workerActivity(log).state, 'permission');
});

test('raw entries and entries without t are skipped by activity, never thrown on', () => {
  const log = [sent(), 'not json{', null, { dir: 'in', event: { type: 'result', subtype: 'success' } }];
  const a = workerActivity(log);
  assert.equal(a.state, 'idle');
  assert.equal(a.lastEventAt, log[0].t);
});

test('stream.mjs imports nothing: no fs, child_process, clock or package', () => {
  const source = readFileSync(new URL('./stream.mjs', import.meta.url), 'utf8');
  assert.ok(!/^\s*import\s/m.test(source), 'stream.mjs has an import');
  assert.ok(!/\brequire\(|\bimport\(/.test(source));
  assert.ok(!/Date\.now|new Date\(\s*\)|performance\.now|Math\.random/.test(source));
});

test('user text Claude marks isSynthetic reads as synthetic; other user text does not (T18)', () => {
  const [synthetic] = readEntry({ t: 1, dir: 'in', event: { type: 'user', isSynthetic: true, message: { content: [{ type: 'text', text: 'skill body' }] } } });
  assert.deepEqual(synthetic, { kind: 'text', role: 'user', text: 'skill body', synthetic: true });
  const [plain] = readEntry({ t: 1, dir: 'in', event: { type: 'user', message: { content: [{ type: 'text', text: '[Request interrupted by user]' }] } } });
  assert.equal(plain.synthetic, undefined);
});
