// human-decision — one task doc that deliberately leaves a single user-facing choice unspecified (the
// greeting wording, the shape that arose on its own in the stopped drill). A real worker cannot guess a
// user-facing requirement (CLAUDE.md: an underspecified requirement is the exact thing the user is here
// for), so it sends the coordinator a `question` and parks; the coordinator surfaces it; and — with a
// scripted answer fed through the control `answers` file by the T17 runner — the answer reaches the
// worker and it resumes to done, merge and promotion (DESIGN §2.5, §4.1).
//
// The worker asking and the answer arriving are still real; only the human at the keyboard is scripted,
// so the scenario is repeatable. `scriptedAnswer` is the fixed line the runner writes; T16 only carries
// it (the runner performs the injection).
//
// Facts (T15): questionRoundTrip('T01') — a surface for T01 then a later merge of it (the worker
// resumed); and oneMergeToMain — the plan drains to its single promotion once the answer lands.

import { defineScenario } from '../scenario.mjs';
import { questionRoundTrip, oneMergeToMain } from '../assertions.mjs';
import { progressDoc, taskDoc } from './common.mjs';

const slug = 'human-decision';

const progress = progressDoc({
  slug,
  summary: 'One task with an unspecified user-facing choice, ceiling 1: the worker asks and the answer is delivered (DESIGN §4.1).',
  tasks: [{ num: 'T01', name: 'Write the greeting file (wording unspecified)', runs: 'auto', deps: [], state: '⬜' }],
});

const tasks = {
  'T01-greeting.md': taskDoc({
    num: 'T01',
    title: 'Write the greeting file (wording unspecified)',
    goal:
      'Create `greeting.txt` at the repo root containing a single greeting line to show the user. The exact ' +
      'wording is DELIBERATELY NOT SPECIFIED here: choosing user-facing wording is the product manager\'s ' +
      'call, not yours. Do not guess or pick a default — ask the coordinator which wording to use, wait for ' +
      'the answer, then write exactly the wording you are given.',
    files: ['`greeting.txt` — new, its contents chosen by the user.'],
    doneWhen: [
      'You asked for the greeting wording rather than guessing it.',
      '`greeting.txt` contains exactly the wording the user gave.',
      '`npm test` is still green.',
    ],
  }),
};

// The fixed answer the T17 runner writes to the control `answers` file when T01's question surfaces, so
// the round trip is repeatable without a live human. The worker's asking and receiving are still real.
const scriptedAnswer = { task: 'T01', text: 'Use exactly this wording, nothing else: Hello, world!' };

const scenario = defineScenario({
  id: slug,
  title: 'Human decision — a question surfaced, answered, resumed',
  fixture: slug,
  seatbelts: { ceiling: 1 },
  facts: [questionRoundTrip('T01'), oneMergeToMain()],
});

export default {
  id: slug,
  slug,
  title: 'Human decision — a question surfaced, answered, resumed',
  progress,
  tasks,
  scriptedAnswer,
  scenario,
};
