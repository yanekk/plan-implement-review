// answerer.mjs, the harness's stand-in for the person (live-workers T18). The choice per request is pure
// (answerFor, pendingDrops); createAnswerer is run against a temp control folder with the real inbox
// writer, so the drops it leaves are exactly what the coordinator's forwarder would read.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { answerFor, pendingDrops, createAnswerer, personHeldWorkers } from './answerer.mjs';
import { writeSnapshot } from '../snapshot-store.mjs';
import { validateDrop } from '../../core/person-input.mjs';

const init = (sid) => ({ t: 1, dir: 'in', event: { type: 'system', subtype: 'init', session_id: sid } });
const permission = (id, command = 'touch approved.txt') => ({ t: 2, dir: 'request', requestId: id, toolName: 'Bash', input: { command } });
const questions = (id) => ({
  t: 3,
  dir: 'request',
  requestId: id,
  toolName: 'AskUserQuestion',
  input: {
    questions: [
      { question: 'Which greeting should greeting.txt hold?', header: 'Greeting', multiSelect: false, options: [{ label: 'Hello, world' }, { label: 'Hi there' }] },
    ],
  },
});
const reply = (id) => ({ t: 4, dir: 'out', from: 'person', kind: 'reply', requestId: id, result: { behavior: 'allow' } });

test('answerFor allows a permission once and picks each question\'s first option', () => {
  assert.deepEqual(answerFor({ kind: 'permission', requestId: 'r1' }), { kind: 'permission', requestId: 'r1', decision: 'allow' });
  assert.deepEqual(
    answerFor({ kind: 'questions', requestId: 'q1', questions: [{ question: 'A?', options: [{ label: 'x' }, { label: 'y' }] }, { question: 'B?', options: [{ label: 'z' }] }] }),
    { kind: 'answers', requestId: 'q1', answers: { 'A?': 'x', 'B?': 'z' } },
  );
});

test('answerFor ticks a pick-several question\'s first two options and types what the scenario says', () => {
  const request = {
    kind: 'questions',
    requestId: 'q',
    questions: [
      { question: 'Extras?', multiSelect: true, options: [{ label: 'apples' }, { label: 'pears' }, { label: 'plums' }] },
      { question: 'Name?', options: [{ label: 'Ada' }] },
    ],
  };
  assert.deepEqual(answerFor(request, { 'Name?': 'Typed' }).answers, { 'Extras?': 'apples, pears', 'Name?': 'Typed' });
  assert.deepEqual(answerFor({ kind: 'questions', requestId: 'q', questions: [{ question: 'Free?', options: [] }] }, { 'Free?': 'x' }).answers, { 'Free?': 'x' });
});

test('answerFor types the `*` answer on any question the scenario does not name', () => {
  const request = { kind: 'questions', requestId: 'q', questions: [{ question: 'Worded any way?', options: [{ label: 'x' }] }, { question: 'Named?', options: [] }] };
  assert.deepEqual(answerFor(request, { '*': 'keep hello there', 'Named?': 'own' }).answers, { 'Worded any way?': 'keep hello there', 'Named?': 'own' });
});

test('answerFor gives up on a question with no options, and on anything else', () => {
  assert.equal(answerFor({ kind: 'questions', requestId: 'q', questions: [{ question: 'A?', options: [] }] }), null);
  assert.equal(answerFor({ kind: 'questions', requestId: 'q', questions: [] }), null);
  assert.equal(answerFor({ kind: 'busy' }), null);
  assert.equal(answerFor(null), null);
});

test('pendingDrops answers each pending request, addressed to the log\'s session id, and every drop validates', () => {
  const logs = [
    { file: 'T01-implement-1.ndjson', entries: [init('w1'), questions('q1')] },
    { file: 'T02-implement-1.ndjson', entries: [init('w2'), permission('p1')] },
  ];
  const drops = pendingDrops(logs);
  assert.deepEqual(drops, [
    { to: 'w1', kind: 'answers', requestId: 'q1', answers: { 'Which greeting should greeting.txt hold?': 'Hello, world' }, key: 'q1' },
    { to: 'w2', kind: 'permission', requestId: 'p1', decision: 'allow', key: 'p1' },
  ]);
  for (const d of drops) assert.equal(validateDrop(d).ok, true);
});

test('pendingDrops skips answered, already-dropped, and not-yet-identified requests', () => {
  const logs = [
    { file: 'T01-implement-1.ndjson', entries: [init('w1'), permission('p1'), reply('p1')] }, // replied
    { file: 'T02-implement-1.ndjson', entries: [init('w2'), permission('p2')] }, // dropped already
    { file: 'T03-implement-1.ndjson', entries: [permission('p3')] }, // no session id yet
  ];
  assert.deepEqual(pendingDrops(logs, new Set(['p2'])), []);
});

test('createAnswerer drops one inbox file per pending request, once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pir-answerer-'));
  try {
    const control = join(dir, 'control');
    mkdirSync(join(control, 'conversations'), { recursive: true });
    const write = (file, entries) => writeFileSync(join(control, 'conversations', file), entries.map((e) => JSON.stringify(e) + '\n').join(''));
    write('T01-implement-1.ndjson', [init('w1'), questions('q1')]);
    write('T02-implement-1.ndjson', [init('w2'), permission('p1')]);
    writeFileSync(join(control, 'conversations', 'notes.txt'), 'not a log');

    const lines = [];
    const a = createAnswerer({ controlDir: control, log: (l) => lines.push(l) });
    assert.equal(a.tick().length, 2);
    const inbox = join(control, 'inbox');
    const files = readdirSync(inbox).filter((f) => f.endsWith('.json'));
    assert.equal(files.length, 2);
    const drops = files.map((f) => JSON.parse(readFileSync(join(inbox, f), 'utf8')));
    assert.deepEqual(drops.map((d) => d.requestId).sort(), ['p1', 'q1']);
    // The forwarder has not run, so both are still pending in the logs; nothing is dropped twice.
    assert.deepEqual(a.tick(), []);
    assert.equal(readdirSync(inbox).filter((f) => f.endsWith('.json')).length, 2);
    assert.equal(lines.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createAnswerer retries a request whose drop failed, and a missing conversations folder is nothing to answer', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pir-answerer-'));
  try {
    const control = join(dir, 'control');
    let ok = false;
    const seen = [];
    const a = createAnswerer({ controlDir: control, drop: (d) => (seen.push(d.requestId), { ok, reason: 'nope' }) });
    assert.deepEqual(a.tick(), []);
    mkdirSync(join(control, 'conversations'), { recursive: true });
    writeFileSync(join(control, 'conversations', 'T02-implement-1.ndjson'), [init('w2'), permission('p1')].map((e) => JSON.stringify(e)).join('\n'));
    assert.deepEqual(a.tick(), []);
    ok = true;
    assert.equal(a.tick().length, 1);
    assert.deepEqual(seen, ['p1', 'p1']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pendingDrops says a task\'s message once, to its idle implementer only', () => {
  const result = { t: 5, dir: 'in', event: { type: 'result', subtype: 'success' } };
  const sent = { t: 1, dir: 'out', from: 'pir', kind: 'message', text: 'pir-implement T04' };
  const logs = [
    { file: 'T04-implement-1.ndjson', entries: [sent, init('w4'), result] },
    { file: 'T04-review-1.ndjson', entries: [sent, init('r4'), result] },
    { file: 'T03-implement-1.ndjson', entries: [sent, init('w3'), result] },
  ];
  assert.deepEqual(pendingDrops(logs, new Set(), {}, { T04: 'go' }), [{ to: 'w4', kind: 'message', text: 'go', key: 'say:T04' }]);
  assert.deepEqual(pendingDrops(logs, new Set(['say:T04']), {}, { T04: 'go' }), []);
  const busy = [{ file: 'T04-implement-1.ndjson', entries: [sent, init('w4')] }];
  assert.deepEqual(pendingDrops(busy, new Set(), {}, { T04: 'go' }), [], 'not while its turn is open');
});

test('afterWake answers a parked implementer only after its post-task_notification turn, never before', () => {
  const sent = { t: 1, dir: 'out', from: 'pir', kind: 'message', text: 'pir-implement T02' };
  const result = (t) => ({ t, dir: 'in', event: { type: 'result', subtype: 'success' } });
  const wake = { t: 6, dir: 'in', event: { type: 'system', subtype: 'task_notification', session_id: 'w2' } };
  const wakeInit = { t: 7, dir: 'in', event: { type: 'system', subtype: 'init', session_id: 'w2' } };
  const log = (entries) => [{ file: 'T02-implement-1.ndjson', entries }];
  const drops = (entries, answered = new Set()) => pendingDrops(log(entries), answered, {}, {}, null, { T02: 'blue' });

  // Parked after its asking turn, with no wake-up yet: not answered.
  const asked = [sent, init('w2'), result(5)];
  assert.deepEqual(drops(asked), [], 'not before any wake-up');
  // The wake-up turn is open: still not answered.
  assert.deepEqual(drops([...asked, wake, wakeInit]), [], 'not while the wake-up turn runs');
  // The wake-up turn has ended: answered once, as a plain message.
  const woken = [...asked, wake, wakeInit, result(8)];
  assert.deepEqual(drops(woken), [{ to: 'w2', kind: 'message', text: 'blue', key: 'wake:T02' }]);
  assert.deepEqual(drops(woken, new Set(['wake:T02'])), [], 'only once');
  // A turn opened by a pir send is not a wake-up.
  assert.deepEqual(drops([...asked, { ...sent, t: 6 }, init('w2'), result(8)]), [], 'a pir turn is not a wake-up');
  // Never a reviewer, never a task not named, never an exited worker.
  assert.deepEqual(pendingDrops([{ file: 'T02-review-1.ndjson', entries: woken }], new Set(), {}, {}, null, { T02: 'blue' }), []);
  assert.deepEqual(pendingDrops(log(woken), new Set(), {}, {}, null, { T01: 'x' }), []);
  assert.deepEqual(drops([...woken, { t: 9, dir: 'note', kind: 'exited' }]), []);
});

test('createAnswerer passes afterWake through to its inbox drops', () => {
  const dir = mkdtempSync(join(tmpdir(), 'answerer-wake-'));
  try {
    mkdirSync(join(dir, 'conversations'), { recursive: true });
    const lines = [
      { t: 1, dir: 'out', from: 'pir', kind: 'message', text: 'pir-implement T02' },
      init('w2'),
      { t: 5, dir: 'in', event: { type: 'result', subtype: 'success' } },
      { t: 6, dir: 'in', event: { type: 'system', subtype: 'task_notification', session_id: 'w2' } },
      { t: 7, dir: 'in', event: { type: 'system', subtype: 'init', session_id: 'w2' } },
      { t: 8, dir: 'in', event: { type: 'result', subtype: 'success' } },
    ];
    writeFileSync(join(dir, 'conversations', 'T02-implement-1.ndjson'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    const dropped = [];
    const a = createAnswerer({ controlDir: dir, afterWake: { T02: 'blue' }, drop: (input) => (dropped.push(input), { ok: true }) });
    a.tick();
    a.tick();
    assert.deepEqual(dropped, [{ to: 'w2', kind: 'message', text: 'blue' }]);
    assert.equal(validateDrop({ ...dropped[0] }).ok, true, 'the drop is a valid person message');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- The canned reply to a planning session (pir-plan-command T17) -------------------------------

const opening = { t: 1, dir: 'out', from: 'pir', kind: 'message', text: 'Load the pir-plan skill and run it.' };
const says = (text, t = 6) => ({ t, dir: 'in', event: { type: 'assistant', session_id: 'p1', message: { content: [{ type: 'text', text }] } } });
const ended = (t = 7) => ({ t, dir: 'in', event: { type: 'result', subtype: 'success', session_id: 'p1' } });
const person = (text, t = 8) => ({ t, dir: 'out', from: 'person', kind: 'message', text });
const toolUse = (t = 6) => ({ t, dir: 'in', event: { type: 'assistant', session_id: 'p1', message: { content: [{ type: 'tool_use', id: 'u1', name: 'Bash', input: {} }] } } });
const REPLIES = { text: 'Yes. Go with your recommendation.', cap: 2 };

test('a planning session that ended its turn on its own words gets the reply once for that turn', () => {
  const logs = [{ file: 'plan-1.ndjson', entries: [opening, init('p1'), says('Shall I keep it to one task?'), ended()] }];
  const drops = pendingDrops(logs, new Set(), {}, {}, REPLIES);
  assert.deepEqual(drops, [{ to: 'p1', kind: 'message', text: REPLIES.text, key: 'reply:plan-1.ndjson:1' }]);
  assert.equal(validateDrop(drops[0]).ok, true);
  assert.deepEqual(pendingDrops(logs, new Set(['reply:plan-1.ndjson:1']), {}, {}, REPLIES), [], 'once per turn, however many ticks it stays idle');
  // The next turn, after the reply went and the session spoke again, is due again.
  const next = [{ file: 'plan-1.ndjson', entries: [...logs[0].entries, person(REPLIES.text), says('And the name?', 9), ended(10)] }];
  assert.deepEqual(pendingDrops(next, new Set(['reply:plan-1.ndjson:1']), {}, {}, REPLIES).map((d) => d.key), ['reply:plan-1.ndjson:2']);
  // The reviewer's log is a planning session too.
  const review = [{ file: 'review-1.ndjson', entries: [opening, init('p1'), says('Two decisions for you.'), ended()] }];
  assert.deepEqual(pendingDrops(review, new Set(), {}, {}, REPLIES).map((d) => d.key), ['reply:review-1.ndjson:1']);
});

test('no reply while the session is busy, asking, has exited, or did not speak last — nor to a build worker', () => {
  const none = (entries, file = 'plan-1.ndjson') => assert.deepEqual(pendingDrops([{ file, entries }], new Set(), {}, {}, REPLIES).filter((d) => d.kind === 'message'), []);
  none([opening, init('p1'), says('Working on it.')]); // busy: the turn is still open
  none([opening, init('p1'), says('Which way?'), questions('q1')]); // pending: the question form answers it, not a reply
  none([opening, init('p1'), says('Which way?'), ended(), { t: 9, dir: 'note', kind: 'exited' }]);
  none([opening, init('p1'), says('Which way?'), ended(), person('Small.')]); // the person spoke last
  none([opening, init('p1'), says('Running the tests.'), toolUse(7), ended(8)]); // a tool call after its words
  none([opening, init('p1'), says('Which way?'), ended()], 'T01-implement-1.ndjson');
  assert.deepEqual(pendingDrops([{ file: 'plan-1.ndjson', entries: [opening, init('p1'), says('?'), ended()] }], new Set(), {}, {}, null), [], 'no replies declared');
});

test('replies stop at the cap, counted over the whole run, and the answerer says the cap is spent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pir-answerer-'));
  try {
    const conv = join(dir, 'control', 'conversations');
    mkdirSync(conv, { recursive: true });
    const write = (file, entries) => writeFileSync(join(conv, file), entries.map((e) => JSON.stringify(e)).join('\n'));
    const dropped = [];
    const a = createAnswerer({ controlDir: join(dir, 'control'), replies: REPLIES, drop: (d) => (dropped.push(d), { ok: true }) });
    let entries = [opening, init('p1'), says('One?'), ended()];
    write('plan-1.ndjson', entries);
    assert.equal(a.tick().length, 1);
    entries = [...entries, person(REPLIES.text), says('Two?', 9), ended(10)];
    write('plan-1.ndjson', entries);
    assert.equal(a.tick().length, 1);
    assert.equal(a.capReached(), false, 'nothing is waiting beyond the cap yet');
    entries = [...entries, person(REPLIES.text, 11), says('Three?', 12), ended(13)];
    write('plan-1.ndjson', entries);
    assert.deepEqual(a.tick(), [], 'the third reply is over the cap of two');
    assert.equal(a.capReached(), true);
    assert.equal(dropped.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createAnswerer reads the control folder each tick, and holds replies while told to', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pir-answerer-'));
  try {
    const before = join(dir, 'plans', 'plan-ab12', '.parallel', 'plan');
    const after = join(dir, 'plans', 'slugify', '.parallel', 'plan');
    for (const c of [before, after]) mkdirSync(join(c, 'conversations'), { recursive: true });
    writeFileSync(join(after, 'conversations', 'review-1.ndjson'), [opening, init('r1'), says('Reviewed?'), ended()].map((e) => JSON.stringify(e)).join('\n'));
    let current = before;
    let hold = true;
    const seen = [];
    const a = createAnswerer({ controlDir: () => current, replies: REPLIES, holdReplies: () => hold, drop: (d, root) => (seen.push(root), { ok: true }) });
    assert.deepEqual(a.tick(), [], 'nothing under the old folder');
    current = after;
    assert.deepEqual(a.tick(), [], 'held');
    hold = false;
    assert.equal(a.tick().length, 1);
    assert.deepEqual(seen, [after], 'dropped under the folder the run has now');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- With the coordinator agent on (pir-coordinator T09) -------------------------------------------

test('answerFor types a deny when the scenario says so, and the drop validates', () => {
  const d = answerFor({ kind: 'permission', requestId: 'r1' }, {}, { decision: 'deny' });
  assert.deepEqual(d, { kind: 'permission', requestId: 'r1', decision: 'deny' });
  assert.equal(validateDrop({ to: 'w', ...d }).ok, true);
});

test('pendingDrops denies a named task\'s permission and allows the rest', () => {
  const logs = [
    { file: 'T01-implement-1.ndjson', entries: [init('w1'), permission('p1')] },
    { file: 'T02-implement-1.ndjson', entries: [init('w2'), permission('p2', 'git push origin HEAD')] },
  ];
  const drops = pendingDrops(logs, new Set(), {}, {}, null, {}, { permissions: { T02: 'deny' } });
  assert.deepEqual(drops.map((d) => [d.to, d.decision]), [['w1', 'allow'], ['w2', 'deny']]);
});

test('personHeldWorkers reads the person-held rows, tasks and helpers, from a status snapshot', () => {
  const status = {
    runState: {
      tasks: [
        { id: 'T01', holder: 'coordinator', worker: { id: 'w1' } },
        { id: 'T02', holder: 'person', worker: { id: 'w2' } },
        { id: 'T03', worker: { id: 'w3' } },
      ],
      helpers: [{ id: 'main-sync', holder: 'person', worker: { id: 'w9' } }],
    },
  };
  assert.deepEqual([...personHeldWorkers(status)].sort(), ['w2', 'w9']);
  assert.equal(personHeldWorkers(null).size, 0);
});

test('createAnswerer with personOnly leaves an item the coordinator holds alone, and answers the person\'s', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pir-answerer-'));
  try {
    mkdirSync(join(dir, 'conversations'), { recursive: true });
    const write = (file, entries) => writeFileSync(join(dir, 'conversations', file), entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
    write('T01-implement-1.ndjson', [init('w1'), questions('q1')]);
    write('T02-implement-1.ndjson', [init('w2'), permission('p2', 'git push origin HEAD')]);
    const dropped = [];
    const a = createAnswerer({ controlDir: dir, personOnly: true, permissions: { T02: 'deny' }, drop: (input) => (dropped.push(input), { ok: true }) });

    // No status yet: whose the items are is unknown, so nothing is answered.
    a.tick();
    assert.deepEqual(dropped, []);

    const snap = (tasks) => writeSnapshot(dir, { proc: { pid: 1 }, finalState: null, runState: { tasks } });
    snap([
      { id: 'T01', holder: 'coordinator', worker: { id: 'w1' } },
      { id: 'T02', holder: 'person', worker: { id: 'w2' } },
    ]);
    a.tick();
    assert.deepEqual(dropped, [{ to: 'w2', kind: 'permission', requestId: 'p2', decision: 'deny' }]);

    // Once the agent passes T01's question on, it is the person's and the stand-in answers it.
    snap([
      { id: 'T01', holder: 'person', worker: { id: 'w1' } },
      { id: 'T02', holder: 'person', worker: { id: 'w2' } },
    ]);
    a.tick();
    assert.equal(dropped.length, 2);
    assert.equal(dropped[1].requestId, 'q1');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
