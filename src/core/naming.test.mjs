import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coordinatorName, workerName, parseAgentName, isWorkerOf, WORKER_ROLES } from './naming.mjs';

test('coordinatorName builds the {repo} · {plan} form, no @ prefix (§2.8)', () => {
  assert.equal(
    coordinatorName({ repo: 'plan-implement-review', plan: 'parallel-pir' }),
    'plan-implement-review · parallel-pir',
  );
});

test('workerName builds the {repo} · {plan} · T{nn} · {role} form, no @ prefix (§2.8)', () => {
  assert.equal(
    workerName({ repo: 'plan-implement-review', plan: 'parallel-pir', task: 'T05', role: 'implement' }),
    'plan-implement-review · parallel-pir · T05 · implement',
  );
  assert.equal(
    workerName({ repo: 'r', plan: 'p', task: 'T05', role: 'review' }),
    'r · p · T05 · review',
  );
  assert.equal(
    workerName({ repo: 'r', plan: 'p', task: 'T05', role: 'verify' }),
    'r · p · T05 · verify',
  );
});

test('workerName rejects a missing or unknown role — the old role-less name is ambiguous', () => {
  assert.throws(() => workerName({ repo: 'r', plan: 'p', task: 'T05' }), /role must be one of/);
  assert.throws(() => workerName({ repo: 'r', plan: 'p', task: 'T05', role: 'build' }), /role must be one of/);
  assert.deepEqual(WORKER_ROLES, ['implement', 'review', 'verify']);
});

test('the built names carry neither "/" nor a leading "@" — both rejected by SendMessage (T00, T07)', () => {
  const c = coordinatorName({ repo: 'r', plan: 'p' });
  const w = workerName({ repo: 'r', plan: 'p', task: 'T01', role: 'implement' });
  assert.ok(!c.includes('/') && !w.includes('/'), 'no "/"');
  assert.ok(!c.startsWith('@') && !w.startsWith('@'), 'no leading "@"');
});

test('parseAgentName round-trips a coordinator name to task: null, role: null', () => {
  const name = coordinatorName({ repo: 'plan-implement-review', plan: 'parallel-pir' });
  assert.deepEqual(parseAgentName(name), {
    repo: 'plan-implement-review',
    plan: 'parallel-pir',
    task: null,
    role: null,
    matches: true,
  });
});

test('parseAgentName round-trips a worker name to its task and role', () => {
  const name = workerName({ repo: 'plan-implement-review', plan: 'parallel-pir', task: 'T05', role: 'review' });
  assert.deepEqual(parseAgentName(name), {
    repo: 'plan-implement-review',
    plan: 'parallel-pir',
    task: 'T05',
    role: 'review',
    matches: true,
  });
});

test('parseAgentName tolerates surrounding and inter-segment spaces', () => {
  assert.deepEqual(parseAgentName('  repo ·  plan  · T12 ·  implement '), {
    repo: 'repo',
    plan: 'plan',
    task: 'T12',
    role: 'implement',
    matches: true,
  });
});

test('a single-token name with no "·" separator is reported, not parsed', () => {
  // A default agent name like "skaut / cd-speech" splits to a single segment on "·".
  assert.equal(parseAgentName('skaut / cd-speech').matches, false);
  assert.equal(parseAgentName('justoneword').task, null);
});

test('a worker-shaped name whose task is not T{nn} is reported, not guessed', () => {
  // Four segments but the task segment is not a task id: must not be parsed into a wrong task.
  const r = parseAgentName('repo · plan · notatask · implement');
  assert.equal(r.matches, false);
  assert.equal(r.task, null);
});

test('a four-segment name whose role is not a known role is reported, not guessed', () => {
  const r = parseAgentName('repo · plan · T01 · build');
  assert.equal(r.matches, false);
  assert.equal(r.role, null);
});

test('a three-segment (role-less) name is reported — a worker name now carries a role', () => {
  const r = parseAgentName('repo · plan · T01');
  assert.equal(r.matches, false);
  assert.equal(r.task, null);
});

test('a name with too many segments is reported', () => {
  const r = parseAgentName('repo · plan · T01 · implement · extra');
  assert.equal(r.matches, false);
});

test('an empty first segment, and a non-string, are reported', () => {
  assert.equal(parseAgentName(' · plan').matches, false);
  assert.equal(parseAgentName(undefined).matches, false);
});

test("isWorkerOf keeps only this run's workers, dropping the coordinator and foreign agents (§2.8, T12 P5)", () => {
  const repo = 'plan-implement-review';
  const plan = 'parallel-pir';
  // A worker of this run (any role).
  assert.equal(isWorkerOf(workerName({ repo, plan, task: 'T05', role: 'implement' }), { repo, plan }), true);
  assert.equal(isWorkerOf(workerName({ repo, plan, task: 'T05', role: 'review' }), { repo, plan }), true);
  // The coordinator's own session: {repo} · {plan}, no task — this is the off-by-one from the drill.
  assert.equal(isWorkerOf(coordinatorName({ repo, plan }), { repo, plan }), false);
  // A worker of a SIBLING plan in the same repo (shares the git-dir, so it is in the list).
  assert.equal(isWorkerOf(workerName({ repo, plan: 'other-plan', task: 'T01', role: 'implement' }), { repo, plan }), false);
  // A worker of a foreign repo.
  assert.equal(isWorkerOf(workerName({ repo: 'other-repo', plan, task: 'T01', role: 'implement' }), { repo, plan }), false);
  // A name that does not parse at all (e.g. a harness default like "repo / thing").
  assert.equal(isWorkerOf('repo / thing', { repo, plan }), false);
});

test('isWorkerOf can narrow to a single role — how the coordinator tells implementer from reviewer', () => {
  const repo = 'r';
  const plan = 'p';
  const impl = workerName({ repo, plan, task: 'T05', role: 'implement' });
  const rev = workerName({ repo, plan, task: 'T05', role: 'review' });
  assert.equal(isWorkerOf(impl, { repo, plan, role: 'implement' }), true);
  assert.equal(isWorkerOf(impl, { repo, plan, role: 'review' }), false);
  assert.equal(isWorkerOf(rev, { repo, plan, role: 'review' }), true);
  // Omitting role still matches any role.
  assert.equal(isWorkerOf(rev, { repo, plan }), true);
});
