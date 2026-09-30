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
function rs(state, sessions = [], { since = {}, stoppedAt = {}, label = null, took = {} } = {}) {
  return planRunState({ id: 'plan-3f2a', slug: null, step: 'plan', outcome: null, ...state }, { label, sessions, since, stoppedAt, took });
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

// ---- T14 drill fixes. ----

test('a finished step shows how long it took; a step with no recorded time shows none', () => {
  const sessions = [session('plan', 'exited', false), session('review', 'exited', false)];
  const done = rs({ slug: 'dark-mode', step: 'done', outcome: 'reviewed' }, sessions, { took: { plan: 1_872_000, review: 65_000 } });
  const r = byId(buildPlanDisplay(done, { now: NOW, record: RECORD, state: 'finished' }));
  assert.equal(r.plan.clock, 1_872_000);
  assert.equal(r.review.clock, 65_000);
  assert.equal(r.build.clock, null);
  const failed = rs({ step: 'done', outcome: 'no-plan' }, [session('plan', 'exited', false)], { took: { plan: 4000 } });
  assert.equal(byId(buildPlanDisplay(failed, { now: NOW, record: RECORD_UNNAMED, state: 'finished' })).plan.clock, 4000);
  assert.equal(byId(buildPlanDisplay(reviewed(), { now: NOW, record: RECORD, state: 'finished' })).plan.clock, null);
  // A live step's time is its running clock, never a took value.
  const live = rs({}, [session('plan', 'busy')], { since: { plan: 40_000 }, took: { plan: 5 } });
  assert.equal(byId(buildPlanDisplay(live, { now: NOW, record: RECORD_UNNAMED, state: 'running' })).plan.clock, 60_000);
});

test('a step an ended run never reached reads not started, not what it waits on', () => {
  const noPlan = buildPlanDisplay(rs({ step: 'done', outcome: 'no-plan' }, [session('plan', 'exited', false)]), { now: NOW, record: RECORD_UNNAMED, state: 'finished' });
  assert.deepEqual(byId(noPlan).review, { id: 'review', role: 'reviewer', kind: 'pending', text: 'not started', clock: null });
  // A stopped run can still be resumed into it, so its pending review keeps saying what it waits on.
  const stopped = buildPlanDisplay(rs({}, [session('plan', 'exited', false)]), { now: NOW, record: RECORD_UNNAMED, state: 'stopped' });
  assert.equal(byId(stopped).review.text, 'starts when the plan is written');
});

// ---- A single run's steps view (single-runs T10, DESIGN §2.8). ----

import { buildSingleDisplay } from './plandisplay.mjs';
import { initialSingleState } from './singleflow.mjs';
import { singleRunState } from '../shell/single-run.mjs';

const S_UNNAMED = { slug: 'single-ab12', label: 'Fix the typo in the REA…', branch: 'pir/single-ab12', baseBranch: 'main' };
const S_NAMED = { slug: 'fix-typo', label: null, branch: 'pir/fix-typo', baseBranch: 'main' };
const NAMED_STATE = { name: 'fix-typo', step: 'review', renamed: { branch: true, worktree: true, control: true, index: true } };
const HANDOFF = 'git switch main && git merge pir/fix-typo';

// A runState as single-run.mjs writes it. `idle` is a session stopped with no job of its own running.
function srs(over = {}, sessions = [], extra = {}) {
  const st = { ...initialSingleState({ id: 'single-ab12', base: 'main', baseSha: 'abc1234def', commands: { setup: [], test: ['npm test'] } }), step: 'build', ...over };
  return singleRunState(st, { label: st.name ? null : S_UNNAMED.label, sessions, ...extra });
}
const sSess = (step, activity, live = true) => ({ id: `${step}-sess`, step, n: 1, logPath: `/c/conversations/${step}-1.ndjson`, live, activity: { state: activity, background: [] } });

test('single: the builder at work — build active with its clock, review waits on build, merge waits on review', () => {
  const d = buildSingleDisplay(srs({}, [sSess('build', 'busy')], { since: { build: 40_000 } }), { now: NOW, record: S_UNNAMED, state: 'running' });
  const r = byId(d);
  assert.deepEqual(d.header, { name: '"Fix the typo in the REA…"', state: 'building', branch: 'pir/single-ab12' });
  assert.deepEqual(r.build, { id: 'build', role: 'builder', kind: 'active', text: 'building', clock: 60_000 });
  assert.deepEqual(r.review, { id: 'review', role: 'reviewer', kind: 'pending', text: 'waits on build', clock: null });
  assert.deepEqual(r.merge, { id: 'merge', role: '—', kind: 'pending', text: 'waits on review', clock: null });
  assert.equal(d.footer, null);
});

test('single: no snapshot yet — the builder is starting', () => {
  const d = buildSingleDisplay(null, { now: NOW, record: S_UNNAMED, state: 'running' });
  assert.deepEqual(d.header, { name: '"Fix the typo in the REA…"', state: 'building', branch: 'pir/single-ab12' });
  assert.deepEqual(byId(d).build, { id: 'build', role: 'builder', kind: 'active', text: 'starting the builder…', clock: null });
  assert.equal(byId(d).review.text, 'waits on build');
});

test('single: pir\'s tests running — the step reads testing… with the test run\'s clock, never asking', () => {
  const held = { running: 'tests', accepted: { kind: 'built', name: 'fix-typo', head: 'h1' } };
  const d = buildSingleDisplay(srs(held, [sSess('build', 'idle')], { since: { build: 10_000 }, running: { kind: 'tests', since: 95_000 } }), { now: NOW, record: S_UNNAMED, state: 'running' });
  assert.equal(d.header.state, 'testing');
  assert.deepEqual(byId(d).build, { id: 'build', role: 'builder', kind: 'active', text: 'testing…', clock: 5_000 });
  assert.equal(d.footer, null, 'a session idle on pir\'s tests asks nothing');
  // The baseline after a first red is a test run too.
  const base = buildSingleDisplay(srs({ running: 'baseline', rounds: { build: 1, review: 0 } }, [sSess('build', 'idle')], { running: { kind: 'baseline', since: 98_000 } }), { now: NOW, record: S_UNNAMED, state: 'running' });
  assert.deepEqual([byId(base).build.text, byId(base).build.clock], ['testing…', 2_000]);
});

test('single: a red round — the step back at work reads tests red · round n, in either step', () => {
  const b = buildSingleDisplay(srs({ rounds: { build: 2, review: 0 } }, [sSess('build', 'busy')], { since: { build: 40_000 } }), { now: NOW, record: S_UNNAMED, state: 'running' });
  assert.deepEqual(byId(b).build, { id: 'build', role: 'builder', kind: 'active', text: 'tests red · round 2', clock: 60_000 });
  assert.equal(b.header.state, 'building');
  const sessions = [sSess('build', 'exited', false), sSess('review', 'busy')];
  const r = buildSingleDisplay(srs({ ...NAMED_STATE, rounds: { build: 2, review: 1 } }, sessions, { since: { review: 90_000 }, took: { build: 30_000 } }), { now: NOW, record: S_NAMED, state: 'running' });
  assert.deepEqual(byId(r).build, { id: 'build', role: 'builder', kind: 'done', text: 'built', clock: 30_000 }, 'a done step shows how long it took, not its red rounds');
  assert.deepEqual(byId(r).review, { id: 'review', role: 'reviewer', kind: 'active', text: 'tests red · round 1', clock: 10_000 });
  assert.deepEqual(r.header, { name: 'fix-typo', state: 'reviewing', branch: 'pir/fix-typo' });
  assert.equal(byId(r).merge.text, 'waits on review');
});

test('single: a step asking — amber row, clock stopped at stoppedAt, the footer names the step, the header keeps the step', () => {
  for (const [activity, text] of [['questions', 'asking you · a question'], ['permission', 'asking you · allow a command?'], ['idle', 'asking you · a question']]) {
    const state = srs({}, [sSess('build', activity)], { since: { build: 40_000 }, stoppedAt: { build: 70_000 } });
    const early = buildSingleDisplay(state, { now: NOW, record: S_UNNAMED, state: 'running' });
    const late = buildSingleDisplay(state, { now: NOW + 500_000, record: S_UNNAMED, state: 'running' });
    assert.deepEqual(byId(early).build, { id: 'build', role: 'builder', kind: 'asking', text, clock: 30_000 }, activity);
    assert.equal(byId(late).build.clock, 30_000);
    assert.deepEqual(early.footer, { kind: 'asking', step: 'build' });
    assert.equal(early.header.state, 'building');
  }
  // Past the red limit the session stops and asks: asking outranks the red round's text.
  const past = buildSingleDisplay(srs({ rounds: { build: 4, review: 0 } }, [sSess('build', 'idle')]), { now: NOW, record: S_UNNAMED, state: 'running' });
  assert.equal(byId(past).build.text, 'asking you · a question');
});

const readyState = () => srs({ ...NAMED_STATE, outcome: 'ready' }, [sSess('build', 'exited', false), sSess('review', 'exited', false)], { took: { build: 30_000, review: 12_000 } });

test('single: ready — both steps done with their times, the merge row is the hand-off line with the base, the footer repeats it', () => {
  const d = buildSingleDisplay(readyState(), { now: NOW, record: S_NAMED, state: 'finished', merged: false });
  const r = byId(d);
  assert.deepEqual(d.header, { name: 'fix-typo', state: 'ready to merge', branch: 'pir/fix-typo' });
  assert.deepEqual(r.build, { id: 'build', role: 'builder', kind: 'done', text: 'built', clock: 30_000 });
  assert.deepEqual(r.review, { id: 'review', role: 'reviewer', kind: 'done', text: 'reviewed', clock: 12_000 });
  assert.deepEqual(r.merge, { id: 'merge', role: '—', kind: 'asking', text: HANDOFF, clock: null });
  assert.deepEqual(d.footer, { kind: 'ready', line: HANDOFF });
  // The base is the run's own, from the snapshot, else the record.
  const dev = buildSingleDisplay({ ...readyState(), base: 'dev' }, { now: NOW, record: S_NAMED, state: 'finished' });
  assert.equal(byId(dev).merge.text, 'git switch dev && git merge pir/fix-typo');
  const fromRecord = buildSingleDisplay({ ...readyState(), base: null }, { now: NOW, record: { ...S_NAMED, baseBranch: 'stage' }, state: 'finished' });
  assert.equal(byId(fromRecord).merge.text, 'git switch stage && git merge pir/fix-typo');
});

test('single: merged — the merge row reads merged, no footer', () => {
  const d = buildSingleDisplay(readyState(), { now: NOW, record: S_NAMED, state: 'finished', merged: true });
  assert.equal(d.header.state, 'merged');
  assert.deepEqual(byId(d).merge, { id: 'merge', role: '—', kind: 'done', text: 'merged', clock: null });
  assert.equal(d.footer, null);
});

test('single: dropped — the step it ended in reads dropped, the rest not started, the footer carries the first line of the report body', () => {
  const inBuild = buildSingleDisplay(srs({ outcome: 'dropped' }, [sSess('build', 'exited', false)], { took: { build: 9_000 } }), {
    now: NOW,
    record: S_UNNAMED,
    state: 'finished',
    dropped: '\nToo big for a single run: use /plan.\nIt touches six files.',
  });
  const r = byId(inBuild);
  assert.equal(inBuild.header.state, 'finished');
  assert.deepEqual(r.build, { id: 'build', role: 'builder', kind: 'failed', text: 'dropped', clock: 9_000 });
  assert.deepEqual([r.review.kind, r.review.text], ['pending', 'not started']);
  assert.deepEqual([r.merge.kind, r.merge.text], ['pending', 'not started']);
  assert.deepEqual(inBuild.footer, { kind: 'dropped', reason: 'Too big for a single run: use /plan.' });

  const inReview = buildSingleDisplay(srs({ ...NAMED_STATE, outcome: 'dropped' }, [sSess('build', 'exited', false), sSess('review', 'exited', false)]), { now: NOW, record: S_NAMED, state: 'finished' });
  assert.deepEqual([byId(inReview).build.text, byId(inReview).review.text, byId(inReview).merge.text], ['built', 'dropped', 'not started']);
  assert.deepEqual(inReview.footer, { kind: 'dropped', reason: null }, 'a body the shell could not read');
  // Merged is never read off a dropped run.
  assert.equal(buildSingleDisplay(srs({ outcome: 'dropped' }), { now: NOW, record: S_UNNAMED, state: 'finished', merged: true }).header.state, 'finished');
});

test('single: stopped or crashed (stale) — the live-looking step names how the run ended, without a clock', () => {
  for (const state of ['stopped', 'crashed']) {
    const testing = srs({ running: 'tests', accepted: { kind: 'built', name: 'x', head: 'h' } }, [sSess('build', 'idle')], { since: { build: 1000 }, running: { kind: 'tests', since: 2000 } });
    const d = buildSingleDisplay(testing, { now: NOW, record: S_UNNAMED, state });
    assert.equal(d.header.state, state);
    assert.deepEqual(byId(d).build, { id: 'build', role: 'builder', kind: 'failed', text: state, clock: null });
    assert.equal(byId(d).review.text, 'waits on build');
    assert.deepEqual(d.footer, { kind: 'stale', state });
    const inReview = buildSingleDisplay(srs(NAMED_STATE, [sSess('review', 'questions')]), { now: NOW, record: S_NAMED, state });
    assert.deepEqual([byId(inReview).build.kind, byId(inReview).review.kind, byId(inReview).review.text], ['done', 'failed', state]);
  }
  // Finished with no snapshot to say how: stale, and nothing to merge is claimed.
  const bare = buildSingleDisplay(null, { now: NOW, record: S_UNNAMED, state: 'finished' });
  assert.deepEqual(bare.footer, { kind: 'stale', state: 'finished' });
  assert.equal(byId(bare).merge.text, 'waits on review');
});
