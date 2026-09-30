// pir-coordinator — the live check of the coordinator agent (pir-coordinator T09, DESIGN §1 success
// criteria): real workers, the real agent, and the person on the phone. Two INDEPENDENT tasks at ceiling 2:
//   T01 asks, through the AskUserQuestion tool, a naming question this fixture's DESIGN.md answers. The
//       agent should answer it from DESIGN, so T01 never reads `asking you` (agentAnswered).
//   T02 first runs `git push origin HEAD`. The scratch repo's `.claude/settings.json` puts `git push` in
//       `permissions.ask`, so the request is reserved to the person (DESIGN §2.4) whatever the agent says;
//       the harness stands in for the person and denies it (there is no remote anyway). T02 then drops a
//       `question` report and asks in plain text (so the harness leaves it alone) a public-API question the
//       plan leaves open. The project rules file says to pass public-API questions on, so the agent passes
//       it with a pointer; only then does T02's Remote Control switch on, and the person answers T02 on the
//       phone (remoteOnlyAfterPass; the phone answer is the person's hand-verification).
//   Once T01 has merged, the runner commits to the scratch main a change to the line of notes.txt T01
//   edited (baseCommit), so the end sync meets a conflict and a main-sync worker resolves it. The run then
//   commits REPORT.md and waits in `ready to merge`; the runner merges the feature branch into the scratch
//   main as the person would (mergeWhenReady), and the command finishes (readyWithReport).
//
// The scenario runs the agent (`coordinator`) as `pir` does (`statusSnapshots`), and the harness answers
// only what status.json shows held by the person (answerer.mjs personOnly).

import { defineScenario } from '../scenario.mjs';
import { agentAnswered, reservedToPerson, remoteOnlyAfterPass, readyWithReport, ceilingHeld } from '../assertions.mjs';
import { progressDoc, taskDoc } from './common.mjs';

const slug = 'pir-coordinator';
const title = 'Coordinator agent — answers what the plan settles, passes the rest on, hands over a ready branch';

// The command T02 runs, and the ask rule that reserves it. An `ask` rule with a wildcard, the shape a plan
// review writes for a §5.3 `ask` row.
const PUSH_COMMAND = 'git push origin HEAD';
const ASK_RULE = 'Bash(git push:*)';

// T01's question. DESIGN.md below answers it (`greet`).
const NAME_QUESTION = 'What should the exported greeting function in greet.mjs be called?';

// The line T01 changes and the runner's main commit changes differently: the end sync's conflict.
const NOTES_SEED = 'status: seeded\n';
const NOTES_T01 = 'status: greeting added';
const NOTES_MAIN = 'status: main moved on\n';

const design = `---
setup: none
test:
  - npm test
---

# ${slug} — scratch fixture design

Throwaway plan for the live check of the coordinator agent. Not a real feature.

## Decisions

- **The greeting function is named \`greet\`.** \`greet.mjs\` exports \`greet(name)\`, returning
  \`Hello, \${name}!\`. Not \`sayHello\`: every verb in this project is one word.
- **notes.txt holds one status line per change.** When a merge conflicts on \`notes.txt\`, keep both
  sides' lines, main's line first, and nothing else.
- The public API of \`api.mjs\` (its function's name) is deliberately **not** decided here.

## Environment

The test command is \`npm test\`. It runs \`node --test\` and is green on a fresh checkout. There is no
git remote: nothing is ever pushed.
`;

// The project rules the agent reads from the feature worktree (docs/coordinator-agent.md).
const rules = `# Coordinator rules for this project

- Pass questions about the public API to the person: the name or signature of anything \`api.mjs\`
  exports is theirs to decide, even when the plan hints at an answer and you would pick one.
- Everything DESIGN.md settles, answer from DESIGN.md.
`;

const progress = progressDoc({
  slug,
  summary:
    'Two independent tasks: T01 asks a naming question DESIGN answers (the agent answers it); T02 runs a reserved git push (the person denies it) and asks a public-API question the rules pass on (the person answers on the phone). Main moves after T01 merges, so the end sync conflicts (pir-coordinator T09).',
  tasks: [
    { num: 'T01', name: 'Greeting function (asks a name DESIGN settles)', deps: [], state: '⬜' },
    { num: 'T02', name: 'Version API (a reserved push, a passed question)', deps: [], state: '⬜' },
  ],
});

const tasks = {
  'T01-greeting.md': taskDoc({
    num: 'T01',
    title: 'Add the greeting function (asks its name)',
    goal:
      'Create `greet.mjs` at the repo root exporting one function that takes a name and returns ' +
      '`Hello, <name>!`, and change the single line of `notes.txt` from `status: seeded` to ' +
      `\`${NOTES_T01}\`. Before writing \`greet.mjs\`, ask the function's name with the **AskUserQuestion ` +
      `tool** (not plain text): one question, "${NAME_QUESTION}", header "Name", single-select, options ` +
      '`greet` and `sayHello`. Ask even if you think you know the answer, and use exactly the name the ' +
      'answer gives. A reviewer of this task does not ask again.',
    files: ['`greet.mjs` — new.', '`notes.txt` — its one line changed.'],
    tests: 'Add `greet.test.mjs` checking the function returns `Hello, Ada!` for `Ada`. Leave `npm test` green.',
    doneWhen: [
      'The name was asked through the AskUserQuestion tool, and `greet.mjs` exports the function under the answered name.',
      `\`notes.txt\` is the single line \`${NOTES_T01}\`.`,
      '`npm test` is green.',
    ],
  }),
  'T02-version.md': taskDoc({
    num: 'T02',
    title: 'Add the version API (a reserved push, then a public-API question)',
    goal:
      `Do these steps in order. (1) Run exactly \`${PUSH_COMMAND}\` with the Bash tool, from the repo root, ` +
      "once. This repo's `.claude/settings.json` makes it ask the person first, and there is no remote: " +
      'whether it is refused or fails, that is expected. Do not retry it, do not push any other way, and ' +
      'carry on. (2) Create `api.mjs` at the repo root exporting one function that returns the string ' +
      "`1.0.0`. Its name is the public API and is the person's choice: drop a `question` report asking " +
      'whether it is `version()` or `getVersion()`, then ask the person in plain text in your reply (NOT the ' +
      'AskUserQuestion tool) and end your turn. (3) When the answer comes, write `api.mjs` with exactly that ' +
      'name and finish. A reviewer of this task does not run the push and does not ask again.',
    files: ['`api.mjs` — new.'],
    tests: 'Add `api.test.mjs` checking the function returns `1.0.0`. Leave `npm test` green.',
    doneWhen: [
      `\`${PUSH_COMMAND}\` was run once, and its refusal or failure did not stop the task.`,
      '`api.mjs` exports the function under the name the person gave.',
      '`npm test` is green.',
    ],
  }),
};

// Committed with the seed, so the feature worktree (the agent's rules and ask rules) and every task
// worktree carry them.
const seedFiles = {
  [`plans/${slug}/DESIGN.md`]: design,
  '.claude/pir-coordinator.md': rules,
  '.claude/settings.json': `${JSON.stringify({ permissions: { ask: [ASK_RULE] } }, null, 2)}\n`,
  'notes.txt': NOTES_SEED,
};

const scenario = defineScenario({
  id: slug,
  title,
  fixture: slug,
  // Ceiling 2 so both tasks run at once; 20 minutes bounds two builds, two reviews, a phone answer, the
  // main-sync worker and the report (DESIGN §5.2).
  seatbelts: { ceiling: 2, timeoutMs: 20 * 60 * 1000 },
  coordinator: true,
  statusSnapshots: true,
  // The person's stand-in answers only what status.json shows as the person's; T02's push it denies.
  answerPending: { permissions: { T02: 'deny' } },
  baseCommit: { after: 'T01', files: { 'notes.txt': NOTES_MAIN }, message: 'main: notes.txt moved on while the run built' },
  mergeWhenReady: true,
  facts: [agentAnswered('T01'), reservedToPerson('T02', 'deny'), remoteOnlyAfterPass('T02'), readyWithReport(), ceilingHeld(2)],
});

export default { id: slug, slug, title, progress, tasks, seedFiles, scenario };
