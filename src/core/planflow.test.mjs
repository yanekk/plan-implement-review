import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RUN_ID_RE,
  isValidSlug,
  runIdFrom,
  planSessionName,
  plannerInstruction,
  reviewerInstruction,
  resumeInstruction,
  parsePlanReport,
  initialPlanState,
  decidePlanStep,
} from './planflow.mjs';

const ALL_DONE = { branch: true, worktree: true, control: true, index: true };
const NONE_DONE = { branch: false, worktree: false, control: false, index: false };
const OK = { ok: true, reason: null };
const types = (actions) => actions.map((a) => a.type);

// A run with the planner spawned and its session id recorded.
function planning() {
  const first = decidePlanStep(initialPlanState({ id: 'plan-3f9a' }), { activity: 'none' });
  return decidePlanStep(first.state, { activity: 'busy', sessionId: 'sess-p1' }).state;
}

// A run past the rename with the reviewer spawned and its id recorded.
function reviewing() {
  let s = planning();
  s = decidePlanStep(s, { reports: [{ kind: 'planned', plan: 'screen-time' }], activity: 'idle', checks: OK, renamed: NONE_DONE }).state;
  return decidePlanStep(s, { activity: 'busy', sessionId: 'sess-r1', renamed: ALL_DONE }).state;
}

// --- slugs, ids, names --------------------------------------------------------------------------

test('isValidSlug: kebab accepted', () => {
  for (const s of ['screen-time', 'a', 'v2', 'plan', 'plan-3f9', 'plan-3f9ab', 'plan-xyzw', 'a-b-c']) {
    assert.equal(isValidSlug(s), true, s);
  }
});

test('isValidSlug: uppercase, spaces, leading or trailing dash, empty, run id rejected', () => {
  for (const s of ['Screen-time', 'screen time', '-screen', 'screen-', 'a--b', '', 'plan-3f9a', null, undefined, 7]) {
    assert.equal(isValidSlug(s), false, String(s));
  }
});

test('runIdFrom builds a RUN_ID_RE id and throws on anything but four hex', () => {
  assert.equal(runIdFrom('3f9a'), 'plan-3f9a');
  assert.match(runIdFrom('0000'), RUN_ID_RE);
  for (const bad of ['3f9', '3f9ab', '3F9A', 'zzzz', '', null]) {
    assert.throws(() => runIdFrom(bad), /four lowercase hex/, String(bad));
  }
});

test('planSessionName: planner and reviewer', () => {
  assert.equal(planSessionName({ repo: 'app', plan: 'plan-3f9a', step: 'plan' }), 'app / plan-3f9a / plan / planner');
  assert.equal(planSessionName({ repo: 'app', plan: 'screen-time', step: 'review' }), 'app / screen-time / plan / reviewer');
  assert.throws(() => planSessionName({ repo: 'app', plan: 'x', step: 'build' }));
});

// --- reports ------------------------------------------------------------------------------------

test('parsePlanReport: each of the four kinds', () => {
  assert.deepEqual(parsePlanReport('[pir:v1 kind=planned plan=screen-time]\nthe plan is committed'), { kind: 'planned', plan: 'screen-time' });
  assert.deepEqual(parsePlanReport('[pir:v1 kind=no-plan plan=-]\ncalled off'), { kind: 'no-plan', plan: null });
  assert.deepEqual(parsePlanReport('[pir:v1 kind=reviewed plan=screen-time]'), { kind: 'reviewed', plan: 'screen-time' });
  assert.deepEqual(parsePlanReport('[pir:v1 kind=not-reviewed plan=screen-time]\r\nbody'), { kind: 'not-reviewed', plan: 'screen-time' });
});

test('parsePlanReport: plan=- on a kind that must name a plan is null', () => {
  assert.equal(parsePlanReport('[pir:v1 kind=planned plan=-]'), null);
});

test('parsePlanReport: garbage, a missing header, a worker header and prose kinds are null', () => {
  for (const t of [
    '',
    'done',
    'kind=planned plan=screen-time',
    'I have planned it. kind: planned',
    '[pir:v1 kind=done task=T05]',
    '[pir:v1 kind=planned]',
    '[pir:v1 kind=bogus plan=x]',
    'hello\n[pir:v1 kind=planned plan=x]',
    null,
  ]) {
    assert.equal(parsePlanReport(t), null, String(t));
  }
});

// --- instructions -------------------------------------------------------------------------------

test('plannerInstruction matches DESIGN §2.3, brief with blank lines kept', () => {
  const brief = 'A daily screen budget.\n\nWarn at ten minutes left.\n';
  assert.equal(
    plannerInstruction({ reportsDir: '/r/plans/plan-3f9a/.parallel/plan/reports', brief }),
    'Load the pir-plan skill and run it. You are run by `pir plan`: follow its "Run by pir plan" section. ' +
      'Reports folder: /r/plans/plan-3f9a/.parallel/plan/reports\n' +
      'Brief:\n' +
      '\n' +
      'A daily screen budget.\n\nWarn at ten minutes left.\n',
  );
});

test('reviewerInstruction matches DESIGN §2.3', () => {
  assert.equal(
    reviewerInstruction({ reportsDir: '/r/plans/screen-time/.parallel/plan/reports', slug: 'screen-time' }),
    'Load the pir-review-plan skill and run it on plan screen-time. You are run by `pir plan`: follow its ' +
      '"Run by pir plan" section. Reports folder: /r/plans/screen-time/.parallel/plan/reports',
  );
});

// The design's block, its line wraps read as layout: one paragraph (user, T14 drill).
test('resumeInstruction matches DESIGN §2.14 as one paragraph', () => {
  assert.equal(
    resumeInstruction(),
    [
      'You were stopped and have been resumed in the same worktree. Whatever you were doing when you stopped',
      'may not have finished: check `git status` and the plan files, tell the person where things stand, and',
      'carry on. Any question you had open was lost, so ask it again.',
    ].join(' '),
  );
  assert.ok(!resumeInstruction().includes('\n'));
});

// --- state and the planner step -----------------------------------------------------------------

test('initialPlanState is the §3.5 shape at step plan with no slug', () => {
  const s = initialPlanState({ id: 'plan-3f9a' });
  assert.equal(s.version, 1);
  assert.equal(s.id, 'plan-3f9a');
  assert.equal(s.slug, null);
  assert.equal(s.step, 'plan');
  assert.deepEqual(s.sessions, { plan: [], review: [] });
  assert.equal(s.outcome, null);
  assert.deepEqual(s.renamed, NONE_DONE);
});

test('first decide on a fresh state spawns the planner, no resume id', () => {
  const { state, actions } = decidePlanStep(initialPlanState({ id: 'plan-3f9a' }), { activity: 'none' });
  assert.deepEqual(actions, [{ type: 'spawn', step: 'plan' }]);
  assert.equal(state.live, true);
  // A second call with no news does nothing more.
  assert.deepEqual(decidePlanStep(state, { activity: 'starting' }).actions, []);
});

test('the session id the shell learns is recorded once', () => {
  const s = planning();
  assert.deepEqual(s.sessions.plan, ['sess-p1']);
  assert.deepEqual(decidePlanStep(s, { activity: 'busy', sessionId: 'sess-p1' }).state.sessions.plan, ['sess-p1']);
});

test('decidePlanStep does not mutate the state it is given', () => {
  const s = planning();
  const before = JSON.stringify(s);
  decidePlanStep(s, { reports: [{ kind: 'planned', plan: 'screen-time' }], activity: 'idle', checks: OK });
  assert.equal(JSON.stringify(s), before);
});

test('planned with checks ok while busy: no close yet; then idle: close and rename sub-steps in order', () => {
  const busy = decidePlanStep(planning(), { reports: [{ kind: 'planned', plan: 'screen-time' }], activity: 'busy', checks: OK });
  assert.deepEqual(busy.actions, []);
  assert.equal(busy.state.step, 'plan');

  // Still asking the person is not idle either.
  for (const activity of ['permission', 'questions', 'starting']) {
    assert.deepEqual(decidePlanStep(busy.state, { activity }).actions, [], activity);
  }

  const idle = decidePlanStep(busy.state, { activity: 'idle', renamed: NONE_DONE });
  assert.deepEqual(idle.actions, [
    { type: 'close' },
    { type: 'rename', substep: 'branch' },
    { type: 'rename', substep: 'worktree' },
    { type: 'rename', substep: 'control' },
    { type: 'rename', substep: 'index' },
    { type: 'spawn', step: 'review' },
  ]);
  assert.equal(idle.state.slug, 'screen-time');
  assert.equal(idle.state.step, 'review');
  assert.deepEqual(idle.state.renamed, ALL_DONE);
});

test('planned with checks ok while already idle closes in the same call', () => {
  const { actions } = decidePlanStep(planning(), { reports: [{ kind: 'planned', plan: 'screen-time' }], activity: 'idle', checks: OK });
  assert.deepEqual(types(actions), ['close', 'rename', 'rename', 'rename', 'rename', 'spawn']);
});

test('planned with a failed check: one send naming the reason; state stays in plan', () => {
  const reason = "the name 'screen-time' is taken: branch pir/screen-time exists. Choose another with the person, rename the folder, commit, report again.";
  const { state, actions } = decidePlanStep(planning(), {
    reports: [{ kind: 'planned', plan: 'screen-time' }],
    activity: 'idle',
    checks: { ok: false, reason },
  });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, 'send');
  assert.ok(actions[0].text.includes(reason));
  assert.ok(actions[0].text.includes('planned'));
  assert.equal(state.step, 'plan');
  assert.equal(state.slug, null);
  assert.equal(state.accepted, null);
});

test('the same failed report seen twice: one send, not two; a new reason is sent', () => {
  const failed = { reports: [{ kind: 'planned', plan: 'screen-time' }], activity: 'idle', checks: { ok: false, reason: 'the worktree is dirty' } };
  const one = decidePlanStep(planning(), failed);
  const two = decidePlanStep(one.state, failed);
  assert.deepEqual(types(one.actions), ['send']);
  assert.deepEqual(two.actions, []);

  const three = decidePlanStep(two.state, { ...failed, checks: { ok: false, reason: 'PLAN.md is missing' } });
  assert.deepEqual(types(three.actions), ['send']);
});

test('a failed report followed by a passing one is accepted', () => {
  const failed = decidePlanStep(planning(), { reports: [{ kind: 'planned', plan: 'screen-time' }], activity: 'busy', checks: { ok: false, reason: 'dirty' } });
  const passed = decidePlanStep(failed.state, { reports: [{ kind: 'planned', plan: 'screen-time' }], activity: 'idle', checks: OK, renamed: NONE_DONE });
  assert.equal(passed.actions[0].type, 'close');
  assert.equal(passed.state.step, 'review');
});

test('a failed re-report supersedes an earlier accepted one: no close on idle', () => {
  const accepted = decidePlanStep(planning(), { reports: [{ kind: 'planned', plan: 'screen-time' }], activity: 'busy', checks: OK });
  const failed = decidePlanStep(accepted.state, { reports: [{ kind: 'planned', plan: 'screen-budget' }], activity: 'busy', checks: { ok: false, reason: 'the worktree is dirty' } });
  assert.deepEqual(types(failed.actions), ['send']);
  assert.equal(failed.state.accepted, null);
  const idle = decidePlanStep(failed.state, { activity: 'idle', renamed: NONE_DONE });
  assert.deepEqual(idle.actions, []);
  assert.equal(idle.state.step, 'plan');
});

test('a planned report without checks is a caller bug', () => {
  assert.throws(() => decidePlanStep(planning(), { reports: [{ kind: 'planned', plan: 'x' }], activity: 'idle', checks: null }), /checks/);
});

test('no-plan: close, finish no-plan', () => {
  const { state, actions } = decidePlanStep(planning(), { reports: [{ kind: 'no-plan', plan: null }], activity: 'busy' });
  assert.deepEqual(actions, [{ type: 'close' }, { type: 'finish', outcome: 'no-plan' }]);
  assert.equal(state.step, 'done');
  assert.equal(state.outcome, 'no-plan');
});

test('a review report during planning is ignored', () => {
  const { state, actions } = decidePlanStep(planning(), { reports: [{ kind: 'not-reviewed', plan: 'screen-time' }], activity: 'idle' });
  assert.deepEqual(actions, []);
  assert.equal(state.step, 'plan');
});

test('planner exited with no report: exitCrashed', () => {
  const { actions } = decidePlanStep(planning(), { activity: 'exited' });
  assert.deepEqual(actions, [{ type: 'exitCrashed' }]);
});

test('planner exited after a failed report: exitCrashed', () => {
  const s = decidePlanStep(planning(), { reports: [{ kind: 'planned', plan: 'x' }], activity: 'busy', checks: { ok: false, reason: 'dirty' } }).state;
  assert.deepEqual(decidePlanStep(s, { activity: 'exited' }).actions, [{ type: 'exitCrashed' }]);
});

test('planner exited after an accepted report still proceeds', () => {
  const s = decidePlanStep(planning(), { reports: [{ kind: 'planned', plan: 'screen-time' }], activity: 'busy', checks: OK }).state;
  const { actions } = decidePlanStep(s, { activity: 'exited', renamed: NONE_DONE });
  assert.deepEqual(types(actions), ['close', 'rename', 'rename', 'rename', 'rename', 'spawn']);
});

// --- the rename ---------------------------------------------------------------------------------

test('rename with some sub-steps done: only the missing ones, then spawn reviewer', () => {
  const s = { ...planning(), step: 'rename', slug: 'screen-time', live: false };
  const { state, actions } = decidePlanStep(s, { activity: 'none', renamed: { branch: true, worktree: true, control: false, index: false } });
  assert.deepEqual(actions, [
    { type: 'rename', substep: 'control' },
    { type: 'rename', substep: 'index' },
    { type: 'spawn', step: 'review' },
  ]);
  assert.equal(state.step, 'review');
});

test('rename after the planner closes skips sub-steps already on disk', () => {
  const s = decidePlanStep(planning(), { reports: [{ kind: 'planned', plan: 'screen-time' }], activity: 'busy', checks: OK }).state;
  const { actions } = decidePlanStep(s, { activity: 'idle', renamed: { branch: true, worktree: false, control: false, index: false } });
  assert.deepEqual(actions.map((a) => a.substep ?? a.type), ['close', 'worktree', 'control', 'index', 'spawn']);
});

// --- the review step ----------------------------------------------------------------------------

test('reviewed ok: close when not busy, finish reviewed', () => {
  const busy = decidePlanStep(reviewing(), { reports: [{ kind: 'reviewed', plan: 'screen-time' }], activity: 'busy', checks: OK, renamed: ALL_DONE });
  assert.deepEqual(busy.actions, []);
  const idle = decidePlanStep(busy.state, { activity: 'idle', renamed: ALL_DONE });
  assert.deepEqual(idle.actions, [{ type: 'close' }, { type: 'finish', outcome: 'reviewed' }]);
  assert.equal(idle.state.step, 'done');
  assert.equal(idle.state.outcome, 'reviewed');
});

test('reviewed with a failed check: send', () => {
  const { state, actions } = decidePlanStep(reviewing(), {
    reports: [{ kind: 'reviewed', plan: 'screen-time' }],
    activity: 'idle',
    checks: { ok: false, reason: 'PROGRESS.md does not read reviewed' },
  });
  assert.deepEqual(types(actions), ['send']);
  assert.ok(actions[0].text.includes('PROGRESS.md does not read reviewed'));
  assert.equal(state.step, 'review');
});

test('not-reviewed: close, finish not-reviewed', () => {
  const { state, actions } = decidePlanStep(reviewing(), { reports: [{ kind: 'not-reviewed', plan: 'screen-time' }], activity: 'idle' });
  assert.deepEqual(actions, [{ type: 'close' }, { type: 'finish', outcome: 'not-reviewed' }]);
  assert.equal(state.outcome, 'not-reviewed');
});

test('a report whose plan= differs from the renamed slug during review is ignored', () => {
  for (const kind of ['reviewed', 'not-reviewed']) {
    const { state, actions } = decidePlanStep(reviewing(), { reports: [{ kind, plan: 'other-plan' }], activity: 'idle', checks: OK });
    assert.deepEqual(actions, [], kind);
    assert.equal(state.step, 'review');
    assert.equal(state.accepted, null);
  }
});

test('reviewer exited with no report: exitCrashed', () => {
  assert.deepEqual(decidePlanStep(reviewing(), { activity: 'exited', renamed: ALL_DONE }).actions, [{ type: 'exitCrashed' }]);
});

// --- resume -------------------------------------------------------------------------------------

const resumed = (step, id) => [
  { type: 'spawn', step, resumeSessionId: id },
  { type: 'send', text: resumeInstruction() },
];

test('resume in plan: spawns the planner with its last session id, then the resume message', () => {
  const s = { ...planning(), sessions: { plan: ['sess-p0', 'sess-p1'], review: [] } };
  const { state, actions } = decidePlanStep(s, { resume: true, activity: 'none' });
  assert.deepEqual(actions, resumed('plan', 'sess-p1'));
  assert.equal(state.step, 'plan');
  // The resumed session keeps its id, so recording it again does not add a second entry.
  assert.deepEqual(decidePlanStep(state, { activity: 'busy', sessionId: 'sess-p1' }).state.sessions.plan, ['sess-p0', 'sess-p1']);
});

test('resume in plan before any session id was recorded spawns fresh', () => {
  const s = { ...initialPlanState({ id: 'plan-3f9a' }), live: true };
  assert.deepEqual(decidePlanStep(s, { resume: true, activity: 'none' }).actions, [{ type: 'spawn', step: 'plan' }]);
});

test('resume in plan forgets an accepted report the planner may not have committed', () => {
  const s = decidePlanStep(planning(), { reports: [{ kind: 'planned', plan: 'screen-time' }], activity: 'busy', checks: OK }).state;
  const { state, actions } = decidePlanStep(s, { resume: true, activity: 'none' });
  assert.deepEqual(actions, resumed('plan', 'sess-p1'));
  assert.equal(state.accepted, null);
});

test('resume in review: spawns the reviewer with its last session id, then the resume message', () => {
  const { state, actions } = decidePlanStep(reviewing(), { resume: true, activity: 'none', renamed: ALL_DONE });
  assert.deepEqual(actions, resumed('review', 'sess-r1'));
  assert.equal(state.step, 'review');
});

test('resume in a half-done rename: the missing sub-steps, then the reviewer fresh', () => {
  const s = { ...planning(), step: 'rename', slug: 'screen-time' };
  const { state, actions } = decidePlanStep(s, { resume: true, activity: 'none', renamed: { branch: true, worktree: false, control: false, index: false } });
  assert.deepEqual(actions, [
    { type: 'rename', substep: 'worktree' },
    { type: 'rename', substep: 'control' },
    { type: 'rename', substep: 'index' },
    { type: 'spawn', step: 'review' },
  ]);
  assert.equal(state.step, 'review');
});

test('resume in review with the rename not all on disk finishes the rename first', () => {
  const s = { ...planning(), step: 'review', slug: 'screen-time' };
  const { actions } = decidePlanStep(s, { resume: true, activity: 'none', renamed: { branch: true, worktree: true, control: true, index: false } });
  assert.deepEqual(actions, [{ type: 'rename', substep: 'index' }, { type: 'spawn', step: 'review' }]);
});

test('resume after not-reviewed reopens the reviewer conversation', () => {
  const done = decidePlanStep(reviewing(), { reports: [{ kind: 'not-reviewed', plan: 'screen-time' }], activity: 'idle' }).state;
  // Without --resume a finished run does nothing.
  assert.deepEqual(decidePlanStep(done, { activity: 'none' }).actions, []);
  const { state, actions } = decidePlanStep(done, { resume: true, activity: 'none', renamed: ALL_DONE });
  assert.deepEqual(actions, resumed('review', 'sess-r1'));
  assert.equal(state.step, 'review');
  assert.equal(state.outcome, null);
});

test('a finished reviewed or no-plan state yields no actions, even on resume', () => {
  const reviewed = decidePlanStep(
    decidePlanStep(reviewing(), { reports: [{ kind: 'reviewed', plan: 'screen-time' }], activity: 'idle', checks: OK, renamed: ALL_DONE }).state,
    { activity: 'idle' },
  ).state;
  assert.equal(reviewed.outcome, 'reviewed');
  const noPlan = decidePlanStep(planning(), { reports: [{ kind: 'no-plan', plan: null }], activity: 'idle' }).state;
  for (const s of [reviewed, noPlan]) {
    assert.deepEqual(decidePlanStep(s, { resume: true, activity: 'none', renamed: ALL_DONE }).actions, []);
    assert.deepEqual(decidePlanStep(s, { activity: 'idle' }).actions, []);
  }
});

test('a report dropped before a crash is acted on after the resume', () => {
  const { actions } = decidePlanStep(planning(), { resume: true, activity: 'none', reports: [{ kind: 'no-plan', plan: null }] });
  assert.deepEqual(actions, [...resumed('plan', 'sess-p1'), { type: 'close' }, { type: 'finish', outcome: 'no-plan' }]);
});
