import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SINGLE_ID_RE,
  RED_LIMIT,
  singleIdFrom,
  isValidSingleName,
  singleSessionName,
  builderInstruction,
  reviewerInstruction,
  parseSingleReport,
  redMessage,
  initialSingleState,
  decideSingleStep,
  singleProgress,
} from './singleflow.mjs';

const ALL_DONE = { branch: true, worktree: true, control: true, index: true };
const NONE_DONE = { branch: false, worktree: false, control: false, index: false };
const PASS = { ok: true, failures: [] };
const H1 = 'a'.repeat(40);
const H2 = 'b'.repeat(40);
const BASE_SHA = '0123456789abcdef0123456789abcdef01234567';
const types = (actions) => actions.map((a) => a.type);

const fresh = (commands = { setup: ['npm ci'], test: ['npm test'] }) =>
  initialSingleState({ id: 'single-3fa2', prompt: 'fix the typo', base: 'main', baseSha: BASE_SHA, commands });

const green = (head = H1, extra = {}) => ({ kind: 'tests', ok: true, half: null, reason: null, logPath: '/c/tests-1.log', tail: '', head, clean: true, ...extra });
const red = (head = H1, extra = {}) => ({
  kind: 'tests', ok: false, half: 'test', reason: 'test `npm test` exited 1', logPath: '/c/tests-1.log', tail: 'not ok 3', head, clean: true, ...extra,
});

// A run with the builder open and its session id recorded.
function building() {
  const first = decideSingleStep(fresh({ setup: [], test: ['npm test'] }), {});
  return decideSingleStep(first.state, { sessionId: 'sess-b1' }).state;
}

// The builder reported `built fix-typo`, its checks passed at `head`, and the tests are running.
function buildTesting(head = H1, from = building()) {
  const asked = decideSingleStep(from, { reports: [{ kind: 'built', name: 'fix-typo', body: '' }] });
  return decideSingleStep(asked.state, { checks: PASS, head }).state;
}

// Past the rename, with the reviewer open and its id recorded; the build's tests were green at H1.
function reviewing() {
  const s = decideSingleStep(buildTesting(), { commandDone: green(), idle: true, renamed: NONE_DONE }).state;
  return decideSingleStep(s, { sessionId: 'sess-r1', renamed: ALL_DONE }).state;
}

// The build step after `n` red rounds, the session told each time and the step waiting for a report.
function afterReds(n, from = building()) {
  let s = from;
  const sent = [];
  for (let i = 0; i < n; i += 1) {
    s = buildTesting(H1, s);
    let r = decideSingleStep(s, { commandDone: red() });
    if (r.actions.some((a) => a.type === 'runBaseline')) {
      r = decideSingleStep(r.state, { commandDone: { kind: 'baseline', ok: true, half: null, reason: null, logPath: '/c/baseline.log' } });
    }
    sent.push(r.actions.find((a) => a.type === 'send').text);
    s = r.state;
  }
  return { state: s, sent };
}

// --- ids, names ---------------------------------------------------------------------------------

test('single ids: single-{hex4} and nothing else', () => {
  assert.equal(SINGLE_ID_RE.test('single-3fa2'), true);
  for (const bad of ['single-3fa', 'single-3fa2b', 'single-3FA2', 'plan-3fa2', 'xsingle-3fa2']) {
    assert.equal(SINGLE_ID_RE.test(bad), false, bad);
  }
  assert.equal(singleIdFrom('3fa2'), 'single-3fa2');
});

test('singleIdFrom throws on anything but four lowercase hex', () => {
  for (const bad of ['XYZ', '3FA2', '3fa', '3fa2b', '', null, 1234]) {
    assert.throws(() => singleIdFrom(bad), /four lowercase hex/, String(bad));
  }
});

test('isValidSingleName: kebab, and neither run-id shape', () => {
  for (const ok of ['fix-typo', 'a', 'v2', 'single', 'single-3fa', 'plan', 'single-xyzw']) {
    assert.equal(isValidSingleName(ok), true, ok);
  }
  for (const bad of ['single-3fa2', 'plan-3fa2', 'Fix', 'a--b', '-a', 'a-', 'a b', '', null, undefined, 7]) {
    assert.equal(isValidSingleName(bad), false, String(bad));
  }
});

test('singleSessionName: five fields, no task segment', () => {
  assert.equal(singleSessionName({ repo: 'app', run: 'single-3fa2', step: 'build' }), 'app / single-3fa2 / single / builder');
  assert.equal(singleSessionName({ repo: 'app', run: 'fix-typo', step: 'review' }), 'app / fix-typo / single / reviewer');
  assert.throws(() => singleSessionName({ repo: 'app', run: 'x', step: 'plan' }), /'build' or 'review'/);
});

// --- instructions (DESIGN §2.6) -----------------------------------------------------------------

test('builderInstruction matches the design text', () => {
  assert.equal(
    builderInstruction({ reportsDir: '/r/reports', base: 'main', baseSha: BASE_SHA, prompt: 'fix the typo\nin the README' }),
    'Load the pir-single skill and run it as the builder. You are run by `pir single`. Reports folder: ' +
      `/r/reports. Starting point: main at ${BASE_SHA}.\nThe change:\n\nfix the typo\nin the README`,
  );
});

test('builderInstruction carries a setup note as its own paragraph', () => {
  const note = 'Setup failed: `npm ci` exited 1.\nFull output: /c/setup.log';
  assert.equal(
    builderInstruction({ reportsDir: '/r/reports', base: 'main', baseSha: BASE_SHA, prompt: 'fix it', setupNote: note }),
    'Load the pir-single skill and run it as the builder. You are run by `pir single`. Reports folder: ' +
      `/r/reports. Starting point: main at ${BASE_SHA}.\n\n${note}\n\nThe change:\n\nfix it`,
  );
});

test('reviewerInstruction matches the design text', () => {
  assert.equal(
    reviewerInstruction({ reportsDir: '/r/reports', name: 'fix-typo', base: 'main', baseSha: BASE_SHA, prompt: 'fix the typo' }),
    'Load the pir-single skill and run it as the reviewer of pir/fix-typo. You are run by `pir single`. ' +
      `Reports folder: /r/reports. Starting point: main at ${BASE_SHA}.\nThe change that was asked for:\n\nfix the typo`,
  );
});

// --- parseSingleReport (DESIGN §2.7) ------------------------------------------------------------

test('parseSingleReport: each kind, with its body', () => {
  assert.deepEqual(parseSingleReport('[pir:v1 kind=built single=fix-typo]\nDone.\n'), { kind: 'built', name: 'fix-typo', body: 'Done.' });
  assert.deepEqual(parseSingleReport('[pir:v1 kind=reviewed single=fix-typo]'), { kind: 'reviewed', name: 'fix-typo', body: '' });
  assert.deepEqual(parseSingleReport('[pir:v1 kind=dropped single=-]\r\nToo big.\nUse /plan.'), {
    kind: 'dropped', name: null, body: 'Too big.\nUse /plan.',
  });
  assert.deepEqual(parseSingleReport('[pir:v1 kind=dropped single=fix-typo]\nNothing to change.'), {
    kind: 'dropped', name: 'fix-typo', body: 'Nothing to change.',
  });
});

test('parseSingleReport: single=- only for dropped', () => {
  assert.equal(parseSingleReport('[pir:v1 kind=built single=-]'), null);
  assert.equal(parseSingleReport('[pir:v1 kind=reviewed single=-]'), null);
});

test('parseSingleReport: no header, a header off line 1, another format → null', () => {
  assert.equal(parseSingleReport('I built it, kind: built, single=fix-typo'), null);
  assert.equal(parseSingleReport('\n[pir:v1 kind=built single=fix-typo]'), null);
  assert.equal(parseSingleReport('Report:\n[pir:v1 kind=built single=fix-typo]'), null);
  assert.equal(parseSingleReport('[pir:v1 kind=planned plan=fix-typo]'), null);
  assert.equal(parseSingleReport('[pir:v1 kind=merged single=fix-typo]'), null);
  assert.equal(parseSingleReport('[pir:v1 kind=built single=fix-typo] and more'), null);
  for (const v of [null, undefined, 7, {}]) assert.equal(parseSingleReport(v), null);
});

// --- redMessage (DESIGN §2.5) -------------------------------------------------------------------

const RED_ARGS = { sha: H1, reason: 'test `npm test` exited 1', logPath: '/c/tests-1.log', tail: 'not ok 3\n# fail 1\n', base: 'main', baseSha: BASE_SHA };

test('redMessage: rounds 1 to 3, tests pass on the starting point', () => {
  assert.equal(
    redMessage({ ...RED_ARGS, round: 1, baseline: { ok: true, half: null, reason: null } }),
    [
      'pir ran the tests on your commit aaaaaaa and they failed: test `npm test` exited 1. Round 1 of 3.',
      'They pass on the untouched starting point (main 0123456), so this change broke them.',
      'Log: /c/tests-1.log',
      'not ok 3',
      '# fail 1',
      'Fix it, commit, and report again.',
    ].join('\n'),
  );
});

test('redMessage: the three baseline lines', () => {
  const line = (baseline) => redMessage({ ...RED_ARGS, round: 2, baseline }).split('\n')[1];
  assert.equal(
    line({ ok: false, half: 'test', reason: 'test `npm test` exited 1' }),
    'They also fail on the untouched starting point (main 0123456), so the failure may be older than this change.',
  );
  assert.equal(line({ ok: true, half: null, reason: null }), 'They pass on the untouched starting point (main 0123456), so this change broke them.');
  assert.equal(
    line({ ok: false, half: 'setup', reason: 'setup `npm ci` exited 1' }),
    'The untouched starting point could not be tested: setup `npm ci` exited 1.',
  );
  assert.equal(line({ ok: false, half: null, reason: 'the worktree could not be created' }), 'The untouched starting point could not be tested: the worktree could not be created.');
});

test('redMessage: past the limit the last line tells the session to stop and ask', () => {
  assert.equal(RED_LIMIT, 3);
  const last = (round) => redMessage({ ...RED_ARGS, round, baseline: { ok: true } }).split('\n').at(-1);
  for (const round of [1, 2, 3]) assert.equal(last(round), 'Fix it, commit, and report again.');
  for (const round of [4, 5]) {
    assert.equal(
      last(round),
      `This is round ${round}, past the limit of 3: stop, tell the person what fails and what you tried, and ask how to go on. Report again only after they answer.`,
    );
    assert.match(redMessage({ ...RED_ARGS, round, baseline: { ok: true } }), new RegExp(`Round ${round} of 3\\.`));
  }
});

test('redMessage: an empty tail leaves no blank line', () => {
  const text = redMessage({ ...RED_ARGS, tail: '', round: 1, baseline: { ok: true } });
  assert.deepEqual(text.split('\n').slice(2), ['Log: /c/tests-1.log', 'Fix it, commit, and report again.']);
});

// --- state --------------------------------------------------------------------------------------

test('initialSingleState: the §3.5 shape', () => {
  assert.deepEqual(fresh(), {
    version: 1,
    id: 'single-3fa2',
    name: null,
    step: 'setup',
    sessions: { build: [], review: [] },
    commands: { setup: ['npm ci'], test: ['npm test'] },
    base: 'main',
    baseSha: BASE_SHA,
    rounds: { build: 0, review: 0 },
    tested: null,
    baseline: null,
    outcome: null,
    renamed: NONE_DONE,
    live: false,
    accepted: null,
    rejected: null,
    running: null,
    pending: null,
    red: null,
  });
  assert.throws(() => initialSingleState({ id: 'plan-3fa2', base: 'main', baseSha: BASE_SHA, commands: { setup: [], test: ['t'] } }), /single-\{hex4\}/);
});

test('the state survives JSON and is never mutated', () => {
  const s = buildTesting();
  const frozen = JSON.parse(JSON.stringify(s));
  const r = decideSingleStep(s, { commandDone: red() });
  assert.deepEqual(s, frozen);
  assert.deepEqual(decideSingleStep(frozen, { commandDone: red() }), r);
});

// --- setup (DESIGN §2.4 step 1) -----------------------------------------------------------------

test('a fresh state runs the setup, once', () => {
  const r = decideSingleStep(fresh(), {});
  assert.deepEqual(r.actions, [{ type: 'runSetup' }]);
  assert.equal(r.state.running, 'setup');
  assert.equal(r.state.step, 'setup');
  assert.deepEqual(decideSingleStep(r.state, {}).actions, []);
});

test('setup: [] spawns the builder at once', () => {
  const r = decideSingleStep(fresh({ setup: [], test: ['npm test'] }), {});
  assert.deepEqual(r.actions, [{ type: 'spawn', step: 'build' }]);
  assert.equal(r.state.step, 'build');
  assert.equal(r.state.live, true);
  assert.equal(r.state.running, null);
});

test('a green setup spawns the builder with no note', () => {
  const s = decideSingleStep(fresh(), {}).state;
  const r = decideSingleStep(s, { commandDone: { kind: 'setup', ok: true, logPath: '/c/setup.log' } });
  assert.deepEqual(r.actions, [{ type: 'spawn', step: 'build' }]);
  assert.equal(r.state.running, null);
});

test('a failed setup still spawns the builder, with the failure as the note', () => {
  const s = decideSingleStep(fresh(), {}).state;
  const r = decideSingleStep(s, { commandDone: { kind: 'setup', ok: false, reason: '`npm ci` exited 1', tail: 'ERR!', logPath: '/c/setup.log' } });
  assert.deepEqual(r.actions, [{ type: 'spawn', step: 'build', note: { reason: '`npm ci` exited 1', tail: 'ERR!', logPath: '/c/setup.log' } }]);
  assert.equal(r.state.step, 'build');
});

test('the session id is recorded once', () => {
  const s = building();
  assert.deepEqual(s.sessions.build, ['sess-b1']);
  assert.deepEqual(decideSingleStep(s, { sessionId: 'sess-b1' }).state.sessions.build, ['sess-b1']);
});

// --- build: checks (DESIGN §2.7) ----------------------------------------------------------------

test('a built report asks for its checks', () => {
  const r = decideSingleStep(building(), { reports: [{ kind: 'built', name: 'fix-typo', body: '' }] });
  assert.deepEqual(r.actions, [{ type: 'check', kind: 'built', name: 'fix-typo' }]);
  assert.deepEqual(r.state.pending, { kind: 'built', name: 'fix-typo' });
  assert.equal(r.state.step, 'build');
});

test('a failed check is sent once, and the step carries on', () => {
  const asked = decideSingleStep(building(), { reports: [{ kind: 'built', name: 'fix-typo', body: '' }] }).state;
  const failed = { ok: false, failures: ['nothing is committed on the branch yet'] };
  const r = decideSingleStep(asked, { checks: failed, head: H1 });
  assert.deepEqual(r.actions, [
    { type: 'send', text: 'pir did not accept your `built` report for pir/fix-typo: nothing is committed on the branch yet' },
  ]);
  assert.equal(r.state.step, 'build');
  assert.equal(r.state.accepted, null);
  assert.equal(r.state.live, true);

  // The same report failing the same way again: checked, not re-sent.
  const again = decideSingleStep(r.state, { reports: [{ kind: 'built', name: 'fix-typo', body: '' }] });
  assert.deepEqual(types(again.actions), ['check']);
  assert.deepEqual(decideSingleStep(again.state, { checks: failed, head: H1 }).actions, []);

  // A different failure is a new message, several failures a list.
  const other = decideSingleStep(again.state, { checks: { ok: false, failures: ['the worktree is not clean', 'pir/fix-typo is taken'] }, head: H1 });
  assert.deepEqual(other.actions, [
    { type: 'send', text: 'pir did not accept your `built` report for pir/fix-typo:\n- the worktree is not clean\n- pir/fix-typo is taken' },
  ]);
});

test('a passed check starts the tests with the head', () => {
  const asked = decideSingleStep(building(), { reports: [{ kind: 'built', name: 'fix-typo', body: '' }] }).state;
  const r = decideSingleStep(asked, { checks: PASS, head: H1 });
  assert.deepEqual(r.actions, [{ type: 'runTests', head: H1 }]);
  assert.equal(r.state.running, 'tests');
  assert.deepEqual(r.state.accepted, { kind: 'built', name: 'fix-typo', head: H1 });
  assert.deepEqual(r.state.tested, { head: H1, ok: null });
  assert.equal(r.state.pending, null);
});

test('a passed check with no head is a caller bug', () => {
  const asked = decideSingleStep(building(), { reports: [{ kind: 'built', name: 'fix-typo', body: '' }] }).state;
  assert.throws(() => decideSingleStep(asked, { checks: PASS }), /needs facts\.head/);
});

test('checks with no report pending are ignored', () => {
  assert.deepEqual(decideSingleStep(building(), { checks: PASS, head: H1 }).actions, []);
});

// --- build: tests, rename (DESIGN §2.4 steps 3–4) -----------------------------------------------

test('green, same head, clean, idle → close, rename in order, spawn the reviewer', () => {
  const r = decideSingleStep(buildTesting(), { commandDone: green(), idle: true, renamed: NONE_DONE });
  assert.deepEqual(r.actions, [
    { type: 'closeWhenIdle' },
    { type: 'rename', substep: 'branch' },
    { type: 'rename', substep: 'worktree' },
    { type: 'rename', substep: 'control' },
    { type: 'rename', substep: 'index' },
    { type: 'spawn', step: 'review' },
  ]);
  assert.equal(r.state.step, 'review');
  assert.equal(r.state.name, 'fix-typo');
  assert.deepEqual(r.state.renamed, ALL_DONE);
  assert.deepEqual(r.state.tested, { head: H1, ok: true });
  assert.equal(r.state.accepted, null);
  assert.equal(r.state.running, null);
  assert.equal(r.state.live, true);
});

test('green while the session is still busy waits for the idle gate', () => {
  const r = decideSingleStep(buildTesting(), { commandDone: green(), idle: false });
  assert.deepEqual(r.actions, []);
  assert.equal(r.state.step, 'build');
  assert.deepEqual(decideSingleStep(r.state, { idle: false }).actions, []);
  assert.deepEqual(types(decideSingleStep(r.state, { idle: true, renamed: NONE_DONE }).actions), [
    'closeWhenIdle', 'rename', 'rename', 'rename', 'rename', 'spawn',
  ]);
});

test('green but the head moved → the tests run again on the new head', () => {
  const r = decideSingleStep(buildTesting(), { commandDone: green(H2), idle: true });
  assert.deepEqual(r.actions, [{ type: 'runTests', head: H2 }]);
  assert.equal(r.state.step, 'build');
  const next = decideSingleStep(r.state, { commandDone: green(H2), idle: true, renamed: NONE_DONE });
  assert.equal(next.state.step, 'review');
});

test('green but the tree is dirty → the tests run again', () => {
  const r = decideSingleStep(buildTesting(), { commandDone: green(H1, { clean: false }), idle: true });
  assert.deepEqual(r.actions, [{ type: 'runTests', head: H1 }]);
  assert.equal(r.state.step, 'build');
});

test('a command result that is not the run in flight is ignored', () => {
  assert.deepEqual(decideSingleStep(building(), { commandDone: green() }).actions, []);
  const r = decideSingleStep(buildTesting(), { commandDone: { kind: 'baseline', ok: true } });
  assert.deepEqual(r.actions, []);
  assert.equal(r.state.running, 'tests');
});

test('a newer accepted report voids the run in flight, whatever its colour', () => {
  const s = buildTesting(H1);
  const asked = decideSingleStep(s, { reports: [{ kind: 'built', name: 'fix-typo', body: '' }] });
  assert.deepEqual(types(asked.actions), ['check']);
  const accepted = decideSingleStep(asked.state, { checks: PASS, head: H2 });
  assert.deepEqual(accepted.actions, []);
  const r = decideSingleStep(accepted.state, { commandDone: red(H2) });
  assert.deepEqual(r.actions, [{ type: 'runTests', head: H2 }]);
  assert.equal(r.state.rounds.build, 0);
});

// --- red rounds and the baseline (DESIGN §2.5) --------------------------------------------------

test('the first red runs the baseline, then sends round 1 with the baseline line', () => {
  const r = decideSingleStep(buildTesting(), { commandDone: red() });
  assert.deepEqual(r.actions, [{ type: 'runBaseline' }]);
  assert.equal(r.state.running, 'baseline');
  assert.equal(r.state.rounds.build, 1);
  assert.deepEqual(r.state.tested, { head: H1, ok: false });
  assert.deepEqual(decideSingleStep(r.state, {}).actions, []);

  const baseline = { kind: 'baseline', ok: false, half: 'test', reason: 'test `npm test` exited 1', logPath: '/c/baseline.log', tail: 'x' };
  const b = decideSingleStep(r.state, { commandDone: baseline });
  assert.deepEqual(b.state.baseline, { ok: false, half: 'test', reason: 'test `npm test` exited 1', logPath: '/c/baseline.log' });
  assert.equal(b.state.running, null);
  assert.equal(b.state.red, null);
  assert.deepEqual(b.actions, [
    {
      type: 'send',
      text: redMessage({
        sha: H1, reason: 'test `npm test` exited 1', round: 1, logPath: '/c/tests-1.log', tail: 'not ok 3',
        baseline: b.state.baseline, base: 'main', baseSha: BASE_SHA,
      }),
    },
  ]);
  assert.match(b.actions[0].text, /^They also fail on the untouched starting point \(main 0123456\)/m);
  assert.equal(b.state.step, 'build');
  assert.equal(b.state.accepted, null);
});

test('a baseline that could not run still lets the round go on', () => {
  const r = decideSingleStep(buildTesting(), { commandDone: red() });
  const b = decideSingleStep(r.state, { commandDone: { kind: 'baseline', ok: false, half: 'setup', reason: 'setup `npm ci` exited 1', logPath: '/c/baseline.log' } });
  assert.match(b.actions[0].text, /^The untouched starting point could not be tested: setup `npm ci` exited 1\.$/m);
});

test('later reds reuse the baseline and send at once', () => {
  const { state } = afterReds(1);
  const r = decideSingleStep(buildTesting(H2, state), { commandDone: red(H2) });
  assert.deepEqual(types(r.actions), ['send']);
  assert.match(r.actions[0].text, /^pir ran the tests on your commit bbbbbbb .* Round 2 of 3\.$/m);
  assert.match(r.actions[0].text, /^They pass on the untouched starting point/m);
  assert.equal(r.state.rounds.build, 2);
});

test('after a red the step waits for a new report, then tests again', () => {
  const { state } = afterReds(1);
  assert.deepEqual(decideSingleStep(state, { idle: true }).actions, []);
  const asked = decideSingleStep(state, { reports: [{ kind: 'built', name: 'fix-typo', body: '' }] });
  assert.deepEqual(types(asked.actions), ['check']);
  // The same head again is still tested again: the last run of it was red.
  assert.deepEqual(decideSingleStep(asked.state, { checks: PASS, head: H1 }).actions, [{ type: 'runTests', head: H1 }]);
});

test('rounds 1 to 3 are plain; rounds 4 and 5 carry the past-limit line', () => {
  const { sent, state } = afterReds(5);
  assert.equal(state.rounds.build, 5);
  for (const i of [0, 1, 2]) {
    assert.match(sent[i], new RegExp(`Round ${i + 1} of 3\\.`));
    assert.match(sent[i], /\nFix it, commit, and report again\.$/);
  }
  for (const i of [3, 4]) {
    assert.match(sent[i], new RegExp(`\\nThis is round ${i + 1}, past the limit of 3: stop, tell the person`));
    assert.doesNotMatch(sent[i], /Fix it, commit/);
  }
});

test('rounds are counted per step: the review starts at 0', () => {
  let s = afterReds(2).state;
  s = decideSingleStep(buildTesting(H1, s), { commandDone: green(), idle: true, renamed: NONE_DONE }).state;
  s = decideSingleStep(s, { sessionId: 'sess-r1', renamed: ALL_DONE }).state;
  assert.deepEqual(s.rounds, { build: 2, review: 0 });
  const asked = decideSingleStep(s, { reports: [{ kind: 'reviewed', name: 'fix-typo', body: '' }], renamed: ALL_DONE }).state;
  const testing = decideSingleStep(asked, { checks: PASS, head: H2, renamed: ALL_DONE }).state;
  const r = decideSingleStep(testing, { commandDone: red(H2), renamed: ALL_DONE });
  // The baseline is the run's, not the step's: it is not run a second time.
  assert.deepEqual(types(r.actions), ['send']);
  assert.match(r.actions[0].text, /Round 1 of 3\./);
  assert.deepEqual(r.state.rounds, { build: 2, review: 1 });
});

// --- review (DESIGN §2.4 steps 5–6) -------------------------------------------------------------

test('reviewed → check → tests → green → close → finish ready', () => {
  const asked = decideSingleStep(reviewing(), { reports: [{ kind: 'reviewed', name: 'fix-typo', body: '' }], renamed: ALL_DONE });
  assert.deepEqual(asked.actions, [{ type: 'check', kind: 'reviewed', name: 'fix-typo' }]);
  const testing = decideSingleStep(asked.state, { checks: PASS, head: H2, renamed: ALL_DONE });
  assert.deepEqual(testing.actions, [{ type: 'runTests', head: H2 }]);
  const r = decideSingleStep(testing.state, { commandDone: green(H2), idle: true, renamed: ALL_DONE });
  assert.deepEqual(r.actions, [{ type: 'closeWhenIdle' }, { type: 'finish', outcome: 'ready' }]);
  assert.equal(r.state.outcome, 'ready');
  assert.equal(r.state.step, 'review');
  assert.equal(r.state.live, false);
  assert.equal(r.state.accepted, null);
});

test('reviewed at the head the build tested green → no second test run', () => {
  const asked = decideSingleStep(reviewing(), { reports: [{ kind: 'reviewed', name: 'fix-typo', body: '' }], renamed: ALL_DONE });
  const r = decideSingleStep(asked.state, { checks: PASS, head: H1, idle: true, renamed: ALL_DONE });
  assert.deepEqual(r.actions, [{ type: 'closeWhenIdle' }, { type: 'finish', outcome: 'ready' }]);
  assert.equal(r.state.outcome, 'ready');
});

test('a failed reviewed check goes to the reviewer', () => {
  const asked = decideSingleStep(reviewing(), { reports: [{ kind: 'reviewed', name: 'other', body: '' }], renamed: ALL_DONE });
  const r = decideSingleStep(asked.state, { checks: { ok: false, failures: ['this run is pir/fix-typo'] }, head: H1, idle: true, renamed: ALL_DONE });
  assert.deepEqual(r.actions, [{ type: 'send', text: 'pir did not accept your `reviewed` report for pir/other: this run is pir/fix-typo' }]);
  assert.equal(r.state.outcome, null);
});

test('a finished run decides nothing more, resume included', () => {
  const asked = decideSingleStep(reviewing(), { reports: [{ kind: 'reviewed', name: 'fix-typo', body: '' }], renamed: ALL_DONE });
  const done = decideSingleStep(asked.state, { checks: PASS, head: H1, idle: true, renamed: ALL_DONE }).state;
  assert.deepEqual(decideSingleStep(done, { resume: true, renamed: ALL_DONE }).actions, []);
  assert.deepEqual(decideSingleStep(done, { reports: [{ kind: 'reviewed', name: 'fix-typo', body: '' }] }).actions, []);
});

// --- dropped ------------------------------------------------------------------------------------

test('dropped in build → close → finish dropped, the body kept', () => {
  const r = decideSingleStep(building(), { reports: [{ kind: 'dropped', name: null, body: 'Too big: use /plan.' }], idle: true });
  assert.deepEqual(r.actions, [{ type: 'closeWhenIdle' }, { type: 'finish', outcome: 'dropped' }]);
  assert.equal(r.state.outcome, 'dropped');
  assert.equal(r.state.step, 'build');
  assert.deepEqual(r.state.accepted, { kind: 'dropped', name: null, body: 'Too big: use /plan.' });
});

test('dropped in review → close → finish dropped', () => {
  const r = decideSingleStep(reviewing(), { reports: [{ kind: 'dropped', name: null, body: 'Nothing to change.' }], idle: true, renamed: ALL_DONE });
  assert.deepEqual(r.actions, [{ type: 'closeWhenIdle' }, { type: 'finish', outcome: 'dropped' }]);
  assert.equal(r.state.step, 'review');
  assert.equal(r.state.name, 'fix-typo');
});

test('dropped waits for the idle gate, and a test run in flight is forgotten', () => {
  const r = decideSingleStep(buildTesting(), { reports: [{ kind: 'dropped', name: null, body: 'x' }], idle: false });
  assert.deepEqual(r.actions, []);
  // The red result of the run that was in flight is not sent to a session that has dropped.
  const late = decideSingleStep(r.state, { commandDone: red(), idle: false });
  assert.deepEqual(late.actions, []);
  assert.equal(late.state.rounds.build, 0);
  const end = decideSingleStep(late.state, { idle: true });
  assert.deepEqual(end.actions, [{ type: 'closeWhenIdle' }, { type: 'finish', outcome: 'dropped' }]);
  assert.equal(end.state.running, null);
});

// --- ignored reports, exits ---------------------------------------------------------------------

test("a report of the other step's kind is ignored", () => {
  const b = decideSingleStep(building(), { reports: [{ kind: 'reviewed', name: 'fix-typo', body: '' }], idle: true });
  assert.deepEqual(b.actions, []);
  assert.equal(b.state.pending, null);
  const r = decideSingleStep(reviewing(), { reports: [{ kind: 'built', name: 'fix-typo', body: '' }], idle: true, renamed: ALL_DONE });
  assert.deepEqual(r.actions, []);
  assert.deepEqual(decideSingleStep(building(), { reports: [null] }).actions, []);
});

test('a session that exits with no report leaves the run crashed', () => {
  for (const facts of [{ exited: true }, { live: false }]) {
    const r = decideSingleStep(building(), facts);
    assert.deepEqual(r.actions, [{ type: 'exitCrashed' }]);
    assert.equal(r.state.live, false);
    assert.equal(r.state.outcome, null);
  }
});

test('a session that exits while pir tests is not a crash: green goes on without it', () => {
  const gone = decideSingleStep(buildTesting(), { exited: true });
  assert.deepEqual(gone.actions, []);
  const r = decideSingleStep(gone.state, { commandDone: green(), renamed: NONE_DONE });
  assert.deepEqual(types(r.actions), ['rename', 'rename', 'rename', 'rename', 'spawn']);
});

test('a red for a session that is gone reopens it before the message', () => {
  let s = afterReds(1).state;
  s = decideSingleStep(buildTesting(H2, s), { exited: true }).state;
  const r = decideSingleStep(s, { commandDone: red(H2) });
  assert.deepEqual(types(r.actions), ['resumeSession', 'send']);
  assert.deepEqual(r.actions[0], { type: 'resumeSession', step: 'build', sessionId: 'sess-b1' });
  assert.equal(r.state.live, true);
});

test('an exit with an accepted, green step goes on instead of crashing', () => {
  const waiting = decideSingleStep(buildTesting(), { commandDone: green(), idle: false }).state;
  const r = decideSingleStep(waiting, { exited: true, renamed: NONE_DONE });
  assert.deepEqual(types(r.actions), ['rename', 'rename', 'rename', 'rename', 'spawn']);
});

// --- resume (DESIGN §2.11) ----------------------------------------------------------------------

test('resume in setup runs the setup again', () => {
  const s = decideSingleStep(fresh(), {}).state;
  assert.deepEqual(decideSingleStep(s, { resume: true }).actions, [{ type: 'runSetup' }]);
});

test('resume in build reopens the last builder session by id', () => {
  const r = decideSingleStep(building(), { resume: true });
  assert.deepEqual(r.actions, [{ type: 'resumeSession', step: 'build', sessionId: 'sess-b1' }]);
  assert.equal(r.state.live, true);
});

test('resume with no session id on record spawns the step afresh', () => {
  const s = decideSingleStep(fresh({ setup: [], test: ['t'] }), {}).state;
  assert.deepEqual(decideSingleStep(s, { resume: true }).actions, [{ type: 'spawn', step: 'build' }]);
});

test('resume forgets a report that was waiting on its checks', () => {
  const asked = decideSingleStep(building(), { reports: [{ kind: 'built', name: 'fix-typo', body: '' }] }).state;
  const r = decideSingleStep(asked, { resume: true });
  assert.deepEqual(types(r.actions), ['resumeSession']);
  assert.equal(r.state.pending, null);
});

test('resume during a test run starts the tests again, with no session', () => {
  const r = decideSingleStep(buildTesting(), { resume: true });
  assert.deepEqual(r.actions, [{ type: 'runTests', head: H1 }]);
  assert.equal(r.state.live, false);
  assert.equal(r.state.running, 'tests');
  // Green: nothing to close, straight to the rename.
  const next = decideSingleStep(r.state, { commandDone: green(), renamed: NONE_DONE });
  assert.deepEqual(types(next.actions), ['rename', 'rename', 'rename', 'rename', 'spawn']);
});

test('resume during the baseline runs it again and keeps the red that waits for it', () => {
  const s = decideSingleStep(buildTesting(), { commandDone: red() }).state;
  const r = decideSingleStep(s, { resume: true });
  assert.deepEqual(r.actions, [{ type: 'runBaseline' }]);
  const b = decideSingleStep(r.state, { commandDone: { kind: 'baseline', ok: true, logPath: '/c/baseline.log' } });
  assert.deepEqual(types(b.actions), ['resumeSession', 'send']);
  assert.match(b.actions[1].text, /Round 1 of 3\./);
});

test('resume finishes a half-done rename first, then reopens the reviewer', () => {
  const half = { branch: true, worktree: true, control: false, index: false };
  const r = decideSingleStep(reviewing(), { resume: true, renamed: half });
  assert.deepEqual(r.actions, [
    { type: 'rename', substep: 'control' },
    { type: 'rename', substep: 'index' },
    { type: 'resumeSession', step: 'review', sessionId: 'sess-r1' },
  ]);
});

test('resume before the reviewer was ever named spawns it afresh after the rename', () => {
  const s = decideSingleStep(buildTesting(), { commandDone: green(), idle: true, renamed: NONE_DONE }).state;
  const r = decideSingleStep(s, { resume: true, renamed: { ...ALL_DONE, index: false } });
  assert.deepEqual(r.actions, [{ type: 'rename', substep: 'index' }, { type: 'spawn', step: 'review' }]);
});

test('a state saved as rename does the sub-steps left, then the reviewer', () => {
  const s = { ...building(), step: 'rename', name: 'fix-typo', live: false };
  for (const resume of [true, false]) {
    const r = decideSingleStep(s, { resume, renamed: { ...NONE_DONE, branch: true } });
    assert.deepEqual(types(r.actions), ['rename', 'rename', 'rename', 'spawn']);
    assert.equal(r.state.step, 'review');
  }
});

test('resume of a green step that was waiting for the idle gate goes on without the session', () => {
  const waiting = decideSingleStep(buildTesting(), { commandDone: green(), idle: false }).state;
  const r = decideSingleStep(waiting, { resume: true, renamed: NONE_DONE });
  assert.deepEqual(types(r.actions), ['rename', 'rename', 'rename', 'rename', 'spawn']);
});

// --- a whole run --------------------------------------------------------------------------------

test('a whole run: setup, build, one red, green, rename, review, ready', () => {
  const log = [];
  let s = fresh();
  const step = (facts) => {
    const r = decideSingleStep(s, facts);
    s = JSON.parse(JSON.stringify(r.state));
    log.push(...types(r.actions));
  };
  step({});
  step({ commandDone: { kind: 'setup', ok: true } });
  step({ sessionId: 'b1' });
  step({ reports: [{ kind: 'built', name: 'fix-typo', body: '' }] });
  step({ checks: PASS, head: H1 });
  step({ commandDone: red() });
  step({ commandDone: { kind: 'baseline', ok: true, logPath: '/c/baseline.log' } });
  step({ reports: [{ kind: 'built', name: 'fix-typo', body: '' }] });
  step({ checks: PASS, head: H2 });
  step({ commandDone: green(H2), idle: true, renamed: NONE_DONE });
  step({ sessionId: 'r1', renamed: ALL_DONE });
  step({ reports: [{ kind: 'reviewed', name: 'fix-typo', body: '' }], renamed: ALL_DONE });
  step({ checks: PASS, head: H2, idle: true, renamed: ALL_DONE });
  assert.deepEqual(log, [
    'runSetup', 'spawn', 'check', 'runTests', 'runBaseline', 'send', 'check', 'runTests',
    'closeWhenIdle', 'rename', 'rename', 'rename', 'rename', 'spawn', 'check', 'closeWhenIdle', 'finish',
  ]);
  assert.equal(s.outcome, 'ready');
  assert.deepEqual(s.sessions, { build: ['b1'], review: ['r1'] });
  assert.deepEqual(s.rounds, { build: 1, review: 0 });
});

// --- singleProgress (DESIGN §2.8) ---------------------------------------------------------------

test('singleProgress: every cell', () => {
  const cell = (step, phase, outcome = null, rounds = { build: 0, review: 0 }) => singleProgress({ kind: 'single', step, phase, outcome, rounds });
  assert.equal(cell('setup', 'working'), 'build …');
  assert.equal(cell('build', 'working'), 'build …');
  assert.equal(cell('build', 'testing'), 'build · tests …');
  assert.equal(cell('rename', 'working'), 'build ✓ review …');
  assert.equal(cell('review', 'working'), 'build ✓ review …');
  assert.equal(cell('review', 'testing'), 'build ✓ review · tests …');
  assert.equal(cell('review', 'working', 'ready'), 'build ✓ review ✓');
  assert.equal(cell('build', 'working', 'dropped'), 'build ✗');
  assert.equal(cell('review', 'working', 'dropped'), 'build ✓ review ✗');
});

test('singleProgress: a red round shows after the step\'s tests', () => {
  assert.equal(singleProgress({ step: 'build', phase: 'testing', outcome: null, rounds: { build: 2, review: 0 } }), 'build · tests (red 2) …');
  assert.equal(singleProgress({ step: 'review', phase: 'testing', outcome: null, rounds: { build: 2, review: 1 } }), 'build ✓ review · tests (red 1) …');
  // The build's rounds do not follow the run into review, and a working step has no `tests` to mark.
  assert.equal(singleProgress({ step: 'review', phase: 'testing', outcome: null, rounds: { build: 2, review: 0 } }), 'build ✓ review · tests …');
  assert.equal(singleProgress({ step: 'build', phase: 'working', outcome: null, rounds: { build: 2, review: 0 } }), 'build …');
});
