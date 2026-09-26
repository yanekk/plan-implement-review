// live-workers-demo — the practice plan for live-workers T18: a whole small plan built by live workers
// where one worker asks the person a question set and another asks a permission, both answered in `pir`
// (live-workers DESIGN §1, §5.1), plus the extra cases the person asked to drill (user 2026-09-26). Four
// INDEPENDENT tasks, so at PARALLEL_MAX_WORKERS=2 two ask at once:
//   T01 pauses 90 s (time to practise Esc on a busy worker), then asks one single-choice question through
//       the AskUserQuestion tool, so it reaches pir as a question set (§2.7), not a plain-text ask.
//   T02 must run one exact command that the scratch repo's own `.claude/settings.json` marks `ask`, so it
//       reaches pir as a permission request (§2.6) even in auto mode.
//   T03 asks a pick-several question and one meant to be answered by typing on its Other line.
//   T04 waits for the person's `go`, then runs two background commands and a Monitor, whose
//       notifications arrive between turns.
// The harness run has no person at the screen, so the scenario declares `answerPending` and the runner
// answers through the inbox (answerer.mjs), typing the name T03 asks for; the hands-on run is where a
// person does it with keys.

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

// T03's two questions. The name question is meant to be answered through its Other line, with typed text.
const EXTRAS_QUESTION = 'Which extras should extras.txt list?';
// The question itself says a typed answer is wanted: on the T18 drill the person picked an option and the
// typed path was never exercised (user 2026-09-26).
const NAME_QUESTION = 'What name should name.txt hold? Type your own.';
// The answer the harness types into the Other line, so the unattended run proves a custom answer lands.
const TYPED_NAME = 'Typed by the harness';

// T04's background work: two commands the Bash tool moves to the background, and one Monitor whose every
// output line is an event. Node timers, not `sleep` (FINDINGS 2026-09-25); long enough to outlive a turn.
const BACKGROUND_ONE = `node -e "setTimeout(() => console.log('first done'), 20000)"`;
const BACKGROUND_TWO = `node -e "setTimeout(() => console.log('second done'), 30000)"`;
const MONITOR_COMMAND = `node -e "let i = 0; const t = setInterval(() => { console.log('tick ' + ++i); if (i === 3) clearInterval(t); }, 10000)"`;

const progress = progressDoc({
  slug,
  summary:
    'Four independent tasks: T01 asks a single-choice question after a pause, T02 runs a command this repo marks `ask`, T03 asks a pick-several question and one answered by typing, T04 runs two background commands and a monitor (live-workers §2.6, §2.7, T18).',
  tasks: [
    { num: 'T01', name: 'Greeting (one question)', deps: [], state: '⬜' },
    { num: 'T02', name: 'Approval (a permission)', deps: [], state: '⬜' },
    { num: 'T03', name: 'Extras and name (pick several, typed)', deps: [], state: '⬜' },
    { num: 'T04', name: 'Background work and a monitor', deps: [], state: '⬜' },
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
  'T03-extras.md': taskDoc({
    num: 'T03',
    title: 'Write the extras and name files (asks a pick-several and a typed answer)',
    goal:
      'Ask the person two questions in ONE call of the **AskUserQuestion tool** (not plain text): first ' +
      `"${EXTRAS_QUESTION}", header "Extras", **multiSelect true**, options \`apples\`, \`pears\`, \`plums\`; ` +
      `second "${NAME_QUESTION}", header "Name", single-select, options \`Ada\` and \`Grace\`. The person ` +
      'is expected to type their own name through the free-text answer the tool offers, so use whatever ' +
      'text comes back; keep the question text exactly as given. Then write `extras.txt` with each chosen ' +
      'extra on its own line, and `name.txt` with the name exactly as answered; each file ends with one ' +
      'trailing newline and holds nothing else. Then tell the person, in one line of your reply, exactly ' +
      'what you wrote to each file, so they can see their typed answer arrived.',
    files: ['`extras.txt` — new.', '`name.txt` — new.'],
    doneWhen: [
      'Both questions went through one AskUserQuestion call; the first was multi-select.',
      '`extras.txt` lists exactly the chosen extras, one per line; `name.txt` holds exactly the answered name.',
      '`npm test` is still green.',
    ],
  }),
  'T04-background.md': taskDoc({
    num: 'T04',
    title: 'Record background work (two background commands and a monitor)',
    goal:
      'Practise background work, so the person can watch how it shows in pir. **Before starting any of ' +
      'it, wait for the person\'s go:** drop a `question` report saying you are ready to start the background ' +
      'work, tell the person in this session "Ready: type go when you are watching", and end your turn. ' +
      'Start only when the person\'s message says go. Then, with the Bash tool and ' +
      `**run_in_background: true**, start \`${BACKGROUND_ONE}\` and then \`${BACKGROUND_TWO}\`. Then, with ` +
      `the **Monitor tool** (load it with ToolSearch if it is not loaded), watch \`${MONITOR_COMMAND}\`, ` +
      'which prints three `tick` lines ten seconds apart. Do not poll and do not sleep: wait for the ' +
      'notifications that each command finished and for the three ticks. Then write `background.txt` ' +
      'holding, one per line, the last output line of the first command, of the second command, and the ' +
      'last tick line the monitor showed, with one trailing newline. If the Monitor tool is not available ' +
      'to you, say so in your report and write `no monitor` as the third line instead.',
    files: ['`background.txt` — new.'],
    doneWhen: [
      'Nothing started before the person said go.',
      'Both commands ran in the background and their completion was received, not polled for.',
      'The monitor delivered its tick lines as events.',
      '`background.txt` holds `first done`, `second done` and `tick 3` (or `no monitor`), one per line.',
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
  // Ceiling 2, as the person's run uses, and 15 minutes: four tasks, one pausing 90 s and one waiting ~30 s
  // on its background work, do not fit the 10-minute default one at a time.
  seatbelts: { ceiling: 2, timeoutMs: 15 * 60 * 1000 },
  facts: [
    requestAnswered('T01', 'questions'),
    requestAnswered('T02', 'permission'),
    requestAnswered('T03', 'questions'),
    ceilingHeld(2),
    handedOffGreenBranch(),
  ],
  // T04 waits for the person's go, which the stand-in sends as a message once T04's worker has gone idle.
  answerPending: { typed: { [NAME_QUESTION]: TYPED_NAME }, say: { T04: 'go' } },
});

export default { id: slug, slug, title, progress, tasks, seedFiles, scenario };
