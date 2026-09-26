// answerer.mjs, the harness's stand-in for the person (live-workers T18). The choice per request is pure
// (answerFor, pendingDrops); createAnswerer is run against a temp control folder with the real inbox
// writer, so the drops it leaves are exactly what the coordinator's forwarder would read.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { answerFor, pendingDrops, createAnswerer } from './answerer.mjs';
import { validateDrop } from '../../core/person-input.mjs';

const init = (sid) => ({ t: 1, dir: 'in', event: { type: 'system', subtype: 'init', session_id: sid } });
const permission = (id, command = 'touch approved.txt') => ({ t: 2, dir: 'request', requestId: id, toolName: 'Bash', input: { command } });
const questions = (id) => ({
  t: 3,
  dir: 'request',
  requestId: id,
  toolName: 'AskUserQuestion',
  input: {
    questions: [
      { question: 'Which greeting should greeting.txt hold?', header: 'Greeting', multiSelect: false, options: [{ label: 'Hello, world' }, { label: 'Hi there' }] },
    ],
  },
});
const reply = (id) => ({ t: 4, dir: 'out', from: 'person', kind: 'reply', requestId: id, result: { behavior: 'allow' } });

test('answerFor allows a permission once and picks each question\'s first option', () => {
  assert.deepEqual(answerFor({ kind: 'permission', requestId: 'r1' }), { kind: 'permission', requestId: 'r1', decision: 'allow' });
  assert.deepEqual(
    answerFor({ kind: 'questions', requestId: 'q1', questions: [{ question: 'A?', options: [{ label: 'x' }, { label: 'y' }] }, { question: 'B?', options: [{ label: 'z' }] }] }),
    { kind: 'answers', requestId: 'q1', answers: { 'A?': 'x', 'B?': 'z' } },
  );
});

test('answerFor gives up on a question with no options, and on anything else', () => {
  assert.equal(answerFor({ kind: 'questions', requestId: 'q', questions: [{ question: 'A?', options: [] }] }), null);
  assert.equal(answerFor({ kind: 'questions', requestId: 'q', questions: [] }), null);
  assert.equal(answerFor({ kind: 'busy' }), null);
  assert.equal(answerFor(null), null);
});

test('pendingDrops answers each pending request, addressed to the log\'s session id, and every drop validates', () => {
  const logs = [
    { file: 'T01-implement-1.ndjson', entries: [init('w1'), questions('q1')] },
    { file: 'T02-implement-1.ndjson', entries: [init('w2'), permission('p1')] },
  ];
  const drops = pendingDrops(logs);
  assert.deepEqual(drops, [
    { to: 'w1', kind: 'answers', requestId: 'q1', answers: { 'Which greeting should greeting.txt hold?': 'Hello, world' } },
    { to: 'w2', kind: 'permission', requestId: 'p1', decision: 'allow' },
  ]);
  for (const d of drops) assert.equal(validateDrop(d).ok, true);
});

test('pendingDrops skips answered, already-dropped, and not-yet-identified requests', () => {
  const logs = [
    { file: 'T01-implement-1.ndjson', entries: [init('w1'), permission('p1'), reply('p1')] }, // replied
    { file: 'T02-implement-1.ndjson', entries: [init('w2'), permission('p2')] }, // dropped already
    { file: 'T03-implement-1.ndjson', entries: [permission('p3')] }, // no session id yet
  ];
  assert.deepEqual(pendingDrops(logs, new Set(['p2'])), []);
});

test('createAnswerer drops one inbox file per pending request, once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pir-answerer-'));
  try {
    const control = join(dir, 'control');
    mkdirSync(join(control, 'conversations'), { recursive: true });
    const write = (file, entries) => writeFileSync(join(control, 'conversations', file), entries.map((e) => JSON.stringify(e) + '\n').join(''));
    write('T01-implement-1.ndjson', [init('w1'), questions('q1')]);
    write('T02-implement-1.ndjson', [init('w2'), permission('p1')]);
    writeFileSync(join(control, 'conversations', 'notes.txt'), 'not a log');

    const lines = [];
    const a = createAnswerer({ controlDir: control, log: (l) => lines.push(l) });
    assert.equal(a.tick().length, 2);
    const inbox = join(control, 'inbox');
    const files = readdirSync(inbox).filter((f) => f.endsWith('.json'));
    assert.equal(files.length, 2);
    const drops = files.map((f) => JSON.parse(readFileSync(join(inbox, f), 'utf8')));
    assert.deepEqual(drops.map((d) => d.requestId).sort(), ['p1', 'q1']);
    // The forwarder has not run, so both are still pending in the logs; nothing is dropped twice.
    assert.deepEqual(a.tick(), []);
    assert.equal(readdirSync(inbox).filter((f) => f.endsWith('.json')).length, 2);
    assert.equal(lines.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createAnswerer retries a request whose drop failed, and a missing conversations folder is nothing to answer', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pir-answerer-'));
  try {
    const control = join(dir, 'control');
    let ok = false;
    const seen = [];
    const a = createAnswerer({ controlDir: control, drop: (d) => (seen.push(d.requestId), { ok, reason: 'nope' }) });
    assert.deepEqual(a.tick(), []);
    mkdirSync(join(control, 'conversations'), { recursive: true });
    writeFileSync(join(control, 'conversations', 'T02-implement-1.ndjson'), [init('w2'), permission('p1')].map((e) => JSON.stringify(e)).join('\n'));
    assert.deepEqual(a.tick(), []);
    ok = true;
    assert.equal(a.tick().length, 1);
    assert.deepEqual(seen, ['p1', 'p1']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
