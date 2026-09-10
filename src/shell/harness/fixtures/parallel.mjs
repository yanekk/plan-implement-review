// parallel — several independent ⬜ auto tasks at ceiling 2. Forces concurrent workers, the ceiling
// (three ready tasks, two slots → one waits), and per-worker naming. The KILL-SWITCH drill lives here
// (DESIGN §4.1): the T17 runner touches HALT mid-run, and the scenario asserts every worker was ended
// and nothing was promoted. Subsumes T10's full multi-worker + kill-switch drill.
//
// Facts (T15): a hello per spawn (per-worker naming), the ceiling held at 2, and the kill switch
// stopped every worker while promoting nothing. There is no oneMergeToMain here on purpose — the run
// is HALTed before promotion, so main must stay untouched (killSwitchStoppedAll checks exactly that).
//
// Ceiling caveat (T08 FINDINGS 2026-09-09): a review handoff can transiently list implementer+reviewer
// = ceiling+1. This scenario HALTs mid-build, before reviews, so ceilingHeld(2) is the honest bound; a
// later scenario that samples through a handoff would use ceilingHeld(3) per the assertions.mjs note.

import { defineScenario } from '../scenario.mjs';
import { helloPerSpawn, ceilingHeld, killSwitchStoppedAll } from '../assertions.mjs';
import { progressDoc, taskDoc } from './common.mjs';

const slug = 'parallel';

// Three independent tasks so two run at once and a third waits on a slot.
const TASKS = [
  { num: 'T01', name: 'Write parallel marker one', file: 'parallel-1.txt' },
  { num: 'T02', name: 'Write parallel marker two', file: 'parallel-2.txt' },
  { num: 'T03', name: 'Write parallel marker three', file: 'parallel-3.txt' },
];

const progress = progressDoc({
  slug,
  summary:
    'Three independent tasks at ceiling 2: concurrency, the ceiling, and the kill-switch drill (DESIGN §4.1).',
  tasks: TASKS.map((t) => ({ num: t.num, name: t.name, runs: 'auto', deps: [], state: '⬜' })),
});

const tasks = Object.fromEntries(
  TASKS.map((t) => [
    `${t.num}-marker.md`,
    taskDoc({
      num: t.num,
      title: t.name,
      goal: `Create a file \`${t.file}\` at the repo root whose only contents are the text \`ok\`. That is all.`,
      files: [`\`${t.file}\` — new.`],
      doneWhen: [`\`${t.file}\` exists and contains \`ok\`.`, '`npm test` is still green.'],
    }),
  ]),
);

const scenario = defineScenario({
  id: slug,
  title: 'N parallel tasks — concurrency, ceiling, kill switch',
  fixture: slug,
  seatbelts: { ceiling: 2 },
  facts: [helloPerSpawn(), ceilingHeld(2), killSwitchStoppedAll()],
});

export default {
  id: slug,
  slug,
  title: 'N parallel tasks — concurrency, ceiling, kill switch',
  progress,
  tasks,
  scenario,
};
