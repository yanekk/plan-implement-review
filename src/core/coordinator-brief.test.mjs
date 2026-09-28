// pir-coordinator T03 — the text of every message the command sends the coordinator agent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { briefFor, refusalFor, answeredElsewhereFor, openingFor, resumedFor, timedOutFor, holdWords } from './coordinator-brief.mjs';

const permission = {
  worker: 'w-1', name: 'repo / plan / T04 / routing / implement', task: 'T04', kind: 'permission', requestId: 'req-1',
  request: { toolName: 'Bash', input: { command: 'npm test' }, reason: 'This command requires approval' },
};

test('a permission brief names the worker, task, requestId, tool, input and reason, and how to answer', () => {
  const text = briefFor(permission);
  assert.match(text, /^Worker: `w-1`$/m);
  assert.match(text, /^requestId: `req-1`$/m);
  assert.match(text, /^Task: T04$/m);
  assert.match(text, /Tool: Bash/);
  assert.match(text, /"command": "npm test"/);
  assert.match(text, /This command requires approval/);
  assert.match(text, /`permission` decision/);
  assert.doesNotMatch(text, /person's/);
});

test('a question-set brief lists each question and its options', () => {
  const text = briefFor({
    worker: 'w-2', task: 'T05', kind: 'questions', requestId: 'req-2',
    request: { questions: [{ question: 'Colour?', multiSelect: true, options: [{ label: 'Red', description: 'warm' }, { label: 'Blue' }] }] },
  });
  assert.match(text, /Question 1 \(pick any number\): Colour\?/);
  assert.match(text, /- Red: warm/);
  assert.match(text, /- Blue/);
  assert.match(text, /`answers` decision/);
});

test('a report-park brief carries the report text and the last words, and asks for a message', () => {
  const text = briefFor({ worker: 'w-3', task: 'T06', kind: 'report', text: 'Should X be Y?', lastWords: 'I asked about X.' });
  assert.match(text, /Should X be Y\?/);
  assert.match(text, /I asked about X\./);
  assert.match(text, /`message` decision/);
  assert.doesNotMatch(text, /requestId/);
});

test('a reserved item is briefed as the person\'s, asking for a note, never as answerable', () => {
  const text = briefFor({ ...permission, reserved: { kind: 'destructive', why: 'a destructive command is always the person\'s to approve' } });
  assert.match(text, /This one is the person's \(a destructive command/);
  assert.match(text, /add your note/);
  assert.match(text, /`pass` decision/);
  assert.doesNotMatch(text, /Answer it with/);
});

test('refusal, answered-elsewhere, opening and resumed texts', () => {
  assert.match(refusalFor('unknown worker', '1-a.json'), /Your decision file 1-a\.json was not applied: unknown worker\./);
  assert.match(refusalFor('x'), /^Your decision was not applied: x\./);
  const elsewhere = answeredElsewhereFor(permission);
  assert.match(elsewhere, /Already answered by the person/);
  assert.match(elsewhere, /`w-1`/);
  assert.match(elsewhere, /`req-1`/);
  const opening = openingFor({ slug: 'demo', projectRulesPath: '/r/.claude/pir-coordinator.md', dropDir: '/c/coordinator/decisions' });
  assert.match(opening, /pir-coordinator skill/);
  assert.match(opening, /^Plan: demo$/m);
  assert.match(opening, /^Project rules: \/r\/\.claude\/pir-coordinator\.md$/m);
  assert.match(opening, /^Drop folder: \/c\/coordinator\/decisions$/m);
  assert.match(openingFor({ slug: 'demo', dropDir: '/d' }), /^Project rules: none/m);
  assert.match(resumedFor(), /restarted your session/);
});

// ---- T05: the end of the run ----
import { endBriefFor, handoffFor, resyncedFor } from './coordinator-brief.mjs';

test('endBriefFor: the task table, ledger, findings, unverified tasks, sync and tests, and the report shape', () => {
  const text = endBriefFor({
    tasks: [{ num: 'T01', name: 'probe', state: '✅' }],
    ledger: [{ kind: 'answers', task: 'T01', item: 'JSON?', answer: 'JSON', reason: 'design', notable: true }],
    findings: ['| 2026-09-27 | 🐞 | a bug |'],
    unverified: ['T01'],
    sync: { state: 'resolved', mainSha: 'abcdef1234567890', files: ['a.txt'] },
    tests: 'green',
  });
  assert.match(text, /- T01 probe ✅/);
  assert.match(text, /T01 answers \(notable\): JSON\? → JSON \(why: design\)/);
  assert.match(text, /a bug/);
  assert.match(text, /still unverified: T01\./);
  assert.match(text, /a worker resolved the conflicts, main at abcdef123456 \(files: a\.txt\)/);
  assert.match(text, /Tests on the feature branch: green\./);
  assert.match(text, /"kind": "report"/);
  assert.match(endBriefFor({}), /ledger\): none\./);
});

test('handoffFor: the report and the merge line when ready; no merge line when red', () => {
  const ready = handoffFor({ slug: 'demo', reportPath: 'plans/demo/REPORT.md', ready: true, report: '# demo — delivery report' });
  assert.match(ready, /plans\/demo\/REPORT\.md/);
  assert.match(ready, /# demo — delivery report/);
  assert.match(ready, /git merge pir\/demo/);
  const red = handoffFor({ slug: 'demo', reportPath: 'plans/demo/REPORT.md', ready: false });
  assert.doesNotMatch(red, /git merge/);
  assert.match(red, /not ready to merge/);
});

test('resyncedFor: main moved, the new sha, green keeps the merge line, red and unresolved do not', () => {
  assert.match(resyncedFor({ slug: 'demo', mainSha: 'abcdef1234567890', tests: 'green' }), /main moved to abcdef123456.*git merge pir\/demo/);
  assert.doesNotMatch(resyncedFor({ slug: 'demo', mainSha: 'a', tests: 'red' }), /git merge/);
  assert.match(resyncedFor({ slug: 'demo', mainSha: 'a', tests: 'red', unresolved: true }), /conflicted and was not resolved/);
});

test('endBriefFor: says whether a test-fix worker ran and what came of it (T10)', () => {
  assert.match(endBriefFor({ tests: 'green', fix: 'green' }), /red at the end; a worker fixed them/);
  assert.match(endBriefFor({ tests: 'red', fix: 'red' }), /tried to fix them and they stayed red/);
  assert.doesNotMatch(endBriefFor({ tests: 'green' }), /a worker fixed/);
});

// ---- T13: the hold limit ----

test('timedOutFor: the item is the person\'s now, names it exactly, says a late answer still counts and a pointer is owed', () => {
  const text = timedOutFor(permission, 300000);
  assert.match(text, /^Handed to the person: you held this item for 5 minutes without a decision/);
  assert.match(text, /^Worker: `w-1`$/m);
  assert.match(text, /^requestId: `req-1`$/m);
  assert.match(text, /^Task: T04$/m);
  assert.match(text, /You may still answer it while the person has not: the first answer wins/);
  assert.match(text, /`pass` decision/);
  assert.match(text, /give the person the pointer in your reply now/);
});

test('holdWords: whole minutes as minutes, a shortened limit in seconds', () => {
  assert.equal(holdWords(300000), '5 minutes');
  assert.equal(holdWords(180000), '3 minutes');
  assert.equal(holdWords(60000), '1 minute');
  assert.equal(holdWords(90000), '90 seconds');
  assert.equal(holdWords(1000), '1 second');
  assert.equal(holdWords(250), '1 second');
});
