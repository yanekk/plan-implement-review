// pir-coordinator-concurrent — the live check of several briefs at once and the hold limit (pir-coordinator
// T14, DESIGN §2.3, §2.4, §2.11): real workers, the real agent, the harness standing in for the person. Three
// INDEPENDENT tasks at ceiling 3, so all three workers start on the same pass and ask at once:
//   T01 and T02 each ask, as the first action of their first turn and with the AskUserQuestion tool, a naming
//       question this fixture's DESIGN.md answers (different questions). The two briefs reach the agent
//       together, or one while its turn for the other runs (briefsOverlapped); it answers both, one decision
//       each, and neither row ever reads `asking you` (agentAnswered, oneDecisionEach).
//   T03 asks, as its first action and with the AskUserQuestion tool, the release date: the project rules file
//       tells the agent to hold release-date questions and write nothing. The project file wins over the
//       skill, so the agent holds it; after the run's shortened hold limit (3 min, coordinatorHoldMs) pir hands
//       it to the person and tells the agent, who replies with its pointer. The harness answers it as the
//       person, a minute after it became the person's (personDelayMs), so the pointer lands while it still
//       waits (timedOutToPerson). Every pointer and every "already answered" message is checked against the
//       workers' logs (statementsMatchRecord).
// Main does not move, so the end has no sync conflict; the run commits REPORT.md and waits in `ready to
// merge`, and the runner merges it as the person would (readyWithReport({ conflict: false })).

import { defineScenario } from '../scenario.mjs';
import {
  agentAnswered,
  briefsOverlapped,
  oneDecisionEach,
  timedOutToPerson,
  statementsMatchRecord,
  readyWithReport,
  ceilingHeld,
} from '../assertions.mjs';
import { progressDoc, taskDoc } from './common.mjs';

const slug = 'pir-coordinator-concurrent';
const title = 'Coordinator agent — two questions at once, and a held question handed to the person';

// The hold limit for this run: it applies to T01 and T02 too, and the agent answers two briefs one after the
// other, so 3 minutes (user, plan review 2026-09-28).
export const HOLD_MS = 3 * 60 * 1000;
// How long the person's stand-in waits once T03 is the person's, so the agent's pointer lands first.
export const PERSON_DELAY_MS = 60 * 1000;

const GREET_QUESTION = 'What should the exported greeting function in greet.mjs be called?';
const FAREWELL_QUESTION = 'What should the exported farewell function in farewell.mjs be called?';
const RELEASE_QUESTION = 'Which release date should RELEASE.md announce?';

const design = `---
setup: none
test:
  - npm test
---

# ${slug} — scratch fixture design

Throwaway plan for the live check of the coordinator agent with several questions at once. Not a real
feature.

## Decisions

- **The greeting function is named \`greet\`.** \`greet.mjs\` exports \`greet(name)\`, returning
  \`Hello, \${name}!\`. Not \`sayHello\`: every verb in this project is one word.
- **The farewell function is named \`farewell\`.** \`farewell.mjs\` exports \`farewell(name)\`, returning
  \`Goodbye, \${name}!\`. Not \`sayGoodbye\`, for the same reason.
- The release date announced in \`RELEASE.md\` is deliberately **not** decided here.

## Environment

The test command is \`npm test\`. It runs \`node --test\` and is green on a fresh checkout. There is no
git remote: nothing is ever pushed.
`;

// The project rules the agent reads from the feature worktree (docs/coordinator-agent.md). The first rule
// makes the agent hold T03 until the hold limit hands it to the person.
const rules = `# Coordinator rules for this project

- For questions about the release date, write no decision and do not pass them on; wait. Once pir hands
  one to the person, give the pointer your skill asks for.
- Everything DESIGN.md settles, answer from DESIGN.md.
`;

const progress = progressDoc({
  slug,
  summary:
    'Three independent tasks that each ask at once: T01 and T02 ask names DESIGN settles (the agent answers both); T03 asks a release date the rules tell the agent to hold, so the hold limit hands it to the person (pir-coordinator T14).',
  tasks: [
    { num: 'T01', name: 'Greeting function (asks a name DESIGN settles)', deps: [], state: '⬜' },
    { num: 'T02', name: 'Farewell function (asks a name DESIGN settles)', deps: [], state: '⬜' },
    { num: 'T03', name: 'Release note (asks a date the agent holds)', deps: [], state: '⬜' },
  ],
});

// askFirst(question, header, options) → the instruction to ask one question with the tool before anything
// else, so the three workers ask on the same pass.
const askFirst = (question, header, options) =>
  'Your FIRST action, before reading or writing anything else, is to ask with the **AskUserQuestion tool** ' +
  `(not plain text): one question, "${question}", header "${header}", single-select, options ` +
  `${options.map((o) => `\`${o}\``).join(' and ')}. Ask even if you think you know the answer, and use exactly ` +
  'the answer it gives. A reviewer of this task does not ask again.';

const tasks = {
  'T01-greeting.md': taskDoc({
    num: 'T01',
    title: 'Add the greeting function (asks its name)',
    goal:
      `${askFirst(GREET_QUESTION, 'Name', ['greet', 'sayHello'])} Then create \`greet.mjs\` at the repo root ` +
      'exporting that one function, which takes a name and returns `Hello, <name>!`.',
    files: ['`greet.mjs` — new.'],
    tests: 'Add `greet.test.mjs` checking the function returns `Hello, Ada!` for `Ada`. Leave `npm test` green.',
    doneWhen: [
      'The name was asked first, through the AskUserQuestion tool, and `greet.mjs` exports the function under the answered name.',
      '`npm test` is green.',
    ],
  }),
  'T02-farewell.md': taskDoc({
    num: 'T02',
    title: 'Add the farewell function (asks its name)',
    goal:
      `${askFirst(FAREWELL_QUESTION, 'Name', ['farewell', 'sayGoodbye'])} Then create \`farewell.mjs\` at the ` +
      'repo root exporting that one function, which takes a name and returns `Goodbye, <name>!`.',
    files: ['`farewell.mjs` — new.'],
    tests: 'Add `farewell.test.mjs` checking the function returns `Goodbye, Ada!` for `Ada`. Leave `npm test` green.',
    doneWhen: [
      'The name was asked first, through the AskUserQuestion tool, and `farewell.mjs` exports the function under the answered name.',
      '`npm test` is green.',
    ],
  }),
  'T03-release.md': taskDoc({
    num: 'T03',
    title: 'Add the release note (asks its date)',
    goal:
      `${askFirst(RELEASE_QUESTION, 'Date', ['2026-10-01', '2026-11-01'])} The answer may take several minutes; ` +
      'wait for it. Then create `RELEASE.md` at the repo root whose only line is `Release: <date>` with the ' +
      'answered date.',
    files: ['`RELEASE.md` — new.'],
    tests: 'No test file; leave `npm test` green.',
    doneWhen: [
      'The date was asked first, through the AskUserQuestion tool, and `RELEASE.md` announces the answered date.',
      '`npm test` is green.',
    ],
  }),
};

const seedFiles = {
  [`plans/${slug}/DESIGN.md`]: design,
  '.claude/pir-coordinator.md': rules,
};

const scenario = defineScenario({
  id: slug,
  title,
  fixture: slug,
  // Ceiling 3 so all three ask on the same pass; 20 minutes bounds three builds, three reviews, a 3-minute
  // hold, the person's minute and the report (DESIGN §5.2).
  seatbelts: { ceiling: 3, timeoutMs: 20 * 60 * 1000 },
  coordinator: true,
  coordinatorHoldMs: HOLD_MS,
  statusSnapshots: true,
  // The person's stand-in answers only what status.json shows as the person's (T03 after the hold limit),
  // and waits a minute first.
  answerPending: { personDelayMs: PERSON_DELAY_MS },
  mergeWhenReady: true,
  facts: [
    briefsOverlapped('T01', 'T02'),
    agentAnswered('T01'),
    agentAnswered('T02'),
    oneDecisionEach(['T01', 'T02']),
    timedOutToPerson('T03', HOLD_MS),
    statementsMatchRecord(),
    readyWithReport({ conflict: false }),
    ceilingHeld(3),
  ],
});

export default { id: slug, slug, title, progress, tasks, seedFiles, scenario };
