// parallel — several independent ⬜ auto tasks at ceiling 2. Forces concurrent workers, the ceiling
// (three ready tasks, two slots → one waits), and per-worker naming. The KILL-SWITCH drill lives here
// (DESIGN §4.1): the T17 runner touches HALT mid-run, and the scenario asserts every worker was ended
// and nothing was promoted. Subsumes T10's full multi-worker + kill-switch drill.
//
// Facts (T15): no spawn hello was sent at all (retired in T30, noHelloEver), the ceiling held at 2, and
// the kill switch stopped every worker while promoting nothing. There is no oneMergeToMain here on
// purpose — the run is HALTed before promotion, so main must stay untouched (killSwitchStoppedAll checks
// exactly that).
//
// noHelloEver REPLACES the old helloPerSpawn here (T30). The T29 kill-switch scoping helloPerSpawn
// needed — a HALT firing before a queued hello was sent — is now moot: with no hello at all, there is
// nothing for the kill switch to interrupt, so the assertion is the plain "zero hello lines" over a run
// that did spawn workers before HALT. That is what makes retiring the hello also retire a moving part
// that could fail silently (T23: both hellos failed to send and it went unnoticed).
//
// Ceiling: ceilingHeld now counts worker SLOTS by task, so a review handoff (implementer+reviewer of
// one task) is one slot and a scenario asserts the bare true ceiling — ceilingHeld(2) here — with no
// ceiling+1 fudge (assertions.mjs; the 2026-09-13 clean-merge false-FAIL is what drove the change).

import { defineScenario } from '../scenario.mjs';
import { noHelloEver, ceilingHeld, killSwitchStoppedAll } from '../assertions.mjs';
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
      goal: `Create a file \`${t.file}\` at the repo root whose entire contents are the two letters \`ok\` followed by a single trailing newline, and nothing else. That is all — do not ask; the newline is specified.`,
      files: [`\`${t.file}\` — new.`],
      doneWhen: [`\`${t.file}\` exists and its entire contents are \`ok\` plus one trailing newline.`, '`npm test` is still green.'],
    }),
  ]),
);

const scenario = defineScenario({
  id: slug,
  title: 'N parallel tasks — concurrency, ceiling, kill switch',
  fixture: slug,
  seatbelts: { ceiling: 2 },
  facts: [noHelloEver(), ceilingHeld(2), killSwitchStoppedAll()],
});

export default {
  id: slug,
  slug,
  title: 'N parallel tasks — concurrency, ceiling, kill switch',
  progress,
  tasks,
  scenario,
};
