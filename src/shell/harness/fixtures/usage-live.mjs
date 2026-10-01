// usage-live — two independent trivial ⬜ tasks at ceiling 2, launched as `pir` launches a run
// (plans/api-service T10, DESIGN §1, §2.3, §5.1). The tasks are not the point: four real sessions
// (an implementer and a reviewer per task) are, because each one on a claude.ai subscription is sent
// `rate_limit_event` messages, and the run process saves every reading among them to the scratch
// home's `.pir/usage.json` (§2.4). usage-live-check.mjs runs this scenario with the API service beside
// it and compares what the service answers with what the conversation logs hold.
//
// `statusSnapshots` is what makes it a run "started by pir": PIR_RUN=1, which turns the usage reporter
// on, and a scratch PIR_HOME under the plan's .parallel/, so nothing reaches the person's own
// `~/.pir/usage.json` (§2.8). No coordinator agent and no question: nothing here needs a person, and an
// agent session would only add cost.
//
// Modelled on parallel.mjs without the kill switch: the run must work to its hand-off so the sessions
// keep hearing events for `observed_at` to move.

import { defineScenario } from '../scenario.mjs';
import { noHelloEver, ceilingHeld, handedOffGreenBranch } from '../assertions.mjs';
import { progressDoc, taskDoc } from './common.mjs';

const slug = 'usage-live';
const title = 'Usage live — real sessions yield the readings the API serves';

const TASKS = [
  { num: 'T01', name: 'Write usage marker one', file: 'usage-1.txt' },
  { num: 'T02', name: 'Write usage marker two', file: 'usage-2.txt' },
];

const progress = progressDoc({
  slug,
  summary: 'Two independent trivial tasks at ceiling 2, run as pir runs them, so real sessions report usage (api-service T10).',
  tasks: TASKS.map((t) => ({ num: t.num, name: t.name, runs: 'auto', deps: [], state: '⬜' })),
});

const tasks = Object.fromEntries(
  TASKS.map((t) => [
    `${t.num}-marker.md`,
    taskDoc({
      num: t.num,
      title: t.name,
      goal: `Create a file \`${t.file}\` at the repo root whose entire contents are the two letters \`ok\` followed by a single trailing newline, and nothing else. That is all — do not ask; the newline is specified.`,
      files: [`\`${t.file}\` — new.`],
      doneWhen: [`\`${t.file}\` exists and its entire contents are \`ok\` plus one trailing newline.`, '`npm test` is still green.'],
    }),
  ]),
);

const scenario = defineScenario({
  id: slug,
  title,
  fixture: slug,
  // 20 minutes: two builds and two reviews of a one-line file, with room for a slow machine.
  seatbelts: { ceiling: 2, timeoutMs: 20 * 60 * 1000 },
  facts: [noHelloEver(), ceilingHeld(2), handedOffGreenBranch()],
  statusSnapshots: true,
});

export default { id: slug, slug, title, progress, tasks, scenario };
