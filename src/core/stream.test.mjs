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

// visible-helpers T05 (DESIGN §2.6): the logged note and its helper ids ride on the `sent` event.
test('a sent message with a preface carries it and helpersStopped; one without has neither', () => {
  const e = at({ dir: 'out', from: 'person', kind: 'message', text: 'continue', preface: '[pir] note', helpersStopped: ['h1'] });
  assert.deepEqual(readEntry(e), [{ kind: 'sent', from: 'person', text: 'continue', preface: '[pir] note', helpersStopped: ['h1'] }]);
  assert.deepEqual(Object.keys(readEntry(sent('hi'))[0]), ['kind', 'from', 'text']);
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

test('a request answered over Remote Control is answered by its answered-remotely note, mid-turn', () => {
  const log = [sent(), init(), request('r1', 'AskUserQuestion')];
  assert.equal(workerActivity(log).state, 'questions');
  log.push(at({ dir: 'note', kind: 'answered-remotely', requestId: 'r1' }));
  const a = workerActivity(log);
  assert.equal(a.state, 'busy');
  assert.equal(a.pending.length, 0);
});

test('`open` says a turn is under way even while a pending request names the state', () => {
  const log = [sent(), init(), request('r1')];
  assert.equal(workerActivity(log).state, 'permission');
  assert.equal(workerActivity(log).open, true);
  log.push(result());
  assert.equal(workerActivity(log).open, false);
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

// A planning session resumed into its own log (pir-plan-command §2.14, T14): what was pending or under
// way died with the old process.
test('workerActivity: a `resumed` note drops what was pending and ends the open turn', () => {
  const ask = { t: 2, dir: 'request', requestId: 'q1', toolName: 'AskUserQuestion', input: { questions: [] } };
  const before = [{ t: 1, dir: 'out', from: 'pir', kind: 'message', text: 'go' }, ask, { t: 3, dir: 'note', kind: 'exited', code: 143 }];
  assert.equal(workerActivity(before).state, 'questions');
  const resumed = [...before, { t: 4, dir: 'note', kind: 'resumed', sessionId: 's' }];
  assert.deepEqual(workerActivity(resumed).pending, []);
  assert.equal(workerActivity(resumed).open, false);
  const spoken = [...resumed, { t: 5, dir: 'out', from: 'pir', kind: 'message', text: 'You were stopped' }];
  assert.equal(workerActivity(spoken).state, 'busy');
  // A request asked after the resume is pending as usual.
  assert.equal(workerActivity([...spoken, { ...ask, t: 6, requestId: 'q2' }]).state, 'questions');
});

// ---- Why each turn opened (real-asking-state DESIGN §2.2, T03) ----

// T00's recording against Claude Code 2.1.283: one case per probe run, keyed by `case`.
const REMOTE_PATH = new URL('./fixtures/remote-answer-sample.ndjson', import.meta.url);
const remote = readFileSync(REMOTE_PATH, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const remoteCase = (name) => remote.filter((e) => e.case === name);
const personSent = (text = 'yes') => at({ dir: 'out', from: 'person', kind: 'message', text });
const notification = () => inMsg({ type: 'system', subtype: 'task_notification', task_id: 'b1', status: 'completed' });
const lifecycle = (state, uuid = 'c1') => inMsg({ type: 'command_lifecycle', command_uuid: uuid, state });

test('recorded: a turn opened by a person send in pir is `person`, pir\'s opening is `pir`', () => {
  const a = workerActivity(remoteCase('1-pir-typed'));
  assert.deepEqual(a.turnCauses, ['pir', 'person']);
  assert.equal(a.personSends, 1);
  assert.equal(a.remoteSends, 0);
});

test('recorded: a turn opened by Remote Control input is `remote`, with or without the replay option', () => {
  for (const name of ['2-remote-typed', '2-remote-typed-replay']) {
    const a = workerActivity(remoteCase(name));
    assert.deepEqual(a.turnCauses, ['pir', 'remote'], name);
    assert.equal(a.remoteSends, 1, `${name}: queued and started of one command count once`);
    assert.equal(a.personSends, 0, name);
  }
});

test('recorded: a background job\'s wake-up turn is `system`, in both recordings', () => {
  assert.deepEqual(workerActivity(remoteCase('5-wakeup-replay')).turnCauses, ['pir', 'system']);
  assert.equal(workerActivity(sample).turnCauses.at(-1), 'system', 'the T01 recording\'s last turn is a wake-up');
});

test('recorded: a picker or permission answered on the phone opens no new turn', () => {
  for (const name of ['3-remote-picker-replay', '4-remote-permission-replay']) {
    const a = workerActivity(remoteCase(name));
    assert.deepEqual(a.turnCauses, ['pir'], name);
    assert.deepEqual(a.pending, [], `${name}: answered-remotely clears the request`);
  }
});

test('a turn the worker opens with nothing announcing it is `unknown`', () => {
  assert.deepEqual(workerActivity([sent(), init(), result(), init()]).turnCauses, ['pir', 'unknown']);
});

test('a person send into an open turn opens no turn but is counted', () => {
  const a = workerActivity([sent(), init(), personSent(), result()]);
  assert.deepEqual(a.turnCauses, ['pir']);
  assert.equal(a.personSends, 1);
});

test('Remote Control input while a turn runs is counted then, and opens the next turn as `remote`', () => {
  const log = [sent(), init(), lifecycle('queued', 'c9')];
  assert.equal(workerActivity(log).remoteSends, 1, 'counted while the turn is still open');
  log.push(result(), lifecycle('started', 'c9'), init(), result(), lifecycle('completed', 'c9'));
  const a = workerActivity(log);
  assert.deepEqual(a.turnCauses, ['pir', 'remote']);
  assert.equal(a.remoteSends, 1);
});

test('a notification inside an open turn does not mark the next turn a wake-up', () => {
  assert.deepEqual(workerActivity([sent(), init(), notification(), result(), init()]).turnCauses, ['pir', 'unknown']);
});

test('a person send after a notification opens the turn as `person`', () => {
  assert.deepEqual(workerActivity([sent(), init(), result(), notification(), personSent(), init()]).turnCauses, ['pir', 'person']);
});

// ---- Background jobs still running (stopped-worker-asking DESIGN §2.2, T01) ----

const listed = (...ids) => inMsg({ type: 'system', subtype: 'background_tasks_changed', tasks: ids.map((task_id) => ({ task_id, task_type: 'local_bash' })) });
const resumedNote = () => at({ dir: 'note', kind: 'resumed' });
const bg = (log) => workerActivity(log).background;

test('readEntry: background_tasks_changed yields the running ids, non-strings dropped', () => {
  const evs = readEntry({ dir: 'in', event: { type: 'system', subtype: 'background_tasks_changed', tasks: [{ task_id: 'a' }, { task_id: 7 }, null, { task_id: 'b' }] } });
  assert.deepEqual(evs, [{ kind: 'background', ids: ['a', 'b'] }]);
  assert.deepEqual(readEntry({ dir: 'in', event: { type: 'system', subtype: 'background_tasks_changed' } }), [{ kind: 'background', ids: [] }]);
});

test('background: [] when the log never lists a job', () => {
  assert.deepEqual(bg([]), []);
  assert.deepEqual(bg([sent(), init(), result()]), []);
});

test('background: a job listed when the turn ends stays listed, state idle', () => {
  const a = workerActivity([sent(), init(), listed('j1'), result()]);
  assert.deepEqual(a.background, ['j1']);
  assert.equal(a.state, 'idle');
});

test('background: a job that ends while idle is held until the wake-up turn opens, then dropped', () => {
  const log = [sent(), init(), listed('j1'), result(), listed()];
  assert.deepEqual(bg(log), ['j1'], 'left the list, no turn yet');
  log.push(notification());
  assert.deepEqual(bg(log), ['j1'], 'the notification alone does not drop it');
  log.push(init());
  let a = workerActivity(log);
  assert.deepEqual(a.background, []);
  assert.equal(a.state, 'busy');
  log.push(result());
  a = workerActivity(log);
  assert.deepEqual(a.background, []);
  assert.equal(a.state, 'idle');
});

test('background: a job that ends inside an open turn is held to that turn\'s result', () => {
  const log = [sent(), init(), listed('j1'), listed()];
  assert.deepEqual(bg(log), ['j1']);
  log.push(inMsg({ type: 'assistant', message: { content: [{ type: 'text', text: 'still working' }] } }));
  assert.deepEqual(bg(log), ['j1'], 'more output in the same turn does not drop it');
  log.push(result());
  assert.deepEqual(bg(log), []);
});

test('background: of two jobs, one ending and its wake-up turn running leaves the other listed', () => {
  const log = [sent(), init(), listed('j1', 'j2'), result(), listed('j2'), notification(), init(), result()];
  const a = workerActivity(log);
  assert.deepEqual(a.background, ['j2']);
  assert.equal(a.state, 'idle');
});

test('background: a job listed again after leaving is not counted twice', () => {
  assert.deepEqual(bg([sent(), init(), listed('j1'), result(), listed(), listed('j1')]), ['j1']);
});

test('background: a resumed note clears it, listed and held alike', () => {
  assert.deepEqual(bg([sent(), init(), listed('j1', 'j2'), result(), listed('j2'), resumedNote()]), []);
});

test('recorded case 5: the timer is held while the worker is idle before its wake-up, [] after', () => {
  const log = remoteCase('5-wakeup-replay');
  const isList = (e) => e.event?.subtype === 'background_tasks_changed';
  const firstList = log.findIndex(isList);
  const shrunk = log.findIndex((e) => isList(e) && e.event.tasks.length === 0);
  const wakeInit = log.findIndex((e, i) => i > shrunk && e.event?.subtype === 'init');
  assert.ok(firstList >= 0 && shrunk > firstList && wakeInit > shrunk, 'the recording holds the sequence');
  const idleBefore = log.findIndex((e, i) => i > firstList && e.event?.type === 'result');
  for (let i = idleBefore; i < wakeInit; i += 1) {
    const a = workerActivity(log.slice(0, i + 1));
    assert.equal(a.state, 'idle', `entry ${i}`);
    assert.deepEqual(a.background, ['bgmiijerv'], `entry ${i}: held while idle before the wake-up`);
  }
  const woke = workerActivity(log.slice(0, wakeInit + 1));
  assert.equal(woke.state, 'busy');
  assert.deepEqual(woke.background, []);
  const end = workerActivity(log);
  assert.equal(end.state, 'idle');
  assert.deepEqual(end.background, []);
});

test('recorded T01 sample: the background job is listed while its turn ends, [] after the wake-up', () => {
  const a = workerActivity(sample);
  assert.equal(a.state, 'idle');
  assert.equal(a.turns, 6);
  assert.deepEqual(a.pending, []);
  assert.deepEqual(a.background, []);
  const lastInit = sample.findLastIndex((e) => e.event?.subtype === 'init');
  const beforeWake = workerActivity(sample.slice(0, lastInit));
  assert.equal(beforeWake.state, 'idle');
  assert.equal(beforeWake.background.length, 1, 'held between the shrunken list and the wake-up init');
});

// pir-coordinator T04: the coordinator agent's answer is a send `from: 'coordinator'`.
const coordinatorSent = (text = 'use Y') => at({ dir: 'out', from: 'coordinator', kind: 'message', text });

test('a coordinator send opens a `coordinator` turn and is counted apart from the person\'s', () => {
  const a = workerActivity([sent(), init(), result(), coordinatorSent(), init()]);
  assert.deepEqual(a.turnCauses, ['pir', 'coordinator']);
  assert.equal(a.coordinatorSends, 1);
  assert.equal(a.personSends, 0);
});

// ---- visible-helpers T01: a helper's frames are tagged and never open a parent turn ----

// Cut from plans/visible-helpers/evidence/plan-0339-helper.ndjson (see helpers.test.mjs).
const helperSample = readFileSync(new URL('./fixtures/helper-sample.ndjson', import.meta.url), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const AGENT_CALL = 'toolu_01DkrWKh5q7BdwWzubBcNeKW';
const HELPER_ID = 'a84a4013ffcebe5e4';
const helperFrame = (content, type = 'assistant') => inMsg({ type, message: { content }, parent_tool_use_id: AGENT_CALL });

test('readEntry: every event from a helper frame carries `helper`; the parent\'s frames carry none', () => {
  const frames = helperSample.filter((e) => e.dir === 'in' && (e.event.type === 'assistant' || e.event.type === 'user'));
  const ofHelper = frames.filter((e) => e.event.parent_tool_use_id);
  const ofParent = frames.filter((e) => !e.event.parent_tool_use_id);
  assert.ok(ofHelper.some((e) => e.event.type === 'assistant') && ofHelper.some((e) => e.event.type === 'user'), 'fixture holds both');
  assert.ok(ofParent.length > 0);
  for (const e of ofHelper) {
    const evs = readEntry(e);
    assert.ok(evs.length > 0 || e.event.message.content.every((b) => b.type === 'thinking'));
    for (const ev of evs) assert.equal(ev.helper, AGENT_CALL);
  }
  for (const e of ofParent) for (const ev of readEntry(e)) assert.equal('helper' in ev, false);
  // A system frame with a null parent_tool_use_id (task_progress) is the parent's reading of the helper.
  for (const ev of readEntry(helperSample.find((e) => e.event?.subtype === 'task_progress'))) assert.equal('helper' in ev, false);
  const [empty] = readEntry({ dir: 'in', event: { type: 'assistant', message: { content: [{ type: 'text', text: 'x' }] }, parent_tool_use_id: '' } });
  assert.equal('helper' in empty, false, 'an empty id is not a helper');
});

test('readEntry: a request entry with agentId yields it; one without has no field', () => {
  const [perm] = readEntry({ dir: 'request', requestId: 'r1', toolName: 'Bash', input: { command: 'ls' }, agentId: HELPER_ID });
  assert.equal(perm.kind, 'permission');
  assert.equal(perm.agentId, HELPER_ID);
  const [q] = readEntry({ dir: 'request', requestId: 'r2', toolName: 'AskUserQuestion', input: { questions: [] }, agentId: HELPER_ID });
  assert.equal(q.kind, 'questions');
  assert.equal(q.agentId, HELPER_ID);
  const [plain] = readEntry({ dir: 'request', requestId: 'r3', toolName: 'Bash', input: {} });
  assert.equal('agentId' in plain, false);
  const [notString] = readEntry({ dir: 'request', requestId: 'r4', toolName: 'Bash', input: {}, agentId: 7 });
  assert.equal('agentId' in notString, false);
});

test('workerActivity: helper frames after the parent\'s result open no turn and add no cause', () => {
  const base = [sent(), init(), result()];
  const log = [...base, helperFrame([{ type: 'text', text: 'found it' }]), helperFrame([{ type: 'tool_use', id: 'tu1', name: 'Read', input: {} }]),
    helperFrame([{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok' }], 'user')];
  const a = workerActivity(log);
  assert.equal(a.open, false);
  assert.equal(a.state, 'idle');
  assert.deepEqual(a.turnCauses, workerActivity(base).turnCauses);
  assert.equal(a.turns, 1);
});

test('workerActivity: helper frames inside a parent turn leave it busy only because the parent opened it', () => {
  const a = workerActivity([sent(), init(), helperFrame([{ type: 'text', text: 'x' }])]);
  assert.equal(a.state, 'busy');
  assert.deepEqual(a.turnCauses, ['pir']);
});

test('workerActivity: a helper\'s pending request still makes the state permission after the parent\'s result', () => {
  const a = workerActivity([sent(), init(), result(), at({ dir: 'request', requestId: 'r1', toolName: 'Bash', input: {}, agentId: HELPER_ID })]);
  assert.equal(a.state, 'permission');
  assert.equal(a.open, false);
});

test('recorded plan-0339: background holds the helper until the interrupt\'s result, then [] and idle', () => {
  const interruptAt = helperSample.findIndex((e) => e.dir === 'out' && e.kind === 'interrupt');
  const resultAt = helperSample.findIndex((e, i) => i > interruptAt && e.event?.type === 'result');
  const before = workerActivity(helperSample.slice(0, interruptAt));
  assert.deepEqual(before.background, [HELPER_ID]);
  assert.equal(before.state, 'questions', 'the parent\'s question is pinned while the helper runs');
  const after = workerActivity(helperSample.slice(0, resultAt + 1));
  assert.deepEqual(after.background, []);
  assert.equal(after.state, 'idle');
  const end = workerActivity(helperSample);
  assert.deepEqual(end.background, []);
  assert.equal(end.state, 'idle');
});
