#!/usr/bin/env node
// Canned scripts for every Claude session of a planning run and the build it starts (pir-plan-command
// DESIGN §4, §5 End to end), and for the builder and reviewer of a single run (single-runs T08). Each
// returns steps for the fake (claude-stream.mjs); put them in a PIR_FAKE_CLAUDE_SCRIPTS file behind
// writeClaudeShim, keyed by the opening message:
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
import { HAND_TOOL } from '../../core/bang.mjs';

const SELF = fileURLToPath(import.meta.url);

// The opening instructions pir sends (DESIGN §2.3, and platform.mjs openingInstruction for workers).
export const PLANNER_MATCH = 'Load the pir-plan skill';
export const REVIEWER_MATCH = 'Load the pir-review-plan skill';
export const IMPLEMENT_MATCH = 'nothing else: pir-implement T\\d+';
export const REVIEW_MATCH = 'nothing else: pir-review T\\d+';
export const COORDINATOR_MATCH = 'Invoke the pir-coordinator skill';
// A single run's two sessions (single-runs DESIGN §2.6, singleflow.mjs builderInstruction and
// reviewerInstruction). Both load the same skill, so the role is what tells them apart.
export const BUILDER_MATCH = 'Load the pir-single skill and run it as the builder';
export const SINGLE_REVIEWER_MATCH = 'Load the pir-single skill and run it as the reviewer of pir/';

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

// ---- A single run's builder and reviewer (single-runs T08, DESIGN §2.4–§2.7). ----
//
// They drop their reports with `single-report`, not `{{reportsDir}}`: the fake reads that path to the end
// of its line, and a single run's opening goes on after it (`. Starting point: …`).

// The file whose presence makes the rig's test line fail (plan-rig.mjs writes `test ! -f red.txt` into
// the scratch repo's settings), so a script turns pir's tests red by committing it and green by removing it.
export const SINGLE_RED_FILE = 'red.txt';

const singleReport = (kind, name, body) => ({ sh: run('single-report', kind, name, body) });
const nextTurn = () => [{ await: 'user' }, { emit: initEvent() }];

// singleBuilderScript({ name, question, takenName, red, dropAsk }) → steps. With nothing but `name` the
// builder commits a change and reports `built` under that name. The options each add one detour:
//   question   asks the person that one AskUserQuestion before it builds
//   takenName  reports `built` under that name first, and under `name` once pir's check message arrives
//   red        its first commit also adds SINGLE_RED_FILE; on pir's red message it removes the file in a
//              second commit and reports again
//   dropAsk    asks that in plain words, waits for the person's reply, then reports `dropped` and builds
//              nothing
export function singleBuilderScript({ name, question = null, takenName = null, red = false, dropAsk = null }) {
  const steps = [{ await: 'user' }, { emit: initEvent() }, { emit: assistantText('I read the change that was asked for.') }];
  if (dropAsk) {
    return [
      ...steps,
      ...say(dropAsk),
      ...nextTurn(),
      singleReport('dropped', '-', 'Too big for a single run: use /plan.'),
      ...say('Dropped, as agreed.'),
    ];
  }
  if (question) {
    const questions = [
      {
        question,
        header: 'Scope',
        multiSelect: false,
        options: [
          { label: 'Only the first', description: 'as the change says' },
          { label: 'Both files', description: 'a wider change' },
        ],
      },
    ];
    steps.push(
      { emit: toolUse('toolu_single-ask-1', 'AskUserQuestion', { questions }) },
      { emit: canUseTool('single-ask-1', 'AskUserQuestion', { questions }, { requires_user_interaction: true }) },
      { await: 'control_response' },
      { resultFor: 'single-ask-1' },
    );
  }
  steps.push({ sh: `echo fixed >> change.txt${red ? ` && echo red > ${q(SINGLE_RED_FILE)}` : ''} && ${GIT} add -A && ${GIT} commit -q -m ${q('fix: the fake change')}` });
  if (takenName) steps.push(singleReport('built', takenName, 'The change is committed.'), ...say(`Reported built as ${takenName}.`), ...nextTurn());
  steps.push(singleReport('built', name, 'The change is committed.'), ...say(`The change is committed; reported built as ${name}.`));
  if (red) {
    steps.push(
      ...nextTurn(),
      { sh: `${GIT} rm -q ${q(SINGLE_RED_FILE)} && ${GIT} commit -q -m ${q('fix: make the tests pass')}` },
      singleReport('built', name, 'Fixed and committed.'),
      ...say('The tests should pass now; reported built again.'),
    );
  }
  return steps;
}

// singleReviewerScript({ name }) → steps: commits one fix of its own and reports `reviewed`, so pir tests
// the branch a second time (a reviewer that commits nothing keeps the build's result, DESIGN §2.4 step 5).
export function singleReviewerScript({ name }) {
  return [
    { await: 'user' },
    { emit: initEvent() },
    { emit: assistantText(`Reading the change on pir/${name}.`) },
    { sh: `echo reviewed >> review.txt && ${GIT} add -A && ${GIT} commit -q -m ${q('review: a fix')}` },
    singleReport('reviewed', name, 'Reviewed; one fix committed.'),
    ...say(`pir/${name} is reviewed.`),
  ];
}

// ---- A single run's sync helpers and finisher (single-finisher T05, DESIGN §2.3, §2.7). ----

export const SINGLE_RESOLVE_MATCH = 'Load the pir-single skill and run it as the resolve helper of pir/';
export const SINGLE_FIX_MATCH = 'Load the pir-single skill and run it as the fix helper of pir/';
// The single opening's first line (finisher-brief finisherOpening, T02).
export const SINGLE_FINISHER_MATCH = 'You are the finisher of the single run';

// singleResolveScript({ name, question }) → steps: finishes the merge in progress by keeping both sides of every
// clash (the marker lines dropped), commits the merge and reports `resolved`. With `question` it first asks
// the person that one AskUserQuestion (options SINGLE_RESOLVE_OPTIONS) and waits for the answer.
export const SINGLE_RESOLVE_OPTIONS = ['Keep both', 'Keep main'];
export function singleResolveScript({ name, question = null }) {
  const ask = question
    ? [
        { emit: toolUse('toolu_resolve-ask-1', 'AskUserQuestion', { questions: [resolveQuestion(question)] }) },
        { emit: canUseTool('resolve-ask-1', 'AskUserQuestion', { questions: [resolveQuestion(question)] }, { requires_user_interaction: true }) },
        { await: 'control_response' },
        { resultFor: 'resolve-ask-1' },
      ]
    : [];
  return [
    ...nextTurn(),
    { emit: assistantText(`Resolving the clash on pir/${name}.`) },
    ...ask,
    { sh: run('resolve-both') },
    singleReport('resolved', name, 'The merge is committed, both sides kept.'),
    ...say('Resolved and committed.'),
  ];
}

const resolveQuestion = (question) => ({
  question,
  header: 'Clash',
  multiSelect: false,
  options: [
    { label: SINGLE_RESOLVE_OPTIONS[0], description: 'both sides\' lines, in order' },
    { label: SINGLE_RESOLVE_OPTIONS[1], description: 'drop the change\'s side' },
  ],
});

// singleFixScript({ name, fix }) → steps: runs the `sh` line `fix`, commits what it changed and reports
// `fixed`.
export function singleFixScript({ name, fix }) {
  return [
    ...nextTurn(),
    { emit: assistantText(`Fixing the tests on pir/${name}.`) },
    { sh: `${fix} && ${GIT} add -A && ${GIT} commit -q -m ${q('fix: make the tests pass after the sync')}` },
    singleReport('fixed', name, 'The fix is committed.'),
    ...say('Fixed and committed.'),
  ];
}

// singleFinisherScript({ name, statusDir, repoRoot, finishingMs }) → the shared fake finisher on pir/{name}:
// a `ready` status, the `Go` question, and on the go the merge into the main checkout for real, then `done`.
// `statusDir` is the finisher's status folder under the run's renamed control folder.
// `variant` is finisherScript's (`finisher-notyet`, `finisher-resync`, `finisher-exits`, …).
export function singleFinisherScript({ name, statusDir, repoRoot, finishingMs = 100, variant = 'finisher' }) {
  return finisherScript({ statusDir, repoRoot, branch: `pir/${name}`, finishingMs, merge: true, variant });
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

// ---- The bang drill (bang-commands T08). ----
//
// One session of each kind that waits for the person: a `!` in its conversation, and (planner, build worker) a
// command it hands the person through `hand_command`. Every reply is a fixed line, so a test can wait for it.
export const BANG_REPLY = 'Thanks, I read the output.';
export const BANG_HAND_COMMAND = 'printf handed';
export const BANG_HAND_REASON = 'the drill needs your pretend login';
export const BANG_HAND_REPLY = 'Got the result of the command I handed you.';
export const BANG_HAND_SLUG = 'handed';
export const BANG_HAND_TASK = { num: 'T01', slug: 'hand-ask' };
const reactWith = (text) => ({ react: `printf '%s' ${q(text)}` });
const handCall = (id) => ({ tool: { id, name: HAND_TOOL, input: { command: BANG_HAND_COMMAND, reason: BANG_HAND_REASON } } });

// bangPlannerScript() → the planner greets and ends its turn; the first message it gets (the person's `!`) it
// answers with BANG_REPLY and then hands the person BANG_HAND_COMMAND; once that is answered it says
// BANG_HAND_REPLY, and from there answers every message with BANG_REPLY. It never writes a plan.
export function bangPlannerScript() {
  return [
    { await: 'user' },
    { emit: initEvent() },
    ...say("I'm the drill's pretend planner. Run a command with ! and I'll answer."),
    { await: 'user' },
    { emit: initEvent() },
    { emit: assistantText(BANG_REPLY) },
    handCall('plan-hand'),
    ...say(BANG_HAND_REPLY),
    reactWith(BANG_REPLY),
  ];
}

// bangBuilderScript() → a single run's builder that greets, ends its turn and answers every message with
// BANG_REPLY. It never builds, so the run waits on it until the test stops it.
export function bangBuilderScript() {
  return [{ await: 'user' }, { emit: initEvent() }, ...say("I'm the drill's pretend builder. Run a command with ! and I'll answer."), reactWith(BANG_REPLY)];
}

// bangBuildScripts() → the build of BANG_HAND_SLUG: T01's implementer hands the person BANG_HAND_COMMAND
// before it builds, the run's coordinator agent reacts (coordinatorReact), and the generic reviewer follows.
export function bangBuildScripts() {
  const implementer = [
    { await: 'user' },
    { emit: initEvent() },
    { emit: assistantText('Running pir-implement for T01. I need you to run a command first.') },
    handCall('t01-hand'),
    { emit: assistantText(BANG_HAND_REPLY) },
    { sh: `${run('mark', '🔍')} && ${GIT} commit -q -am "$(${run('commit-message', 'pir-implement')})"` },
    { sh: run('worker-report', 'implemented') },
    ...say('pir-implement finished.'),
  ];
  return [
    { match: `nothing else: pir-implement ${BANG_HAND_TASK.num}\\b`, script: implementer },
    ...workerScripts(),
    { match: COORDINATOR_MATCH, script: [{ react: run('coordinator-react') }] },
  ];
}

export function bangBuildPlanFiles(slug = BANG_HAND_SLUG) {
  const { num, slug: task } = BANG_HAND_TASK;
  return {
    [`plans/${slug}/DESIGN.md`]: `---\nsetup: none\ntest:\n  - true\n---\n\n# ${slug} — Design\n\nThe bang drill's plan (src/shell/fake/sessions.mjs).\n`,
    [`plans/${slug}/PLAN.md`]: `# ${slug} — Plan\n\n| # | Task | Depends on |\n|---|---|---|\n| ${num} | ${task} | — |\n`,
    [`plans/${slug}/PROGRESS.md`]:
      `# Progress\n\n**Plan reviewed:** yes — the drill's plan\n\n**Status:** Planned. Nothing built.\n\n` +
      `## Tasks\n\n| # | Task | Depends on | State | Notes |\n|---|---|---|---|---|\n| ${num} | ${task} | — | ⬜ | |\n\n**Review queue:** *(empty)*\n`,
    [`plans/${slug}/FINDINGS.md`]: '# Findings log\n\n| Date | | Finding |\n|---|---|---|\n',
    [`plans/${slug}/tasks/${num}-${task}.md`]: `# ${num} — ${task}\n\n## Goal\n\nNothing; the fake builds it.\n`,
  };
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
  if (worker && /^A worker has handed the person a command/.test(message)) {
    // Reserved for the person (bang-commands DESIGN §2.6): the agent may only add its note.
    drop({ kind: 'pass', worker, requestId: requestId ?? undefined, reason: 'a handed command is only the person\'s to run', suggestion: 'run it' });
    return `${task} handed you a command to run, and only you run it. Answer it in ${task}'s conversation.`;
  }
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
    // A ready branch the finisher takes over carries no merge line (finisher T05).
    if (/starts the finisher/.test(message)) return 'The branch is ready. The finisher takes the merge from here.';
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

// ---- The fake finisher (finisher T07; single-finisher T05). ----
//
// The real finisher-agent session on the fake. The fake writes its own status files (a `sh` step, outside
// the fence, which is the fake's and not what is tested) into `statusDir`, named in order, each written
// aside and renamed so pir never reads half of one. The conversation rig's finisher scenarios and a single
// run's tests share it: `branch` is what it merges, `init` the init event it starts its turns with.
export const FINISHER_GO_QUESTION = 'Ready to finish? 2 steps from project rules';
export const FINISHER_SUMMARY = 'The branch is clean and its tests pass; main has not moved.';
export const FINISHER_RETRY_QUESTION = 'Retry the install? 1 step from project rules';
export const FINISHER_RESERVED_COMMAND = 'rm -rf dist/';
export const FINISHER_RECHECKED = 'Re-checked after main moved: the branch is clean and its tests pass.';
export const FINISHER_NOT_YET = 'Not yet, then. Nothing has changed; tell me when you want me to ask again.';
export const FINISHER_ASKING_AGAIN = 'Asking again.';
export const finisherStuckSummary = (branch) => `Merged ${branch} into main; ./install.sh failed: npm ci exited 1 (network unreachable). Nothing else ran.`;
export const finisherDoneSummary = (branch) => `Merged ${branch} into main and ran ./install.sh.`;
export function finisherScript({ statusDir, repoRoot, branch, init = initEvent(), finishingMs = 3000, variant = 'finisher', merge: mergeForReal = false }) {
  const writeStatus = (name, status) => {
    const json = JSON.stringify(status).replace(/'/g, `'\\''`);
    const dest = join(statusDir, name);
    return { sh: `printf '%s' '${json}' > '${dest}.tmp' && mv '${dest}.tmp' '${dest}'` };
  };
  const steps = [`git -C ${repoRoot} merge ${branch}`, './install.sh'];
  const say = (text) => [{ emit: assistantText(text) }];
  // The go question (DESIGN §2.7): header and options exactly `Go` and `Not yet`.
  const goQuestion = (id, question, n) => ({
    tool: {
      id,
      name: 'AskUserQuestion',
      input: { questions: [{ question, header: 'Go', multiSelect: false, options: [{ label: 'Go', description: `run the ${n} step${n === 1 ? '' : 's'}` }, { label: 'Not yet', description: 'change nothing' }] }] },
    },
  });
  const bash = (id, command, description) => ({ tool: { id, name: 'Bash', input: { command, description } } });
  const done = [
    writeStatus('9-done.json', { kind: 'done', summary: finisherDoneSummary(branch) }),
    ...say('Done: merged and installed.'),
    { emit: resultEvent('success', 'finished') },
    { chat: { workMs: 300, init: init } },
  ];
  const opening = [
    { await: 'user' },
    { emit: init },
    ...say("I'm the pretend finisher. I looked at the branch and main without changing anything."),
    writeStatus('1-ready.json', { kind: 'ready', rules: join(repoRoot, '.pir', 'rules', 'on-finish.md'), summary: FINISHER_SUMMARY, steps }),
    ...say(`${FINISHER_SUMMARY}\n\nThe steps, once you say go:\n1. ${steps[0]}\n2. ${steps[1]}`),
    goQuestion('go1', FINISHER_GO_QUESTION, 2),
  ];
  // What the finisher does once the go is in: the merge, then the variant's own end.
  // With `merge` the fake also merges for real once the gate let its merge call through: the fake's own
  // tool call only reads `ran Bash`, and a single run's test watches the base for the merge.
  const realMerge = mergeForReal ? [{ sh: run('finisher-merge', statusDir, repoRoot, branch) }] : [];
  const merge = [bash('merge1', steps[0], 'Merge the branch into main'), ...realMerge, ...say('Merged. Running the install.'), { sleep: finishingMs }];
  if (variant === 'finisher') return [...opening, ...merge, ...done];
  if (variant === 'finisher-notyet') {
    // A `Not yet` is not a go (DESIGN §2.7): the finisher ends its turn and waits for the person to write.
    return [
      ...opening,
      ...say(FINISHER_NOT_YET),
      { emit: resultEvent('success', 'waiting') },
      { await: 'user' },
      { emit: init },
      ...say(FINISHER_ASKING_AGAIN),
      goQuestion('go2', FINISHER_GO_QUESTION, 2),
      ...merge,
      ...done,
    ];
  }
  if (variant === 'finisher-resync') {
    // The base moves before the go (single-finisher DESIGN §2.5): the person's Go to the first question
    // lands after pir held the finisher, so it does not count. pir then tells the finisher twice, in either
    // order (the stale Go, and the re-sync), and only after both does it write a fresh `ready` and ask
    // again. That second question is answered `Not yet`, the person writes, and a third question takes
    // the go that finishes.
    return [
      ...opening,
      ...say('Go noted; checking it counts.'),
      { emit: resultEvent('success', 'waiting') },
      { await: 'user' },
      { emit: init },
      ...say('Noted.'),
      { emit: resultEvent('success', 'noted') },
      { await: 'user' },
      { emit: init },
      ...say(FINISHER_RECHECKED),
      writeStatus('2-ready.json', { kind: 'ready', rules: join(repoRoot, '.pir', 'rules', 'on-finish.md'), summary: FINISHER_RECHECKED, steps }),
      goQuestion('go2', FINISHER_GO_QUESTION, 2),
      ...say(FINISHER_NOT_YET),
      { emit: resultEvent('success', 'waiting') },
      { await: 'user' },
      { emit: init },
      ...say(FINISHER_ASKING_AGAIN),
      goQuestion('go3', FINISHER_GO_QUESTION, 2),
      ...merge,
      ...done,
    ];
  }
  if (variant === 'finisher-exits') {
    // A finisher that dies on every start, its resumes included (each resume continues past the exit before
    // it), so the restart budget runs out and pir falls back to the hand merge (finisher DESIGN §2.12).
    return [{ await: 'user' }, { emit: init }, ...say("I'm the pretend finisher, and I am about to fall over."), ...Array.from({ length: 8 }, () => ({ exit: 1 }))];
  }
  if (variant === 'finisher-stuck') {
    // A step fails after the go (DESIGN §2.12): stuck with a proposal, the go question again, and only the
    // second go runs the retry.
    return [
      ...opening,
      bash('merge1', steps[0], 'Merge the branch into main'),
      ...say('Merged. Running the install.'),
      bash('install1', steps[1], 'Install the engine and skills'),
      { sleep: finishingMs },
      writeStatus('2-stuck.json', { kind: 'stuck', summary: finisherStuckSummary(branch), proposal: 'retry the install once the network is back', steps: [steps[1]] }),
      ...say(`${finisherStuckSummary(branch)}\n\nI propose to retry the install. The step, once you say go:\n1. ${steps[1]}`),
      goQuestion('go2', FINISHER_RETRY_QUESTION, 1),
      bash('install2', steps[1], 'Install the engine and skills'),
      ...say('Installed.'),
      { sleep: finishingMs },
      ...done,
    ];
  }
  if (variant === 'finisher-reserved') {
    // A destructive command after the go is still the person's (DESIGN §2.5): parked, answered in the
    // finisher's conversation.
    return [
      ...opening,
      bash('merge1', steps[0], 'Merge the branch into main'),
      ...say('Merged. The old build folder is in the way of the install; clearing it.'),
      bash('clear1', FINISHER_RESERVED_COMMAND, 'Delete the old build folder'),
      ...say('Cleared. Running the install.'),
      { sleep: finishingMs },
      ...done,
    ];
  }
  throw new Error(`unknown finisher variant "${variant}"`);
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
  } else if (cmd === 'single-report') {
    // The folder is cut out of the opening up to `. Starting point:` (builder, reviewer) or `. Base:` (a sync
    // helper), which follows it on the same line.
    const dir = /Reports folder: (.+?)\. (?:Starting point|Base): /.exec(process.env.FAKE_OPENING ?? '')?.[1];
    dropReport(dir, 'single', `[pir:v1 kind=${args[0]} single=${args[1]}]\n${args[2] ?? args[0]}`);
  } else if (cmd === 'resolve-both') {
    // Every unmerged file keeps both sides: the conflict marker lines go, the rest stays in order.
    const files = git('diff', '--name-only', '--diff-filter=U').split('\n').filter(Boolean);
    if (!files.length) throw new Error('no merge in progress to resolve');
    for (const f of files) {
      const kept = readFileSync(f, 'utf8').split('\n').filter((l) => !/^(<<<<<<<|=======|>>>>>>>)( |$)/.test(l));
      writeFileSync(f, kept.join('\n'));
    }
    execFileSync('git', ['-c', 'user.name=pir fake', '-c', 'user.email=fake@pir.invalid', 'add', '-A']);
    execFileSync('git', ['-c', 'user.name=pir fake', '-c', 'user.email=fake@pir.invalid', 'commit', '-q', '--no-edit']);
  } else if (cmd === 'finisher-merge') {
    // The merge a finisher's Bash call would have run, done only once pir's gate holds the phase at
    // `finishing` (the go was given): the fake's tool call itself runs nothing.
    const [statusDir, repoRoot, branch] = args;
    const phase = JSON.parse(readFileSync(join(statusDir, '..', 'state.json'), 'utf8')).phase;
    if (phase !== 'finishing') throw new Error(`finisher-merge: the phase is ${phase}, not finishing`);
    execFileSync('git', ['-C', repoRoot, '-c', 'user.name=pir fake', '-c', 'user.email=fake@pir.invalid', 'merge', '-q', '--no-edit', branch]);
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
