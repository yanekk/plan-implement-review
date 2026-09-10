import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coordinatorName, workerName, parseAgentName, isWorkerOf } from './naming.mjs';

test('coordinatorName builds the {repo} · {plan} form, no @ prefix (§2.8)', () => {
  assert.equal(
    coordinatorName({ repo: 'plan-implement-review', plan: 'parallel-pir' }),
    'plan-implement-review · parallel-pir',
  );
});

test('workerName builds the {repo} · {plan} · T{nn} form, no @ prefix (§2.8)', () => {
  assert.equal(
    workerName({ repo: 'plan-implement-review', plan: 'parallel-pir', task: 'T05' }),
    'plan-implement-review · parallel-pir · T05',
  );
});

test('the built names carry neither "/" nor a leading "@" — both rejected by SendMessage (T00, T07)', () => {
  const c = coordinatorName({ repo: 'r', plan: 'p' });
  const w = workerName({ repo: 'r', plan: 'p', task: 'T01' });
  assert.ok(!c.includes('/') && !w.includes('/'), 'no "/"');
  assert.ok(!c.startsWith('@') && !w.startsWith('@'), 'no leading "@"');
});

test('parseAgentName round-trips a coordinator name to task: null', () => {
  const name = coordinatorName({ repo: 'plan-implement-review', plan: 'parallel-pir' });
  assert.deepEqual(parseAgentName(name), {
    repo: 'plan-implement-review',
    plan: 'parallel-pir',
    task: null,
    matches: true,
  });
});

test('parseAgentName round-trips a worker name to its task', () => {
  const name = workerName({ repo: 'plan-implement-review', plan: 'parallel-pir', task: 'T05' });
  assert.deepEqual(parseAgentName(name), {
    repo: 'plan-implement-review',
    plan: 'parallel-pir',
    task: 'T05',
    matches: true,
  });
});

test('parseAgentName tolerates surrounding and inter-segment spaces', () => {
  assert.deepEqual(parseAgentName('  repo ·  plan  · T12 '), {
    repo: 'repo',
    plan: 'plan',
    task: 'T12',
    matches: true,
  });
});

test('a single-token name with no "·" separator is reported, not parsed', () => {
  // A default agent name like "skaut / cd-speech" splits to a single segment on "·".
  assert.equal(parseAgentName('skaut / cd-speech').matches, false);
  assert.equal(parseAgentName('justoneword').task, null);
});

test('a worker-shaped name whose task is not T{nn} is reported, not guessed', () => {
  // Three segments but the third is not a task id: must not be parsed into a wrong task.
  const r = parseAgentName('repo · plan · notatask');
  assert.equal(r.matches, false);
  assert.equal(r.task, null);
});

test('a name with too many segments is reported', () => {
  const r = parseAgentName('repo · plan · T01 · extra');
  assert.equal(r.matches, false);
});

test('an empty first segment, and a non-string, are reported', () => {
  assert.equal(parseAgentName(' · plan').matches, false);
  assert.equal(parseAgentName(undefined).matches, false);
});

test('isWorkerOf keeps only this run\'s workers, dropping the coordinator and foreign agents (§2.8, T12 P5)', () => {
  const repo = 'plan-implement-review';
  const plan = 'parallel-pir';
  // A worker of this run.
  assert.equal(isWorkerOf(workerName({ repo, plan, task: 'T05' }), { repo, plan }), true);
  // The coordinator's own session: {repo} · {plan}, no task — this is the off-by-one from the drill.
  assert.equal(isWorkerOf(coordinatorName({ repo, plan }), { repo, plan }), false);
  // A worker of a SIBLING plan in the same repo (shares the git-dir, so it is in the list).
  assert.equal(isWorkerOf(workerName({ repo, plan: 'other-plan', task: 'T01' }), { repo, plan }), false);
  // A worker of a foreign repo.
  assert.equal(isWorkerOf(workerName({ repo: 'other-repo', plan, task: 'T01' }), { repo, plan }), false);
  // A name that does not parse at all (e.g. a harness default like "repo / thing").
  assert.equal(isWorkerOf('repo / thing', { repo, plan }), false);
});
