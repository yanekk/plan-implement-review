// finisher T02 — the text of every message pir sends the finisher session.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  finisherStaleGo,
  finisherOpening, finisherResumed, finisherRefusal, finisherResynced, finisherGateRefusal, finisherNotGo, rulesSourceWords,
} from './finisher-brief.mjs';

const base = {
  slug: 'demo', branch: 'pir/demo', base: 'dev', rulesPath: '/r/.pir/rules/on-finish.md', rulesSource: 'project',
  statusDir: '/r/plans/demo/.parallel/control/finisher/status', reportPath: 'plans/demo/REPORT.md', mainCheckout: '/r',
};
const PHASES = ['preparing', 'awaiting-go', 'finishing', 'stuck', 'done'];
const GO = /header `Go`, options `Go` and `Not yet`/;

test('the opening names the skill, plan, branch, target branch, rules file, main checkout, report and status folder, and the go question', () => {
  const text = finisherOpening(base);
  assert.match(text, /pir-finisher skill/);
  assert.match(text, /^Plan: demo$/m);
  assert.match(text, /^Branch: pir\/demo$/m);
  assert.match(text, /^Target branch: dev$/m);
  assert.match(text, /ready to merge into `dev`/);
  assert.doesNotMatch(text, /\bmain\b(?! checkout)/i, 'names no branch but the run\'s');
  assert.match(text, /^Rules file: \/r\/\.pir\/rules\/on-finish\.md$/m);
  assert.match(text, /^Main checkout: \/r$/m);
  assert.match(text, /^Report: plans\/demo\/REPORT\.md$/m);
  assert.match(text, /^Status folder: \/r\/plans\/demo\/\.parallel\/control\/finisher\/status$/m);
  assert.match(text, /only look until the person says go/);
  assert.match(text, GO);
  assert.match(text, /a chat message never is/);
});

test('the opening names each rules source distinctly; built-in says install.sh never ran', () => {
  const sources = ['project', 'yours', 'default', 'built-in'];
  const lines = sources.map((s) => finisherOpening({ ...base, rulesSource: s }).match(/^Rules source: (.*)$/m)[1]);
  assert.equal(new Set(lines).size, sources.length);
  assert.match(lines[0], /project's own/);
  assert.match(lines[1], /person's rules for this repo/);
  assert.match(lines[2], /^the default rules$/);
  assert.match(lines[3], /install\.sh never ran/);
  assert.match(lines[3], /ready summary/);
  assert.match(rulesSourceWords('nonsense'), /unknown source \(nonsense\)/);
});

test('resumed mentions the skill and the Go header for every phase that can still ask', () => {
  for (const phase of ['preparing', 'awaiting-go', 'stuck']) {
    const text = finisherResumed({ phase });
    assert.match(text, /pir-finisher/, phase);
    assert.match(text, GO, phase);
    assert.match(text, /only look/, phase);
  }
  assert.match(finisherResumed({ phase: 'awaiting-go' }), /lost with the restart: ask it again/);
  assert.match(finisherResumed({ phase: 'done' }), /nothing left/);
  assert.match(finisherResumed(), /preparing/);
  const odd = finisherResumed({ phase: 'finishing' });
  assert.doesNotMatch(odd, /preparing/);
  assert.match(odd, /Your phase is finishing\. Tell the person/);
});

test('resumed after finishing carries the stuck summary and says a fresh go is needed', () => {
  const summary = 'the finisher restarted mid-finish; it will check what is already done';
  const text = finisherResumed({ phase: 'stuck', stuckSummary: summary });
  assert.ok(text.includes(summary));
  assert.match(text, /fresh go/);
  assert.match(text, /does not carry over/);
  assert.match(text, /`stuck` status/);
  assert.match(text, GO);
});

test('refusal names the file and why; nothing changed', () => {
  assert.match(finisherRefusal('`done` is accepted in finishing only', '17-a.json'), /^Your status file 17-a\.json was refused: `done` is accepted in finishing only\. Nothing changed\./);
  assert.match(finisherRefusal('not JSON'), /^Your status file was refused: not JSON\./);
  assert.doesNotMatch(finisherRefusal('not JSON.', 'a.json'), /\.\./);
});

test('resumed restates the run\'s target branch when given one', () => {
  assert.match(finisherResumed({ phase: 'awaiting-go', base: 'dev' }), /The target branch is still `dev`\./);
  assert.doesNotMatch(finisherResumed({ phase: 'awaiting-go' }), /target branch/);
});

test('resynced names the run\'s base and its new tip, returns to preparing and voids the old steps and go', () => {
  const text = finisherResynced({ base: 'dev', baseSha: '0123456789abcdef0123' });
  assert.match(text, /^dev moved to 0123456789ab /);
  assert.match(text, /back to preparing/);
  assert.match(text, /no longer count/);
  assert.match(text, /fresh `ready` status/);
  assert.match(text, GO);
  assert.match(finisherResynced({}), /a new tip/);
});

test('gate refusal differs between look-only phases and done, and names the tool', () => {
  const look = finisherGateRefusal('Edit', 'awaiting-go');
  const done = finisherGateRefusal('Edit', 'done');
  assert.notEqual(look, done);
  assert.match(look, /^Edit was refused: your phase is awaiting-go/);
  assert.match(look, /only look until the person says go/);
  assert.match(look, /Write into the status folder only/);
  assert.match(look, /AskUserQuestion/);
  assert.match(done, /phase is done, and nothing more may run/);
  assert.doesNotMatch(done, /Allowed:/);
  for (const phase of ['preparing', 'stuck']) assert.match(finisherGateRefusal('Bash', phase), new RegExp(`phase is ${phase}, so you may only look`));
  const finishing = finisherGateRefusal(undefined, 'finishing');
  assert.match(finishing, /^that tool was refused\. Do not work around it/);
  assert.match(finishing, /`stuck` status/);
  assert.match(finishing, GO);
  assert.match(finisherGateRefusal('Edit', 'weird'), /^Edit was refused by pir in phase weird/);
});

test('not-go quotes the answer, keeps the fence shut and says to wait', () => {
  const text = finisherNotGo('Not yet');
  assert.match(text, /answered "Not yet", not Go/);
  assert.match(text, /may still only look/);
  assert.match(text, /wait/);
  assert.match(text, /only when they ask you to/);
  assert.match(finisherNotGo(''), /answered something other than Go/);
});

test('finisherStaleGo: the Go did not count; the fence is shut and the question must be asked again (T04)', () => {
  const text = finisherStaleGo('preparing');
  assert.match(text, /does not count/);
  assert.match(text, /\(preparing\)/);
  assert.match(text, /may still only look/);
  assert.match(text, /header `Go`, options `Go` and `Not yet`/);
});

test('every message is plain text under 1500 characters, even with long inputs', () => {
  const long = 'x'.repeat(5000);
  const texts = [
    ...['project', 'yours', 'default', 'built-in'].map((s) => finisherOpening({ ...base, rulesSource: s })),
    ...PHASES.map((phase) => finisherResumed({ phase, stuckSummary: long })),
    finisherRefusal(long, '1-a.json'),
    finisherResynced({ base: 'dev', baseSha: long }),
    ...PHASES.map((phase) => finisherGateRefusal('WebFetch', phase)),
    finisherNotGo(long),
    ...[...PHASES, undefined].map((phase) => finisherStaleGo(phase)),
  ];
  for (const t of texts) {
    assert.equal(typeof t, 'string');
    assert.ok(t.length < 1500, `${t.length} chars: ${t.slice(0, 80)}`);
    assert.doesNotMatch(t, /\x1b\[/); // no terminal escapes
    assert.doesNotMatch(t, /undefined|null|\[object/);
  }
});

test('boundary: the module reads no clock, randomness or environment', () => {
  const src = readFileSync(new URL('./finisher-brief.mjs', import.meta.url), 'utf8');
  for (const token of [/\bDate\b/, /Math\.random/, /\bprocess\./, /\bglobalThis\b/, /^\s*import\b/m, /\bimport\(/]) {
    assert.doesNotMatch(src, token, `finisher-brief.mjs matches ${token}`);
  }
});
