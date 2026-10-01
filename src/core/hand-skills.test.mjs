// Golden tests over what the skills tell an agent about `hand_command` (bang-commands DESIGN §2.6, T09).
// The tool is offered to build workers, the planner and plan reviewer and a single run's two sessions,
// and its description in worker-proc.mjs fences it; the skills are where an agent learns when it may use
// it. The risk is a skill that never mentions the tool (so nobody uses it) or one that drops a limit (so
// it is used to push work onto the person). The coordinator agent and the finisher get no tool, so their
// skills must not mention it.
//
// A test file may reach for the filesystem; the core logic it guards may not (boundary.test.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { HAND_TOOL } from './stream.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const skill = (name) => readFileSync(join(ROOT, `skills/${name}/SKILL.md`), 'utf8');
// Prose is wrapped to the page, so a phrase may break across a line; match on the unwrapped text.
const flat = (text) => text.replace(/\s+/g, ' ');

// A heading's section, from the heading line to the next heading of the same or higher level.
function section(text, heading) {
  const m = text.match(new RegExp(`\\n(#+) ${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n`));
  assert.ok(m, `missing heading "${heading}"`);
  const start = m.index + 1;
  const rest = text.slice(start + m[0].length - 1);
  const next = rest.search(new RegExp(`\\n#{1,${m[1].length}} `));
  return text.slice(start, next === -1 ? undefined : start + m[0].length - 1 + next);
}

// A bold-led paragraph, e.g. **Handing a command.**, up to the next blank line.
function paragraph(text, lead) {
  const start = text.indexOf(lead);
  assert.notEqual(start, -1, `missing paragraph "${lead}"`);
  const end = text.indexOf('\n\n', start);
  return text.slice(start, end === -1 ? undefined : end);
}

// The three limits of DESIGN §2.6 and requirement 12, as each passage must state them.
function assertLimits(label, passage) {
  const p = flat(passage);
  assert.match(p, /`hand_command`/, `${label}: names the tool`);
  assert.match(p, /only the person can run/, `${label}: only for a command only the person can run`);
  assert.match(p, /login/, `${label}: a login is the example of what only the person can run`);
  assert.match(p, /permission rules/, `${label}: never what its own permission rules let it run`);
  assert.match(p, /`ask` row/, `${label}: never in place of an ask row's permission prompt`);
  assert.match(p, /reason/, `${label}: with a reason`);
  assert.match(p, /judge/, `${label}: a reason the person can judge`);
}

test('the tool name the skills use is the tool pir offers', () => {
  assert.equal(HAND_TOOL, 'mcp__pir__hand_command');
  for (const name of ['pir-worker', 'pir-plan', 'pir-review-plan', 'pir-single']) {
    assert.ok(skill(name).includes('`mcp__pir__hand_command`'), `${name} names the full tool name`);
  }
});

test('pir-worker: the hand section states the tool, the three limits, no report, and the person answers', () => {
  const text = skill('pir-worker');
  const bar = section(text, 'The bar for handing something to the person: everything mechanical is yours');
  const hand = section(bar, 'Handing the person a command: the `hand_command` tool');
  assertLimits('pir-worker', hand);
  const p = flat(hand);
  assert.match(p, /`worker` row/, 'never what a worker row lets it run');
  assert.match(p, /\*\*Do not drop a report for it\.\*\*/, 'no report file for a hand');
  assert.match(p, /asking you · run a command/, 'names how the row reads');
  assert.match(p, /coordinator agent never does/, 'only the person answers a hand');
  assert.match(p, /do not hand the same command again/, 'a decline is not retried');
  assert.match(p, /from outside pir/, 'the outside-pir fallback result is explained');
});

test('pir-single: the hand paragraph in "What binds both sessions" states the tool and the three limits', () => {
  const text = skill('pir-single');
  const binds = section(text, 'What binds both sessions');
  assertLimits('pir-single', paragraph(binds, '**Handing a command.**'));
});

for (const name of ['pir-plan', 'pir-review-plan']) {
  test(`${name}: "Run by pir plan" says the session may hand a command, with the three limits`, () => {
    const run = section(skill(name), 'Run by pir plan');
    const p = paragraph(run, '**Handing a command.**');
    assertLimits(name, p);
    assert.match(flat(p), /login check/, `${name}: the login-check example`);
  });
}

for (const name of ['pir-implement', 'pir-review']) {
  test(`${name}: one line points a command handover at pir-worker, with the limits`, () => {
    const p = flat(skill(name));
    assert.match(p, /`hand_command` tool, never round a permission or an `ask` row, and always with a reason the person can judge: see `pir-worker § Handing the person a command`/);
    assert.ok(p.includes('only the person can run'), `${name}: only the person can run`);
  });
}

test('pir-coordinator and pir-finisher do not mention the hand tool', () => {
  for (const name of ['pir-coordinator', 'pir-finisher']) {
    assert.ok(!/hand_command/.test(skill(name)), `${name} must not name hand_command`);
  }
});
