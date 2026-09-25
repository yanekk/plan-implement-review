import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateDrop, grantFrom, grantMatches, decidePermission } from './person-input.mjs';
import { readEntry } from './stream.mjs';

// The permission requests of T01's real recording, read the way the coordinator will see them.
const SAMPLE_PATH = new URL('./fixtures/stream-sample.ndjson', import.meta.url);
const recorded = readFileSync(SAMPLE_PATH, 'utf8').split('\n').filter(Boolean)
  .flatMap((l) => readEntry(l)).filter((e) => e.kind === 'permission');

const addRules = (rules, extra = {}) => ({ type: 'addRules', rules, behavior: 'allow', destination: 'localSettings', ...extra });
const bashReq = (command, suggestions = [], extra = {}) => ({ toolName: 'Bash', input: { command }, suggestions, ...extra });
const bashGrant = (ruleContent) => ({ rules: [{ toolName: 'Bash', ruleContent }] });
const matches = (ruleContent, command) => grantMatches(bashGrant(ruleContent), bashReq(command));

// ---- validateDrop ----

test('validateDrop: each valid kind round-trips', () => {
  const drops = [
    { to: 'w1', kind: 'message', text: 'carry on' },
    { to: 'w1', kind: 'interrupt' },
    { to: 'w1', kind: 'permission', requestId: 'r1', decision: 'allow' },
    { to: 'w1', kind: 'permission', requestId: 'r1', decision: 'deny' },
    { to: 'w1', kind: 'permission', requestId: 'r1', decision: 'allow-always' },
    { to: 'w1', kind: 'permission', requestId: 'r1', decision: 'deny', text: 'use the fixture instead' },
    { to: 'w1', kind: 'answers', requestId: 'r2', answers: { 'Which colour?': 'red', 'Which sizes?': 'S, M' } },
    { to: 'w1', kind: 'answers', requestId: 'r2', answers: {} },
    { to: 'w1', kind: 'decline-questions', requestId: 'r2', text: 'neither, ask me later' },
  ];
  for (const d of drops) assert.deepEqual(validateDrop(d), { ok: true, input: d }, JSON.stringify(d));
});

test('validateDrop: unknown fields are dropped from the normalised input', () => {
  const r = validateDrop({ to: 'w1', kind: 'interrupt', text: 'x', extra: 1 });
  assert.deepEqual(r, { ok: true, input: { to: 'w1', kind: 'interrupt' } });
});

test('validateDrop: the answers map is copied, not shared', () => {
  const answers = { q: 'a' };
  const r = validateDrop({ to: 'w1', kind: 'answers', requestId: 'r', answers });
  answers.q = 'changed';
  assert.equal(r.input.answers.q, 'a');
});

test('validateDrop: malformed drops are errors, never throws', () => {
  const bad = [
    null, undefined, 'message', 42, [],
    { kind: 'message', text: 'hi' },
    { to: '', kind: 'message', text: 'hi' },
    { to: '  ', kind: 'interrupt' },
    { to: 7, kind: 'interrupt' },
    { to: 'w1' },
    { to: 'w1', kind: 'shout', text: 'hi' },
    { to: 'w1', kind: 'message' },
    { to: 'w1', kind: 'message', text: '' },
    { to: 'w1', kind: 'message', text: '   \n' },
    { to: 'w1', kind: 'message', text: 3 },
    { to: 'w1', kind: 'permission', decision: 'allow' },
    { to: 'w1', kind: 'permission', requestId: '', decision: 'allow' },
    { to: 'w1', kind: 'permission', requestId: 'r', decision: 'maybe' },
    { to: 'w1', kind: 'permission', requestId: 'r' },
    { to: 'w1', kind: 'permission', requestId: 'r', decision: 'deny', text: 5 },
    { to: 'w1', kind: 'permission', requestId: 'r', decision: 'allow', text: 'why' },
    { to: 'w1', kind: 'answers', answers: { q: 'a' } },
    { to: 'w1', kind: 'answers', requestId: 'r' },
    { to: 'w1', kind: 'answers', requestId: 'r', answers: ['a'] },
    { to: 'w1', kind: 'answers', requestId: 'r', answers: 'red' },
    { to: 'w1', kind: 'answers', requestId: 'r', answers: null },
    { to: 'w1', kind: 'answers', requestId: 'r', answers: { q: ['a', 'b'] } },
    { to: 'w1', kind: 'answers', requestId: 'r', answers: { q: 1 } },
    { to: 'w1', kind: 'decline-questions', text: 'no' },
    { to: 'w1', kind: 'decline-questions', requestId: 'r' },
  ];
  for (const d of bad) {
    const r = validateDrop(d);
    assert.equal(r.ok, false, JSON.stringify(d));
    assert.equal(typeof r.error, 'string');
    assert.ok(r.error.length > 0);
  }
});

// ---- grantFrom ----

test('grantFrom: the recorded requests yield their addRules suggestion only', () => {
  const grants = recorded.map(grantFrom);
  assert.deepEqual(grants.filter(Boolean), [bashGrant('echo probe-one *'), bashGrant('rm probe.txt')]);
  // The recorded suggestions also carried `addDirectories`; a grant never takes it.
  assert.ok(recorded.some((r) => r.suggestions.some((s) => s.type === 'addDirectories')));
});

test('grantFrom: a recorded grant covers its own family of commands', () => {
  const [echoGrant] = recorded.map(grantFrom).filter(Boolean);
  assert.equal(grantMatches(echoGrant, bashReq('echo probe-one')), true);
  assert.equal(grantMatches(echoGrant, bashReq('echo probe-one two')), true);
  assert.equal(grantMatches(echoGrant, bashReq('echo probe-two')), false);
  // The originating request redirects into a file: Claude checks the target, pir asks.
  assert.equal(grantMatches(echoGrant, recorded[0]), false);
});

test('grantFrom: no suggestion, or none of type addRules/allow, yields no grant', () => {
  assert.equal(grantFrom(bashReq('ls')), null);
  assert.equal(grantFrom({ toolName: 'Bash', input: { command: 'ls' } }), null);
  assert.equal(grantFrom(bashReq('ls', [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }])), null);
  assert.equal(grantFrom(bashReq('ls', [{ type: 'addDirectories', directories: ['/tmp'] }])), null);
  assert.equal(grantFrom(bashReq('ls', [addRules([{ toolName: 'Bash', ruleContent: 'ls' }], { behavior: 'deny' })])), null);
  assert.equal(grantFrom(bashReq('ls', [addRules([])])), null);
  assert.equal(grantFrom(bashReq('ls', [addRules([{ ruleContent: 'ls' }])])), null);
  assert.equal(grantFrom(null), null);
  assert.equal(grantFrom('x'), null);
});

test('grantFrom: suppressAlwaysAllowRule means the rule would grant too much, so no grant', () => {
  const req = bashReq('ls', [addRules([{ toolName: 'Bash', ruleContent: 'ls *' }])], { suppressAlwaysAllowRule: true });
  assert.equal(grantFrom(req), null);
});

test('grantFrom: every allow rule is kept, across suggestions; a rule without content is a whole-tool rule', () => {
  const req = bashReq('git status && npm test', [
    addRules([{ toolName: 'Bash', ruleContent: 'npm test' }, { toolName: 'Bash', ruleContent: 'git status' }]),
    addRules([{ toolName: 'WebSearch' }]),
  ]);
  assert.deepEqual(grantFrom(req), {
    rules: [{ toolName: 'Bash', ruleContent: 'npm test' }, { toolName: 'Bash', ruleContent: 'git status' }, { toolName: 'WebSearch' }],
  });
});

// ---- grantMatches: Bash, after Claude's rule form ----

test('grantMatches: an exact rule `touch a.txt` matches `touch a.txt` only', () => {
  const grant = grantFrom(bashReq('touch a.txt', [addRules([{ toolName: 'Bash', ruleContent: 'touch a.txt' }])]));
  assert.equal(grantMatches(grant, bashReq('touch a.txt')), true);
  for (const c of ['touch a.txt b.txt', 'touch b.txt', 'touch  a.txt', ' touch a.txt', 'touch a.txt ', 'touch a.tx', 'touch'])
    assert.equal(grantMatches(grant, bashReq(c)), false, c);
});

test('grantMatches: `npm test:*` matches `npm test` and its arguments, never `npm testx`', () => {
  for (const c of ['npm test', 'npm test -- x', 'npm test --watch'])
    assert.equal(matches('npm test:*', c), true, c);
  for (const c of ['npm testx', 'npm tes', 'npm install', 'npx npm test'])
    assert.equal(matches('npm test:*', c), false, c);
});

test('grantMatches: the space form `npm test *` is the same rule as `npm test:*`', () => {
  for (const c of ['npm test', 'npm test -- x', 'npm testx', 'npm install'])
    assert.equal(matches('npm test *', c), matches('npm test:*', c), c);
});

test('grantMatches: wildcards per the Claude docs table', () => {
  const table = [
    ['npm run build', ['npm run build'], ['npm run build --watch']],
    ['npm run *', ['npm run build', 'npm run test --watch', 'npm run'], ['npm install']],
    ['git log * main', ['git log --oneline main', 'git log -5 main'], ['git log main', 'git push origin main']],
    ['* --version', ['node --version'], ['node -v']],
    ['ls *', ['ls -la', 'ls'], ['lsof']],
    ['ls*', ['ls -la', 'lsof'], []],
    ['* --help *', ['npm --help x'], ['npm --help']],
  ];
  for (const [rule, yes, no] of table) {
    for (const c of yes) assert.equal(matches(rule, c), true, `${rule} ↔ ${c}`);
    for (const c of no) assert.equal(matches(rule, c), false, `${rule} ↔ ${c}`);
  }
});

test('grantMatches: `:*` is a wildcard only at the end; elsewhere it is literal', () => {
  assert.equal(matches('git:* push', 'git push'), false);
  assert.equal(matches('git:* push', 'git:x push'), true);
});

test('grantMatches: regex characters in a rule are literal', () => {
  assert.equal(matches('ls a.txt', 'ls abtxt'), false);
  assert.equal(matches('echo (x)+ *', 'echo (x)+ y'), true);
  assert.equal(matches('echo (x)+ *', 'echo xx y'), false);
});

test('grantMatches: a compound, substituted or redirected command never matches a grant', () => {
  for (const c of [
    'npm test && rm -rf /', 'npm test || true', 'npm test; ls', 'npm test | sh', 'npm test & sleep 1',
    'npm test\nrm x', 'npm test $(rm x)', 'npm test `rm x`', 'npm test > out.txt', 'npm test < in.txt',
    'npm test >> out.txt', 'npm test >&2',
  ]) assert.equal(matches('npm test *', c), false, c);
  assert.equal(grantMatches(bashGrant('*'), bashReq('ls; rm x')), false);
  assert.equal(grantMatches({ rules: [{ toolName: 'Bash' }] }, bashReq('ls && rm x')), false);
});

test('grantMatches: output to /dev/null and 2>&1 are not treated as redirects', () => {
  for (const c of ['npm test 2>/dev/null', 'npm test > /dev/null', 'npm test >/dev/null 2>&1', 'npm test 2>&1'])
    assert.equal(matches('npm test *', c), true, c);
  assert.equal(matches('npm test *', 'npm test 2>&1 | tee log'), false);
});

test('grantMatches: `Bash(*)` and a bare Bash rule match every simple command', () => {
  assert.equal(grantMatches(bashGrant('*'), bashReq('anything at all')), true);
  assert.equal(grantMatches({ rules: [{ toolName: 'Bash' }] }, bashReq('ls')), true);
});

test('grantMatches: a Bash grant never matches another tool, nor a request with no command', () => {
  const grant = bashGrant('*');
  assert.equal(grantMatches(grant, { toolName: 'Edit', input: { file_path: 'a.txt' } }), false);
  assert.equal(grantMatches(bashGrant('ls'), { toolName: 'Edit', input: { command: 'ls' } }), false);
  assert.equal(grantMatches(grant, { toolName: 'Bash', input: {} }), false);
  assert.equal(grantMatches(grant, { toolName: 'Bash' }), false);
});

// ---- grantMatches: other tools ----

test('grantMatches: a whole-tool rule matches every request of that tool only', () => {
  const grant = { rules: [{ toolName: 'WebSearch' }] };
  assert.equal(grantMatches(grant, { toolName: 'WebSearch', input: { query: 'x' } }), true);
  assert.equal(grantMatches(grant, { toolName: 'WebFetch', input: { url: 'https://a.com' } }), false);
});

test('grantMatches: a path rule must equal the tool\'s primary field', () => {
  const grant = { rules: [{ toolName: 'Edit', ruleContent: 'src/a.mjs' }] };
  assert.equal(grantMatches(grant, { toolName: 'Edit', input: { file_path: 'src/a.mjs' } }), true);
  assert.equal(grantMatches(grant, { toolName: 'Edit', input: { file_path: 'src/b.mjs' } }), false);
  assert.equal(grantMatches({ rules: [{ toolName: 'Edit', ruleContent: 'src/**' }] }, { toolName: 'Edit', input: { file_path: 'src/a.mjs' } }), false);
  assert.equal(grantMatches({ rules: [{ toolName: 'mcp__x__y', ruleContent: 'a' }] }, { toolName: 'mcp__x__y', input: { a: 'a' } }), false);
});

test('grantMatches: WebFetch domain rules match the hostname exactly, case-insensitive', () => {
  const grant = { rules: [{ toolName: 'WebFetch', ruleContent: 'domain:Example.com' }] };
  const fetch = (url) => ({ toolName: 'WebFetch', input: { url } });
  assert.equal(grantMatches(grant, fetch('https://example.com/docs')), true);
  assert.equal(grantMatches(grant, fetch('https://EXAMPLE.com./x')), true);
  assert.equal(grantMatches(grant, fetch('https://api.example.com/')), false);
  assert.equal(grantMatches(grant, fetch('https://example.com.evil.io/')), false);
  assert.equal(grantMatches(grant, fetch('not a url')), false);
  assert.equal(grantMatches({ rules: [{ toolName: 'WebFetch', ruleContent: 'domain:*.example.com' }] }, fetch('https://api.example.com/')), false);
});

test('grantMatches: malformed grants or requests never match, never throw', () => {
  for (const g of [null, {}, { rules: 'x' }, { rules: [null] }]) assert.equal(grantMatches(g, bashReq('ls')), false);
  assert.equal(grantMatches(bashGrant('ls'), null), false);
});

// ---- decidePermission ----

test('decidePermission: several grants, none matching → ask; one matching → allow-by-grant', () => {
  const grants = [bashGrant('npm test *'), bashGrant('touch a.txt'), { rules: [{ toolName: 'WebSearch' }] }];
  assert.equal(decidePermission(grants, bashReq('rm -rf build')), 'ask');
  assert.equal(decidePermission(grants, bashReq('npm test && rm x')), 'ask');
  assert.equal(decidePermission(grants, { toolName: 'Edit', input: { file_path: 'a.txt' } }), 'ask');
  assert.equal(decidePermission(grants, bashReq('touch a.txt')), 'allow-by-grant');
  assert.equal(decidePermission(grants, bashReq('npm test -- x')), 'allow-by-grant');
});

test('decidePermission: no grants → ask', () => {
  assert.equal(decidePermission([], bashReq('ls')), 'ask');
  assert.equal(decidePermission(undefined, bashReq('ls')), 'ask');
});
