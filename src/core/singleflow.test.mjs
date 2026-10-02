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
  leftoverMessage,
  initialSingleState,
  decideSingleStep,
  singleProgress,
  helperInstruction,
  SYNC_RETRY_MS,
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
  assert.equal(singleSessionName({ repo: 'app', run: 'fix-typo', step: 'resolve' }), 'app / fix-typo / single / resolve');
  assert.equal(singleSessionName({ repo: 'app', run: 'fix-typo', step: 'fix' }), 'app / fix-typo / single / fix');
  for (const bad of ['plan', 'sync', 'wait', 'toString']) {
    assert.throws(() => singleSessionName({ repo: 'app', run: 'x', step: bad }), /'build', 'review', 'resolve' or 'fix'/, bad);
  }
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
    sessions: { build: [], review: [], resolve: [], fix: [] },
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
    end: {
      seq: 0, phase: null, sync: null, tests: null, testsReason: null, fixUsed: false, hold: null,
      localSeen: null, remote: null, finisher: null, fallback: null,
    },
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

test('green on the same head but the tree is dirty → the session is told once, no rerun', () => {
  const dirty = '?? coverage/\n M README.md\n';
  const r = decideSingleStep(buildTesting(), { commandDone: green(H1, { clean: false, dirty }), idle: true });
  assert.deepEqual(r.actions, [{ type: 'send', text: leftoverMessage({ sha: H1, dirty }) }]);
  assert.equal(r.state.step, 'build');
  assert.equal(r.state.accepted, null);
  assert.equal(r.state.tested, null);
  assert.equal(r.state.running, null);
  assert.equal(r.state.rounds.build, 0, 'a green run counts no red round');
  // Nothing more happens until the session reports again.
  assert.deepEqual(decideSingleStep(r.state, { idle: true }).actions, []);
  const again = decideSingleStep(r.state, { reports: [{ kind: 'built', name: 'fix-typo', body: '' }] });
  assert.deepEqual(types(again.actions), ['check']);
});

test('green with the head moved and the tree dirty → the tests run on the new head first', () => {
  const r = decideSingleStep(buildTesting(), { commandDone: green(H2, { clean: false, dirty: '?? x\n' }), idle: true });
  assert.deepEqual(r.actions, [{ type: 'runTests', head: H2 }]);
});

test('leftoverMessage: the listing between the two lines, dropped when empty', () => {
  assert.equal(
    leftoverMessage({ sha: H1, dirty: '?? coverage/\n' }),
    'pir ran the tests on your commit aaaaaaa and they passed, but the worktree is not clean afterwards:\n' +
      '?? coverage/\n' +
      'If these are your edits, commit them. If the tests made them, make git ignore them (.gitignore) and commit that. Then report again.',
  );
  assert.equal(leftoverMessage({ sha: H1, dirty: '' }).split('\n').length, 2);
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

test('a dropped report wins over any other report drained with it, whatever the order', () => {
  for (const reports of [
    [{ kind: 'dropped', name: null, body: 'x' }, { kind: 'built', name: 'fix-typo', body: '' }],
    [{ kind: 'built', name: 'fix-typo', body: '' }, { kind: 'dropped', name: null, body: 'x' }],
  ]) {
    const r = decideSingleStep(building(), { reports, idle: true });
    assert.deepEqual(r.actions, [{ type: 'closeWhenIdle' }, { type: 'finish', outcome: 'dropped' }]);
    assert.equal(r.state.accepted.body, 'x');
  }
});

test('a dropped report drained with a red result: no round, no baseline, no message', () => {
  const dropped = { kind: 'dropped', name: null, body: 'x' };
  const r = decideSingleStep(buildTesting(), { reports: [dropped], commandDone: red(), idle: true });
  assert.deepEqual(r.actions, [{ type: 'closeWhenIdle' }, { type: 'finish', outcome: 'dropped' }]);
  assert.equal(r.state.rounds.build, 0);
  assert.equal(r.state.baseline, null);

  // The baseline returning in the same call must not reopen a session that is gone to tell it of a red.
  let s = decideSingleStep(buildTesting(), { commandDone: red() }).state;
  s = decideSingleStep(s, { exited: true }).state;
  const b = decideSingleStep(s, { reports: [dropped], commandDone: { kind: 'baseline', ok: true, logPath: '/c/baseline.log' }, idle: true });
  assert.deepEqual(b.actions, [{ type: 'finish', outcome: 'dropped' }]);
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
  assert.deepEqual(s.sessions, { build: ['b1'], review: ['r1'], resolve: [], fix: [] });
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

// --- the end sequence (single-finisher DESIGN §2.2–§2.10, T03) ----------------------------------

const END = { endSequence: true };
const dE = (s, f = {}) => decideSingleStep(s, f, END);
const BSHA = 'c'.repeat(40);
const BSHA2 = 'd'.repeat(40);
const LOCAL = 'e'.repeat(40);
const OK_BASE = (sha = BSHA) => ({ ok: true, sha, remote: 'origin', localTip: LOCAL, reason: null, text: null });
const FETCH_FAILED = { ok: false, sha: null, remote: 'origin', reason: 'fetch-failed', text: 'cannot reach origin' };
const FIN = (extra = {}) => ({ started: true, phase: 'awaiting-go', goGiven: false, givenUp: false, failed: false, accepted: [], ...extra });

// The reviewer reported at the head the build tested green, and is idle: the sync begins.
function reviewedGreen() {
  const s = dE(reviewing(), { reports: [{ kind: 'reviewed', name: 'fix-typo', body: '' }], renamed: ALL_DONE }).state;
  return dE(s, { checks: PASS, head: H1, idle: true, renamed: ALL_DONE });
}
// In `sync`, the base prepared at BSHA and syncBase asked for.
function merging(from = reviewedGreen().state) {
  return dE(from, { base: OK_BASE() }).state;
}
// In `wait` with the finisher on, the first sync up to date.
function finisherOn() {
  return dE(merging(), { sync: { state: 'up-to-date', baseSha: BSHA, files: [] } }).state;
}
// The `merged` sync's tests run; returns the state with tests in flight.
function syncTesting(from = merging()) {
  return dE(from, { sync: { state: 'merged', baseSha: BSHA, files: [] } }).state;
}
const sGreen = () => ({ kind: 'tests', ok: true, half: null, reason: null, logPath: '/c/sync-tests-2.log', tail: '', head: H2, clean: true });
const sRed = () => ({ kind: 'tests', ok: false, half: 'test', reason: 'test `npm test` exited 1', logPath: '/c/sync-tests-2.log', tail: '', head: H2, clean: true });

test('without endSequence a green review still finishes ready', () => {
  const s = decideSingleStep(reviewing(), { reports: [{ kind: 'reviewed', name: 'fix-typo', body: '' }], renamed: ALL_DONE }).state;
  const r = decideSingleStep(s, { checks: PASS, head: H1, idle: true, renamed: ALL_DONE });
  assert.deepEqual(r.actions.at(-1), { type: 'finish', outcome: 'ready' });
});

test('review accepted head green, idle → close the reviewer, sync, prepareBase start; no finish', () => {
  const r = reviewedGreen();
  assert.deepEqual(r.actions, [{ type: 'closeWhenIdle' }, { type: 'prepareBase', mode: 'start' }]);
  assert.equal(r.state.step, 'sync');
  assert.equal(r.state.outcome, null);
  assert.equal(r.state.end.phase, 'prepare');
  assert.equal(r.state.end.seq, 1);
  assert.equal(r.state.end.tests, 'green');
  assert.equal(r.state.live, false);
});

test('base not ok → hold with the text; before nextTry nothing; at nextTry prepare again; same reason keeps since', () => {
  assert.equal(SYNC_RETRY_MS, 60_000);
  let r = dE(reviewedGreen().state, { base: FETCH_FAILED, now: 1000 });
  assert.deepEqual(r.actions, []);
  assert.deepEqual(r.state.end.hold, { reason: 'fetch-failed', text: 'cannot reach origin', since: 1000, nextTry: 61000 });
  assert.equal(r.state.end.phase, 'prepare');
  r = dE(r.state, { now: 60999 });
  assert.deepEqual(r.actions, []);
  r = dE(r.state, { now: 61000 });
  assert.deepEqual(r.actions, [{ type: 'prepareBase', mode: 'start' }]);
  r = dE(r.state, { base: FETCH_FAILED, now: 61005 });
  assert.equal(r.state.end.hold.since, 1000, 'the same reason is one hold');
  assert.equal(r.state.end.hold.nextTry, 121005);
  r = dE(r.state, { base: { ...FETCH_FAILED, reason: 'diverged', text: 'main has diverged' }, now: 62000 });
  assert.equal(r.state.end.hold.since, 62000, 'a new reason is a new hold');
  r = dE(r.state, { now: 122000 });
  r = dE(r.state, { base: OK_BASE(), now: 122001 });
  assert.equal(r.state.end.hold, null);
  assert.deepEqual(r.actions, [{ type: 'syncBase', baseSha: BSHA }]);
});

test('prepareBase no-base-branch holds like fetch-failed', () => {
  const r = dE(reviewedGreen().state, { base: { ok: false, reason: 'no-base-branch', text: 'no main branch', remote: null }, now: 5 });
  assert.deepEqual(r.actions, []);
  assert.equal(r.state.end.hold.reason, 'no-base-branch');
  assert.equal(r.state.end.hold.text, 'no main branch');
});

test('the base already holds the tip at the sync → finish merged', () => {
  const r = dE(reviewedGreen().state, { base: OK_BASE(), watch: 'merged' });
  assert.deepEqual(r.actions, [{ type: 'finish', outcome: 'merged' }]);
  assert.equal(r.state.outcome, 'merged');
  // While held too: a hand merge seen on the local base ends the run.
  const held = dE(reviewedGreen().state, { base: FETCH_FAILED, now: 1 }).state;
  assert.deepEqual(dE(held, { watch: 'merged', now: 2 }).actions, [{ type: 'finish', outcome: 'merged' }]);
});

test('base ok → syncBase with its sha, localSeen and remote kept', () => {
  const r = dE(reviewedGreen().state, { base: OK_BASE() });
  assert.deepEqual(r.actions, [{ type: 'syncBase', baseSha: BSHA }]);
  assert.equal(r.state.end.phase, 'merge');
  assert.equal(r.state.end.localSeen, LOCAL);
  assert.equal(r.state.end.remote, 'origin');
});

test('up-to-date → wait, tests green, startFinisher, finisher on', () => {
  const r = dE(merging(), { sync: { state: 'up-to-date', baseSha: BSHA, files: [] } });
  assert.deepEqual(r.actions, [{ type: 'startFinisher' }]);
  assert.equal(r.state.step, 'wait');
  assert.equal(r.state.end.tests, 'green');
  assert.equal(r.state.end.finisher, 'on');
  assert.deepEqual(r.state.end.sync, { state: 'up-to-date', baseSha: BSHA, files: [] });
});

test('merged → runTests; green → wait and startFinisher', () => {
  const r1 = dE(merging(), { sync: { state: 'merged', baseSha: BSHA, files: [] } });
  assert.deepEqual(r1.actions, [{ type: 'runTests', head: null }]);
  assert.equal(r1.state.end.phase, 'testing');
  const r2 = dE(r1.state, { commandDone: sGreen() });
  assert.deepEqual(r2.actions, [{ type: 'startFinisher' }]);
  assert.equal(r2.state.step, 'wait');
  assert.equal(r2.state.end.tests, 'green');
});

test('merged → red → spawn fix; fixed accepted → runTests; green → startFinisher', () => {
  let r = dE(syncTesting(), { commandDone: sRed() });
  assert.deepEqual(r.actions, [{ type: 'spawn', step: 'fix' }]);
  assert.equal(r.state.end.phase, 'fixing');
  assert.equal(r.state.end.fixUsed, true);
  assert.deepEqual(r.state.end.testsReason, { reason: 'test `npm test` exited 1', logPath: '/c/sync-tests-2.log' });
  r = dE(r.state, { sessionId: 'fx1' });
  assert.deepEqual(r.state.sessions.fix, ['fx1']);
  r = dE(r.state, { reports: [{ kind: 'fixed', name: 'fix-typo', body: '' }] });
  assert.deepEqual(r.actions, [{ type: 'check', kind: 'fixed', name: 'fix-typo' }]);
  r = dE(r.state, { checks: PASS, head: H2, idle: false });
  assert.deepEqual(r.actions, [], 'the idle gate holds the close');
  r = dE(r.state, { idle: true });
  assert.deepEqual(r.actions, [{ type: 'closeWhenIdle' }, { type: 'runTests', head: null }]);
  r = dE(r.state, { commandDone: sGreen() });
  assert.deepEqual(r.actions, [{ type: 'startFinisher' }]);
  assert.equal(r.state.end.finisher, 'on');
});

test('red after the fix → wait red, no startFinisher, no second fix', () => {
  let r = dE(syncTesting(), { commandDone: sRed() });
  r = dE(r.state, { sessionId: 'fx1' });
  r = dE(r.state, { reports: [{ kind: 'fixed', name: 'fix-typo', body: '' }] });
  r = dE(r.state, { checks: PASS, head: H2, idle: true });
  r = dE(r.state, { commandDone: sRed() });
  assert.deepEqual(r.actions, []);
  assert.equal(r.state.step, 'wait');
  assert.equal(r.state.end.tests, 'red');
  assert.equal(r.state.end.finisher, null);
});

test('a failed fixed check is sent once to the helper', () => {
  let r = dE(syncTesting(), { commandDone: sRed() });
  r = dE(r.state, { sessionId: 'fx1' });
  r = dE(r.state, { reports: [{ kind: 'fixed', name: 'fix-typo', body: '' }] });
  r = dE(r.state, { checks: { ok: false, failures: ['the worktree is not clean'] } });
  assert.deepEqual(types(r.actions), ['send']);
  assert.match(r.actions[0].text, /`fixed` report for pir\/fix-typo/);
  r = dE(r.state, { reports: [{ kind: 'fixed', name: 'fix-typo', body: '' }] });
  r = dE(r.state, { checks: { ok: false, failures: ['the worktree is not clean'] } });
  assert.deepEqual(r.actions, []);
});

test('fix helper exits with no report → the tests run anyway', () => {
  let r = dE(syncTesting(), { commandDone: sRed() });
  r = dE(r.state, { sessionId: 'fx1' });
  r = dE(r.state, { exited: true, live: true });
  assert.deepEqual(r.actions, [{ type: 'runTests', head: null }]);
  assert.equal(r.state.live, false);
});

test('conflict → spawn resolve with the files; resolved accepted → runTests', () => {
  let r = dE(merging(), { sync: { state: 'conflict', baseSha: BSHA, files: ['README.md', 'src/a.js'] } });
  assert.deepEqual(r.actions, [{ type: 'spawn', step: 'resolve' }]);
  assert.deepEqual(r.state.end.sync, { state: 'conflict', baseSha: BSHA, files: ['README.md', 'src/a.js'] });
  assert.equal(r.state.end.phase, 'resolving');
  r = dE(r.state, { sessionId: 'rs1' });
  assert.deepEqual(r.state.sessions.resolve, ['rs1']);
  r = dE(r.state, { reports: [{ kind: 'resolved', name: 'fix-typo', body: '' }] });
  assert.deepEqual(r.actions, [{ type: 'check', kind: 'resolved', name: 'fix-typo' }]);
  r = dE(r.state, { checks: PASS, head: H2, idle: true });
  assert.deepEqual(r.actions, [{ type: 'closeWhenIdle' }, { type: 'runTests', head: null }]);
  assert.equal(r.state.end.sync.state, 'resolved');
});

test('resolve helper exits with syncPending → abortSync, unresolved, wait red', () => {
  let r = dE(merging(), { sync: { state: 'conflict', baseSha: BSHA, files: ['a'] } });
  r = dE(r.state, { sessionId: 'rs1' });
  r = dE(r.state, { exited: true, syncPending: true });
  assert.deepEqual(r.actions, [{ type: 'abortSync' }]);
  assert.equal(r.state.end.sync.state, 'unresolved');
  assert.equal(r.state.step, 'wait');
  assert.equal(r.state.end.tests, 'red');
});

test('resolve helper exits having committed the merge → resolved, tests run', () => {
  let r = dE(merging(), { sync: { state: 'conflict', baseSha: BSHA, files: ['a'] } });
  r = dE(r.state, { sessionId: 'rs1' });
  r = dE(r.state, { exited: true, syncPending: false });
  assert.deepEqual(r.actions, [{ type: 'runTests', head: null }]);
  assert.equal(r.state.end.sync.state, 'resolved');
});

test('sync error → unresolved, wait red, no helper', () => {
  const r = dE(merging(), { sync: { state: 'error', baseSha: BSHA, files: [], error: 'git refused' } });
  assert.deepEqual(r.actions, []);
  assert.equal(r.state.end.sync.state, 'unresolved');
  assert.equal(r.state.step, 'wait');
  assert.equal(r.state.end.tests, 'red');
});

test('a helper dropped, and built/reviewed sent during the sync, are ignored', () => {
  let r = dE(merging(), { sync: { state: 'conflict', baseSha: BSHA, files: ['a'] } });
  r = dE(r.state, { sessionId: 'rs1' });
  const before = r.state;
  for (const kind of ['dropped', 'built', 'reviewed', 'fixed']) {
    const x = dE(before, { reports: [{ kind, name: 'fix-typo', body: 'no' }] });
    assert.deepEqual(x.actions, [], kind);
    assert.equal(x.state.outcome, null, kind);
  }
  // `resolved` while fixing is not the fix helper's kind either.
  let f = dE(syncTesting(), { commandDone: sRed() });
  f = dE(f.state, { sessionId: 'fx1' });
  assert.deepEqual(dE(f.state, { reports: [{ kind: 'resolved', name: 'fix-typo', body: '' }] }).actions, []);
  // A report while pir itself syncs or tests is nobody's.
  assert.deepEqual(dE(syncTesting(), { reports: [{ kind: 'fixed', name: 'fix-typo', body: '' }] }).actions, []);
});

test('wait, finisher on: done → finished; close → closed', () => {
  const s = finisherOn();
  let r = dE(s, { finisher: FIN({ accepted: [{ kind: 'done' }] }) });
  assert.deepEqual(r.actions, [{ type: 'closeFinisher' }, { type: 'finish', outcome: 'finished' }]);
  assert.equal(r.state.outcome, 'finished');
  r = dE(s, { finisher: FIN({ accepted: [{ kind: 'ready' }, { kind: 'close' }] }) });
  assert.deepEqual(r.actions.at(-1), { type: 'finish', outcome: 'closed' });
  assert.deepEqual(dE(s, { finisher: FIN() }).actions, [], 'waiting for the go');
});

test('before go: merged → closeFinisher, finish merged; moved → resyncing, seq + 1, fixUsed reset, prepare', () => {
  const s = finisherOn();
  let r = dE(s, { finisher: FIN(), watch: 'merged' });
  assert.deepEqual(r.actions, [{ type: 'closeFinisher' }, { type: 'finish', outcome: 'merged' }]);
  const used = { ...s, end: { ...s.end, fixUsed: true } };
  r = dE(used, { finisher: FIN(), watch: 'moved' });
  assert.deepEqual(r.actions, [{ type: 'finisherResyncing' }, { type: 'prepareBase', mode: 'start' }]);
  assert.equal(r.state.step, 'sync');
  assert.equal(r.state.end.seq, s.end.seq + 1);
  assert.equal(r.state.end.fixUsed, false);
  assert.equal(r.state.end.finisher, 'on');
});

test('re-sync settles green → finisherResynced; red → closeFinisher, fallback red; a later green never restarts it', () => {
  const moved = dE(finisherOn(), { finisher: FIN(), watch: 'moved' }).state;
  const prepared = dE(moved, { base: OK_BASE(BSHA2), finisher: FIN() }).state;
  const tested = dE(prepared, { sync: { state: 'merged', baseSha: BSHA2, files: [] }, finisher: FIN() }).state;
  let r = dE(tested, { commandDone: sGreen(), finisher: FIN() });
  assert.deepEqual(r.actions, [{ type: 'finisherResynced', baseSha: BSHA2 }]);
  assert.equal(r.state.step, 'wait');

  // Red: the one fix, then red again.
  r = dE(tested, { commandDone: sRed(), finisher: FIN() });
  r = dE(r.state, { sessionId: 'fx1' });
  r = dE(r.state, { exited: true });
  r = dE(r.state, { commandDone: sRed(), finisher: FIN() });
  assert.deepEqual(r.actions, [{ type: 'closeFinisher' }]);
  assert.equal(r.state.end.finisher, 'fallback');
  assert.equal(r.state.end.fallback, 'red');
  assert.equal(r.state.end.tests, 'red');

  // The base moves again and the branch goes green: no second hand-over.
  r = dE(r.state, { watch: 'moved' });
  assert.deepEqual(r.actions, [{ type: 'prepareBase', mode: 'start' }]);
  r = dE(r.state, { base: OK_BASE(BSHA) });
  r = dE(r.state, { sync: { state: 'merged', baseSha: BSHA, files: [] } });
  r = dE(r.state, { commandDone: sGreen() });
  assert.deepEqual(r.actions, []);
  assert.equal(r.state.step, 'wait');
  assert.equal(r.state.end.tests, 'green');
  assert.equal(r.state.end.finisher, 'fallback');
});

test('after go: the watch is ignored; only done or close end the run', () => {
  const s = finisherOn();
  for (const watch of ['merged', 'moved']) {
    assert.deepEqual(dE(s, { finisher: FIN({ goGiven: true, phase: 'finishing' }), watch }).actions, [], watch);
  }
  assert.deepEqual(dE(s, { finisher: FIN({ goGiven: true, accepted: [{ kind: 'done' }] }), watch: 'merged' }).actions.at(-1), {
    type: 'finish', outcome: 'finished',
  });
});

test('givenUp → closeFinisher, fallback gave-up; failed → fallback failed; then merged ends, moved re-syncs and stays in fallback', () => {
  let r = dE(finisherOn(), { finisher: FIN({ givenUp: true }) });
  assert.deepEqual(r.actions, [{ type: 'closeFinisher' }]);
  assert.equal(r.state.end.fallback, 'gave-up');
  assert.equal(r.state.end.finisher, 'fallback');
  const failed = dE(finisherOn(), { finisher: { started: false, failed: true } });
  assert.deepEqual(failed.actions, [], 'nothing to close: it never started');
  assert.equal(failed.state.end.fallback, 'failed');

  assert.deepEqual(dE(r.state, { watch: 'merged' }).actions, [{ type: 'finish', outcome: 'merged' }]);
  r = dE(r.state, { watch: 'moved' });
  assert.deepEqual(r.actions, [{ type: 'prepareBase', mode: 'start' }]);
  r = dE(r.state, { base: OK_BASE(BSHA2) });
  r = dE(r.state, { sync: { state: 'merged', baseSha: BSHA2, files: [] } });
  r = dE(r.state, { commandDone: sGreen() });
  assert.deepEqual(r.actions, []);
  assert.equal(r.state.end.finisher, 'fallback');
});

test('red wait: moved → a new sequence; green → startFinisher (never started before)', () => {
  let r = dE(merging(), { sync: { state: 'error', baseSha: BSHA, files: [] } });
  assert.equal(r.state.end.tests, 'red');
  assert.deepEqual(dE(r.state, {}).actions, [], 'red waits');
  r = dE(r.state, { watch: 'moved' });
  assert.deepEqual(r.actions, [{ type: 'prepareBase', mode: 'start' }]);
  assert.equal(r.state.end.seq, 2);
  r = dE(r.state, { base: OK_BASE(BSHA2) });
  r = dE(r.state, { sync: { state: 'merged', baseSha: BSHA2, files: [] } });
  r = dE(r.state, { commandDone: sGreen() });
  assert.deepEqual(r.actions, [{ type: 'startFinisher' }]);
  assert.equal(r.state.end.finisher, 'on');
});

test('a red wait seeing up-to-date on its re-sync stays red', () => {
  let r = dE(syncTesting(), { commandDone: sRed() });
  r = dE(r.state, { sessionId: 'fx1' });
  r = dE(r.state, { exited: true });
  r = dE(r.state, { commandDone: sRed() });
  r = dE(r.state, { watch: 'moved' });
  r = dE(r.state, { base: OK_BASE() });
  r = dE(r.state, { sync: { state: 'up-to-date', baseSha: BSHA, files: [] } });
  assert.deepEqual(r.actions, []);
  assert.equal(r.state.end.tests, 'red');
});

test('resume in sync: a merge in progress with no helper → abortSync then prepareBase', () => {
  // Crashed while syncBase ran: the merge stopped half way.
  const r = dE(merging(), { resume: true, syncPending: true });
  assert.deepEqual(r.actions, [{ type: 'abortSync' }, { type: 'prepareBase', mode: 'start' }]);
  assert.equal(r.state.end.tests, null, 'a merge that may have landed is tested again');
  // And an up-to-date sync then runs the tests rather than trusting the review's green.
  const r2 = dE(dE(r.state, { base: OK_BASE() }).state, { sync: { state: 'up-to-date', baseSha: BSHA, files: [] } });
  assert.deepEqual(r2.actions, [{ type: 'runTests', head: null }]);
  // Held in prepare: just prepared again.
  const held = dE(reviewedGreen().state, { base: FETCH_FAILED, now: 1 }).state;
  assert.deepEqual(dE(held, { resume: true, now: 2 }).actions, [{ type: 'prepareBase', mode: 'start' }]);
});

test('resume with a helper on record → resumeSession; tests in flight → started again', () => {
  let r = dE(merging(), { sync: { state: 'conflict', baseSha: BSHA, files: ['a'] } });
  r = dE(r.state, { sessionId: 'rs1' });
  let x = dE(r.state, { resume: true, syncPending: true });
  assert.deepEqual(x.actions, [{ type: 'resumeSession', step: 'resolve', sessionId: 'rs1' }]);
  assert.equal(x.state.live, true);

  let f = dE(syncTesting(), { commandDone: sRed() });
  f = dE(f.state, { sessionId: 'fx1' });
  x = dE(f.state, { resume: true });
  assert.deepEqual(x.actions, [{ type: 'resumeSession', step: 'fix', sessionId: 'fx1' }]);

  x = dE(syncTesting(), { resume: true });
  assert.deepEqual(x.actions, [{ type: 'runTests', head: null }]);

  // A resolve helper that never got an id: the merge is abandoned and the sync starts again.
  const noId = dE(merging(), { sync: { state: 'conflict', baseSha: BSHA, files: ['a'] } }).state;
  assert.deepEqual(dE(noId, { resume: true, syncPending: true }).actions, [{ type: 'abortSync' }, { type: 'prepareBase', mode: 'start' }]);
});

test('resume in wait: finisher on → startFinisher; its phase done → finished', () => {
  assert.deepEqual(dE(finisherOn(), { resume: true }).actions, [{ type: 'startFinisher' }]);
  assert.deepEqual(dE(finisherOn(), { resume: true, finisher: { started: false, phase: 'done' } }).actions, [{ type: 'finish', outcome: 'finished' }]);
  // A red wait just watches.
  const redWait = dE(merging(), { sync: { state: 'error', baseSha: BSHA, files: [] } }).state;
  assert.deepEqual(dE(redWait, { resume: true }).actions, []);
  assert.deepEqual(dE(redWait, { resume: true, watch: 'merged' }).actions, [{ type: 'finish', outcome: 'merged' }]);
});

test('right after startFinisher: givenUp → gave-up; phase done → finished; a resume after a merged sync → resynced', () => {
  const started = finisherOn();
  assert.equal(dE(started, { finisher: FIN({ givenUp: true }) }).state.end.fallback, 'gave-up');
  assert.deepEqual(dE(started, { finisher: FIN({ phase: 'done' }) }).actions.at(-1), { type: 'finish', outcome: 'finished' });
  // The last sync merged the base in: the resumed finisher's old steps are void.
  const merged = dE(syncTesting(), { commandDone: sGreen() }).state;
  assert.deepEqual(dE(merged, { resume: true }).actions, [{ type: 'startFinisher' }, { type: 'finisherResynced', baseSha: BSHA }]);
  // A resume mid re-sync whose program holds no finisher: started again, then told.
  const moved = dE(finisherOn(), { finisher: FIN(), watch: 'moved' }).state;
  let r = dE(moved, { resume: true });
  r = dE(r.state, { base: OK_BASE(BSHA2) });
  r = dE(r.state, { sync: { state: 'merged', baseSha: BSHA2, files: [] } });
  r = dE(r.state, { commandDone: sGreen() });
  assert.deepEqual(r.actions, [{ type: 'startFinisher' }, { type: 'finisherResynced', baseSha: BSHA2 }]);
});

test('a finished run returns no actions, whatever its outcome', () => {
  for (const outcome of ['finished', 'merged', 'closed', 'dropped', 'ready']) {
    const s = { ...finisherOn(), outcome };
    assert.deepEqual(dE(s, { resume: true, watch: 'moved', finisher: FIN({ accepted: [{ kind: 'done' }] }) }).actions, [], outcome);
  }
});

test('an old state.json without end, resolve or fix loads with defaults', () => {
  const old = JSON.parse(JSON.stringify(reviewing()));
  delete old.end;
  old.sessions = { build: ['b1'], review: ['r1'], stray: ['x'] };
  const r = dE(old, { renamed: ALL_DONE });
  assert.deepEqual(r.state.sessions, { build: ['b1'], review: ['r1'], resolve: [], fix: [] });
  assert.equal(r.state.end.seq, 0);
  assert.equal(r.state.end.finisher, null);
  // And a legacy finished `ready` stays finished.
  assert.deepEqual(dE({ ...old, outcome: 'ready' }, { resume: true }).actions, []);
});

test('the end state survives JSON and the input is never mutated', () => {
  const s = finisherOn();
  const frozen = JSON.parse(JSON.stringify(s));
  dE(s, { finisher: FIN(), watch: 'moved' });
  assert.deepEqual(s, frozen);
});

test('parseSingleReport: resolved and fixed, each with a name', () => {
  assert.deepEqual(parseSingleReport('[pir:v1 kind=resolved single=fix-typo]\nmerged'), { kind: 'resolved', name: 'fix-typo', body: 'merged' });
  assert.deepEqual(parseSingleReport('[pir:v1 kind=fixed single=fix-typo]'), { kind: 'fixed', name: 'fix-typo', body: '' });
  assert.equal(parseSingleReport('[pir:v1 kind=resolved single=-]'), null);
  assert.equal(parseSingleReport('[pir:v1 kind=fixed single=-]'), null);
});

test('helperInstruction: both roles name the skill, the role, pir single, the reports folder and the base', () => {
  const resolve = helperInstruction({ role: 'resolve', name: 'fix-typo', base: 'main', reportsDir: '/r/reports', files: ['README.md', 'src/a.js'] });
  assert.equal(
    resolve,
    'Load the pir-single skill and run it as the resolve helper of pir/fix-typo. You are run by `pir single`. ' +
      'Reports folder: /r/reports. Base: main.\n' +
      'pir merged main into pir/fix-typo and the merge stopped on a clash in:\n' +
      '  README.md\n  src/a.js\n' +
      'Finish the merge in progress: resolve these files keeping the intent of both sides, commit the merge, and report `resolved`.',
  );
  const fix = helperInstruction({ role: 'fix', name: 'fix-typo', base: 'main', reportsDir: '/r/reports', testsReason: 'test `npm test` exited 1', logPath: '/c/sync-tests-2.log' });
  assert.equal(
    fix,
    'Load the pir-single skill and run it as the fix helper of pir/fix-typo. You are run by `pir single`. ' +
      'Reports folder: /r/reports. Base: main.\n' +
      'pir merged main into pir/fix-typo and the tests failed: test `npm test` exited 1.\n' +
      'Log: /c/sync-tests-2.log\n' +
      'Make the tests pass without undoing the change or the merged main, commit, and report `fixed`. ' +
      'If nothing can be fixed, report `fixed` and say why.',
  );
  assert.doesNotMatch(helperInstruction({ role: 'fix', name: 'x', base: 'main', reportsDir: '/r' }), /Log:/);
  assert.throws(() => helperInstruction({ role: 'build', name: 'x', base: 'main', reportsDir: '/r' }), /'resolve' or 'fix'/);
});

test('singleProgress: the end-sequence cells, and legacy ready unchanged', () => {
  assert.equal(singleProgress({ step: 'sync', phase: 'working' }), 'build ✓ review ✓ sync …');
  assert.equal(singleProgress({ step: 'sync', phase: 'testing' }), 'build ✓ review ✓ sync · tests …');
  assert.equal(singleProgress({ step: 'wait', phase: 'working', tests: 'green' }), 'build ✓ review ✓ sync ✓ merge …');
  assert.equal(singleProgress({ step: 'wait', phase: 'working', tests: 'red' }), 'build ✓ review ✓ sync ✗');
  assert.equal(singleProgress({ step: 'wait', outcome: 'finished' }), 'build ✓ review ✓ sync ✓ merge ✓');
  assert.equal(singleProgress({ step: 'sync', outcome: 'merged' }), 'build ✓ review ✓ sync ✓ merge ✓');
  assert.equal(singleProgress({ step: 'wait', outcome: 'closed' }), 'build ✓ review ✓ sync ✓ merge ✗');
  assert.equal(singleProgress({ step: 'review', outcome: 'ready' }), 'build ✓ review ✓');
  assert.equal(singleProgress({ step: 'review', outcome: 'dropped' }), 'build ✓ review ✗');
});
