import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coordinatorName, workerName, parseAgentName, isWorkerOf, WORKER_ROLES } from './naming.mjs';

test('coordinatorName builds the {repo} · {plan} form, no @ prefix (kept on "·" until T05)', () => {
  assert.equal(
    coordinatorName({ repo: 'plan-implement-review', plan: 'parallel-pir' }),
    'plan-implement-review · parallel-pir',
  );
});

test('workerName builds the five-field {repo} / {plan} / {task} / {slug} / {role} form (§2.9)', () => {
  assert.equal(
    workerName({ repo: 'plan-implement-review', plan: 'non-agentic-coordinator', task: 'T01', slug: 'stop-promoting', role: 'implement' }),
    'plan-implement-review / non-agentic-coordinator / T01 / stop-promoting / implement',
  );
  assert.equal(
    workerName({ repo: 'r', plan: 'p', task: 'T05', slug: 'budget-ledger', role: 'review' }),
    'r / p / T05 / budget-ledger / review',
  );
  assert.equal(
    workerName({ repo: 'r', plan: 'p', task: 'T05', slug: 'budget-ledger', role: 'verify' }),
    'r / p / T05 / budget-ledger / verify',
  );
});

test('workerName tolerates an omitted slug, defaulting it to the task id (T02→T05 transition)', () => {
  // The un-migrated harness callers build worker names without a slug; the default keeps their names
  // valid and parseable until T05 migrates them to pass a real slug.
  assert.equal(
    workerName({ repo: 'r', plan: 'p', task: 'T05', role: 'implement' }),
    'r / p / T05 / T05 / implement',
  );
  assert.equal(parseAgentName(workerName({ repo: 'r', plan: 'p', task: 'T05', role: 'implement' })).task, 'T05');
});

test('workerName rejects a missing or unknown role — the old role-less name is ambiguous', () => {
  assert.throws(() => workerName({ repo: 'r', plan: 'p', task: 'T05', slug: 's' }), /role must be one of/);
  assert.throws(() => workerName({ repo: 'r', plan: 'p', task: 'T05', slug: 's', role: 'build' }), /role must be one of/);
  // `verify` stays defined until T05 removes the verify path (DESIGN §2.5).
  assert.deepEqual(WORKER_ROLES, ['implement', 'review', 'verify']);
});

test('the worker name carries no leading "@" (SendMessage rejected a leading "@", T07)', () => {
  const w = workerName({ repo: 'r', plan: 'p', task: 'T01', slug: 's', role: 'implement' });
  assert.ok(!w.startsWith('@'), 'no leading "@"');
  const c = coordinatorName({ repo: 'r', plan: 'p' });
  assert.ok(!c.startsWith('@'), 'no leading "@"');
});

test('parseAgentName round-trips every field of a worker name, including the slug, across "/"', () => {
  const name = workerName({ repo: 'plan-implement-review', plan: 'parallel-pir', task: 'T05', slug: 'budget-ledger', role: 'review' });
  assert.deepEqual(parseAgentName(name), {
    repo: 'plan-implement-review',
    plan: 'parallel-pir',
    task: 'T05',
    slug: 'budget-ledger',
    role: 'review',
    matches: true,
  });
});

test('the task number is extracted correctly when a slug is present (§2.9: number is the identity)', () => {
  assert.equal(parseAgentName('r / p / T05 / budget-ledger / implement').task, 'T05');
  assert.equal(parseAgentName('r / p / T12 / a-long-readable-slug / review').task, 'T12');
});

test('parseAgentName round-trips a coordinator name to task/slug/role null', () => {
  const name = coordinatorName({ repo: 'plan-implement-review', plan: 'parallel-pir' });
  assert.deepEqual(parseAgentName(name), {
    repo: 'plan-implement-review',
    plan: 'parallel-pir',
    task: null,
    slug: null,
    role: null,
    matches: true,
  });
});

test('parseAgentName still reads a legacy "·" four-field worker name (slug null) during the transition', () => {
  // The un-migrated harness (T05) still emits and injects "·" worker names; they must round-trip so the
  // suite stays green until T05 removes the last producer of them.
  assert.deepEqual(parseAgentName('repo · plan · T12 · implement'), {
    repo: 'repo',
    plan: 'plan',
    task: 'T12',
    slug: null,
    role: 'implement',
    matches: true,
  });
});

test('parseAgentName tolerates surrounding and inter-segment spaces on both separators', () => {
  assert.equal(parseAgentName('  repo /  plan  / T12 /  a-slug / implement ').task, 'T12');
  assert.equal(parseAgentName('  repo ·  plan  · T12 ·  implement ').task, 'T12');
});

test('a single-token name with no separator is reported, not parsed', () => {
  assert.equal(parseAgentName('justoneword').matches, false);
  assert.equal(parseAgentName('justoneword').task, null);
});

test('a five-field name whose task is not T{nn} is reported, not guessed', () => {
  const r = parseAgentName('repo / plan / notatask / a-slug / implement');
  assert.equal(r.matches, false);
  assert.equal(r.task, null);
});

test('a five-field name whose role is not a known role is reported, not guessed', () => {
  const r = parseAgentName('repo / plan / T01 / a-slug / build');
  assert.equal(r.matches, false);
  assert.equal(r.role, null);
});

test('a five-field name whose slug is empty is reported, not parsed', () => {
  const r = parseAgentName('repo / plan / T01 /  / implement');
  assert.equal(r.matches, false);
});

test('a name with too many segments is reported', () => {
  assert.equal(parseAgentName('repo / plan / T01 / a-slug / implement / extra').matches, false);
});

test('an empty first segment, and a non-string, are reported', () => {
  assert.equal(parseAgentName(' / plan').matches, false);
  assert.equal(parseAgentName(undefined).matches, false);
});

test("isWorkerOf keeps only this run's workers, dropping the coordinator and foreign agents (§2.9)", () => {
  const repo = 'plan-implement-review';
  const plan = 'parallel-pir';
  // A worker of this run (any role), matched regardless of its slug.
  assert.equal(isWorkerOf(workerName({ repo, plan, task: 'T05', slug: 's', role: 'implement' }), { repo, plan }), true);
  assert.equal(isWorkerOf(workerName({ repo, plan, task: 'T05', slug: 'other-slug', role: 'review' }), { repo, plan }), true);
  // A legacy "·" worker of this run still matches during the transition.
  assert.equal(isWorkerOf(`${repo} · ${plan} · T05 · implement`, { repo, plan }), true);
  // The coordinator's own session ({repo} · {plan}, no task) is never a worker.
  assert.equal(isWorkerOf(coordinatorName({ repo, plan }), { repo, plan }), false);
  // A worker of a SIBLING plan in the same repo (shares the git-dir, so it is in the list).
  assert.equal(isWorkerOf(workerName({ repo, plan: 'other-plan', task: 'T01', slug: 's', role: 'implement' }), { repo, plan }), false);
  // A worker of a foreign repo.
  assert.equal(isWorkerOf(workerName({ repo: 'other-repo', plan, task: 'T01', slug: 's', role: 'implement' }), { repo, plan }), false);
  // A foreign default agent name that happens to split in two ("/"-separated) is not a worker (no task).
  assert.equal(isWorkerOf('repo / thing', { repo, plan }), false);
});

test('isWorkerOf can narrow to a single role — how the coordinator tells implementer from reviewer', () => {
  const repo = 'r';
  const plan = 'p';
  const impl = workerName({ repo, plan, task: 'T05', slug: 's', role: 'implement' });
  const rev = workerName({ repo, plan, task: 'T05', slug: 's', role: 'review' });
  assert.equal(isWorkerOf(impl, { repo, plan, role: 'implement' }), true);
  assert.equal(isWorkerOf(impl, { repo, plan, role: 'review' }), false);
  assert.equal(isWorkerOf(rev, { repo, plan, role: 'review' }), true);
  // Omitting role still matches any role.
  assert.equal(isWorkerOf(rev, { repo, plan }), true);
});
