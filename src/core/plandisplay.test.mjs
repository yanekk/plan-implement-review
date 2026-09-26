// A planning run's live view model (pir-plan-command T12, DESIGN §2.8, §2.11): the steps, their kinds and
// clocks, the footer and the go question, for every state a planning run can be in.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlanDisplay, widthLine } from './plandisplay.mjs';
import { planRunState } from '../shell/plan-run.mjs';
import { fakePlanFiles } from '../shell/fake/sessions.mjs';

const NOW = 100_000;
const RECORD_UNNAMED = { slug: 'plan-3f2a', label: 'Add dark mode to the bl…', branch: 'pir/plan-3f2a', go: null };
const RECORD = { slug: 'dark-mode', label: null, branch: 'pir/dark-mode', go: null };

// A runState as plan-run.mjs writes it, so the model is tested against the real snapshot shape.
function rs(state, sessions = [], { since = {}, stoppedAt = {}, label = null } = {}) {
  return planRunState({ id: 'plan-3f2a', slug: null, step: 'plan', outcome: null, ...state }, { label, sessions, since, stoppedAt });
}
const session = (step, activity, live = true, n = 1) => ({ id: `${step}-sess-${n}`, step, n, logPath: `/c/conversations/${step}-${n}.ndjson`, live, activity: { state: activity } });
const byId = (d) => Object.fromEntries(d.rows.map((r) => [r.id, r]));

test('planner busy: plan active with a running clock, review and build pending, no footer, no go', () => {
  const d = buildPlanDisplay(rs({}, [session('plan', 'busy')], { since: { plan: 40_000 } }), { now: NOW, record: RECORD_UNNAMED, state: 'running' });
  const r = byId(d);
  assert.deepEqual(d.header, { name: '"Add dark mode to the bl…"', state: 'planning', branch: 'pir/plan-3f2a' });
  assert.deepEqual(r.plan, { id: 'plan', role: 'planner', kind: 'active', text: 'planning', clock: 60_000 });
  assert.deepEqual(r.review, { id: 'review', role: 'reviewer', kind: 'pending', text: 'starts when the plan is written', clock: null });
  assert.deepEqual(r.build, { id: 'build', role: '—', kind: 'pending', text: 'asks your go after review', clock: null });
  assert.equal(d.footer, null);
  assert.equal(d.go, null);
});

test('planner asking a question, and asking for a command: amber row, clock stopped at stoppedAt, footer names the step', () => {
  for (const [activity, text] of [['questions', 'asking you · a question'], ['permission', 'asking you · allow a command?']]) {
    const state = rs({}, [session('plan', activity)], { since: { plan: 40_000 }, stoppedAt: { plan: 70_000 } });
    const early = buildPlanDisplay(state, { now: NOW, record: RECORD_UNNAMED, state: 'running' });
    const late = buildPlanDisplay(state, { now: NOW + 500_000, record: RECORD_UNNAMED, state: 'running' });
    assert.deepEqual(byId(early).plan, { id: 'plan', role: 'planner', kind: 'asking', text, clock: 30_000 }, activity);
    assert.equal(byId(late).plan.clock, 30_000, 'the clock does not run while the step waits on the person');
    assert.deepEqual(early.footer, { kind: 'asking', step: 'plan' });
  }
});

test('planner done and reviewer busy: plan done, review active, header reviewing under the slug', () => {
  const sessions = [session('plan', 'exited', false), session('review', 'busy')];
  const d = buildPlanDisplay(rs({ slug: 'dark-mode', step: 'review' }, sessions, { since: { plan: 1000, review: 90_000 } }), { now: NOW, record: RECORD, state: 'running' });
  const r = byId(d);
  assert.deepEqual(d.header, { name: 'dark-mode', state: 'reviewing', branch: 'pir/dark-mode' });
  assert.equal(r.plan.kind, 'done');
  assert.equal(r.plan.text, 'plan written');
  assert.deepEqual(r.review, { id: 'review', role: 'reviewer', kind: 'active', text: 'reviewing', clock: 10_000 });
  assert.equal(r.build.kind, 'pending');
  assert.equal(d.footer, null);
});

const reviewed = () => rs({ slug: 'dark-mode', step: 'done', outcome: 'reviewed' }, [session('plan', 'exited', false), session('review', 'exited', false)]);

test('reviewed with no go: the go question with the width line of the plan on the branch', () => {
  const progress = fakePlanFiles('dark-mode')['plans/dark-mode/PROGRESS.md'];
  const d = buildPlanDisplay(reviewed(), { now: NOW, record: RECORD, state: 'finished', progress });
  assert.deepEqual(d.go, { slug: 'dark-mode', branch: 'pir/dark-mode', widthLine: '1 task, longest chain 1, up to 1 can run at once.' });
  assert.equal(d.header.state, 'reviewed');
  assert.deepEqual(byId(d).build, { id: 'build', role: '—', kind: 'asking', text: 'waiting for your go', clock: null });
  assert.equal(byId(d).review.kind, 'done');
  assert.equal(d.footer, null);
  // Without the plan's text the question is still asked, without a width line.
  assert.equal(buildPlanDisplay(reviewed(), { now: NOW, record: RECORD, state: 'finished' }).go.widthLine, null);
});

test('declined: no go, finished, build not started, footer says how to build it later', () => {
  const d = buildPlanDisplay(reviewed(), { now: NOW, record: { ...RECORD, go: 'declined' }, state: 'finished' });
  assert.equal(d.go, null);
  assert.equal(d.header.state, 'finished');
  assert.deepEqual(byId(d).build, { id: 'build', role: '—', kind: 'pending', text: 'not started', clock: null });
  assert.deepEqual(d.footer, { kind: 'build-later', slug: 'dark-mode', branch: 'pir/dark-mode' });
});

test('no-plan: plan failed, footer no-plan with the kept branch, no go', () => {
  const d = buildPlanDisplay(rs({ step: 'done', outcome: 'no-plan' }, [session('plan', 'exited', false)]), { now: NOW, record: RECORD_UNNAMED, state: 'finished' });
  assert.deepEqual(byId(d).plan, { id: 'plan', role: 'planner', kind: 'failed', text: 'no plan', clock: null });
  assert.equal(byId(d).review.kind, 'pending');
  assert.equal(byId(d).build.text, 'not started');
  assert.deepEqual(d.footer, { kind: 'no-plan', branch: 'pir/plan-3f2a' });
  assert.equal(d.go, null);
});

test('not-reviewed: review failed, footer not-reviewed, no go', () => {
  const d = buildPlanDisplay(rs({ slug: 'dark-mode', step: 'done', outcome: 'not-reviewed' }, [session('plan', 'exited', false), session('review', 'exited', false)]), {
    now: NOW, record: RECORD, state: 'finished',
  });
  assert.equal(byId(d).plan.kind, 'done');
  assert.deepEqual(byId(d).review, { id: 'review', role: 'reviewer', kind: 'failed', text: 'not reviewed', clock: null });
  assert.deepEqual(d.footer, { kind: 'not-reviewed' });
  assert.equal(d.go, null);
});

test('crashed mid-review (stale): the live-looking step reads crashed without a clock, footer stale', () => {
  // The program died with its snapshot still saying the reviewer was working.
  const state = rs({ slug: 'dark-mode', step: 'review' }, [session('plan', 'exited', false), session('review', 'busy')], { since: { review: 1000 } });
  const d = buildPlanDisplay(state, { now: NOW, record: RECORD, state: 'crashed' });
  assert.equal(d.header.state, 'crashed');
  assert.deepEqual(byId(d).review, { id: 'review', role: 'reviewer', kind: 'failed', text: 'crashed', clock: null });
  assert.deepEqual(d.footer, { kind: 'stale', state: 'crashed' });
  assert.equal(d.go, null);
  const stopped = buildPlanDisplay(state, { now: NOW, record: RECORD, state: 'stopped' });
  assert.equal(byId(stopped).review.text, 'stopped');
  assert.deepEqual(stopped.footer, { kind: 'stale', state: 'stopped' });
});

test('no snapshot yet: the planner is starting', () => {
  const d = buildPlanDisplay(null, { now: NOW, record: RECORD_UNNAMED, state: 'running' });
  assert.deepEqual(byId(d).plan, { id: 'plan', role: 'planner', kind: 'active', text: 'starting the planner…', clock: null });
  assert.equal(d.header.state, 'planning');
  assert.equal(d.go, null);
});

test('widthLine: counts, chain and width from PROGRESS.md; null for nothing readable', () => {
  const text = [
    '# Progress', '', '## Tasks', '', '| # | Task | Depends on | State | Notes |', '|---|---|---|---|---|',
    '| T01 | a | — | ⬜ | |', '| T02 | b | — | ⬜ | |', '| T03 | c | T01, T02 | ⬜ | |', '',
  ].join('\n');
  assert.equal(widthLine(text), '3 tasks, longest chain 2, up to 2 can run at once.');
  assert.equal(widthLine(null), null);
  assert.equal(widthLine('# nothing here\n'), null);
});
