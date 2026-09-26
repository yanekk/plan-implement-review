#!/usr/bin/env node
// Canned scripts for every Claude session of a planning run and the build it starts (pir-plan-command
// DESIGN §4, §5 End to end). Each returns steps for the fake (claude-stream.mjs); put them in a
// PIR_FAKE_CLAUDE_SCRIPTS file behind writeClaudeShim, keyed by the opening message:
//
//   [{ match: PLANNER_MATCH, script: plannerScript({ slug, question }) },
//    { match: REVIEWER_MATCH, script: reviewerScript({ slug }) },
//    ...workerScripts()]
//
// The sessions do real work in their cwd through `sh` steps: they write files, commit them and drop
// report files where the real sessions would, so everything pir checks against git holds. The work
// itself is done by this file run as a program (`node sessions.mjs <command>`, bottom), so the shell
// lines stay one quoted call each instead of a heredoc of JavaScript.
//
// Commits carry a fixed identity (`-c user.name/user.email`), since a scratch repo may have none.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assistantText, canUseTool, initEvent, resultEvent, toolUse } from './claude-stream.mjs';

const SELF = fileURLToPath(import.meta.url);

// The opening instructions pir sends (DESIGN §2.3, and platform.mjs openingInstruction for workers).
export const PLANNER_MATCH = 'Load the pir-plan skill';
export const REVIEWER_MATCH = 'Load the pir-review-plan skill';
export const IMPLEMENT_MATCH = 'nothing else: pir-implement T\\d+';
export const REVIEW_MATCH = 'nothing else: pir-review T\\d+';

// The minimal plan's one task.
export const FAKE_TASK = { num: 'T01', slug: 'first-task' };

const q = (s) => `'${String(s).replaceAll("'", `'\\''`)}'`;
const run = (...args) => [process.execPath, SELF, ...args].map(q).join(' ');
const GIT = "git -c user.name='pir fake' -c user.email=fake@pir.invalid";

// A plain spoken turn's closing: the assistant text and a success result.
const say = (text) => [{ emit: assistantText(text) }, { emit: resultEvent('success', text) }];

// plannerScript({ slug, question }) → steps: asks the person one AskUserQuestion, then writes a minimal
// plan under plans/{slug}/ that parses and is ready for review, commits it and drops `planned`.
export function plannerScript({ slug, question = 'Which way should the plan go?' }) {
  const questions = [
    {
      question,
      header: 'Direction',
      multiSelect: false,
      options: [
        { label: 'Small', description: 'one task' },
        { label: 'Large', description: 'also one task, it is a fake' },
      ],
    },
  ];
  return [
    { await: 'user' },
    { emit: initEvent() },
    { emit: assistantText('I read the brief. One question before I write the plan.') },
    { emit: toolUse('toolu_plan-ask-1', 'AskUserQuestion', { questions }) },
    { emit: canUseTool('plan-ask-1', 'AskUserQuestion', { questions }, { requires_user_interaction: true }) },
    { await: 'control_response' },
    { resultFor: 'plan-ask-1' },
    { sh: `${run('write-plan', slug)} && ${GIT} add -A ${q(`plans/${slug}`)} && ${GIT} commit -q -m ${q(`plan(${slug}): fake plan`)}` },
    { sh: run('report', '{{reportsDir}}', 'plan', `[pir:v1 kind=planned plan=${slug}]\nThe plan is committed.`) },
    ...say(`The plan ${slug} is committed.`),
  ];
}

// reviewerScript({ slug }) → steps: marks the plan reviewed in its PROGRESS.md, commits, drops `reviewed`.
export function reviewerScript({ slug }) {
  return [
    { await: 'user' },
    { emit: initEvent() },
    { emit: assistantText(`Reading plan ${slug} back.`) },
    { sh: `${run('review-plan', slug)} && ${GIT} commit -q -am ${q(`plan-review(${slug}): clean`)}` },
    { sh: run('report', '{{reportsDir}}', 'plan', `[pir:v1 kind=reviewed plan=${slug}]\nThe plan is reviewed.`) },
    ...say(`Plan ${slug} is reviewed.`),
  ];
}

// noPlanScript() → steps: the person called the plan off; nothing is written, `no-plan` is dropped.
export function noPlanScript() {
  return [
    { await: 'user' },
    { emit: initEvent() },
    { sh: run('report', '{{reportsDir}}', 'plan', '[pir:v1 kind=no-plan plan=-]\nThe person called it off.') },
    ...say('No plan, as you asked.'),
  ];
}

// workerScripts() → [{ match, script }] for build workers. The implementer marks its row 🔍, commits and
// drops `implemented`; the reviewer marks it ✅, commits, integrates the feature branch and drops `done`
// (pir-worker contract). Task and slug come from the opening message and the branch, as a real worker's do.
export function workerScripts() {
  const worker = (phase, state, kind, integrate) => [
    { await: 'user' },
    { emit: initEvent() },
    { emit: assistantText(`Running ${phase}.`) },
    {
      sh:
        `${run('mark', state)} && ${GIT} commit -q -am "$(${run('commit-message', phase)})"` +
        (integrate ? ` && ${GIT} merge -q --no-edit "$(${run('feature-branch')})"` : ''),
    },
    { sh: run('worker-report', kind) },
    ...say(`${phase} finished.`),
  ];
  return [
    { match: IMPLEMENT_MATCH, script: worker('pir-implement', '🔍', 'implemented', false) },
    { match: REVIEW_MATCH, script: worker('pir-review', '✅', 'done', true) },
  ];
}

// ---- The plan the fake planner writes. ----

export function fakePlanFiles(slug) {
  const { num, slug: task } = FAKE_TASK;
  return {
    [`plans/${slug}/DESIGN.md`]: `---\nsetup: none\ntest:\n  - true\n---\n\n# ${slug} — Design\n\nWritten by the fake planner (src/shell/fake/sessions.mjs).\n`,
    [`plans/${slug}/PLAN.md`]: `# ${slug} — Plan\n\n| # | Task | Depends on |\n|---|---|---|\n| ${num} | ${task} | — |\n`,
    [`plans/${slug}/PROGRESS.md`]:
      `# Progress\n\n**Plan reviewed:** not yet\n\n**Status:** Planned. Nothing built.\n**Next \`pir-work\` will:** ${num} ${task}.\n\n` +
      `## Tasks\n\n| # | Task | Depends on | State | Notes |\n|---|---|---|---|---|\n| ${num} | ${task} | — | ⬜ | |\n\n**Review queue:** *(empty)*\n`,
    [`plans/${slug}/FINDINGS.md`]: '# Findings log\n\n| Date | | Finding |\n|---|---|---|\n',
    [`plans/${slug}/tasks/${num}-${task}.md`]: `# ${num} — ${task}\n\n## Goal\n\nNothing; the fake builds it.\n`,
  };
}

// ---- As a program: the work the `sh` steps do. ----

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

// The worker's branch is pir/{slug}-T{nn} (DESIGN §2.9 of parallel mode).
function branchParts() {
  const m = /^pir\/(.+)-(T\d+)$/.exec(git('branch', '--show-current'));
  if (!m) throw new Error('not on a task branch pir/{slug}-T{nn}');
  return { slug: m[1], task: m[2] };
}

function setRowState(file, task, state) {
  const text = readFileSync(file, 'utf8');
  const re = new RegExp(`^(\\|\\s*${task}\\s*\\|(?:[^|]*\\|){2}\\s*)\\S+(\\s*\\|)`, 'm');
  if (!re.test(text)) throw new Error(`no row ${task} in ${file}`);
  writeFileSync(file, text.replace(re, `$1${state}$2`));
}

function dropReport(dir, label, text) {
  if (!dir) throw new Error('no reports folder (the opening message named none)');
  mkdirSync(dir, { recursive: true });
  const f = join(dir, `${Date.now()}-${label}-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(`${f}.tmp`, JSON.stringify({ from: 'pir fake claude', text }));
  renameSync(`${f}.tmp`, f);
}

function cli([cmd, ...args]) {
  if (cmd === 'write-plan') {
    for (const [path, content] of Object.entries(fakePlanFiles(args[0]))) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    }
  } else if (cmd === 'review-plan') {
    const file = `plans/${args[0]}/PROGRESS.md`;
    const text = readFileSync(file, 'utf8');
    if (!/\*\*Plan reviewed:\*\* not yet/.test(text)) throw new Error(`${file} has no unreviewed gate line`);
    writeFileSync(file, text.replace(/\*\*Plan reviewed:\*\* not yet.*/, '**Plan reviewed:** yes — read back by the fake reviewer'));
  } else if (cmd === 'report') {
    dropReport(args[0], args[1], args[2]);
  } else if (cmd === 'mark') {
    const { slug, task } = branchParts();
    setRowState(`plans/${slug}/PROGRESS.md`, task, args[0]);
  } else if (cmd === 'commit-message') {
    const { task } = branchParts();
    process.stdout.write(args[0] === 'pir-review' ? `${task} review: clean` : `${task}: fake implementation`);
  } else if (cmd === 'feature-branch') {
    process.stdout.write(`pir/${branchParts().slug}`);
  } else if (cmd === 'worker-report') {
    const { slug, task } = branchParts();
    const main = dirname(resolve(git('rev-parse', '--git-common-dir')));
    dropReport(join(main, 'plans', slug, '.parallel', 'control', 'reports'), task, `[pir:v1 kind=${args[0]} task=${task}]\n${args[0]}`);
  } else {
    throw new Error(`sessions.mjs: unknown command "${cmd}"`);
  }
}

if (process.argv[1] === SELF) {
  try {
    cli(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exit(1);
  }
}
