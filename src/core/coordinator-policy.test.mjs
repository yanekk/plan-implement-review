import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DESTRUCTIVE, parseRule, commandParts, reservedFor, readDecision, checkDecision } from './coordinator-policy.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(readFileSync(join(HERE, '../shell/fake/fixtures/coordinator-requests.json'), 'utf8'));
const ASK = ['Bash(git push:*)']; // the probe repo's permissions.ask

// A recorded canUseTool call, as the shell will hand it to reservedFor: the request plus the SDK options.
const fromFixture = ({ toolName, input, opts = {} }) => ({ kind: 'permission', requestId: opts.requestId ?? 'r', toolName, input, ...opts });
const bash = (command, extra = {}) => ({ kind: 'permission', requestId: 'r1', toolName: 'Bash', input: { command }, ...extra });

// ---- reservedFor on the recorded T00 cases ----

test('recorded ask-rule case: git push reaches the gate with no matchedAskRule and is reserved by the settings match', () => {
  const [req] = FIXTURE.askRule.requests;
  assert.equal(req.opts.matchedAskRule, undefined);
  assert.equal(reservedFor(fromFixture(req), ASK)?.kind, 'ask-rule');
  // With no ask rule configured, a plain push is not destructive and not reserved.
  assert.equal(reservedFor(fromFixture(req), []), null);
});

test('recorded destructive commands are reserved as destructive', () => {
  for (const r of FIXTURE.destructive.ranWithoutRequest) {
    assert.equal(reservedFor(fromFixture(r), ASK)?.kind, 'destructive', r.input.command);
  }
});

test('recorded gate requests (Write, MCP, Read, Skill) are not reserved', () => {
  assert.ok(FIXTURE.gate.requests.length >= 5);
  for (const r of FIXTURE.gate.requests) assert.equal(reservedFor(fromFixture(r), ASK), null, r.toolName);
});

// ---- reservedFor flags ----

test('matchedAskRule → ask-rule; defaultToNo → destructive; neither and no match → null', () => {
  const rule = { source: 'projectSettings', toolName: 'Bash', ruleContent: 'npm publish:*' };
  const a = reservedFor(bash('npm publish', { matchedAskRule: rule }));
  assert.equal(a.kind, 'ask-rule');
  assert.match(a.why, /npm publish:\*/);
  assert.equal(reservedFor({ kind: 'permission', toolName: 'Write', input: { file_path: '/x' }, defaultToNo: true }).kind, 'destructive');
  assert.equal(reservedFor(bash('npm test'), ASK), null);
  assert.equal(reservedFor({ kind: 'permission', toolName: 'Write', input: { file_path: '/x' } }, ASK), null);
});

test('a question set, a non-object or a request without a tool is never reserved', () => {
  assert.equal(reservedFor({ kind: 'questions', requestId: 'q', questions: [] }, ASK), null);
  assert.equal(reservedFor(null, ASK), null);
  assert.equal(reservedFor(bash('rm -rf /'), 'not an array')?.kind, 'destructive');
});

test('Bash(git push:*) reserves git push origin main, not git status', () => {
  assert.equal(reservedFor(bash('git push origin main'), ASK)?.kind, 'ask-rule');
  assert.equal(reservedFor(bash('git push'), ASK)?.kind, 'ask-rule');
  assert.equal(reservedFor(bash('git status'), ASK), null);
  assert.equal(reservedFor(bash('git pushx'), ASK), null);
});

test('each part of a compound command is matched, though ruleMatches alone refuses compounds', async () => {
  const { ruleMatches } = await import('./person-input.mjs');
  const rule = parseRule('Bash(git push:*)');
  for (const cmd of ['cd x && git push origin main', 'git status; git push', 'git status | tee x\ngit push', 'FOO=1 git push > out.log 2>&1', 'echo $(git push)']) {
    assert.equal(ruleMatches(rule, { command: cmd }), false, cmd);
    assert.equal(reservedFor(bash(cmd), ASK)?.kind, 'ask-rule', cmd);
  }
});

test('an ask rule for another tool matches that tool only', () => {
  const rules = ['Write(//etc/hosts)', 'WebFetch', 'Bash(git push:*)'];
  assert.equal(reservedFor({ toolName: 'Write', input: { file_path: '/etc/hosts' } }, rules)?.kind, 'ask-rule');
  assert.equal(reservedFor({ toolName: 'Write', input: { file_path: '/etc/other' } }, rules), null);
  assert.equal(reservedFor({ toolName: 'WebFetch', input: { url: 'https://x.dev' } }, rules)?.kind, 'ask-rule');
  assert.equal(reservedFor({ toolName: 'Read', input: { file_path: '/etc/hosts' } }, rules), null);
});

test('a malformed ask rule is ignored, never a match-all', () => {
  for (const bad of ['Bash(', 'Bash()', '(git push)', 'Bash(git push) extra', '', 42]) {
    assert.equal(reservedFor(bash('git status'), [bad]), null, String(bad));
  }
});

// ---- parseRule ----

test('parseRule: with and without parentheses; malformed → null', () => {
  assert.deepEqual(parseRule('Bash(git push:*)'), { toolName: 'Bash', ruleContent: 'git push:*' });
  assert.deepEqual(parseRule('Read'), { toolName: 'Read' });
  assert.deepEqual(parseRule('mcp__claude_ai_Gmail__list_labels'), { toolName: 'mcp__claude_ai_Gmail__list_labels' });
  assert.deepEqual(parseRule('WebFetch(domain:example.com)'), { toolName: 'WebFetch', ruleContent: 'domain:example.com' });
  assert.deepEqual(parseRule('Bash(echo (x))'), { toolName: 'Bash', ruleContent: 'echo (x)' });
  for (const bad of ['', '   ', 'Bash(', 'Bash()', 'Bash(  )', '(x)', 'Bash(x) y', 'two words', null, undefined, {}, 3]) {
    assert.equal(parseRule(bad), null, JSON.stringify(bad));
  }
});

// ---- DESTRUCTIVE ----

const HITS = [
  'rm -rf build', 'rm -r dir', 'rm -f file.txt', 'rm -Rf x', 'rm --recursive x', 'rm file --force', 'sudo rm -rf /',
  'git push --force', 'git push -f origin main', 'git push --force-with-lease', 'git push origin +main', 'git -C repo push -uf origin x',
  'git reset --hard', 'git reset --hard HEAD~1',
  'git clean -fd', 'git clean -f', 'git clean --force',
  'git branch -D feat', 'git branch --delete --force feat', 'git branch -d -f feat',
  'git checkout -- src/a.mjs', 'git checkout .', 'git restore src/a.mjs',
  'git rebase main', 'git filter-branch --tree-filter x',
  'DROP TABLE users', 'drop database prod', 'psql -c "truncate orders"',
  'mkfs.ext4 /dev/sda1', 'dd if=/dev/zero of=/dev/disk2',
];
const MISSES = [
  'rm file.txt', 'rm -i x', 'rm my-file.txt', 'git push', 'git push origin feature-f', 'git push -u origin main',
  'git reset --soft HEAD~1', 'git reset', 'git branch -d feat', 'git checkout main', 'git checkout -b feat',
  'git clean -n', 'select * from drops', 'npm test', 'ls -rf', 'git status', 'git log --format=%H',
];

test('DESTRUCTIVE: each command is matched', () => {
  for (const c of HITS) assert.equal(reservedFor(bash(c))?.kind, 'destructive', c);
});

test('DESTRUCTIVE: near misses are not matched', () => {
  for (const c of MISSES) {
    assert.equal(reservedFor(bash(c)), null, c);
    assert.ok(!DESTRUCTIVE.some((re) => re.test(c)), c);
  }
});

test('every DESTRUCTIVE entry matches at least one listed command', () => {
  for (const re of DESTRUCTIVE) assert.ok(HITS.some((c) => re.test(c)), String(re));
});

test('destructive inside a compound command is reserved', () => {
  for (const c of ['cd x && rm -rf y', 'git status; git reset --hard', 'true || git push --force', 'echo `rm -rf y`']) {
    assert.equal(reservedFor(bash(c))?.kind, 'destructive', c);
  }
});

test('commandParts splits, strips assignments and redirects, keeps 2>&1 from splitting', () => {
  assert.deepEqual(commandParts('cd x && FOO=1 BAR=2 git push origin main 2>&1 > out'), ['cd x', 'git push origin main']);
  assert.deepEqual(commandParts('a | b || c ; d\ne & f'), ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.deepEqual(commandParts(undefined), []);
  assert.deepEqual(commandParts('git push &>out'), ['git push']);
});

// Review: a wrapper, a keyword, a quoted `sh -c` body or a path-qualified binary must not carry a reserved
// command past the person. Over-matching (`echo git push`) is the accepted cost (DESIGN §3.3).
test('a reserved command behind a wrapper, keyword, quotes or a path is still reserved', () => {
  for (const c of ['nohup git push', 'time git push origin', 'env FOO=1 git push', 'sudo git push', 'xargs git push',
    '{ git push; }', 'if true; then git push; fi', 'sh -c "cd x && git push"', "bash -c 'git push'", 'git push &>out']) {
    assert.equal(reservedFor(bash(c), ASK)?.kind, 'ask-rule', c);
  }
  for (const c of ['/bin/rm -rf x', '\\rm -rf x', '"rm" -rf x', "sh -c 'rm -rf build'"]) {
    assert.equal(reservedFor(bash(c), ASK)?.kind, 'destructive', c);
  }
  for (const c of ['git status', 'nohup npm test', 'sh -c "npm test"', 'rm file.txt']) assert.equal(reservedFor(bash(c), ASK), null, c);
});

// ---- readDecision ----

test('readDecision accepts every kind with its fields', () => {
  assert.deepEqual(readDecision({ kind: 'permission', worker: 'w', requestId: 'r', decision: 'allow', reason: 'ok', notable: true, extra: 1 }),
    { ok: true, decision: { kind: 'permission', worker: 'w', requestId: 'r', decision: 'allow', reason: 'ok', notable: true } });
  assert.deepEqual(readDecision({ kind: 'answers', worker: 'w', requestId: 'r', answers: { 'Q?': 'A' }, reason: 'ok' }).decision,
    { kind: 'answers', worker: 'w', requestId: 'r', answers: { 'Q?': 'A' }, reason: 'ok', notable: false });
  assert.deepEqual(readDecision({ kind: 'message', worker: 'w', text: 'go on', reason: 'r' }).decision,
    { kind: 'message', worker: 'w', text: 'go on', reason: 'r', notable: false });
  assert.deepEqual(readDecision({ kind: 'pass', worker: 'w', requestId: 'r', reason: 'r', suggestion: 's' }).decision,
    { kind: 'pass', worker: 'w', requestId: 'r', reason: 'r', suggestion: 's' });
  assert.deepEqual(readDecision({ kind: 'pass', worker: 'w', reason: 'r', suggestion: 's' }).decision,
    { kind: 'pass', worker: 'w', reason: 'r', suggestion: 's' });
  assert.deepEqual(readDecision({ kind: 'report', sections: { delivered: 'd', checkByHand: '', risks: 'r' } }).decision,
    { kind: 'report', sections: { delivered: 'd', checkByHand: '', risks: 'r' } });
  assert.deepEqual(readDecision({ kind: 'close' }), { ok: true, decision: { kind: 'close' } });
});

test('readDecision refuses bad files with a named error', () => {
  const cases = [
    [null, /JSON object/],
    [[], /JSON object/],
    ['x', /JSON object/],
    [{ kind: 'merge' }, /unknown kind "merge"/],
    [{}, /unknown kind/],
    [{ kind: 'permission', requestId: 'r', decision: 'allow', reason: 'x' }, /missing `worker`/],
    [{ kind: 'permission', worker: 'w', decision: 'allow', reason: 'x' }, /missing `requestId`/],
    [{ kind: 'permission', worker: 'w', requestId: 'r', decision: 'allow-always', reason: 'x' }, /unknown decision/],
    [{ kind: 'permission', worker: 'w', requestId: 'r', decision: 'allow' }, /missing `reason`/],
    [{ kind: 'permission', worker: 'w', requestId: 'r', decision: 'allow', reason: 'x', notable: 'yes' }, /`notable`/],
    [{ kind: 'answers', worker: 'w', requestId: 'r', answers: ['A'], reason: 'x' }, /`answers` must be an object/],
    [{ kind: 'answers', worker: 'w', requestId: 'r', answers: 'A', reason: 'x' }, /`answers` must be an object/],
    [{ kind: 'answers', worker: 'w', requestId: 'r', answers: {}, reason: 'x' }, /empty/],
    [{ kind: 'answers', worker: 'w', requestId: 'r', answers: { q: 1 }, reason: 'x' }, /must be a string/],
    [{ kind: 'message', worker: 'w', text: '  ', reason: 'x' }, /non-empty `text`/],
    [{ kind: 'message', worker: 'w', reason: 'x' }, /non-empty `text`/],
    [{ kind: 'pass', worker: 'w', reason: 'x' }, /suggestion/],
    [{ kind: 'pass', worker: 'w', requestId: '', reason: 'x', suggestion: 's' }, /requestId/],
    [{ kind: 'report' }, /sections/],
    [{ kind: 'report', sections: { delivered: 'd', risks: 'r' } }, /checkByHand/],
  ];
  for (const [obj, err] of cases) {
    const r = readDecision(obj);
    assert.equal(r.ok, false, JSON.stringify(obj));
    assert.match(r.error, err, JSON.stringify(obj));
  }
});

// ---- checkDecision ----

const PERM = { worker: 'w1', task: 'T01', kind: 'permission', requestId: 'p1', request: bash('npm test') };
const RESERVED = { worker: 'w1', task: 'T01', kind: 'permission', requestId: 'p2', request: bash('git push'), reserved: { kind: 'ask-rule', why: 'the ask rule' } };
const QUESTIONS = {
  worker: 'w2', task: 'T02', kind: 'questions', requestId: 'q1',
  request: { kind: 'questions', requestId: 'q1', questions: [{ question: 'Colour?' }, { question: 'Size?' }], input: { questions: [] } },
};
const REPORT = { worker: 'w3', task: 'T03', kind: 'report', text: 'Which newline?' };
const WAITING = [PERM, RESERVED, QUESTIONS, REPORT];
const dec = (obj) => {
  const r = readDecision(obj);
  assert.ok(r.ok, r.error);
  return r.decision;
};

test('checkDecision applies a permission allow and deny with the worker result and ledger line', () => {
  const allow = checkDecision(dec({ kind: 'permission', worker: 'w1', requestId: 'p1', decision: 'allow', reason: 'tests are routine' }), WAITING);
  assert.equal(allow.ok, true);
  assert.deepEqual(allow.apply.result, { behavior: 'allow', updatedInput: { command: 'npm test' } });
  assert.deepEqual(allow.apply.ledger, { kind: 'permission', worker: 'w1', task: 'T01', requestId: 'p1', item: 'Bash: npm test', answer: 'allow', reason: 'tests are routine', notable: false });
  assert.equal(allow.apply.requestId, 'p1');
  const deny = checkDecision(dec({ kind: 'permission', worker: 'w1', requestId: 'p1', decision: 'deny', reason: 'use npm run lint', notable: true }), WAITING);
  assert.deepEqual(deny.apply.result, { behavior: 'deny', message: 'use npm run lint' });
  assert.equal(deny.apply.ledger.notable, true);
});

test('checkDecision applies answers and a message', () => {
  const a = checkDecision(dec({ kind: 'answers', worker: 'w2', requestId: 'q1', answers: { 'Colour?': 'Red', 'Size?': 'L' }, reason: 'per DESIGN' }), WAITING);
  assert.equal(a.ok, true);
  assert.deepEqual(a.apply.result.updatedInput.answers, { 'Colour?': 'Red', 'Size?': 'L' });
  assert.equal(a.apply.ledger.item, 'Colour? / Size?');
  assert.equal(a.apply.ledger.answer, 'Colour? → Red; Size? → L');
  const m = checkDecision(dec({ kind: 'message', worker: 'w3', text: 'No trailing newline.', reason: 'DESIGN §4' }), WAITING);
  assert.deepEqual(m, { ok: true, apply: { kind: 'message', worker: 'w3', task: 'T03', text: 'No trailing newline.', ledger: { kind: 'message', worker: 'w3', task: 'T03', item: 'Which newline?', answer: 'No trailing newline.', reason: 'DESIGN §4', notable: false } } });
});

test('checkDecision refuses an unknown worker and an unknown or already-answered request', () => {
  const unknown = checkDecision(dec({ kind: 'permission', worker: 'ghost', requestId: 'p1', decision: 'allow', reason: 'x' }), WAITING);
  assert.equal(unknown.ok, false);
  assert.equal(unknown.passOn, false);
  assert.match(unknown.why, /ghost/);
  const gone = checkDecision(dec({ kind: 'permission', worker: 'w1', requestId: 'p9', decision: 'allow', reason: 'x' }), WAITING);
  assert.equal(gone.ok, false);
  assert.match(gone.why, /already answered/);
  // The person answered p1 first: it is no longer in waiting.
  const late = checkDecision(dec({ kind: 'permission', worker: 'w1', requestId: 'p1', decision: 'allow', reason: 'x' }), [RESERVED]);
  assert.equal(late.ok, false);
  assert.equal(late.passOn, false);
});

test('checkDecision refuses a decision for an item known closed with those facts; the generic refusal stays for the rest (T15)', () => {
  const answered = new Map([['w1:p1', 'already answered by the person: denied'], ['w3:report', 'closed with no answer: the worker exited before anyone answered']]);
  const late = checkDecision(dec({ kind: 'pass', worker: 'w1', requestId: 'p1', reason: 'note', suggestion: 'deny' }), [RESERVED], { answered });
  assert.deepEqual(late, { ok: false, why: 'already answered by the person: denied', passOn: false });
  const noWorker = checkDecision(dec({ kind: 'permission', worker: 'w1', requestId: 'p1', decision: 'allow', reason: 'x' }), [], { answered });
  assert.equal(noWorker.why, 'already answered by the person: denied');
  const park = checkDecision(dec({ kind: 'message', worker: 'w3', text: 'JSON', reason: 'x' }), [], { answered });
  assert.equal(park.why, 'closed with no answer: the worker exited before anyone answered');
  // A worker that never had an item: the generic refusal.
  const ghost = checkDecision(dec({ kind: 'permission', worker: 'ghost', requestId: 'p1', decision: 'allow', reason: 'x' }), WAITING, { answered });
  assert.match(ghost.why, /nothing is waiting from worker "ghost" \(unknown worker, or already answered\)/);
  // Still waiting (a later item under the same key): checked as usual, the old facts ignored.
  const again = checkDecision(dec({ kind: 'message', worker: 'w3', text: 'JSON', reason: 'x' }), [REPORT], { answered });
  assert.equal(again.ok, true);
});

test('checkDecision refuses a kind mismatch', () => {
  const r = checkDecision(dec({ kind: 'answers', worker: 'w1', requestId: 'p1', answers: { q: 'a' }, reason: 'x' }), WAITING);
  assert.equal(r.ok, false);
  assert.match(r.why, /answers decision does not answer a permission/);
  const p = checkDecision(dec({ kind: 'permission', worker: 'w2', requestId: 'q1', decision: 'allow', reason: 'x' }), WAITING);
  assert.equal(p.ok, false);
  assert.equal(p.passOn, false);
});

test('checkDecision refuses answers naming a question not asked, or leaving one out', () => {
  const extra = checkDecision(dec({ kind: 'answers', worker: 'w2', requestId: 'q1', answers: { 'Colour?': 'Red', 'Size?': 'L', 'Shape?': 'x' }, reason: 'x' }), WAITING);
  assert.match(extra.why, /Shape\?/);
  const missing = checkDecision(dec({ kind: 'answers', worker: 'w2', requestId: 'q1', answers: { 'Colour?': 'Red' }, reason: 'x' }), WAITING);
  assert.match(missing.why, /Size\?/);
});

test('checkDecision refuses a message to a worker not report-parked', () => {
  const r = checkDecision(dec({ kind: 'message', worker: 'w1', text: 'hi', reason: 'x' }), WAITING);
  assert.equal(r.ok, false);
  assert.equal(r.passOn, false);
  assert.match(r.why, /not parked on a report/);
});

test('checkDecision passes on a permission for a reserved item', () => {
  const r = checkDecision(dec({ kind: 'permission', worker: 'w1', requestId: 'p2', decision: 'allow', reason: 'looks fine' }), WAITING);
  assert.equal(r.ok, false);
  assert.equal(r.passOn, true);
  assert.match(r.why, /the ask rule/);
  // A deny of a reserved item is passed on too: the person decides reserved items, either way.
  assert.equal(checkDecision(dec({ kind: 'permission', worker: 'w1', requestId: 'p2', decision: 'deny', reason: 'no' }), WAITING).passOn, true);
});

test('checkDecision accepts a pass on anything waiting, reserved included', () => {
  for (const [worker, requestId] of [['w1', 'p1'], ['w1', 'p2'], ['w2', 'q1'], ['w3', undefined]]) {
    const obj = { kind: 'pass', worker, reason: 'the person should pick', suggestion: 'option A' };
    if (requestId) obj.requestId = requestId;
    const r = checkDecision(dec(obj), WAITING);
    assert.equal(r.ok, true, `${worker} ${requestId}`);
    assert.equal(r.apply.kind, 'pass');
    assert.equal(r.apply.requestId, requestId);
    assert.equal(r.apply.suggestion, 'option A');
    assert.equal(r.apply.ledger.kind, 'pass');
  }
  // With no requestId and no report park, the agent must name the request.
  const r = checkDecision(dec({ kind: 'pass', worker: 'w1', reason: 'x', suggestion: 's' }), WAITING);
  assert.equal(r.ok, false);
  assert.match(r.why, /requestId/);
});

test('checkDecision passes a report through', () => {
  const sections = { delivered: 'All of it.', checkByHand: 'Nothing.', risks: 'None.' };
  assert.deepEqual(checkDecision(dec({ kind: 'report', sections }), []), { ok: true, apply: { kind: 'report', sections } });
});

test('checkDecision passes close only in ready to merge', () => {
  assert.deepEqual(checkDecision(dec({ kind: 'close' }), [], { ready: true }), { ok: true, apply: { kind: 'close' } });
  const early = checkDecision(dec({ kind: 'close' }), WAITING);
  assert.equal(early.ok, false);
  assert.equal(early.passOn, false);
  assert.match(early.why, /still building/);
  assert.equal(checkDecision(dec({ kind: 'close' }), [], { ready: false }).ok, false);
});
