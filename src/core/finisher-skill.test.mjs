// Golden tests over the finisher's base definition, skills/pir-finisher/SKILL.md, and the two rules
// files T03 ships (finisher DESIGN §2.2, §2.4–§2.7). The skill is prose the session follows; T01's
// readStatus and isGoAnswer are the code that reads what it writes and answers. These read the real
// files on disk and check the two cannot drift: every shown status parses, and the go question's header
// and labels are the exact strings pir recognises.
//
// A test file may reach for the filesystem; the core logic it guards may not (boundary.test.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readStatus, isGoAnswer, isLookOnly, checkStatus, afterRestart } from './finisher-policy.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILL = readFileSync(join(ROOT, 'skills/pir-finisher/SKILL.md'), 'utf8');
const INSTALL = readFileSync(join(ROOT, 'install.sh'), 'utf8');
const DEFAULT_RULES = readFileSync(join(ROOT, 'rules/default/on-finish.md'), 'utf8');
const REPO_RULES = readFileSync(join(ROOT, '.pir/rules/on-finish.md'), 'utf8');

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

function section(text, heading) {
  const start = text.indexOf(`\n## ${heading}\n`);
  if (start === -1) return null;
  const rest = text.slice(start + 1);
  const next = rest.indexOf('\n## ', 3);
  return next === -1 ? rest : rest.slice(0, next);
}

// Every line of a ```json fence that is a JSON object with a `kind`.
function shownStatuses(text) {
  const out = [];
  for (const block of text.matchAll(/```json\n([\s\S]*?)```/g)) {
    for (const line of block[1].split('\n')) {
      if (!line.trim()) continue;
      out.push(JSON.parse(line));
    }
  }
  return out;
}

test('the skill is not user-invocable and is engaged by the opening instruction', () => {
  const fm = frontmatter(SKILL);
  assert.ok(fm, 'no frontmatter');
  assert.equal(fm.name, 'pir-finisher');
  assert.equal(fm['user-invocable'], 'false');
  assert.match(fm.description, /opening instruction/);
  assert.match(fm.description, /never typed/);
});

test('install.sh installs the skill', () => {
  const line = INSTALL.match(/^SKILLS=\(([^)]*)\)$/m);
  assert.ok(line, 'no SKILLS=(…) line');
  assert.ok(line[1].split(/\s+/).includes('pir-finisher'));
});

test('the skill shows exactly the ready, stuck, done and close shapes, and each parses with readStatus', () => {
  const shown = shownStatuses(SKILL);
  assert.deepEqual(shown.map((s) => s.kind).sort(), ['close', 'done', 'ready', 'stuck']);
  for (const s of shown) {
    const r = readStatus(s);
    assert.ok(r.ok, `${s.kind} as shown does not parse: ${r.why}`);
    assert.deepEqual(Object.keys(r.status).sort(), Object.keys(s).sort(), `${s.kind} shows a field readStatus drops`);
  }
});

test('statuses are written with Write into the status folder, one per file', () => {
  const s = section(SKILL, 'Writing a status');
  assert.ok(s);
  assert.match(s, /written with the Write tool/);
  assert.ok(s.includes('<status folder>/<epoch>-<rand>.json'));
  assert.match(section(SKILL, 'Your opening instruction'), /control\/finisher\/status\//);
});

test('the go question names the Go header and both labels exactly, and a skill-shaped answer is the go', () => {
  const s = section(SKILL, 'The go question');
  assert.ok(s);
  assert.match(s, /one `AskUserQuestion` call with one\s+question, header exactly `Go`, options labelled exactly `Go` and `Not yet`/);
  assert.match(s, /Write `ready` first/);
  const question = 'Finish pir/demo with the 2 steps from the project rules?';
  const input = { questions: [{ question, header: 'Go', options: [{ label: 'Go' }, { label: 'Not yet' }] }] };
  const go = (answer) => isGoAnswer({ phase: 'awaiting-go', toolName: 'AskUserQuestion', input, answers: { [question]: answer } });
  assert.equal(go('Go'), true);
  assert.equal(go('Not yet'), false);
});

test('a chat message is never the go', () => {
  assert.match(section(SKILL, 'The go question'), /Never treat a chat message as the go/);
  assert.equal((SKILL.match(/Never treat a chat message as the go/g) ?? []).length, 1, 'stated once');
});

test('look only until the go, in words, and what to check', () => {
  const look = section(SKILL, 'Look only, until the go');
  assert.ok(look);
  assert.match(look, /answers your go question with `Go`/);
  assert.match(look, /no dry runs/);
  const check = section(SKILL, 'What to check');
  assert.ok(check);
  for (const needle of ['rules file', 'status --porcelain', 'branch --show-current', 'worktree list', 'merge-tree --write-tree <target> pir/{slug}', 'command -v', 'REPORT.md']) {
    assert.ok(check.includes(needle), `What to check names ${needle}`);
  }
  assert.match(check, /Before the go, do not stash, switch or\s+clean anything/);
});

// The target is the run's, told in the opening instruction (user, 2026-09-30): the skill names no branch
// of its own, the run's target wins over a rules file, and a clean checkout elsewhere is switched as a
// listed step.
test('the target branch comes from the opening instruction, wins over the rules, and is switched to as a listed step', () => {
  assert.match(section(SKILL, 'Your opening instruction'), /\*\*target branch\*\*: the branch this run was cut from/);
  const s = section(SKILL, 'The target branch');
  assert.ok(s);
  assert.match(s, /does not come from the\s+rules file/);
  assert.match(s, /still merge into the target branch, and say in your ready summary/);
  assert.ok(s.includes('git -C <main checkout> switch <target>'));
  assert.match(s, /first step/);
  assert.match(s, /do not list a step that switches back/);
  assert.match(s, /List no step that stashes or cleans/);
  assert.match(s, /checked out in another worktree/);
  assert.match(s, /The merge runs only with the main checkout on the target branch/);
  // `main` appears only as an example of a target or of what an older rules file may say, never as the
  // branch to merge into.
  for (const line of SKILL.split('\n')) {
    if (!/`main`/.test(line)) continue;
    assert.match(line, /\(`main`, `dev`, whichever the run has\)|an older rules file may say `main`/, `the skill names main as the target: ${line}`);
  }
  assert.doesNotMatch(SKILL, /into `main`|on\s+`main`|--is-ancestor pir\/\{slug\} main/);
});

test('after the go: a failure stops, writes stuck with a proposal and asks again; success writes done; close on the person\'s word', () => {
  const s = section(SKILL, 'After the go');
  assert.ok(s);
  assert.match(s, /When a step fails\*\*, stop/);
  assert.match(s, /what is already done/);
  assert.match(s, /proposal/);
  assert.match(s, /ask the go question again/);
  assert.match(s, /write a `done` status/);
  assert.match(s, /tells you to close the run/);
  assert.match(s, /write a `close` status/);
});

test('the skill asks for plain English with the person', () => {
  assert.match(section(SKILL, 'Talking to the person'), /plain English, no jargon/);
});

test('the default rules merge into the run\'s target branch in the main checkout and confirm the tip', () => {
  assert.ok(DEFAULT_RULES.includes('merge pir/{slug}'));
  assert.match(DEFAULT_RULES, /main checkout/);
  assert.match(DEFAULT_RULES, /into the target branch/);
  assert.ok(DEFAULT_RULES.includes('git -C <main checkout> merge-base --is-ancestor pir/{slug} <target>'));
  for (const rules of [DEFAULT_RULES, REPO_RULES]) assert.doesNotMatch(rules, /`main`|\} main\b/, 'no rules file names a branch');
});

test('this repo\'s rules merge, run ./install.sh and compare the installed engine and skills', () => {
  assert.ok(REPO_RULES.includes('merge pir/{slug}'));
  assert.ok(REPO_RULES.includes('./install.sh'));
  assert.ok(REPO_RULES.includes('diff -rq src ~/.claude/pir-engine/src'));
  assert.ok(REPO_RULES.includes('~/.claude/skills/'));
  assert.match(REPO_RULES, /skills\/pir-\*/);
});

// Review T03: the skill must not tell the finisher to do what pir will refuse. Two paths it names are
// reachable only through T01's code, so the check is against that code, not against the prose.

test('every concrete look the skill asks for before the go is on the look-only list', () => {
  const check = section(SKILL, 'What to check');
  const commands = [...check.matchAll(/`((?:git|gh|command|node|npm|diff|ls|cat|<tool>)(?=\s)[^`]*)`/g)].map((m) =>
    m[1].replaceAll('<main checkout>', '/main').replaceAll('<target>', 'dev').replaceAll('{slug}', 'demo').replaceAll('<tool>', 'gh'));
  assert.ok(commands.length >= 4, `found ${commands.length} commands`);
  for (const c of commands) assert.ok(isLookOnly(c), `What to check asks for a refused command: ${c}`);
});

test('after a restart mid-finish the skill does not ask for a status pir refuses in that phase', () => {
  const { phase } = afterRestart('finishing');
  assert.equal(phase, 'stuck');
  const restart = section(SKILL, 'If you are restarted');
  assert.ok(restart);
  for (const kind of ['stuck', 'ready']) {
    if (checkStatus({ kind }, phase).ok) continue;
    assert.doesNotMatch(restart, new RegExp(`write (a|an|a fresh) \`${kind}\` status`), `${kind} is refused in ${phase}`);
  }
  assert.match(restart, /ask the go question again/);
});
