// Golden tests over the coordinator agent's base definition, skills/pir-coordinator/SKILL.md
// (pir-coordinator DESIGN §2.2–§2.10, T02). The skill is prose the agent follows, and the command
// (T01's readDecision/checkDecision, T03's gate) is the code that reads what it writes; the risk is
// drift between the two. So these read the real skill file on disk and check it names every decision
// shape, both reserved kinds, the pointer and the hand-off.
//
// A test file may reach for the filesystem; the core logic it guards may not (boundary.test.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILL = readFileSync(join(ROOT, 'skills/pir-coordinator/SKILL.md'), 'utf8');
const INSTALL = readFileSync(join(ROOT, 'install.sh'), 'utf8');

// The frontmatter is flat `key: value` lines between two `---` lines at the top of the file.
function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([a-z-]+):\s*(.*)$/);
    assert.ok(kv, `frontmatter line does not parse: ${line}`);
    out[kv[1]] = kv[2];
  }
  return out;
}

// The section runs from its `## ` heading to the next `## ` heading or the end of the file.
function section(text, heading) {
  const start = text.indexOf(`\n## ${heading}\n`);
  if (start === -1) return null;
  const rest = text.slice(start + 1);
  const next = rest.indexOf('\n## ', 3);
  return next === -1 ? rest : rest.slice(0, next);
}

// Every JSON object line inside a ```json block: the decision shapes the skill shows the agent.
function shownDecisions(text) {
  const blocks = [...text.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
  return blocks.flatMap((b) => b.split('\n').filter((l) => l.trim().startsWith('{')).map((l) => JSON.parse(l)));
}

// The decision kinds and their fields, as T01's readDecision accepts them.
const KINDS = {
  permission: ['worker', 'requestId', 'decision', 'reason'],
  answers: ['worker', 'requestId', 'answers', 'reason'],
  message: ['worker', 'text', 'reason'],
  pass: ['worker', 'requestId', 'reason', 'suggestion'],
  report: ['sections'],
  close: [],
};

test('frontmatter parses, is named pir-coordinator, and is not user-invocable', () => {
  const fm = frontmatter(SKILL);
  assert.ok(fm, 'no frontmatter');
  assert.equal(fm.name, 'pir-coordinator');
  assert.equal(fm['user-invocable'], 'false');
  assert.ok(fm.description && /opening instruction/.test(fm.description), 'description must say it is engaged by the opening instruction');
  assert.match(fm.description, /never typed/);
});

test('install.sh installs the skill', () => {
  const line = INSTALL.match(/^SKILLS=\(([^)]*)\)$/m);
  assert.ok(line, 'no SKILLS=(…) line');
  assert.ok(line[1].split(/\s+/).includes('pir-coordinator'));
});

test('every decision kind is shown with its fields, and every shown shape is valid JSON', () => {
  const shown = shownDecisions(SKILL);
  const byKind = Object.fromEntries(shown.map((d) => [d.kind, d]));
  assert.deepEqual(Object.keys(byKind).sort(), Object.keys(KINDS).sort(), 'the skill must show exactly the T01 kinds');
  for (const [kind, fields] of Object.entries(KINDS)) {
    for (const f of fields) assert.ok(f in byKind[kind], `${kind} is shown without its ${f} field`);
  }
  assert.deepEqual(Object.keys(byKind.report.sections).sort(), ['checkByHand', 'delivered', 'risks']);
  assert.ok(['allow', 'deny'].every((d) => SKILL.includes(`\`${d}\``)), 'permission must name allow and deny');
  assert.ok(Object.values(byKind).every((d) => !('notable' in d) || typeof d.notable === 'boolean'));
});

test('decisions are one file each, written with the Write tool into the drop folder', () => {
  const s = section(SKILL, 'Writing a decision');
  assert.ok(s);
  assert.ok(s.includes('<drop folder>/<epoch>-<rand>.json'));
  assert.match(s, /written with the Write tool/);
  assert.match(s, /Never write\s+anywhere else, never use any other tool to write/);
});

test('both reserved kinds are named and always passed on', () => {
  const s = section(SKILL, 'What always goes to the person');
  assert.ok(s);
  assert.ok(s.includes('`ask-rule`') && s.includes('`destructive`'));
  assert.ok(s.includes("this one is the person's"));
  assert.match(s, /Pass it on with a\s+`pass` decision/);
  // The answer-or-pass rule repeats it without exception.
  assert.match(section(SKILL, 'For each brief: answer, or pass on'), /"this one is the person's"\*\* — always/);
});

test('every pass says the pointer in the reply: worker and task, why, what it would pick', () => {
  const s = section(SKILL, 'Passing on: the pointer is your reply');
  assert.ok(s);
  assert.match(s, /in the same turn/);
  assert.match(s, /Say the pointer to the person in your reply/);
  assert.match(s, /which worker and task/);
  assert.match(s, /why you held back/);
  assert.match(s, /what you\s+would pick/);
});

test('the hand-off is presented to the person, and the agent never merges into the base branch or pushes', () => {
  const s = section(SKILL, 'The hand-off');
  assert.ok(s);
  assert.match(s, /Present them to the\s+person in your reply/);
  assert.ok(s.includes('git switch {base} && git merge pir/{slug}'));
  assert.match(s, /never merge into the base branch and you never push/);
  assert.match(section(SKILL, 'What you may decide'), /Never tell a worker to merge into the base branch[^]*never tell a\s+worker to push/);
  assert.doesNotMatch(SKILL, /\bmain\b(?! checkout)/, 'the skill names the base branch, never `main`');
});

test('close only on the person\'s word and only once ready to merge', () => {
  const s = section(SKILL, 'Closing the run');
  assert.ok(s);
  assert.match(s, /only when the person tells you to close the run/);
  assert.match(s, /only once the run is `ready to merge`/);
  assert.match(s, /still\s+building/);
  assert.match(s, /dashboard/);
});

test('the report brief asks for three plain-English sections and leaves decisions and footer to pir', () => {
  const s = section(SKILL, 'The report');
  assert.ok(s);
  assert.match(s, /three\s+markdown sections/);
  assert.match(s, /plain English, no jargon/);
  assert.match(s, /Decisions made for you/);
  assert.match(s, /branch footer/);
});

test('rules precedence and the notable flag are stated', () => {
  const r = section(SKILL, 'Whose rules win');
  assert.ok(r);
  assert.ok(r.indexOf('person\'s instructions') < r.indexOf('project rules file'));
  assert.match(r, /wins over this skill/);
  const d = section(SKILL, 'What you may decide');
  assert.match(d, /approve a worker adding a task/);
  assert.match(d, /notable: true/);
  assert.match(section(SKILL, 'Read first, and re-read rather than remember'), /DESIGN\.md.*PLAN\.md.*PROGRESS\.md/s);
});

// T08: the worker contract says an answer may come from the coordinator agent on the person's behalf, and
// that it counts as the person's, a task-adding yes included; the worker still addresses only the person.
test('pir-worker: the coordinator agent may answer on the person\'s behalf, and the worker never addresses it', () => {
  const worker = readFileSync(join(ROOT, 'skills/pir-worker/SKILL.md'), 'utf8');
  assert.match(worker, /coordinator agent/);
  assert.match(worker, /counts as the\s+person's/);
  assert.match(worker, /yes to adding a\s+task/);
  assert.match(worker, /never write to the agent/);
  assert.match(worker, /`ask`-bin action and a destructive command are never answered\s+by the agent/);
  assert.match(worker, /Never add a task without a yes\*\* — the person's, or the\s+coordinator agent's/);
});

// T08: the canonical docs carry the agent, and CLAUDE.md names it as the person's stand-in.
test('docs index the coordinator agent page, and CLAUDE.md names the stand-in', () => {
  const index = readFileSync(join(ROOT, 'docs/README.md'), 'utf8');
  assert.match(index, /\[coordinator-agent\.md\]\(coordinator-agent\.md\)/);
  const page = readFileSync(join(ROOT, 'docs/coordinator-agent.md'), 'utf8');
  for (const h of ['## Answer first', '## What always goes to the person', '## Passing on', '## The end of the run', '## Known limitations']) {
    assert.ok(page.includes(`\n${h}\n`), `coordinator-agent.md has ${h}`);
  }
  assert.match(page, /--no-coordinator/);
  const claude = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8');
  assert.match(claude, /the coordinator agent stands in for me/);
  assert.match(claude, /never answers an `ask`-bin action or a\s+destructive command/);
});

// T13: the hold limit replaced "no timeout"; the skill names it, the hand-over message and the pointer owed.
test('the skill names the 5-minute hold limit and the hand-over, and no longer says there is no timeout', () => {
  assert.doesNotMatch(SKILL, /no timeout/i);
  assert.match(SKILL, /hold limit is 5 minutes/);
  assert.match(SKILL, /Handed to the person/);
  assert.match(SKILL, /Reply to it with the pointer/);
  assert.match(SKILL, /may\s+still answer the item while the person has not/);
});

// T15: an item closed without the agent — who and what, a one-line correction only when its pointer sent the
// person there, never a guess.
test('the skill says the agent is told who closed an item and what, corrects its pointer in one line, never guesses', () => {
  assert.match(SKILL, /An item closed without you/);
  assert.match(SKILL, /reserved ones included/);
  assert.match(SKILL, /who closed it and what the answer was/);
  assert.match(SKILL, /If your own last reply sent the person to answer\s+it, say in one line that it is already settled and how/);
  assert.match(SKILL, /otherwise say nothing about it/);
  assert.match(SKILL, /Never guess who answered/);
  assert.match(SKILL, /An item you passed on is not reported/);
  assert.match(SKILL, /Closed with no answer/);
});
