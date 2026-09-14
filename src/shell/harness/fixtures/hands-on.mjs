// hands-on — the build→verify split (DESIGN §2.6, T31) made concrete as a live fixture, and the ONLY
// fixture that exercises a `you` task end to end with a person in the loop (T32). Two tasks:
//   T01 `auto` — an autonomous worker builds a tiny runnable program (greet.mjs, which prints a known
//                line) with its own test, and it is fresh-reviewed and merged like any auto task.
//   T02 `you`  — depends on T01: the hands-on verification. Its "Needs a person" block asks the person to
//                RUN the program T01 built and confirm the line. The coordinator spawns a pir-verify
//                scribe the person drives; the scribe records a `✅` row into FINDINGS.md, marks the row
//                ✅, and reports done — with NO review — and the plan promotes (DESIGN §2.6).
//
// ATTENDED-ONLY (PM decision 2026-09-14). A `you` task emits no `surface` line, so the runner's scripted
// injector cannot drive it; the person drives the verify worker by hand. The runner surfaces a durable
// `hands-on T02` drive signal (loop.mjs writes the flow line, run.mjs announces it) and this fixture
// gives the run a roomier wall-clock budget so a human-speed drive is not guillotined; teardown and the
// kill switch stay. The unattended auto-drive channel is deliberately out of scope (T32).
//
// Facts (T15): verifyWorkerSpawned('T02') — the you-task's worker is a verify session, not an implementer
// (keyed on the timeline agent name, since the flow log drops role); youNeverReviewed('T02') — a merge of
// T02 with no review of it (§2.6); oneMergeToMain — the plan promotes once; ceilingHeld(1); and
// scribeWroteFinding — the hand-verified `✅` row reached main in FINDINGS.md.

import { defineScenario } from '../scenario.mjs';
import {
  verifyWorkerSpawned,
  youNeverReviewed,
  oneMergeToMain,
  ceilingHeld,
  scribeWroteFinding,
} from '../assertions.mjs';
import { progressDoc, taskDoc } from './common.mjs';

const slug = 'hands-on';
const GREETING = 'hello from the agent';
const FINDINGS_PATH = `plans/${slug}/FINDINGS.md`;

const progress = progressDoc({
  slug,
  summary:
    'One auto build then one you-verify, ceiling 1: an agent builds a program and a person runs it (DESIGN §2.6, §4.1).',
  tasks: [
    { num: 'T01', name: 'Build greet.mjs (auto)', runs: 'auto', deps: [], state: '⬜' },
    { num: 'T02', name: 'Run greet.mjs and confirm its output (you)', runs: 'you', deps: ['T01'], state: '⬜' },
  ],
});

const tasks = {
  'T01-build-greet.md': taskDoc({
    num: 'T01',
    title: 'Build greet.mjs (auto)',
    goal:
      `Create \`greet.mjs\` at the repo root: a runnable Node script that, run with \`node greet.mjs\`, ` +
      `prints exactly the line \`${GREETING}\` (and a trailing newline) to stdout, and nothing else. Add a ` +
      `test \`greet.test.mjs\` that runs the script and asserts its output is exactly that line. That is ` +
      `all — do not ask; the line is specified.`,
    files: ['`greet.mjs` — new, the runnable script.', '`greet.test.mjs` — new, asserts its output.'],
    tests: `A \`greet.test.mjs\` that runs \`node greet.mjs\` and asserts stdout is exactly \`${GREETING}\` plus a newline.`,
    doneWhen: [
      `\`node greet.mjs\` prints exactly \`${GREETING}\` and a trailing newline.`,
      '`greet.test.mjs` asserts that output and `npm test` is green.',
    ],
  }),
  'T02-run-greet.md': taskDoc({
    num: 'T02',
    title: 'Run greet.mjs and confirm its output (you)',
    runs: 'you',
    goal:
      `Hand-verify the program T01 built. This is a \`you\` task: a person runs the program and confirms ` +
      `what it prints, and you are the scribe (DESIGN §2.6). Present the "Needs a person" block below, wait ` +
      `for the person to report, then record what they saw. There is no code to write and no review.`,
    files: [`\`${FINDINGS_PATH}\` — append the \`✅ verified by hand\` row the person's report earns.`],
    tests: 'None — a you task has no code deliverable; the recorded observation is the evidence (§2.6).',
    doneWhen: [
      'The person ran `node greet.mjs` and reported the line it printed.',
      `A \`✅ verified by hand\` row recording that observation is in \`${FINDINGS_PATH}\`.`,
    ],
    needsPerson: {
      command: 'node greet.mjs',
      expect: `the single line \`${GREETING}\` is printed to the terminal.`,
      tell: `the exact line \`node greet.mjs\` printed, so the ✅ row records what was actually seen.`,
    },
  }),
};

const scenario = defineScenario({
  id: slug,
  title: 'Hands-on — an agent builds a program, a person runs it',
  fixture: slug,
  // Ceiling 1: the tasks are a dependency chain (the verify needs the built program), so they never run
  // concurrently. A roomier wall-clock backstop than the default 10 min because a person drives the
  // verify worker at human speed — still an automatic HALT if the run hangs (§5.2).
  seatbelts: { ceiling: 1, timeoutMs: 25 * 60 * 1000 },
  facts: [
    verifyWorkerSpawned('T02'),
    youNeverReviewed('T02'),
    oneMergeToMain(),
    ceilingHeld(1),
    scribeWroteFinding({ file: FINDINGS_PATH, needle: '✅' }),
  ],
});

export default {
  id: slug,
  slug,
  title: 'Hands-on — an agent builds a program, a person runs it',
  progress,
  tasks,
  // The runner captures this file's promoted content into the bundle (final-files.json) so
  // scribeWroteFinding can confirm the hand-verified row reached main offline.
  finalContent: { file: FINDINGS_PATH },
  scenario,
};
