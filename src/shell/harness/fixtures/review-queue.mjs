// review-queue — a short dependency chain at ceiling 2 that forces the implement→review handoff: one
// task reaches 🔍 and a fresh reviewer takes it over while another task is still building, and the
// implementer is closed as its reviewer starts (DESIGN §2.1, §4.1). T01 and T02 are independent so both
// build at once; T03 depends on T01, so it only becomes ready once T01 is reviewed and merged — the
// dependency edge is what makes the review handoff sit on the critical path rather than being incidental.
//
// Facts (T15): a hello opened every spawn AND every fresh reviewer's channel (helloPerSpawn counts
// spawn+review); no finished worker was closed before it went idle (the implementer's idle-gated close,
// DESIGN §2.3); and main gained exactly one commit — the plan drains to promotion.

import { defineScenario } from '../scenario.mjs';
import { helloPerSpawn, noCloseBeforeIdle, oneMergeToMain } from '../assertions.mjs';
import { progressDoc, taskDoc } from './common.mjs';

const slug = 'review-queue';

const progress = progressDoc({
  slug,
  summary:
    'Two independent tasks and one dependent, ceiling 2: a task reaches review while another builds (DESIGN §4.1).',
  tasks: [
    { num: 'T01', name: 'Write review-queue marker one', runs: 'auto', deps: [], state: '⬜' },
    { num: 'T02', name: 'Write review-queue marker two', runs: 'auto', deps: [], state: '⬜' },
    { num: 'T03', name: 'Write review-queue marker three', runs: 'auto', deps: ['T01'], state: '⬜' },
  ],
});

const FILES = { T01: 'rq-1.txt', T02: 'rq-2.txt', T03: 'rq-3.txt' };

const tasks = Object.fromEntries(
  Object.entries(FILES).map(([num, file]) => [
    `${num}-marker.md`,
    taskDoc({
      num,
      title: `Write review-queue marker ${num}`,
      goal: `Create a file \`${file}\` at the repo root whose only contents are the text \`ok\`. That is all.`,
      files: [`\`${file}\` — new.`],
      doneWhen: [`\`${file}\` exists and contains \`ok\`.`, '`npm test` is still green.'],
    }),
  ]),
);

const scenario = defineScenario({
  id: slug,
  title: 'Review queue — the implement→review handoff',
  fixture: slug,
  seatbelts: { ceiling: 2 },
  facts: [helloPerSpawn(), noCloseBeforeIdle(), oneMergeToMain()],
});

export default {
  id: slug,
  slug,
  title: 'Review queue — the implement→review handoff',
  progress,
  tasks,
  scenario,
};
