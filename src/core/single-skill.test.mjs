// Golden tests over skills/pir-single/SKILL.md, the procedure a single run's builder and reviewer
// follow (single-runs DESIGN §2.5–§2.7, T07). The skill is prose a session follows; parseSingleReport,
// RED_LIMIT and the opening instructions in singleflow.mjs are the code on the other side of it. The
// risk is drift between the two, so these read the real skill and install.sh on disk, run every report
// header the skill shows through the real parser, and run the drop command it shows for real.
//
// A test file may reach for the filesystem and a child process; the core logic it guards may not
// (boundary.test.mjs scans non-test files only).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  RED_LIMIT,
  builderInstruction,
  decideSingleStep,
  initialSingleState,
  isValidSingleName,
  parseSingleReport,
  redMessage,
  reviewerInstruction,
} from './singleflow.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILL = readFileSync(join(ROOT, 'skills/pir-single/SKILL.md'), 'utf8');
const INSTALL = readFileSync(join(ROOT, 'install.sh'), 'utf8');

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

// A `## ` section, from its heading to the next one or the end of the file.
function section(heading) {
  const start = SKILL.indexOf(`\n## ${heading}\n`);
  assert.notEqual(start, -1, `the skill lacks a "## ${heading}" section`);
  const rest = SKILL.slice(start + 1);
  const next = rest.indexOf('\n## ', 3);
  return next === -1 ? rest : rest.slice(0, next);
}

// Prose is wrapped to the page, so a phrase may break across a line; match on the unwrapped text.
const flat = (text) => text.replace(/\s+/g, ' ');

// Every `[pir:v1 kind=… single=…]` the skill shows, with the placeholder name filled in as a session would.
function reportHeaders(text) {
  return [...text.matchAll(/\[pir:v1 kind=[^\]\n]*single=[^\]\n]*\]/g)].map((m) => m[0].replace('{name}', 'fix-readme-typo'));
}

// The drop command: the one fenced block that pipes a heredoc into `node -e`.
function dropCommand() {
  const block = [...SKILL.matchAll(/```\n([\s\S]*?)```/g)].map((m) => m[1]).find((b) => b.startsWith('node -e '));
  assert.ok(block, 'the skill shows no drop command');
  return block;
}

test('the skill exists, is named pir-single and is never typed by a person', () => {
  const fm = frontmatter(SKILL);
  assert.ok(fm, 'no frontmatter');
  assert.equal(fm.name, 'pir-single');
  assert.equal(fm['user-invocable'], 'false');
  assert.match(fm.description, /never typed by a person/);
  assert.match(fm.description, /opening instruction/);
});

test('it is keyed on the sentence both opening instructions carry, and on the role each names', () => {
  const trigger = 'You are run by `pir single`';
  const args = { reportsDir: '/r/reports', base: 'main', baseSha: 'abc1234', prompt: 'fix it' };
  const builder = builderInstruction(args);
  const reviewer = reviewerInstruction({ ...args, name: 'fix-it' });
  assert.ok(builder.includes(trigger) && reviewer.includes(trigger));
  assert.ok(flat(SKILL).includes(trigger), 'the skill must name the trigger sentence');
  // The skill tells a session how to find its role and its inputs; each phrase it quotes must be one
  // the real instruction contains.
  const skill = flat(SKILL);
  for (const [instruction, phrases] of [
    [builder, ['run it as the builder', 'Reports folder:', 'Starting point:', 'The change:']],
    [reviewer, ['run it as the reviewer of pir/', 'Reports folder:', 'Starting point:', 'The change that was asked for:']],
  ]) {
    for (const phrase of phrases) {
      assert.ok(instruction.includes(phrase), `the instruction lacks ${phrase}`);
      assert.ok(skill.includes(phrase), `the skill does not name ${phrase}`);
    }
  }
  // The instruction puts a full stop straight after the reports path; the skill must say it is not part of it.
  assert.ok(builder.includes('/r/reports. Starting point'));
  assert.match(skill, /the stop is not part of the path/);
  // The same goes for the stop straight after the starting commit.
  assert.ok(builder.includes('main at abc1234.') && reviewer.includes('main at abc1234.'));
  assert.match(skill, /The stop that closes that sentence is not part of the commit either/);
});

test('it says where the failed-setup note stands in the builder\'s instruction: before the change, not at the end', () => {
  const noted = builderInstruction({ reportsDir: '/r/reports', base: 'main', baseSha: 'abc1234', prompt: 'fix it', setupNote: 'SETUP NOTE' });
  const at = noted.indexOf('SETUP NOTE');
  assert.ok(at > noted.indexOf('Starting point:') && at < noted.indexOf('The change:'));
  assert.ok(!noted.endsWith('SETUP NOTE'));
  const s = flat(section('What binds both sessions'));
  assert.match(s, /carries a note that the setup failed \(it stands between the starting point and `The change:`\)/);
  assert.doesNotMatch(flat(SKILL), /instruction ends with a note/);
});

test('the failed-check message it tells a session to recognise is the one decideSingleStep sends', () => {
  let r = decideSingleStep(initialSingleState({ id: 'single-0a1f', base: 'main', baseSha: 'abc1234', commands: { setup: [], test: ['t'] } }), {});
  r = decideSingleStep(r.state, { reports: [{ kind: 'built', name: 'fix-typo', body: '' }] });
  r = decideSingleStep(r.state, { checks: { ok: false, failures: ['the worktree is not clean'] } });
  const sent = r.actions.find((a) => a.type === 'send');
  assert.ok(sent, 'a failed check is sent to the session');
  // The skill quotes the opening with `…` standing for the report kind.
  const quoted = flat(section('After you report')).match(/beginning `(pir did not accept your … report)`/);
  assert.ok(quoted, 'the skill quotes how a failed-check message begins');
  const [before, after] = quoted[1].split('…');
  assert.ok(sent.text.startsWith(`${before}\`built\`${after}`), `pir sends: ${sent.text}`);
});

test('every report header it shows parses with parseSingleReport, and it shows exactly the three kinds', () => {
  const headers = reportHeaders(SKILL);
  assert.ok(headers.length >= 3, 'the skill shows fewer than three report headers');
  const seen = new Map();
  for (const h of headers) {
    const parsed = parseSingleReport(`${h}\nbody`);
    assert.ok(parsed, `parseSingleReport rejects the header ${h} shown in the skill`);
    seen.set(parsed.kind, parsed.name);
  }
  assert.deepEqual([...seen.keys()].sort(), ['built', 'dropped', 'reviewed']);
  assert.equal(seen.get('built'), 'fix-readme-typo');
  assert.equal(seen.get('reviewed'), 'fix-readme-typo');
  assert.equal(seen.get('dropped'), null, 'a dropped report names no run: single=-');
});

test('the drop command writes temp-then-rename, and run for real it leaves one report the parser accepts', () => {
  const cmd = dropCommand();
  assert.match(cmd, /const t=f\+"\.tmp";fs\.writeFileSync\(t,/, 'the report is written to a .tmp file first');
  assert.match(cmd, /fs\.renameSync\(t,f\)/, 'and renamed into place');
  assert.match(cmd, /<<'PIR_EOF'\n/, 'the body goes over a quoted heredoc');
  assert.match(cmd, /\nPIR_EOF\n$/, 'the terminator sits at the start of its line');

  const dir = mkdtempSync(join(tmpdir(), 'pir-single-skill-'));
  try {
    for (const role of ['builder', 'reviewer']) {
      // A path with a space and a body with a backtick and a `$`: the quoting must carry both through.
      const reports = join(dir, `${role} run`, 'reports');
      const script = cmd
        .replace('<reports folder>', reports)
        .replace('<builder or reviewer>', role)
        .replace('{name}', 'fix-readme-typo')
        .replace('<one or two plain lines: what the change is>', 'Fixed `teh` in README, cost $0.');
      assert.doesNotMatch(script, /<reports folder>|<builder or reviewer>|\{name\}/);
      execFileSync('/bin/sh', ['-c', script], { stdio: 'pipe' });
      const files = readdirSync(reports);
      assert.equal(files.length, 1, 'one report and no leftover .tmp file');
      assert.match(files[0], /^\d+-single-[a-z0-9]+\.json$/);
      const { from, text } = JSON.parse(readFileSync(join(reports, files[0]), 'utf8'));
      assert.equal(from, role);
      assert.deepEqual(parseSingleReport(text), { kind: 'built', name: 'fix-readme-typo', body: 'Fixed `teh` in README, cost $0.' });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('it names the red limit as RED_LIMIT and quotes the messages pir really sends', () => {
  assert.equal(RED_LIMIT, 3);
  const after = flat(section('After you report'));
  assert.ok(after.includes(`A step gets ${RED_LIMIT} rounds`));
  assert.ok(after.includes(`From round ${RED_LIMIT + 1}`));
  const red = { sha: 'abcdef1234', reason: '`npm test` exited 1', logPath: '/l', tail: 'x', baseline: { ok: true }, base: 'main', baseSha: 'abc1234' };
  // The phrases the skill tells a session to recognise are the ones redMessage writes.
  const inLimit = redMessage({ ...red, round: RED_LIMIT });
  const past = redMessage({ ...red, round: RED_LIMIT + 1 });
  for (const phrase of ['pir ran the tests on your commit', 'and they failed']) {
    assert.ok(inLimit.includes(phrase) && after.includes(phrase), `red message phrase: ${phrase}`);
  }
  const limit = `past the limit of ${RED_LIMIT}`;
  assert.ok(past.includes(limit) && !inLimit.includes(limit));
  assert.ok(after.includes(limit));
  // The limit is named in the message's last line, which goes on after it: the skill must not say the
  // message ends with the phrase.
  assert.ok(past.split('\n').at(-1).includes(limit) && !past.endsWith(limit));
  assert.ok(after.includes(`the message's last line says \`${limit}\``));
  assert.match(after, /Report again only after they answer/);
  assert.match(after, /untouched starting point/);
});

test('both sessions: the worktree carve-out, scope, asking, and never merge, rebase or push (§2.6)', () => {
  const s = flat(section('What binds both sessions'));
  assert.match(s, /CLAUDE\.md § Where sessions run/);
  assert.match(s, /does not bind/);
  assert.match(s, /Work only in this worktree and only on this branch/);
  assert.match(s, /Never merge, rebase, push, or touch the base branch/);
  assert.match(s, /Change only what the prompt asks for/);
  assert.match(s, /ask before you widen it/);
  assert.match(s, /recommend they plan it with `\/plan`/);
  assert.match(s, /AskUserQuestion/);
  assert.match(s, /Green is `pir`'s word, never yours/);
  assert.match(s, /Commit before you report/);
  assert.match(s, /git status --porcelain/);
});

test('the builder: the commit message, the three name checks with single-{hex4} refused, then built', () => {
  const s = flat(section('The builder'));
  assert.ok(s.includes('`single({name}): <what the change does>`'));
  assert.ok(s.includes('git ls-tree -d {base} plans/{name}'));
  assert.ok(s.includes('git branch --list pir/{name}'));
  assert.ok(s.includes('^[a-z0-9]+(-[a-z0-9]+)*$'));
  assert.match(s, /neither form `single-\{hex4\}` nor `plan-\{hex4\}`/);
  assert.match(s, /Report `built`/);
  assert.match(s, /do not review your own work/);
  // The rule the skill states is the rule the check enforces.
  assert.equal(isValidSingleName('fix-readme-typo'), true);
  assert.equal(isValidSingleName('single-0a1f'), false);
  assert.equal(isValidSingleName('plan-0a1f'), false);
});

test('the reviewer: the diff against the starting commit, fix or ask, the commit message, then reviewed', () => {
  const s = flat(section('The reviewer'));
  assert.ok(s.includes('git diff {sha}..HEAD'));
  assert.match(s, /Fix what has one right answer/);
  assert.match(s, /Ask the person about the rest/);
  assert.ok(s.includes('`single({name}) review: <what the fix does>`'));
  assert.match(s, /Report `reviewed`/);
  assert.match(s, /Do not merge/);
});

test('after reporting it waits and changes nothing; dropping needs the person\'s agreement (§2.6, §2.12)', () => {
  const after = flat(section('After you report'));
  assert.match(after, /Wait for pir's word, and change nothing until it arrives/);
  assert.match(after, /pir did not accept your … report/);
  const drop = flat(section('Dropping'));
  assert.match(drop, /only after the person agreed to it in this conversation/);
  assert.match(drop, /too big for a single run/);
  assert.match(drop, /recommend they plan it with `\/plan`/);
  assert.match(drop, /nothing to change/);
  assert.match(drop, /says what was found/);
});

test('install.sh installs pir-single with the other skills', () => {
  const m = INSTALL.match(/^SKILLS=\(([^)]*)\)/m);
  assert.ok(m, 'install.sh must declare SKILLS');
  assert.ok(m[1].split(/\s+/).includes('pir-single'));
  assert.doesNotMatch(INSTALL.match(/^ORPHAN_SKILLS=\(([^)]*)\)/m)[1], /pir-single/);
});
