// pir-coordinator T05 — the delivery report's assembly (DESIGN §2.7, §2.9, §2.11). Pure.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  notableDecisions, decisionsSection, branchFooter, assembleReport, replaceFooter, endFacts, unverifiedTasks, findingRows,
  AGENT_UNAVAILABLE, FOOTER_HEADING,
} from './coordinator-report.mjs';

const ledger = [
  { kind: 'permission', task: 'T01', item: 'Bash: npm test', answer: 'allow', reason: 'the test command', notable: false },
  { kind: 'answers', task: 'T02', item: 'JSON or YAML?', answer: 'JSON', reason: 'DESIGN leaves it open; JSON matches the rest', notable: true },
  { kind: 'adopt', task: 'T09', name: 'extra-probe', item: 'new task T09 (extra-probe)', answer: 'adopted into the plan', reason: 'x', notable: true },
];
const sections = { delivered: 'The export works.', checkByHand: 'Open the file.', risks: 'None known.' };
const footer = branchFooter({ mainSha: 'abcdef1234567890', tests: 'green', syncedAt: '2026-09-27T10:00:00Z' });

test('notableDecisions: the flagged lines and adopted tasks, routine lines left out, an adoption listed once', () => {
  const n = notableDecisions(ledger, [{ task: 'T09', name: 'extra-probe' }, { task: 'T10', name: 'late' }]);
  assert.deepEqual(n.map((d) => d.task), ['T02', 'T09', 'T10']);
  assert.deepEqual(n[0], { question: 'JSON or YAML?', answer: 'JSON', why: 'DESIGN leaves it open; JSON matches the rest', task: 'T02' });
  assert.match(n[1].question, /T09 \(extra-probe\)/);
  assert.deepEqual(notableDecisions([], []), []);
  assert.deepEqual(notableDecisions([null, 'x', { notable: true, item: 'q', answer: 'a' }]), [{ question: 'q', answer: 'a', why: '', task: null }]);
});

test('decisionsSection: question, answer and why per decision; "None." when empty', () => {
  assert.equal(decisionsSection([]), '## Decisions made for you\n\nNone.\n');
  const s = decisionsSection(notableDecisions(ledger));
  assert.match(s, /- \*\*T02: JSON or YAML\?\*\*\n {2}Answer: JSON\n {2}Why: DESIGN leaves it open/);
});

test('branchFooter: the sha, the time and the tests; red and unresolved say not ready', () => {
  assert.match(footer, /^## Branch\n/);
  assert.match(footer, /Synced with `main` at `abcdef123456` on 2026-09-27T10:00:00Z\./);
  assert.match(footer, /Tests: green\./);
  assert.doesNotMatch(footer, /not ready/);
  assert.match(branchFooter({ mainSha: 'abc', tests: 'red' }), /Tests: red\. The branch is not ready to merge\./);
  assert.match(branchFooter({ mainSha: 'abc', tests: 'red', unresolved: true }), /conflicted and was not resolved/);
});

test('assembleReport: four sections in order, then the footer', () => {
  const text = assembleReport({ slug: 'demo', sections, notable: notableDecisions(ledger), footer });
  const heads = [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(heads, ['What was delivered', 'Decisions made for you', 'What to check by hand', 'Risks and follow-ups', 'Branch']);
  assert.match(text, /^# demo — delivery report\n/);
  assert.match(text, /The export works\./);
  assert.match(text, /JSON or YAML\?/);
  assert.ok(text.endsWith('Tests: green.\n'));
});

test('assembleReport: no agent → one line in place of its three sections; decisions and footer kept', () => {
  const text = assembleReport({ slug: 'demo', sections: null, notable: [], footer });
  assert.ok(text.includes(AGENT_UNAVAILABLE));
  const heads = [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(heads, ['Decisions made for you', 'Branch']);
  assert.match(text, /None\./);
});

test('replaceFooter: swaps the last Branch section only; appends one when missing', () => {
  const text = assembleReport({ slug: 'demo', sections, notable: [], footer });
  const next = branchFooter({ mainSha: '9999999999999', tests: 'red', syncedAt: 'later' });
  const out = replaceFooter(text, next);
  assert.equal(out.split(FOOTER_HEADING).length, 2, 'one footer');
  assert.match(out, /`999999999999`/);
  assert.doesNotMatch(out, /abcdef/);
  assert.ok(out.startsWith(text.slice(0, text.indexOf(FOOTER_HEADING))));
  assert.match(replaceFooter('# r\n', next), /^# r\n\n## Branch/);
});

test('unverifiedTasks and findingRows read the plan files', () => {
  const progress = '| # | Task |\n|---|---|\n| T01 | a | ✅ | hand half unverified |\n| T02 | b | ✅ | fine |\n';
  assert.deepEqual(unverifiedTasks(progress), ['T01']);
  const findings = '| Date | | Finding |\n|---|---|---|\n| 2026-09-27 | 🐞 | a bug |\nprose\n';
  assert.deepEqual(findingRows(findings), ['| 2026-09-27 | 🐞 | a bug |']);
});

test('endFacts normalises the facts for the brief', () => {
  const f = endFacts({ tasks: [{ num: 'T01', name: 'a', state: '✅', deps: [] }], ledger, findings: ['| r |', ''], unverified: ['T01'], sync: { state: 'merged', mainSha: 'abc' }, tests: 'green' });
  assert.deepEqual(f.tasks, [{ num: 'T01', name: 'a', state: '✅' }]);
  assert.equal(f.ledger.length, 3);
  assert.deepEqual(f.findings, ['| r |']);
  assert.deepEqual(f.sync, { state: 'merged', mainSha: 'abc', files: [] });
  assert.equal(f.tests, 'green');
  assert.equal(endFacts({}).tests, 'red');
});
