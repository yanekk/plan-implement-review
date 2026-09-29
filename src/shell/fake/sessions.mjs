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
export const COORDINATOR_MATCH = 'Invoke the pir-coordinator skill';

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
//
// `mergeArgs` goes into the reviewer's integrate. With several tasks side by side their PROGRESS.md rows
// are adjacent lines, so a plain merge of the feature branch conflicts (the T07 drill's middle task did);
// the drill passes `-X ours`, keeping the task's own row, as the coordinator folds PROGRESS.md at merge.
export function workerScripts({ mergeArgs = '' } = {}) {
  const worker = (phase, state, kind, integrate) => [
    { await: 'user' },
    { emit: initEvent() },
    { emit: assistantText(`Running ${phase}.`) },
    {
      sh:
        `${run('mark', state)} && ${GIT} commit -q -am "$(${run('commit-message', phase)})"` +
        (integrate ? ` && ${GIT} merge -q --no-edit ${mergeArgs ? `${mergeArgs} ` : ''}"$(${run('feature-branch')})"` : ''),
    },
    { sh: run('worker-report', kind) },
    ...say(`${phase} finished.`),
  ];
  return [
    { match: IMPLEMENT_MATCH, script: worker('pir-implement', '🔍', 'implemented', false) },
    { match: REVIEW_MATCH, script: worker('pir-review', '✅', 'done', true) },
  ];
}

// coordinatorScript() → steps for the run's coordinator agent (pir-coordinator T05). It says it is ready,
// then answers the end brief with a `report` decision in its drop folder (the `Drop folder:` line of its
// opening), and acknowledges the hand-off. It holds no worker's item: in the rigs using it, no worker asks
// anything, so the next message it gets after its opening is the end brief. Without it the agent never
// writes its report and a run with the agent on waits at the end for ever.
export function coordinatorScript() {
  return [
    { await: 'user' },
    { emit: initEvent() },
    ...say('Coordinator ready.'),
    { await: 'user' },
    { emit: initEvent() },
    { sh: run('coordinator-report') },
    ...say('The delivery report is written.'),
    { await: 'user' },
    { emit: initEvent() },
    ...say('The branch is ready for you to merge.'),
  ];
}

// ---- The coordinator drill (pir-coordinator T07). ----
//
// A reviewed three-task plan whose implementers each ask one thing before they build, and an agent that
// reacts to whatever pir sends it, in whatever order it comes (the fake's `react` step running
// `coordinator-react`, below):
//   T01 asks to run a routine command      → the agent allows it; the row never reads `asking you`
//   T02 asks to force-push its branch      → reserved (destructive, DESIGN §2.4): the person's at once,
//                                            the agent passes it with its pointer
//   T03 asks a question with two options   → the agent passes it on with its pointer
// Every other message gets a one-line reply naming what it was: the end brief is answered with the
// report (after DRILL_REPORT_DELAY_MS, so `preparing` is on screen long enough to be seen), the hand-off
// with the merge line, anything the person types with `Noted: …`.
export const DRILL_SLUG = 'drill';
export const DRILL_TASKS = [
  { num: 'T01', slug: 'routine-ask', deps: [] },
  { num: 'T02', slug: 'reserved-ask', deps: [] },
  { num: 'T03', slug: 'passed-question', deps: [] },
];
export const DRILL_ROUTINE = { command: 'git status --short', description: 'Check the worktree is clean' };
export const DRILL_RESERVED = { command: 'git push --force origin HEAD', description: 'Force-push the task branch' };
export const DRILL_QUESTION = 'Should the drill log be kept after the run?';
export const DRILL_REPORT_DELAY_MS = 3000;
// How long the fake agent thinks before it passes a question set on. A real agent takes seconds; the drills
// assert the row read `asking coordinator` while the agent held it, and since the loop wakes on the
// agent's decision file (fast-tests T01) an instant pass would be off the screen before the `pir` screen's
// 500 ms refresh could show it.
export const DRILL_PASS_DELAY_MS = 1500;

// drillScripts() → [{ match, script }]: the three implementers (before the generic entries, since the
// fake takes the first match), the generic implement/review workers, and the reacting agent.
export function drillScripts() {
  const questions = [
    {
      question: DRILL_QUESTION,
      header: 'Drill log',
      multiSelect: false,
      options: [
        { label: 'Keep it', description: 'under the control folder' },
        { label: 'Delete it', description: 'with the worktree' },
      ],
    },
  ];
  const asks = {
    T01: ['Bash', DRILL_ROUTINE, { description: DRILL_ROUTINE.description }],
    T02: ['Bash', DRILL_RESERVED, { description: DRILL_RESERVED.description }],
    T03: ['AskUserQuestion', { questions }, { requires_user_interaction: true }],
  };
  const implementer = (num) => {
    const [tool, input, extra] = asks[num];
    const id = `${num.toLowerCase()}-ask`;
    return [
      { await: 'user' },
      { emit: initEvent() },
      { emit: assistantText(`Running pir-implement for ${num}. One thing first.`) },
      { emit: toolUse(`toolu_${id}`, tool, input) },
      { emit: canUseTool(id, tool, input, extra) },
      { await: 'control_response' },
      { resultFor: id, allowed: 'ok' },
      { sh: `${run('mark', '🔍')} && ${GIT} commit -q -am "$(${run('commit-message', 'pir-implement')})"` },
      { sh: run('worker-report', 'implemented') },
      ...say('pir-implement finished.'),
    ];
  };
  return [
    ...DRILL_TASKS.map((t) => ({ match: `nothing else: pir-implement ${t.num}\\b`, script: implementer(t.num) })),
    ...workerScripts({ mergeArgs: '-X ours' }),
    { match: COORDINATOR_MATCH, script: [{ react: run('coordinator-react') }] },
  ];
}

// ---- The end-helper drill (pir-coordinator T11). ----
//
// A reviewed one-task plan whose test line fails until a file `fixed.txt` is committed, so the end gate is
// red and the run spawns its tests-fix helper in the feature worktree. The helper asks the person one
// question before it fixes anything; the agent (coordinatorReact) passes it on; once answered, the helper
// commits the file and reports done, the tests go green and the run ends in `ready to merge`.
export const HELPER_DRILL_SLUG = 'helper';
export const HELPER_DRILL_QUESTION = 'The tests want fixed.txt. Should I add it?';
// The tests-red prompt the helper is opened with (conflict.mjs testsRedPrompt).
export const TESTS_FIX_MATCH = 'here in this worktree\\. Make it pass\\.';

export function helperDrillScripts() {
  const questions = [
    {
      question: HELPER_DRILL_QUESTION,
      header: 'Test fix',
      multiSelect: false,
      options: [
        { label: 'Add it', description: 'commit fixed.txt on the feature branch' },
        { label: 'Leave it red', description: 'the run ends not ready' },
      ],
    },
  ];
  const fixer = [
    { await: 'user' },
    { emit: initEvent() },
    { emit: assistantText('The plan\'s tests fail on the feature branch. One question before I fix them.') },
    { emit: toolUse('toolu_fix-ask', 'AskUserQuestion', { questions }) },
    { emit: canUseTool('fix-ask', 'AskUserQuestion', { questions }, { requires_user_interaction: true }) },
    { await: 'control_response' },
    { resultFor: 'fix-ask', allowed: 'ok' },
    { sh: `echo ok > fixed.txt && ${GIT} add fixed.txt && ${GIT} commit -q -m "tests-fix: add fixed.txt"` },
    { sh: run('helper-report', 'tests-fix', 'done') },
    ...say('The tests pass now.'),
  ];
  return [
    { match: TESTS_FIX_MATCH, script: fixer },
    ...workerScripts(),
    { match: COORDINATOR_MATCH, script: [{ react: run('coordinator-react') }] },
  ];
}

export function helperDrillPlanFiles(slug = HELPER_DRILL_SLUG) {
  const { num, slug: task } = FAKE_TASK;
  return {
    [`plans/${slug}/DESIGN.md`]: `---\nsetup: none\ntest:\n  - test -f fixed.txt\n---\n\n# ${slug} — Design\n\nThe end-helper drill's plan (src/shell/fake/sessions.mjs).\n`,
    [`plans/${slug}/PLAN.md`]: `# ${slug} — Plan\n\n| # | Task | Depends on |\n|---|---|---|\n| ${num} | ${task} | — |\n`,
    [`plans/${slug}/PROGRESS.md`]:
      `# Progress\n\n**Plan reviewed:** yes — the drill's plan\n\n**Status:** Planned. Nothing built.\n\n` +
      `## Tasks\n\n| # | Task | Depends on | State | Notes |\n|---|---|---|---|---|\n| ${num} | ${task} | — | ⬜ | |\n\n**Review queue:** *(empty)*\n`,
    [`plans/${slug}/FINDINGS.md`]: '# Findings log\n\n| Date | | Finding |\n|---|---|---|\n',
    [`plans/${slug}/tasks/${num}-${task}.md`]: `# ${num} — ${task}\n\n## Goal\n\nNothing; the fake builds it.\n`,
  };
}

export function drillPlanFiles(slug = DRILL_SLUG) {
  const rows = DRILL_TASKS.map((t) => `| ${t.num} | ${t.slug} | ${t.deps.join(', ') || '—'} | ⬜ | |`).join('\n');
  const files = {
    [`plans/${slug}/DESIGN.md`]: `---\nsetup: none\ntest:\n  - true\n---\n\n# ${slug} — Design\n\nThe coordinator drill's plan (src/shell/fake/sessions.mjs).\n`,
    [`plans/${slug}/PLAN.md`]: `# ${slug} — Plan\n\n| # | Task | Depends on |\n|---|---|---|\n${DRILL_TASKS.map((t) => `| ${t.num} | ${t.slug} | — |`).join('\n')}\n`,
    [`plans/${slug}/PROGRESS.md`]:
      `# Progress\n\n**Plan reviewed:** yes — the drill's plan\n\n**Status:** Planned. Nothing built.\n\n` +
      `## Tasks\n\n| # | Task | Depends on | State | Notes |\n|---|---|---|---|---|\n${rows}\n\n**Review queue:** *(empty)*\n`,
    [`plans/${slug}/FINDINGS.md`]: '# Findings log\n\n| Date | | Finding |\n|---|---|---|\n',
  };
  for (const t of DRILL_TASKS) files[`plans/${slug}/tasks/${t.num}-${t.slug}.md`] = `# ${t.num} — ${t.slug}\n\n## Goal\n\nNothing; the fake builds it.\n`;
  return files;
}

// coordinatorReact(message, dropDir) → the agent's reply to one message, writing a decision file first
// when the message is a brief it answers (DESIGN §2.3, §2.5, §2.9).
export function coordinatorReact(message, dropDir, { now = Date.now } = {}) {
  const field = (re) => re.exec(message)?.[1] ?? null;
  const worker = field(/^Worker: `([^`]+)`$/m);
  const requestId = field(/^requestId: `([^`]+)`$/m);
  const task = field(/^Task: (\S+)$/m) ?? 'a task';
  const drop = (decision) => {
    mkdirSync(dropDir, { recursive: true });
    const f = join(dropDir, `${now()}-${decision.kind}-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(`${f}.tmp`, JSON.stringify(decision));
    renameSync(`${f}.tmp`, f);
  };
  if (worker && /This one is the person's/.test(message)) {
    drop({ kind: 'pass', worker, requestId: requestId ?? undefined, reason: 'a destructive command is yours to approve', suggestion: 'allow it: the task branch is the worker\'s own' });
    return `${task} wants to force-push its task branch, and that is yours: it is a destructive command. Answer it in ${task}'s conversation; I would allow it.`;
  }
  if (worker && /^A worker is asking permission/.test(message)) {
    drop({ kind: 'permission', worker, requestId, decision: 'allow', reason: 'a read-only git command' });
    return `Allowed ${task}'s request: a read-only git command.`;
  }
  if (worker && task === 'tests-fix' && /^A worker is asking a set of questions/.test(message)) {
    execFileSync('sleep', [String(DRILL_PASS_DELAY_MS / 1000)]);
    drop({ kind: 'pass', worker, requestId, reason: 'how to fix the plan\'s tests is a judgement', suggestion: 'Add it' });
    return `${task} asks how to make the plan's tests pass, and that is a judgement about the plan. Answer it in ${task}'s conversation; I would add the file.`;
  }
  if (worker && /^A worker is asking a set of questions/.test(message)) {
    execFileSync('sleep', [String(DRILL_PASS_DELAY_MS / 1000)]);
    drop({ kind: 'pass', worker, requestId, reason: 'the design does not say', suggestion: 'Keep it' });
    return `${task} asks whether the drill log should be kept, and the design does not say. Answer it in ${task}'s conversation; I would keep it.`;
  }
  if (worker && /^A worker dropped a question/.test(message)) {
    drop({ kind: 'pass', worker, reason: 'the design does not say', suggestion: 'carry on' });
    return `${task} is waiting on a question the design does not answer. Answer it in ${task}'s conversation.`;
  }
  if (/^Every task is done/.test(message)) {
    execFileSync('sleep', [String(DRILL_REPORT_DELAY_MS / 1000)]);
    drop({ kind: 'report', sections: { delivered: 'The three drill tasks.', checkByHand: 'Nothing.', risks: 'None.' } });
    return 'The delivery report is written.';
  }
  const merge = /git merge (pir\/\S+)/.exec(message);
  if (/^The delivery report is committed/.test(message)) {
    return merge ? `The branch is ready. Merge it yourself with: git merge ${merge[1]}` : 'The branch is not ready to merge; the report says why.';
  }
  return `Noted: ${message.split('\n')[0].slice(0, 120)}`;
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
  } else if (cmd === 'coordinator-report') {
    const dir = /^Drop folder: (.+)$/m.exec(process.env.FAKE_OPENING ?? '')?.[1];
    if (!dir) throw new Error('no drop folder (the opening message named none)');
    mkdirSync(dir, { recursive: true });
    const sections = { delivered: 'The fake plan\'s one task.', checkByHand: 'Nothing.', risks: 'None.' };
    const f = join(dir, `${Date.now()}-report.json`);
    writeFileSync(`${f}.tmp`, JSON.stringify({ kind: 'report', sections }));
    renameSync(`${f}.tmp`, f);
  } else if (cmd === 'coordinator-react') {
    const dir = /^Drop folder: (.+)$/m.exec(process.env.FAKE_OPENING ?? '')?.[1];
    if (!dir) throw new Error('no drop folder (the opening message named none)');
    process.stdout.write(coordinatorReact(process.env.FAKE_MESSAGE ?? '', dir) + '\n');
  } else if (cmd === 'helper-report') {
    // An end-of-run helper runs in the feature worktree, on pir/{slug} (coordinate.mjs spawnHelper).
    const slug = /^pir\/(.+)$/.exec(git('branch', '--show-current'))?.[1];
    if (!slug) throw new Error('not on a feature branch pir/{slug}');
    const main = dirname(resolve(git('rev-parse', '--git-common-dir')));
    dropReport(join(main, 'plans', slug, '.parallel', 'control', 'reports'), args[0], `[pir:v1 kind=${args[1]} task=${args[0]}]\n${args[1]}`);
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
