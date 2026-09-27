// real-asking — the live check of real-asking-state (T05): a task row reads `asking you` only while its
// worker is really waiting on the person, and comes off it at the right moment (real-asking-state DESIGN
// §1, §2.1, §2.2). Two INDEPENDENT tasks at ceiling 2:
//   T01 drops a `question` report and then keeps working in the same turn (a 30 s stand-in for work and a
//       placeholder file), and only then asks in plain text and ends its turn. Its row must read
//       `building` until that turn ends, then `asking you`. The person answers it on their phone over
//       Remote Control, and the row must return to `building` within one pass.
//   T02 starts a background timer, drops a `question` report, asks in plain text and ends its turn. The
//       timer's wake-up opens a turn that is not an answer, so the row must stay `asking you` through it.
//       The harness then answers T02 through the inbox as the screen would (answerPending.afterWake), and
//       the row must leave `asking you` within one pass.
// The scenario runs the coordinator as `pir` does (statusSnapshots), so it writes status.json every pass
// and the capture keeps each row's history in the bundle's status.jsonl.

import { defineScenario } from '../scenario.mjs';
import { handedOffGreenBranch, ceilingHeld } from '../assertions.mjs';
import { progressDoc, taskDoc } from './common.mjs';

const slug = 'real-asking';
const title = 'Real asking state — a report dropped mid-work, and a wake-up that is not an answer';

// Node timers, not `sleep`: the Bash tool refuses a standalone `sleep` (FINDINGS 2026-09-25). T01's is run
// in the foreground after its report, so its row is seen `building` over several passes with the report
// already dropped; T02's runs in the background and outlives its asking turn, so its wake-up lands while
// the task is parked.
const WORK_COMMAND = 'node -e "setTimeout(() => {}, 30000)"';
const WAKE_COMMAND = 'node -e "setTimeout(() => {}, 60000)"';

// The harness's answer to T02, sent as a plain message once T02's wake-up turn has ended.
const T02_ANSWER = 'blue';

const progress = progressDoc({
  slug,
  summary:
    'Two independent tasks: T01 drops a question report and keeps working before it asks; T02 asks, then is woken by its own background timer before anyone answers (real-asking-state T05).',
  tasks: [
    { num: 'T01', name: 'Greeting (asks after working on)', deps: [], state: '⬜' },
    { num: 'T02', name: 'Colour (woken while asking)', deps: [], state: '⬜' },
  ],
});

const tasks = {
  'T01-greeting.md': taskDoc({
    num: 'T01',
    title: 'Write the greeting file (wording unspecified; ask after working on)',
    goal:
      'Create `greeting.txt` at the repo root holding one greeting line for the user. The wording is ' +
      'deliberately NOT specified: it is the person\'s choice, not yours. Do these steps in this order, all ' +
      'in ONE turn: (1) drop a `question` report saying you need the greeting wording; (2) keep working ' +
      `without waiting: run exactly \`${WORK_COMMAND}\` with the Bash tool in the foreground (a 30-second ` +
      'stand-in for other work; not in the background), then write `greeting.txt` holding `PLACEHOLDER` and ' +
      'one trailing newline; (3) only then ask the person, in plain text in your reply (NOT the ' +
      'AskUserQuestion tool), which greeting wording to use, and end your turn. When the person answers, ' +
      'replace the placeholder with exactly their wording and finish the task.',
    files: ['`greeting.txt` — new, its contents chosen by the person.'],
    doneWhen: [
      'You dropped the question report before the 30-second command, and asked in plain text only after it.',
      '`greeting.txt` holds exactly the person\'s wording plus one trailing newline; no `PLACEHOLDER` remains.',
      '`npm test` is still green.',
    ],
  }),
  'T02-colour.md': taskDoc({
    num: 'T02',
    title: 'Write the colour file (asks; woken by its own timer while waiting)',
    goal:
      'Create `colour.txt` at the repo root holding the colour the person picks, `red` or `blue`. Do these ' +
      `steps in order: (1) with the Bash tool and **run_in_background: true**, start exactly \`${WAKE_COMMAND}\` ` +
      '(a 60-second timer); (2) drop a `question` report asking red or blue; (3) ask the person in plain ' +
      'text in your reply (NOT the AskUserQuestion tool) whether it is red or blue, and end your turn. ' +
      '(4) When the background timer finishes and wakes you, that is not the person\'s answer: reply in ' +
      'one line that you are still waiting for their choice, and end the turn without doing anything ' +
      'else. (5) When the person answers, write exactly their colour and one trailing newline, and finish.',
    files: ['`colour.txt` — new, its contents chosen by the person.'],
    doneWhen: [
      'The timer ran in the background and its wake-up did not end your wait.',
      '`colour.txt` holds exactly the colour the person gave plus one trailing newline.',
      '`npm test` is still green.',
    ],
  }),
};

const scenario = defineScenario({
  id: slug,
  title,
  fixture: slug,
  // Ceiling 2 so both tasks ask at once; 15 minutes covers two builds, a phone answer and two reviews.
  seatbelts: { ceiling: 2, timeoutMs: 15 * 60 * 1000 },
  facts: [ceilingHeld(2), handedOffGreenBranch()],
  // T01 is answered by the person on the phone; only T02 is the harness's, after its wake-up turn.
  answerPending: { afterWake: { T02: T02_ANSWER } },
  statusSnapshots: true,
});

export default { id: slug, slug, title, progress, tasks, scenario };
