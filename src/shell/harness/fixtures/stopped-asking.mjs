// stopped-asking — the live check of stopped-worker-asking (T06): a build worker idle with nothing running
// in the background reads `asking you` whether or not it dropped a report, and a worker idle behind its own
// background job reads `building` (stopped-worker-asking DESIGN §1, §2.1, §2.2). Two INDEPENDENT tasks at
// ceiling 2:
//   T01 asks the person for its wording in plain text and ends its turn WITHOUT a report; after the answer
//       it asks one follow-up in plain text, again without a report, and ends its turn. Its row must read
//       `asking you` after each asking turn ends and `building` after each reply. The harness answers both
//       (answerPending.taskReplies), after a hold so the row is seen asking over several passes.
//   T02 waits twice without ever asking: on a background Bash timer, then on a Monitor. Its row must never
//       read `asking you` while either job runs. The Monitor wait measures whether a Monitor job appears in
//       `background_tasks_changed` at all (DESIGN §2.2, plan review 2026-09-27).
// The scenario runs the coordinator as `pir` does (statusSnapshots), so the bundle's status.jsonl keeps
// each row's history, and the rows are matched against the turns' `result` times in the conversation logs.

import { defineScenario } from '../scenario.mjs';
import { handedOffGreenBranch, ceilingHeld } from '../assertions.mjs';
import { progressDoc, taskDoc } from './common.mjs';

const slug = 'stopped-asking';
const title = 'Stopped worker asking — a plain-text ask with no report, and a wait behind a background job';

// Node timers, not `sleep`: the Bash tool refuses a standalone `sleep` (FINDINGS 2026-09-25).
const TIMER_COMMAND = 'node -e "setTimeout(() => {}, 60000)"';
const MONITOR_COMMAND = `node -e "setTimeout(() => console.log('done'), 45000)"`;

// The harness's two replies to T01, one per asking turn: the wording, then the follow-up's answer.
const T01_REPLIES = ['Hello there', 'yes'];

// The report is forbidden on purpose: the pir-worker skill tells a worker to drop one on every ask
// (stopped-worker-asking T04), and a report would park the task and prove the report park instead of the
// stopped rule this run exists to see.
const NO_REPORT =
  'IMPORTANT, this overrides the pir-worker skill for this task only: this task is a test of what pir ' +
  'shows when a worker asks WITHOUT a report, so do NOT drop any report of kind `question` or `decision` ' +
  'at any point, and do NOT use the AskUserQuestion tool. Ask only in plain text in your reply, then end ' +
  'your turn with nothing running.';

const progress = progressDoc({
  slug,
  summary:
    'Two independent tasks: T01 asks the person twice in plain text with no report; T02 waits on a background timer and then a Monitor without asking (stopped-worker-asking T06).',
  tasks: [
    { num: 'T01', name: 'Greeting (asks with no report, twice)', deps: [], state: '⬜' },
    { num: 'T02', name: 'Timer (waits on its own background jobs)', deps: [], state: '⬜' },
  ],
});

const tasks = {
  'T01-greeting.md': taskDoc({
    num: 'T01',
    title: 'Write the greeting file (wording unspecified; ask in plain text, no report)',
    goal:
      'Create `greeting.txt` at the repo root holding one greeting line for the user. The wording is ' +
      'deliberately NOT specified: it is the person\'s choice, not yours. ' + NO_REPORT + ' Do these steps ' +
      'in order: (1) ask the person, in plain text, which greeting wording to use, and end your turn. ' +
      '(2) When the person answers, write `greeting.txt` holding exactly their wording and one trailing ' +
      'newline. (3) Then ask the person one follow-up, in plain text: whether to add a trailing full stop ' +
      'to the greeting. End your turn. (4) When the person answers, add the full stop if they said yes ' +
      '(keep the one trailing newline), leave it as it is if they said no, and finish the task.',
    files: ['`greeting.txt` — new, its contents chosen by the person.'],
    doneWhen: [
      'You asked twice in plain text, ending your turn each time, and dropped no question or decision report.',
      '`greeting.txt` holds exactly the person\'s wording, with a full stop only if they said yes, plus one trailing newline.',
      '`npm test` is still green.',
    ],
  }),
  'T02-timer.md': taskDoc({
    num: 'T02',
    title: 'Write the timer file (waits on a background timer, then a Monitor; never asks)',
    goal:
      'Create `timer.txt` at the repo root holding `done` and one trailing newline, after two waits. ' +
      'Nothing here is the person\'s choice: never ask the person anything and never drop a question or ' +
      'decision report. Do these steps in order: (1) with the Bash tool and **run_in_background: true**, ' +
      `start exactly \`${TIMER_COMMAND}\` (a 60-second timer); say in one line that you are waiting for ` +
      'the timer, and end your turn. (2) When the timer finishes and wakes you, write `timer.txt`. ' +
      `(3) Then start the **Monitor tool** on exactly \`${MONITOR_COMMAND}\` (a 45-second wait); say in ` +
      'one line that you are waiting for the monitor, and end your turn. (4) When the monitor wakes you ' +
      '(its line `done`, or its command ending), finish the task.',
    files: ['`timer.txt` — new, holding `done`.'],
    doneWhen: [
      'The timer ran in the background and the monitor through the Monitor tool, and you ended a turn waiting on each.',
      'You never asked the person anything and dropped no question or decision report.',
      '`timer.txt` holds `done` plus one trailing newline; `npm test` is still green.',
    ],
  }),
};

const scenario = defineScenario({
  id: slug,
  title,
  fixture: slug,
  // Ceiling 2 so both run at once; 15 minutes covers two builds, two timed waits and two reviews.
  seatbelts: { ceiling: 2, timeoutMs: 15 * 60 * 1000 },
  facts: [ceilingHeld(2), handedOffGreenBranch()],
  answerPending: { taskReplies: { T01: T01_REPLIES } },
  statusSnapshots: true,
});

export default { id: slug, slug, title, progress, tasks, scenario };
