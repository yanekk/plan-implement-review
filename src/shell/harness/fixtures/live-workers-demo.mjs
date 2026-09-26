// live-workers-demo — the practice plan for live-workers T18: a whole small plan built by live workers
// where one worker asks the person a question set and another asks a permission, both answered in `pir`
// (live-workers DESIGN §1, §5.1). Two INDEPENDENT tasks, so at PARALLEL_MAX_WORKERS=2 both ask at once:
//   T01 must put its one user-facing choice to the person through the AskUserQuestion tool, so it reaches
//       pir as a question set (§2.7), not as a plain-text ask.
//   T02 must run one exact command that the scratch repo's own `.claude/settings.json` marks `ask`, so it
//       reaches pir as a permission request (§2.6) even in auto mode.
// The harness run has no person at the screen, so the scenario declares `answerPending` and the runner
// answers both through the inbox (answerer.mjs); the hands-on run is where a person does it with keys.

import { defineScenario } from '../scenario.mjs';
import { handedOffGreenBranch, ceilingHeld, requestAnswered } from '../assertions.mjs';
import { progressDoc, taskDoc } from './common.mjs';

const slug = 'live-workers-demo';
const title = 'Live workers demo — a question set and a permission, answered in pir';

// The one command the permission task runs. An exact rule (no wildcard) so nothing else the worker runs
// is caught by it.
const ASKED_COMMAND = 'touch approved.txt';

// T01 opens with a pause so a busy worker waits long enough for the person to press Esc on it (the T18
// drill: the person was too slow to interrupt a worker that finished in seconds, user 2026-09-26). A
// node timer, not `sleep`: the Bash tool refuses a standalone `sleep` (FINDINGS 2026-09-25).
const PAUSE_COMMAND = 'node -e "setTimeout(() => {}, 90000)"';

const progress = progressDoc({
  slug,
  summary:
    'Two independent tasks: T01 asks the person a question set through AskUserQuestion, T02 runs a command this repo marks `ask`, so each reaches pir for an answer (live-workers §2.6, §2.7).',
  tasks: [
    { num: 'T01', name: 'Write the greeting file (asks a question set)', deps: [], state: '⬜' },
    { num: 'T02', name: 'Create the approval marker (asks a permission)', deps: [], state: '⬜' },
  ],
});

const tasks = {
  'T01-greeting.md': taskDoc({
    num: 'T01',
    title: 'Write the greeting file (asks a question set)',
    goal:
      `First, before anything else, run exactly \`${PAUSE_COMMAND}\` with the Bash tool: a 90-second pause ` +
      'that gives the person time to practise interrupting you. If you are interrupted, follow what the ' +
      'person types next. Then create `greeting.txt` at the repo root holding the greeting the person picks, followed by one trailing ' +
      'newline and nothing else. The wording is the person\'s choice, not yours. Ask it with the ' +
      '**AskUserQuestion tool** (not a plain-text question): one question, "Which greeting should greeting.txt ' +
      'hold?", header "Greeting", single-select, options `Hello, world` and `Hi there`. Wait for the answer, ' +
      'then write exactly the label chosen (or the text typed as the other answer). Dropping a `question` ' +
      'report as well is fine; the question itself must go through the tool.',
    files: ['`greeting.txt` — new, its contents chosen by the person.'],
    doneWhen: [
      'You asked through the AskUserQuestion tool rather than guessing.',
      '`greeting.txt` holds exactly the chosen greeting plus one trailing newline.',
      '`npm test` is still green.',
    ],
  }),
  'T02-approval.md': taskDoc({
    num: 'T02',
    title: 'Create the approval marker (asks a permission)',
    goal:
      `Create an empty file \`approved.txt\` at the repo root by running exactly \`${ASKED_COMMAND}\` with the ` +
      'Bash tool, from the repo root, as a command on its own. This repo\'s `.claude/settings.json` makes that ' +
      'command ask the person first; that is the point of the task, so wait for their answer. Do not create ' +
      'the file any other way (no Write tool, no other command). If the person refuses, do not create it: ' +
      'mark the task blocked and say so.',
    files: ['`approved.txt` — new, empty.'],
    doneWhen: [
      `\`approved.txt\` exists, empty, created by \`${ASKED_COMMAND}\` after the person allowed it.`,
      '`npm test` is still green.',
    ],
  }),
};

// Committed with the seed, so every worktree carries it and the worker's project settings load it.
const seedFiles = {
  '.claude/settings.json': `${JSON.stringify({ permissions: { ask: [`Bash(${ASKED_COMMAND})`] } }, null, 2)}\n`,
};

const scenario = defineScenario({
  id: slug,
  title,
  fixture: slug,
  seatbelts: { ceiling: 1 },
  facts: [
    requestAnswered('T01', 'questions'),
    requestAnswered('T02', 'permission'),
    ceilingHeld(1),
    handedOffGreenBranch(),
  ],
  answerPending: true,
});

export default { id: slug, slug, title, progress, tasks, seedFiles, scenario };
