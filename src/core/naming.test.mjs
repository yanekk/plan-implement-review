import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workerName, parseAgentName, isWorkerOf, WORKER_ROLES } from './naming.mjs';

test('workerName builds the five-field {repo} / {plan} / {task} / {slug} / {role} form (§2.9)', () => {
  assert.equal(
    workerName({ repo: 'plan-implement-review', plan: 'non-agentic-coordinator', task: 'T01', slug: 'stop-promoting', role: 'implement' }),
    'plan-implement-review / non-agentic-coordinator / T01 / stop-promoting / implement',
  );
  assert.equal(
    workerName({ repo: 'r', plan: 'p', task: 'T05', slug: 'budget-ledger', role: 'review' }),
    'r / p / T05 / budget-ledger / review',
  );
});

test('workerName rejects a missing or unknown role — the old role-less name is ambiguous, and verify is gone', () => {
  assert.throws(() => workerName({ repo: 'r', plan: 'p', task: 'T05', slug: 's' }), /role must be one of/);
  assert.throws(() => workerName({ repo: 'r', plan: 'p', task: 'T05', slug: 's', role: 'build' }), /role must be one of/);
  // The `verify` role was removed with the hands-on/`you` path (DESIGN §2.5, T05).
  assert.throws(() => workerName({ repo: 'r', plan: 'p', task: 'T05', slug: 's', role: 'verify' }), /role must be one of/);
  assert.deepEqual(WORKER_ROLES, ['implement', 'review']);
});

test('workerName requires a slug — every task carries one (§2.9), so an omitted slug is a caller bug', () => {
  assert.throws(() => workerName({ repo: 'r', plan: 'p', task: 'T05', role: 'implement' }), /a slug is required/);
  assert.throws(() => workerName({ repo: 'r', plan: 'p', task: 'T05', slug: '', role: 'implement' }), /a slug is required/);
});

test('the worker name carries no leading "@" (SendMessage rejected a leading "@", T07)', () => {
  const w = workerName({ repo: 'r', plan: 'p', task: 'T01', slug: 's', role: 'implement' });
  assert.ok(!w.startsWith('@'), 'no leading "@"');
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

test('parseAgentName tolerates surrounding and inter-segment spaces', () => {
  assert.equal(parseAgentName('  repo /  plan  / T12 /  a-slug / implement ').task, 'T12');
});

test('a legacy "·" name no longer parses — the dual-separator tolerance is gone (T05)', () => {
  // The "·" separator and the four-field legacy worker form went with the down-channel and the harness
  // that emitted them (DESIGN §2.9, §3.2). Such a name is now reported, never parsed.
  assert.equal(parseAgentName('repo · plan · T12 · implement').matches, false);
  assert.equal(parseAgentName('repo · plan').matches, false);
});

test('a two-field name (an old coordinator name, or a foreign default) is reported, not parsed', () => {
  // There is no coordinator name any more (DESIGN §2.9); a name that splits in two is just not a worker.
  assert.equal(parseAgentName('repo / plan').matches, false);
  assert.equal(parseAgentName('repo / plan').task, null);
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
  // verify is no longer a known role, so a verify-suffixed name is reported too.
  assert.equal(parseAgentName('repo / plan / T01 / a-slug / verify').matches, false);
});

test('a five-field name whose slug is empty is reported, not parsed', () => {
  const r = parseAgentName('repo / plan / T01 /  / implement');
  assert.equal(r.matches, false);
});

test('a name with too many segments is reported', () => {
  assert.equal(parseAgentName('repo / plan / T01 / a-slug / implement / extra').matches, false);
});

test('an empty first segment, and a non-string, are reported', () => {
  assert.equal(parseAgentName(' / plan / T01 / a-slug / implement').matches, false);
  assert.equal(parseAgentName(undefined).matches, false);
});

test("isWorkerOf keeps only this run's workers, dropping foreign agents (§2.9)", () => {
  const repo = 'plan-implement-review';
  const plan = 'parallel-pir';
  // A worker of this run (any role), matched regardless of its slug.
  assert.equal(isWorkerOf(workerName({ repo, plan, task: 'T05', slug: 's', role: 'implement' }), { repo, plan }), true);
  assert.equal(isWorkerOf(workerName({ repo, plan, task: 'T05', slug: 'other-slug', role: 'review' }), { repo, plan }), true);
  // A two-field name (an old coordinator name) is never a worker.
  assert.equal(isWorkerOf(`${repo} / ${plan}`, { repo, plan }), false);
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
