// platform.mjs, proven without a live agent (DESIGN §4, §5.1). T07's send/inbox half: the wire format
// round-trips; same-repo resolution is exercised against a real scratch repo and its linked worktree;
// the `--cwd` gotcha is guarded with a spy; `claude agents --json` parses. T08's spawn/list/close half:
// the opening instruction and argv are asserted directly, and spawn/list/close are driven through a
// spy `claude` runner to the edge of the real process. The two things the tests cannot reach — a `·`
// name accepted by the live messaging layer, and a real agent spawning — are hand-verified and recorded
// in FINDINGS (DESIGN §2.8, §5.1).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  encodeMessage,
  parseMessage,
  resolveSameRepo,
  parseAgents,
  createMessaging,
  openingInstruction,
  spawnArgv,
  listArgv,
  closeArgv,
  createPlatform,
} from './platform.mjs';

const git = (dir, args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });

// A scratch repo with one commit on main, plus a named linked worktree, so an agent cwd can point at
// either. Never the real project (the seatbelt): a throwaway temp dir, no agent spawned.
function scratchRepo(prefix = 'pir-t07-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const repo = join(dir, 'repo');
  git(dir, ['init', '-b', 'main', 'repo']);
  git(repo, ['config', 'user.email', 't07@test.local']);
  git(repo, ['config', 'user.name', 'T07 Test']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(repo, 'f.txt'), 'x\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-m', 'init', '--no-edit']);
  const wt = join(dir, 'wt');
  git(repo, ['worktree', 'add', '-b', 'side', wt]);
  return { dir, repo, wt, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// --- the wire format --------------------------------------------------------------------------

test('a constructed message carries from/kind/task/text and parses back', () => {
  const from = 'plan-implement-review · parallel-pir · T05';
  const wire = encodeMessage({ kind: 'question', task: 'T05', text: 'which threshold?' });
  assert.deepEqual(parseMessage({ from, text: wire }), {
    from,
    kind: 'question',
    task: 'T05',
    text: 'which threshold?',
  });
});

test('a multi-line body survives the round-trip intact', () => {
  const from = 'repo · plan · T09';
  const text = 'line one\nline two\n\n[pir:v1 kind=fake task=T01] not a header\n';
  const wire = encodeMessage({ kind: 'conflict', task: 'T09', text });
  const back = parseMessage({ from, text: wire });
  assert.equal(back.kind, 'conflict');
  assert.equal(back.task, 'T09');
  assert.equal(back.text, text); // the header regex is anchored to the first line only
});

test('a message with no task recovers the task from the sender name', () => {
  const from = 'repo · plan · T12';
  const wire = encodeMessage({ kind: 'done', task: null, text: '' });
  const back = parseMessage({ from, text: wire });
  assert.equal(back.task, 'T12');
  assert.equal(back.kind, 'done');
});

test('a body with no header is read as a plain message, task from the sender name', () => {
  const from = 'repo · plan · T03';
  const back = parseMessage({ from, text: 'just a note from a human' });
  assert.equal(back.kind, 'message');
  assert.equal(back.task, 'T03');
  assert.equal(back.text, 'just a note from a human');
});

// --- P3: a REAL worker's message drives the state machine (T12) --------------------------------
//
// The T10 live drill's worker did NOT send the wire header — it wrote natural language with an
// explicit "(kind: question)" marker, which the old parseMessage read as kind `message` and the loop
// then dropped. These assert the two shapes a worker following the updated pir-worker contract sends:
// the header (the contract) and the prose safety net (a worker that forgets it).

test('the exact header shape pir-worker is taught to emit parses to the right kind and task', () => {
  const from = 'plan-implement-review · parallel-pir · T01';
  // The literal string the worker sends: the [pir:v1 …] line, then a multi-line question body.
  const sent =
    '[pir:v1 kind=question task=T01]\n' +
    'The greeting wording is unspecified. Options: (a) "Hello", (b) "Hi there".\n' +
    'Recommend (a). If you say nothing I will use (a).';
  const back = parseMessage({ from, text: sent });
  assert.equal(back.kind, 'question');
  assert.equal(back.task, 'T01');
  assert.match(back.text, /greeting wording is unspecified/);
});

test('a worker that forgets the header but names its kind in prose still parses (the drill shape)', () => {
  const from = 'pir-t10 · scratch · T01';
  // Verbatim-shape from the drill handoff: prose with an explicit "(kind: question)" marker.
  const drillShape = 'T01 question (kind: question) — the greeting wording is unspecified. I recommend "Hello".';
  const back = parseMessage({ from, text: drillShape });
  assert.equal(back.kind, 'question', 'the explicit kind marker is honoured');
  assert.equal(back.task, 'T01', 'the T-id in the text (or the sender name) gives the task');
  assert.equal(back.text, drillShape, 'the whole prose is kept as the body');
});

test('a "kind: done" prose signal parses to done; a bare word "done" in a note does not', () => {
  const from = 'repo · plan · T02';
  assert.equal(parseMessage({ from, text: 'kind=done task=T02 all integrated' }).kind, 'done');
  // A human note that merely contains the word "done" must stay a plain message, not fire a state change.
  const note = parseMessage({ from, text: 'I think this one is basically done, nice work' });
  assert.equal(note.kind, 'message', 'no explicit kind marker → plain message, never guessed');
});

// --- same-repo resolution ---------------------------------------------------------------------

test('two worktrees of one repo resolve same-repo; a different repo does not', (t) => {
  const a = scratchRepo();
  const b = scratchRepo('pir-t07-other-');
  t.after(a.cleanup);
  t.after(b.cleanup);

  const agents = [
    { id: 'w1', cwd: a.repo }, // the coordinator's own checkout
    { id: 'w2', cwd: a.wt }, // a worker in a linked worktree of the same repo
    { id: 'w3', cwd: b.repo }, // a session in a different repo
    { id: 'w4', cwd: null }, // no cwd — must be dropped, not crash
  ];
  const kept = resolveSameRepo(agents, { root: a.repo }).map((x) => x.id);
  assert.deepEqual(kept.sort(), ['w1', 'w2']);
});

test('same-repo resolution never passes --cwd (the known gotcha)', () => {
  // A spy runner standing in for git: it records every arg vector and answers a fixed common-dir per
  // cwd, so we can assert the resolver asks `rev-parse --git-common-dir` and never `--cwd`.
  const calls = [];
  const commons = {
    '/repo': '/repo/.git',
    '/repo/wt': '/repo/.git',
    '/other': '/other/.git',
  };
  const run = (dir, args) => {
    calls.push({ dir, args });
    return { ok: dir in commons, stdout: `${commons[dir] ?? ''}\n` };
  };
  const agents = [{ id: 'a', cwd: '/repo' }, { id: 'b', cwd: '/repo/wt' }, { id: 'c', cwd: '/other' }];
  const kept = resolveSameRepo(agents, { root: '/repo', run }).map((x) => x.id);
  assert.deepEqual(kept.sort(), ['a', 'b']);
  assert.ok(calls.length > 0, 'the resolver did run git');
  for (const c of calls) {
    assert.ok(!c.args.includes('--cwd'), `--cwd must never be used, saw: ${c.args.join(' ')}`);
    assert.deepEqual(c.args, ['rev-parse', '--git-common-dir']);
  }
});

test('resolveSameRepo returns nothing when the root is not a repo', () => {
  const run = () => ({ ok: false, stdout: '' });
  assert.deepEqual(resolveSameRepo([{ id: 'a', cwd: '/x' }], { root: '/nope', run }), []);
});

// --- claude agents --json ---------------------------------------------------------------------

test('parseAgents pulls id/cwd/status/state/name from a sample and drops the rest', () => {
  // Shape as observed from the real `claude agents --json` (2.1.263).
  const sample = JSON.stringify([
    {
      pid: 24990,
      id: 'ea11998b',
      cwd: '/Users/x/src/skaut',
      kind: 'background',
      startedAt: 1788759264498,
      sessionId: '91a137f7',
      name: 'skaut / cd-speech',
      status: 'idle',
      state: 'blocked',
    },
    {
      pid: 72756,
      id: '28e9678c',
      cwd: '/Users/x/src/pir',
      name: 'pir · parallel-pir · T05',
      status: 'busy',
      state: 'working',
    },
  ]);
  const agents = parseAgents(sample);
  assert.equal(agents.length, 2);
  assert.deepEqual(agents[0], {
    id: 'ea11998b',
    pid: 24990, // kept: close needs it to SIGTERM the session (claude stop only interrupts)
    cwd: '/Users/x/src/skaut',
    status: 'idle',
    state: 'blocked',
    name: 'skaut / cd-speech',
  });
  assert.equal(agents[1].id, '28e9678c');
  assert.equal(agents[1].pid, 72756);
  assert.equal(agents[1].state, 'working');
  assert.equal(agents[1].name, 'pir · parallel-pir · T05');
  assert.equal('sessionId' in agents[0], false);
});

test('parseAgents accepts an already-parsed array and tolerates non-arrays', () => {
  assert.equal(parseAgents([{ id: 'x', cwd: '/a', status: 'idle', state: 'done' }]).length, 1);
  assert.deepEqual(parseAgents('{}'), []);
  assert.deepEqual(parseAgents(null), []);
});

// --- the messaging surface --------------------------------------------------------------------

test('createMessaging.send encodes through the injected transport', () => {
  const delivered = [];
  const transport = { deliver: (name, text) => (delivered.push({ name, text }), { ok: true }), drain: () => [] };
  const m = createMessaging({ transport });
  const r = m.send('repo · plan', { kind: 'answer', task: 'T05', text: 'use 30' });
  assert.equal(r.ok, true);
  assert.equal(delivered[0].name, 'repo · plan');
  assert.deepEqual(parseMessage({ from: 'repo · plan · T05', text: delivered[0].text }), {
    from: 'repo · plan · T05',
    kind: 'answer',
    task: 'T05',
    text: 'use 30',
  });
});

test('createMessaging.inbox parses each drained message; a failed deliver reports not ok', () => {
  const transport = {
    deliver: () => ({ ok: false }),
    drain: () => [
      { from: 'repo · plan · T01', text: encodeMessage({ kind: 'implemented', task: 'T01', text: '' }) },
      { from: 'repo · plan · T02', text: encodeMessage({ kind: 'done', task: 'T02', text: '' }) },
    ],
  };
  const m = createMessaging({ transport });
  assert.equal(m.send('repo · plan', { kind: 'k', task: 'T01', text: '' }).ok, false);
  const got = m.inbox();
  assert.equal(got.length, 2);
  assert.equal(got[0].kind, 'implemented');
  assert.equal(got[0].task, 'T01');
  assert.equal(got[1].kind, 'done');
});

// --- the opening instruction and argv (T08, DESIGN §5.1: everything short of a live process) ----

test('openingInstruction names the right skill per phase, with the task, and engages the contract', () => {
  const impl = openingInstruction('implement', 'T08');
  assert.match(impl, /pir-implement T08/);
  assert.match(impl, /pir-worker/); // it engages the worker contract
  assert.match(impl, /not .*pick your own task|do not pick your own task/i);

  assert.match(openingInstruction('review', 'T08'), /pir-review T08/);
  assert.match(openingInstruction('verify', 'T08'), /pir-verify T08/);
});

test('openingInstruction refuses an unknown phase or a missing task', () => {
  assert.throws(() => openingInstruction('deploy', 'T08'), /unknown phase/);
  assert.throws(() => openingInstruction('implement', null), /no task/);
});

test('spawnArgv is claude --bg -n <name> <instruction> (task POSITIONAL, T00), close/list argv fixed', () => {
  // T00 found `claude --bg` takes the opening turn positionally, not with -p (--bg+--print conflict).
  const argv = spawnArgv({ name: 'repo · plan · T08', instruction: 'do the thing' });
  assert.deepEqual(argv, ['--bg', '-n', 'repo · plan · T08', 'do the thing']);
  assert.equal(argv.includes('-p'), false, '--bg must not be given -p');
  assert.equal(argv.includes('--print'), false);

  assert.deepEqual(closeArgv('abc123'), ['stop', 'abc123']);
  assert.deepEqual(listArgv(), ['agents', '--json']);
});

// --- createPlatform: spawn / list / close over an injected claude runner ------------------------

// A spy `claude` runner: records every call and answers a scripted result, so spawn/list/close are
// exercised to the edge of the real process without one. The name in spawn carries the `·` separator
// so the argv assertion also proves execFile-style args need no shell quoting.
function claudeSpy(results = {}) {
  const calls = [];
  const run = (args, opts = {}) => {
    calls.push({ args, opts });
    if (args[0] === '--bg') return results.spawn ?? { ok: true, stdout: 'sess-1\n' };
    if (args[0] === 'agents') return results.list ?? { ok: true, stdout: '[]' };
    if (args[0] === 'stop') return results.close ?? { ok: true, stdout: '' };
    return { ok: false, stdout: '', stderr: 'unexpected' };
  };
  return { run, calls };
}

test('spawn builds the argv from the name+phase, runs in the worktree cwd, returns the printed id', () => {
  const spy = claudeSpy({ spawn: { ok: true, stdout: '  28e9678c\n' } });
  const p = createPlatform({ runClaude: spy.run });
  const id = p.spawn({ cwd: '/wt/T08', name: 'repo · plan · T08', phase: 'implement' });
  assert.equal(id, '28e9678c'); // trimmed
  const call = spy.calls[0];
  assert.equal(call.args[0], '--bg');
  assert.deepEqual(call.args.slice(0, 3), ['--bg', '-n', 'repo · plan · T08']);
  assert.match(call.args[3], /pir-implement T08/); // the opening instruction is the positional turn
  assert.equal(call.opts.cwd, '/wt/T08'); // spawned in the worker's worktree
});

test('spawn on the review phase names pir-review; a spawn that returns no id or fails throws', () => {
  const spy = claudeSpy();
  const p = createPlatform({ runClaude: spy.run });
  p.spawn({ cwd: '/wt/T08', name: 'repo · plan · T08', phase: 'review' });
  assert.match(spy.calls[0].args[3], /pir-review T08/);

  const empty = createPlatform({ runClaude: () => ({ ok: true, stdout: '  \n' }) });
  assert.throws(() => empty.spawn({ cwd: '/x', name: 'repo · plan · T08', phase: 'implement' }), /no id/);
  const failed = createPlatform({ runClaude: () => ({ ok: false, stderr: 'boom' }) });
  assert.throws(() => failed.spawn({ cwd: '/x', name: 'repo · plan · T08', phase: 'implement' }), /boom/);
});

test('close interrupts with `claude stop <id>` then SIGTERMs the pid (stop alone does not remove it)', () => {
  // T08 live run: `claude stop` only interrupts a session's turn; it stays listed and running. So close
  // must also terminate the process. It looks the session up by id to get its pid, then sends SIGTERM.
  const killed = [];
  const listing = JSON.stringify([
    { id: 'sess-1', pid: 4242, cwd: '/repo', name: 'r · p · T01', status: 'idle', state: 'working' },
  ]);
  const calls = [];
  const run = (args) => {
    calls.push(args);
    if (args[0] === 'stop') return { ok: true, stdout: '' };
    if (args[0] === 'agents') return { ok: true, stdout: listing };
    return { ok: false };
  };
  const p = createPlatform({ runClaude: run, kill: (pid, sig) => killed.push([pid, sig]) });
  assert.deepEqual(p.close('sess-1'), { ok: true });
  assert.deepEqual(calls[0], ['stop', 'sess-1'], 'first interrupts the turn');
  assert.ok(calls.some((c) => c[0] === 'agents'), 'then looks the session up for its pid');
  assert.deepEqual(killed, [[4242, 'SIGTERM']], 'then terminates the process');
});

test('close of an already-gone id is a safe no-op — nothing to terminate', () => {
  const killed = [];
  const run = (args) => (args[0] === 'agents' ? { ok: true, stdout: '[]' } : { ok: true, stdout: '' });
  const p = createPlatform({ runClaude: run, kill: (pid) => killed.push(pid) });
  assert.deepEqual(p.close('ghost'), { ok: true });
  assert.deepEqual(killed, [], 'no pid found, nothing killed');
});

test('list parses a live-shaped `claude agents --json` into id/name/cwd/status/state/live', () => {
  // Two agents in this repo, one in another; same-repo filtering is done by the injected git spy so
  // the test is hermetic (the resolveSameRepo path itself is exercised against real git elsewhere).
  const sample = JSON.stringify([
    { pid: 1, id: 'a', cwd: '/repo/wt-T01', name: 'repo · plan · T01', status: 'busy', state: 'working' },
    { pid: 2, id: 'b', cwd: '/repo/wt-T02', name: 'repo · plan · T02', status: 'idle', state: 'blocked' },
    { pid: 3, id: 'c', cwd: '/other', name: 'other · thing', status: 'idle', state: 'working' },
  ]);
  const commons = { '/repo': '/repo/.git', '/repo/wt-T01': '/repo/.git', '/repo/wt-T02': '/repo/.git', '/other': '/other/.git' };
  const gitSpy = (dir) => ({ ok: dir in commons, stdout: `${commons[dir] ?? ''}\n` });
  const p = createPlatform({
    root: '/repo',
    runClaude: (args) => (args[0] === 'agents' ? { ok: true, stdout: sample } : { ok: false }),
    sameRepoRun: gitSpy,
  });
  const live = p.list();
  assert.deepEqual(live.map((w) => w.id).sort(), ['a', 'b']); // /other dropped
  assert.deepEqual(live[0], {
    id: 'a',
    pid: 1,
    name: 'repo · plan · T01',
    cwd: '/repo/wt-T01',
    status: 'busy',
    state: 'working',
    live: true,
  });
});

test('list returns [] when `claude agents --json` fails, rather than throwing', () => {
  const p = createPlatform({ runClaude: () => ({ ok: false, stdout: '' }) });
  assert.deepEqual(p.list(), []);
});
