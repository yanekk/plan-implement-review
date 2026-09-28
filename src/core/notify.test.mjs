import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertText, reminderText, excerpt, endAlert, newNotifyState, notifyStep, notifyExit } from './notify.mjs';

const cp = (s) => [...s].length;
const base = { plan: 'screen-time', task: 'T04', role: 'implement' };

// ---- excerpt ----

test('excerpt: exactly 150 code points is kept whole', () => {
  const s = 'a'.repeat(150);
  assert.equal(excerpt(s), s);
});

test('excerpt: 151 code points is cut to 150 ending in …', () => {
  const out = excerpt('a'.repeat(151));
  assert.equal(cp(out), 150);
  assert.equal(out, 'a'.repeat(149) + '…');
});

test('excerpt: newlines fold to single spaces', () => {
  assert.equal(excerpt('first line\n\n  second\r\nthird\n'), 'first line second third');
});

test('excerpt: counts emoji as code points, never splitting a surrogate pair', () => {
  const s = '🙂'.repeat(151);
  const out = excerpt(s);
  assert.equal(cp(out), 150);
  assert.equal(out, '🙂'.repeat(149) + '…');
  assert.equal(excerpt('🙂'.repeat(150)), '🙂'.repeat(150));
});

test('excerpt: empty and missing text give an empty string', () => {
  assert.equal(excerpt(''), '');
  assert.equal(excerpt(undefined), '');
  assert.equal(excerpt('\n\n'), '');
});

test('excerpt: strips terminal escapes', () => {
  assert.equal(excerpt('\x1b[31mred\x1b[0m text'), 'red text');
});

test('excerpt: honours a smaller max', () => {
  assert.equal(excerpt('abcdef', 4), 'abc…');
});

// ---- alertText: kinds ----

test('alertText: title is plan · task role', () => {
  assert.equal(alertText({ ...base, kind: 'question', decisionText: 'x' }).title, 'screen-time · T04 implement');
});

test('alertText: a helper title uses name instead of task and role', () => {
  const t = alertText({ plan: 'screen-time', task: 'T04', role: 'review', name: 'main-sync resolve-main-merge', kind: 'question' });
  assert.equal(t.title, 'screen-time · main-sync resolve-main-merge');
});

test('alertText: report question uses the decision text', () => {
  const t = alertText({ ...base, kind: 'question', decisionText: 'Which colour?', lastText: 'ignored' });
  assert.equal(t.message, 'asks: Which colour?');
});

test('alertText: report-less question falls back to the last assistant text', () => {
  const t = alertText({ ...base, kind: 'question', decisionText: null, lastText: 'Shall I\nproceed?' });
  assert.equal(t.message, 'asks: Shall I proceed?');
});

test('alertText: question with no text says is waiting for you', () => {
  assert.equal(alertText({ ...base, kind: 'question' }).message, 'is waiting for you');
  assert.equal(alertText({ ...base, kind: 'question', decisionText: '  ', lastText: '' }).message, 'is waiting for you');
});

test('alertText: a question whose text is only escapes falls through, never a bare asks:', () => {
  assert.equal(alertText({ ...base, kind: 'question', decisionText: '\x1b[0m', lastText: 'Proceed?' }).message, 'asks: Proceed?');
  assert.equal(alertText({ ...base, kind: 'question', decisionText: '\x1b[0m\n' }).message, 'is waiting for you');
  const pending = [{ kind: 'questions', requestId: 'r1', questions: [{ question: '\x1b[2K' }, { question: 'Size?' }] }];
  assert.equal(alertText({ ...base, kind: 'questions', pending }).message, 'asks: Size? (+1 more)');
});

test('alertText: questions uses the first question, with (+N more)', () => {
  const pending = [{ kind: 'questions', requestId: 'r1', questions: [{ question: 'Colour?' }, { question: 'Size?' }, { question: 'Shape?' }] }];
  assert.equal(alertText({ ...base, kind: 'questions', pending }).message, 'asks: Colour? (+2 more)');
});

test('alertText: a single question has no more-count', () => {
  const pending = [{ kind: 'questions', requestId: 'r1', questions: [{ question: 'Colour?' }] }];
  assert.equal(alertText({ ...base, kind: 'questions', pending }).message, 'asks: Colour?');
});

test('alertText: a long first question is cut but (+N more) survives, within 150', () => {
  const pending = [{ kind: 'questions', requestId: 'r1', questions: [{ question: 'q'.repeat(300) }, { question: 'b' }] }];
  const m = alertText({ ...base, kind: 'questions', pending }).message;
  assert.ok(m.endsWith('… (+1 more)'), m);
  assert.equal(cp(m), 150);
});

test('alertText: questions picks the oldest questions request, skipping a permission', () => {
  const pending = [
    { kind: 'permission', requestId: 'p', toolName: 'Bash', input: { command: 'ls' } },
    { kind: 'questions', requestId: 'r1', questions: [{ question: 'First?' }] },
    { kind: 'questions', requestId: 'r2', questions: [{ question: 'Second?' }] },
  ];
  assert.equal(alertText({ ...base, kind: 'questions', pending }).message, 'asks: First?');
});

test('alertText: permission names the tool and its main argument', () => {
  const pending = [{ kind: 'permission', requestId: 'p', toolName: 'Bash', input: { command: 'git push origin x', description: 'push' } }];
  assert.equal(alertText({ ...base, kind: 'permission', pending }).message, 'wants to run Bash git push origin x');
});

test('alertText: permission for an unlisted tool uses its first string field', () => {
  const pending = [{ kind: 'permission', requestId: 'p', toolName: 'mcp__x__y', input: { n: 1, target: 'prod' } }];
  assert.equal(alertText({ ...base, kind: 'permission', pending }).message, 'wants to run mcp__x__y prod');
});

test('alertText: a multi-line permission command folds to one line', () => {
  const pending = [{ kind: 'permission', requestId: 'p', toolName: 'Bash', input: { command: 'a &&\n  b' } }];
  assert.equal(alertText({ ...base, kind: 'permission', pending }).message, 'wants to run Bash a && b');
});

test('alertText: questions or permission with nothing pending falls back', () => {
  assert.equal(alertText({ ...base, kind: 'questions', pending: [] }).message, 'is waiting for you');
  assert.equal(alertText({ ...base, kind: 'permission' }).message, 'is waiting for you');
});

// ---- alertText: reasons ----

test('alertText: each reason prefixes the message', () => {
  const m = (why) => alertText({ ...base, why, kind: 'question', decisionText: 'Q?' }).message;
  assert.equal(m('passed'), 'Agent passed it on: asks: Q?');
  assert.equal(m('timeout'), "Agent didn't answer in time: asks: Q?");
  assert.equal(m('reserved'), 'Needs your yes: asks: Q?');
  assert.equal(m('unavailable'), 'Agent unavailable: asks: Q?');
  assert.equal(m('off'), 'asks: Q?');
  assert.equal(m(null), 'asks: Q?');
  assert.equal(m(undefined), 'asks: Q?');
});

test('alertText: the prefix is outside the 150-code-point cut, and the message stays under 190', () => {
  const m = alertText({ ...base, why: 'timeout', kind: 'question', decisionText: 'x'.repeat(400) }).message;
  const prefix = "Agent didn't answer in time: ";
  assert.ok(m.startsWith(prefix + 'asks: '));
  assert.equal(cp(m.slice(prefix.length)), 150);
  assert.ok(cp(m) < 190);
});

test('reminderText prefixes Still waiting', () => {
  assert.equal(reminderText('asks: Q?'), 'Still waiting: asks: Q?');
});

// ---- endAlert ----

test('endAlert: ready', () => {
  assert.deepEqual(endAlert({ slug: 'screen-time', ready: true, taskCount: 9 }), {
    title: 'screen-time · ready to merge',
    message: 'All 9 tasks merged. git merge pir/screen-time',
    tags: ['tada'],
  });
});

test('endAlert: red with a reason', () => {
  assert.deepEqual(endAlert({ slug: 'screen-time', ready: false, taskCount: 9, reason: '3 tests failed' }), {
    title: 'screen-time · not ready',
    message: 'Tests red on pir/screen-time: 3 tests failed',
    tags: ['warning'],
  });
});

test('endAlert: a long red reason is cut to 150', () => {
  const { message } = endAlert({ slug: 's', ready: false, reason: 'r'.repeat(500) });
  const prefix = 'Tests red on pir/s: ';
  assert.ok(message.startsWith(prefix));
  assert.equal(cp(message.slice(prefix.length)), 150);
  assert.ok(message.endsWith('…'));
});

test('endAlert: red with no reason drops the colon', () => {
  assert.equal(endAlert({ slug: 's', ready: false }).message, 'Tests red on pir/s');
  assert.equal(endAlert({ slug: 's', ready: false, reason: '  ' }).message, 'Tests red on pir/s');
});

test('endAlert: unresolved main-sync outranks the test reason', () => {
  const a = endAlert({ slug: 's', ready: false, reason: 'boom', unresolved: true });
  assert.equal(a.message, 'Merge with main unresolved on pir/s');
  assert.equal(a.title, 's · not ready');
  assert.deepEqual(a.tags, ['warning']);
});

// ---- notifyStep ----

const view = (over = {}) => ({ id: 'w1', waiting: 'question', title: 'p · T01 implement', message: 'asks: Q?', remote: 'off', url: null, ...over });
const opts = { remindMs: 1000, linkWaitMs: 100 };

test('notifyStep: sends at once when remote is off or refused', () => {
  for (const remote of ['off', 'refused']) {
    const { actions, state } = notifyStep(newNotifyState(), [view({ remote })], 0, opts);
    assert.deepEqual(actions, [{ type: 'send', id: 'w1', seq: 'pir-w1-1', title: 'p · T01 implement', message: 'asks: Q?', click: null, reminder: false }]);
    assert.equal(state.episodes.w1.sentAt, 0);
  }
});

test('notifyStep: waits for the link while remote is wanted, then sends with click', () => {
  let s = newNotifyState();
  let r = notifyStep(s, [view({ remote: 'wanted' })], 0, opts);
  assert.deepEqual(r.actions, []);
  r = notifyStep(r.state, [view({ remote: 'wanted' })], 50, opts);
  assert.deepEqual(r.actions, []);
  r = notifyStep(r.state, [view({ remote: 'wanted', url: 'https://claude.ai/code/session_x' })], 60, opts);
  assert.equal(r.actions.length, 1);
  assert.equal(r.actions[0].click, 'https://claude.ai/code/session_x');
  assert.equal(r.actions[0].seq, 'pir-w1-1');
});

test('notifyStep: sends without a link once linkWaitMs has passed', () => {
  let r = notifyStep(newNotifyState(), [view({ remote: 'wanted' })], 0, opts);
  r = notifyStep(r.state, [view({ remote: 'wanted' })], 99, opts);
  assert.deepEqual(r.actions, []);
  r = notifyStep(r.state, [view({ remote: 'wanted' })], 100, opts);
  assert.equal(r.actions.length, 1);
  assert.equal(r.actions[0].click, null);
});

test('notifyStep: a url known at the first pass sends at once', () => {
  const r = notifyStep(newNotifyState(), [view({ remote: 'wanted', url: 'https://u' })], 0, opts);
  assert.equal(r.actions[0].click, 'https://u');
});

test('notifyStep: default timings are 15 min and 20 s', () => {
  let r = notifyStep(newNotifyState(), [view({ remote: 'wanted' })], 0);
  r = notifyStep(r.state, [view({ remote: 'wanted' })], 19_999);
  assert.deepEqual(r.actions, []);
  r = notifyStep(r.state, [view({ remote: 'wanted' })], 20_000);
  assert.equal(r.actions.length, 1);
  r = notifyStep(r.state, [view()], 20_000 + 899_999);
  assert.deepEqual(r.actions, []);
  r = notifyStep(r.state, [view()], 20_000 + 900_000);
  assert.equal(r.actions[0].reminder, true);
});

test('notifyStep: one reminder at remindMs, same seq, never another', () => {
  let r = notifyStep(newNotifyState(), [view()], 0, opts);
  r = notifyStep(r.state, [view()], 999, opts);
  assert.deepEqual(r.actions, []);
  r = notifyStep(r.state, [view()], 1000, opts);
  assert.deepEqual(r.actions, [{ type: 'send', id: 'w1', seq: 'pir-w1-1', title: 'p · T01 implement', message: 'Still waiting: asks: Q?', click: null, reminder: true }]);
  for (const t of [2000, 5000, 100_000]) {
    r = notifyStep(r.state, [view()], t, opts);
    assert.deepEqual(r.actions, []);
  }
});

test('notifyStep: the reminder carries a link that appeared after the first alert', () => {
  let r = notifyStep(newNotifyState(), [view({ remote: 'wanted' })], 0, opts);
  r = notifyStep(r.state, [view({ remote: 'wanted' })], 100, opts);
  assert.equal(r.actions[0].click, null);
  r = notifyStep(r.state, [view({ remote: 'wanted', url: 'https://late' })], 1100, opts);
  assert.equal(r.actions[0].click, 'https://late');
});

test('notifyStep: the message and title are fixed at episode start', () => {
  let r = notifyStep(newNotifyState(), [view({ remote: 'wanted', message: 'Agent unavailable: asks: Q?' })], 0, opts);
  r = notifyStep(r.state, [view({ remote: 'wanted', message: 'Agent passed it on: asks: Q?', title: 'other', url: 'https://u' })], 10, opts);
  assert.equal(r.actions[0].message, 'Agent unavailable: asks: Q?');
  assert.equal(r.actions[0].title, 'p · T01 implement');
  r = notifyStep(r.state, [view({ message: 'changed' })], 1010, opts);
  assert.equal(r.actions[0].message, 'Still waiting: Agent unavailable: asks: Q?');
});

test('notifyStep: an episode ending clears only if it was sent', () => {
  let r = notifyStep(newNotifyState(), [view()], 0, opts);
  r = notifyStep(r.state, [view({ waiting: null })], 10, opts);
  assert.deepEqual(r.actions, [{ type: 'clear', id: 'w1', seq: 'pir-w1-1' }]);
  assert.deepEqual(r.state.episodes, {});

  r = notifyStep(newNotifyState(), [view()], 0, opts);
  r = notifyStep(r.state, [], 10, opts); // worker gone from views
  assert.deepEqual(r.actions, [{ type: 'clear', id: 'w1', seq: 'pir-w1-1' }]);
});

test('notifyStep: an episode that never sent ends silently', () => {
  let r = notifyStep(newNotifyState(), [view({ remote: 'wanted' })], 0, opts);
  r = notifyStep(r.state, [view({ remote: 'wanted', waiting: null })], 10, opts);
  assert.deepEqual(r.actions, []);
  assert.deepEqual(r.state.episodes, {});
});

test('notifyStep: waiting again starts episode n+1 with a new seq', () => {
  let r = notifyStep(newNotifyState(), [view()], 0, opts);
  r = notifyStep(r.state, [view({ waiting: null })], 10, opts);
  r = notifyStep(r.state, [view({ message: 'asks: again?' })], 20, opts);
  assert.deepEqual(r.actions, [{ type: 'send', id: 'w1', seq: 'pir-w1-2', title: 'p · T01 implement', message: 'asks: again?', click: null, reminder: false }]);
  // A silent (never-sent) episode still counts, so seq numbers never repeat.
  r = notifyStep(r.state, [], 30, opts);
  r = notifyStep(r.state, [view({ remote: 'wanted' })], 40, opts);
  r = notifyStep(r.state, [], 50, opts);
  r = notifyStep(r.state, [view()], 60, opts);
  assert.equal(r.actions[0].seq, 'pir-w1-4');
});

test('notifyStep: two workers waiting at once are independent', () => {
  let r = notifyStep(newNotifyState(), [view(), view({ id: 'w2', remote: 'wanted' })], 0, opts);
  assert.deepEqual(r.actions.map((a) => [a.type, a.seq]), [['send', 'pir-w1-1']]);
  r = notifyStep(r.state, [view({ waiting: null }), view({ id: 'w2', remote: 'wanted', url: 'https://w2' })], 50, opts);
  assert.deepEqual(r.actions.map((a) => [a.type, a.seq]), [['send', 'pir-w2-1'], ['clear', 'pir-w1-1']]);
  r = notifyStep(r.state, [view({ id: 'w2', remote: 'wanted', url: 'https://w2' })], 1050, opts);
  assert.deepEqual(r.actions.map((a) => [a.type, a.seq, a.reminder]), [['send', 'pir-w2-1', true]]);
});

test('notifyStep: does not mutate the input state', () => {
  const s0 = newNotifyState();
  const r1 = notifyStep(s0, [view()], 0, opts);
  assert.deepEqual(s0, { episodes: {}, counts: {} });
  const snap = structuredClone(r1.state);
  notifyStep(r1.state, [view()], 5000, opts);
  notifyStep(r1.state, [], 5000, opts);
  assert.deepEqual(r1.state, snap);
});

test('notifyStep: now going backwards sends no early reminder and does not throw', () => {
  let r = notifyStep(newNotifyState(), [view()], 10_000, opts);
  r = notifyStep(r.state, [view()], 0, opts);
  assert.deepEqual(r.actions, []);
  r = notifyStep(r.state, [view()], 10_999, opts);
  assert.deepEqual(r.actions, []);
  r = notifyStep(r.state, [view()], 11_000, opts);
  assert.equal(r.actions[0].reminder, true);
  // backwards before the link wait: not sent early either
  let q = notifyStep(newNotifyState(), [view({ remote: 'wanted' })], 10_000, opts);
  q = notifyStep(q.state, [view({ remote: 'wanted' })], 0, opts);
  assert.deepEqual(q.actions, []);
});

test('notifyStep: tolerates a missing state and odd views', () => {
  const r = notifyStep(undefined, [null, { waiting: 'question' }, view(), view({ message: 'dup' })], 0, opts);
  assert.equal(r.actions.length, 1);
  assert.equal(r.actions[0].message, 'asks: Q?');
});

// ---- notifyExit ----

test('notifyExit clears sent episodes only', () => {
  let r = notifyStep(newNotifyState(), [view(), view({ id: 'w2', remote: 'wanted' })], 0, opts);
  assert.deepEqual(notifyExit(r.state), [{ type: 'clear', id: 'w1', seq: 'pir-w1-1' }]);
  assert.deepEqual(notifyExit(newNotifyState()), []);
  assert.deepEqual(notifyExit(undefined), []);
});
