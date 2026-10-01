// bang-commands T04 — the pure rules for a command an agent hands the person (DESIGN §2.6, §2.7): a pending
// `mcp__pir__hand_command` request reads as its own asking kind, `command`, through every core reader, and
// nothing lets the coordinator agent answer it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readEntry, workerActivity } from './stream.mjs';
import { HAND_TOOL, HAND_FALLBACK, handDeclineMessage } from './bang.mjs';
import { waitingOn, waitingFor, waitingItems, itemKey, holderOf } from './asking.mjs';
import { reservedFor, checkDecision, readDecision, describeItem } from './coordinator-policy.mjs';
import { briefFor } from './coordinator-brief.mjs';
import { buildDisplay } from './display.mjs';
import { buildPlanDisplay, buildSingleDisplay } from './plandisplay.mjs';
import { alertText } from './notify.mjs';

const NOW = 100_000;
let clock = 1000;
const at = (e) => ({ t: clock++, ...e });
const handReq = (requestId = 'h1', input = { command: 'gcloud auth login --no-launch-browser', reason: 'the deploy check needs your Google login' }, extra = {}) =>
  at({ dir: 'request', requestId, toolName: HAND_TOOL, input, suggestions: [], ...extra });
const sent = () => at({ dir: 'out', from: 'pir', kind: 'message', text: 'go' });
const reply = (requestId, behavior = 'allow') => at({ dir: 'out', from: 'person', kind: 'reply', requestId, result: { behavior } });

test('HAND_TOOL is the in-process server\'s full tool name, and the fixed texts read as DESIGN §2.6 words them', () => {
  assert.equal(HAND_TOOL, 'mcp__pir__hand_command');
  assert.equal(HAND_FALLBACK, 'The person allowed this from outside pir, so pir did not run it. Ask them in words whether they ran it and what it printed.');
  assert.equal(handDeclineMessage(), 'The person declined to run it.');
  assert.equal(handDeclineMessage('   '), 'The person declined to run it.');
  assert.equal(handDeclineMessage(' not now, use staging '), 'The person declined to run it. They said: not now, use staging');
});

test('readRequest: a hand request reads as kind command with its command, reason, ids and helper', () => {
  const [ev] = readEntry(handReq('h1', { command: 'gcloud auth login', reason: 'login' }, { toolUseId: 'toolu_9', agentId: 'a-1' }));
  assert.deepEqual(ev, {
    kind: 'command', requestId: 'h1', toolUseId: 'toolu_9', toolName: HAND_TOOL,
    input: { command: 'gcloud auth login', reason: 'login' }, command: 'gcloud auth login', reason: 'login', agentId: 'a-1',
  });
  const [bare] = readEntry(handReq('h2', { command: 'ls' }));
  assert.equal(bare.kind, 'command');
  assert.equal(bare.reason, '', 'a missing reason reads as empty, never undefined');
  assert.equal('toolUseId' in bare, false);
});

test('readRequest: a malformed hand request (no command, blank, not a string) reads as a plain permission', () => {
  for (const input of [{ reason: 'x' }, { command: '   ', reason: 'x' }, { command: 42 }, null]) {
    const [ev] = readEntry(handReq('m', input));
    assert.equal(ev.kind, 'permission', JSON.stringify(input));
    assert.equal(ev.toolName, HAND_TOOL);
  }
});

test('workerActivity: a pending hand request is pending, outranks busy, and clears on its reply', () => {
  const asking = workerActivity([sent(), handReq('h1')]);
  assert.equal(asking.state, 'command');
  assert.equal(asking.open, true);
  assert.deepEqual(asking.pending.map((p) => [p.kind, p.requestId]), [['command', 'h1']]);
  const answered = workerActivity([sent(), handReq('h1'), reply('h1')]);
  assert.equal(answered.state, 'busy');
  assert.deepEqual(answered.pending, []);
});

test('waitingOn → command; waitingFor holds it for the person even with the agent up and holding its key', () => {
  const activity = workerActivity([sent(), handReq('h1')]);
  const task = { phase: 'implementing', workerId: 'w1' };
  assert.equal(waitingOn(task, activity), 'command');
  assert.deepEqual(waitingFor(task, activity, { heldByAgent: new Set() }), { kind: 'command', holder: 'person' });
  // Even a shell that wrongly holds it cannot hand it to the agent.
  assert.deepEqual(waitingFor(task, activity, { heldByAgent: new Set(['w1:h1']) }), { kind: 'command', holder: 'person' });
});

test('waitingItems marks a hand request reserved (with no ask rules), and a malformed one too', () => {
  const activity = workerActivity([sent(), handReq('h1'), handReq('m1', { reason: 'no command' })]);
  const items = waitingItems({ T05: { workerId: 'w1', phase: 'implementing' } }, [{ id: 'w1', task: 'T05', live: true, activity }]);
  assert.deepEqual(items.map((i) => [i.kind, i.requestId, i.reserved?.kind]), [['command', 'h1', 'hand'], ['permission', 'm1', 'hand']]);
  assert.equal(holderOf(items, new Set(items.map(itemKey))), 'person');
  // An ordinary permission the agent holds still reads as held: the change is for reserved items only.
  const plain = [{ worker: 'w1', requestId: 'p1', kind: 'permission' }];
  assert.equal(holderOf(plain, new Set(['w1:p1'])), 'coordinator');
});

test('reservedFor reserves every hand request, by tool name alone', () => {
  const r = reservedFor({ toolName: HAND_TOOL, input: { command: 'ls' } });
  assert.equal(r.kind, 'hand');
  assert.match(r.why, /person/);
  assert.equal(reservedFor({ toolName: HAND_TOOL, input: {} }).kind, 'hand');
  assert.equal(reservedFor({ kind: 'command', toolName: HAND_TOOL, command: 'ls', input: { command: 'ls' } }).kind, 'hand');
  assert.equal(reservedFor({ toolName: 'Bash', input: { command: 'ls' } }), null, 'other tools are unchanged');
});

test('checkDecision: an allow or a deny of a hand request is never applied; it is passed on with the note', () => {
  const activity = workerActivity([sent(), handReq('h1')]);
  const waiting = waitingItems({ T05: { workerId: 'w1', phase: 'implementing' } }, [{ id: 'w1', task: 'T05', live: true, activity }]);
  for (const decision of ['allow', 'deny']) {
    const { decision: d } = readDecision({ kind: 'permission', worker: 'w1', requestId: 'h1', decision, reason: 'looks fine' });
    const out = checkDecision(d, waiting);
    assert.equal(out.ok, false, decision);
    assert.equal(out.passOn, true, decision);
    assert.match(out.why, /person's/);
  }
  // Even an item the shell forgot to mark reserved.
  const bare = waiting.map(({ reserved, ...i }) => i);
  const { decision: allow } = readDecision({ kind: 'permission', worker: 'w1', requestId: 'h1', decision: 'allow', reason: 'x' });
  assert.equal(checkDecision(allow, bare).ok, false);
  const { decision: answers } = readDecision({ kind: 'answers', worker: 'w1', requestId: 'h1', answers: { q: 'a' }, reason: 'x' });
  const a = checkDecision(answers, waiting);
  assert.equal(a.ok, false);
  assert.equal(a.passOn, false);
  // A pass is the agent's only move, and it is applied as a pass.
  const { decision: pass } = readDecision({ kind: 'pass', worker: 'w1', requestId: 'h1', reason: 'they hold the login', suggestion: 'run it' });
  const p = checkDecision(pass, waiting);
  assert.equal(p.ok, true);
  assert.equal(p.apply.kind, 'pass');
  assert.equal(p.apply.ledger.item, 'a command for the person to run: gcloud auth login --no-launch-browser');
  assert.equal(describeItem(waiting[0]), 'a command for the person to run: gcloud auth login --no-launch-browser');
});

test('briefFor: a hand request is briefed as the person\'s, with its command and reason, for a note only', () => {
  const [request] = workerActivity([sent(), handReq('h1')]).pending;
  for (const item of [
    { worker: 'w1', task: 'T05', kind: 'command', requestId: 'h1', request, reserved: reservedFor(request) },
    { worker: 'w1', task: 'T05', kind: 'command', requestId: 'h1', request }, // no `reserved`: still the person's
  ]) {
    const text = briefFor(item);
    assert.match(text, /handed the person a command to run/);
    assert.match(text, /^requestId: `h1`$/m);
    assert.match(text, /Command: gcloud auth login --no-launch-browser/);
    assert.match(text, /the deploy check needs your Google login/);
    assert.match(text, /This one is the person's \(a command an agent hands the person is only the person's to run\)/);
    assert.match(text, /`pass` decision/);
    assert.match(text, /A `permission` decision for it is refused/);
  }
});

test('a logged hand request reads `asking you · run a command` on a build row, from the log to the row', () => {
  const activity = workerActivity([sent(), handReq('h1')]);
  const task = { id: 'T05', slug: 'hand-tool', deps: [], done: false, phase: 'building', since: NOW - 4000, stoppedAt: NOW - 1000 };
  const w = waitingFor({ phase: 'implementing', workerId: 'w1' }, activity);
  const { rows, summary, footer } = buildDisplay({ branch: 'pir/demo', ceiling: 2, tasks: [{ ...task, asking: w.kind, holder: w.holder }] }, { now: NOW });
  assert.equal(rows[0].kind, 'asking');
  assert.equal(rows[0].label, 'asking you · run a command');
  assert.equal(summary.asking, 1);
  assert.equal(footer.kind, 'asking');
});

test('ASKING_TEXT: a planning and a single step asking for a command read `asking you · run a command`', () => {
  const step = (id) => ({ id, phase: 'asking', since: 40_000, stoppedAt: 70_000, tookMs: null, asking: 'command', worker: { id: 'p', live: true }, workers: [] });
  const pending = (id) => ({ id, phase: 'pending', since: null, stoppedAt: null, tookMs: null, asking: null, worker: null, workers: [] });
  const plan = buildPlanDisplay(
    { kind: 'plan', label: null, slug: null, step: 'plan', outcome: null, steps: [step('plan'), pending('review'), pending('build')] },
    { now: NOW, record: { slug: 'plan-3f2a', label: 'x', branch: 'pir/plan-3f2a', go: null }, state: 'running' },
  );
  const row = plan.rows.find((r) => r.id === 'plan');
  assert.equal(row.kind, 'asking');
  assert.equal(row.text, 'asking you · run a command');
  assert.equal(row.clock, 30_000);
  const single = buildSingleDisplay(
    { kind: 'single', label: null, slug: null, step: 'build', outcome: null, steps: [step('build'), pending('review'), pending('merge')] },
    { now: NOW, record: { slug: 'fix-typo', label: 'x', branch: 'pir/fix-typo', go: null }, state: 'running' },
  );
  assert.equal(single.rows.find((r) => r.id === 'build').text, 'asking you · run a command');
});

test('alertText for a hand request: Needs-your-yes prefix, the command, the open-pir tail, cut to 150', () => {
  const pending = workerActivity([sent(), handReq('h1')]).pending;
  const { title, message } = alertText({ plan: 'demo', task: 'T05', role: 'implement', why: 'reserved', kind: 'command', pending });
  assert.equal(title, 'demo · T05 implement');
  assert.equal(message, 'Needs your yes: asks you to run: gcloud auth login --no-launch-browser (open pir to run it)');

  const long = workerActivity([sent(), handReq('h2', { command: `echo ${'x'.repeat(300)}`, reason: 'r' })]).pending;
  const cut = alertText({ plan: 'demo', task: 'T05', role: 'implement', why: 'reserved', kind: 'command', pending: long }).message;
  const body = cut.slice('Needs your yes: '.length);
  assert.equal([...body].length, 150);
  assert.ok(body.endsWith('… (open pir to run it)'), body);
  assert.ok(body.startsWith('asks you to run: echo xxx'));

  // Escapes and newlines in the command never reach the phone raw.
  const odd = workerActivity([sent(), handReq('h3', { command: 'printf "\x1b[31mred\x1b[0m"\nls', reason: 'r' })]).pending;
  assert.equal(alertText({ plan: 'p', task: 'T05', role: 'implement', kind: 'command', pending: odd }).message, 'asks you to run: printf "red" ls (open pir to run it)');
  // Nothing to read: the generic fallback.
  assert.equal(alertText({ plan: 'p', task: 'T05', role: 'implement', kind: 'command', pending: [] }).message, 'is waiting for you');
});
