// Golden tests over the "Run by pir plan" sections of the planning skills (DESIGN §2.4, §2.15, T15).
// The skills are prose a planning session follows, and parsePlanReport is the code that reads what
// that session drops; the risk is drift between them. So these read the real skill files and the
// real CLAUDE.md on disk and run every report header the skills show through the real parser.
//
// A test file may reach for the filesystem; the core logic it guards may not (boundary.test.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parsePlanReport } from './planflow.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const SKILLS = {
  'pir-plan': read('skills/pir-plan/SKILL.md'),
  'pir-review-plan': read('skills/pir-review-plan/SKILL.md'),
};
const CLAUDE_MD = read('CLAUDE.md');

// The section runs from its heading to the next `## ` heading or the end of the file.
function runByPirPlan(text) {
  const start = text.indexOf('\n## Run by pir plan\n');
  if (start === -1) return null;
  const rest = text.slice(start + 1);
  const next = rest.indexOf('\n## ', 3);
  return next === -1 ? rest : rest.slice(0, next);
}

// Every `[pir:v1 kind=… plan=…]` in a text, with a placeholder slug filled in as a session would.
function reportHeaders(text) {
  return [...text.matchAll(/\[pir:v1 kind=[^\]\n]*plan=[^\]\n]*\]/g)].map((m) => m[0].replace('{slug}', 'screen-time'));
}

// The kinds each skill is the author of (DESIGN §2.4).
const KINDS = { 'pir-plan': ['planned', 'no-plan'], 'pir-review-plan': ['reviewed', 'not-reviewed'] };

for (const [name, text] of Object.entries(SKILLS)) {
  test(`${name}: has a "Run by pir plan" section keyed on the opening instruction's sentence`, () => {
    const section = runByPirPlan(text);
    assert.ok(section, `${name} lacks a "## Run by pir plan" section`);
    // The trigger sentence the §2.3 opening instruction contains; a hand-typed command lacks it.
    assert.ok(section.includes('You are run by\n`pir plan`') || section.includes('You are run by `pir plan`'),
      `${name}'s section must name the trigger sentence`);
    // The one-line pointer near the top, so a session reading top-down finds the section first.
    const pointer = text.indexOf('read § Run by pir plan');
    assert.ok(pointer !== -1 && pointer < text.indexOf('\n## '), `${name} needs a pointer before its first stage`);
  });

  test(`${name}: every report header it shows is one parsePlanReport accepts, and it shows its kinds`, () => {
    const headers = reportHeaders(text);
    assert.ok(headers.length > 0, `${name} shows no report header`);
    const seen = new Set();
    for (const h of headers) {
      const parsed = parsePlanReport(`${h}\nbody`);
      assert.ok(parsed, `parsePlanReport rejects the header ${h} shown in ${name}`);
      seen.add(parsed.kind);
    }
    assert.deepEqual([...seen].sort(), [...KINDS[name]].sort(), `${name} should show exactly its own report kinds`);
  });

  test(`${name}: the section carries the Where-sessions-run carve-out (§2.15)`, () => {
    const section = runByPirPlan(text);
    assert.match(section, /CLAUDE\.md § Where sessions run/);
    assert.match(section, /does not\s+bind/);
    assert.match(section, /git status --porcelain/, 'the section must require a clean worktree');
  });
}

test('pir-plan: the slug check, the prototype file and no next-session hand-over (§2.15)', () => {
  const s = runByPirPlan(SKILLS['pir-plan']);
  assert.match(s, /git ls-tree -d main plans\/\{slug\}/);
  assert.match(s, /git branch --list pir\/\{slug\}/);
  assert.match(s, /plan-\{hex4\}/);
  assert.match(s, /plans\/\{slug\}\/prototype\/index\.html/);
  assert.match(s, /`open plans\/\{slug\}\/prototype\/index\.html`/);
  assert.match(s, /do not tell them to start a new session/);
});

test('pir-review-plan: settings on the plan branch and no /pir-work hand-over (§2.15)', () => {
  const s = runByPirPlan(SKILLS['pir-review-plan']);
  assert.match(s, /\.claude\/settings\.json/);
  assert.match(s, /commit them on this branch/);
  assert.match(s, /do not name `\/pir-work`/);
});

test('CLAUDE.md § Where sessions run names planning sessions run by pir plan', () => {
  const start = CLAUDE_MD.indexOf('### Where sessions run');
  assert.ok(start !== -1);
  const end = CLAUDE_MD.indexOf('\n## ', start);
  const section = CLAUDE_MD.slice(start, end === -1 ? undefined : end);
  assert.match(section, /Planning sessions run by `pir plan`/);
  assert.match(section, /Run by pir plan/);
});

test('CLAUDE.md commands table lists pir plan and pir start {slug}', () => {
  assert.match(CLAUDE_MD, /^\| `pir plan` \|/m);
  assert.match(CLAUDE_MD, /^\| `pir start \{slug\}` \|/m);
});
