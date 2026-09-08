// T07 — the send/inbox half of platform.mjs, proven without a live agent (DESIGN §4, §5.1). The
// wire format round-trips; same-repo resolution is exercised against a real scratch repo and its
// linked worktree; the `--cwd` gotcha is guarded with a spy; `claude agents --json` parses. The one
// thing here the tests cannot reach — a `·` name actually accepted by the live messaging layer — is
// confirmed by hand and recorded in FINDINGS (DESIGN §2.8).

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
    cwd: '/Users/x/src/skaut',
    status: 'idle',
    state: 'blocked',
    name: 'skaut / cd-speech',
  });
  assert.equal(agents[1].id, '28e9678c');
  assert.equal(agents[1].state, 'working');
  assert.equal(agents[1].name, 'pir · parallel-pir · T05');
  assert.equal('pid' in agents[0], false);
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
