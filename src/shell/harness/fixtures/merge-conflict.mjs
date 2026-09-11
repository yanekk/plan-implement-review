// merge-conflict — two tasks whose docs make each edit the SAME line of the same file, at ceiling 2.
// Ceiling 2 so both task branches are cut from the common seeded base and worked concurrently: the
// first worker to complete merges cleanly into the feature branch, and the second then cannot merge
// that line — it conflicts, is surfaced and parked, and no bad merge lands (DESIGN §2.5, §4.1). No
// promotion, since a parked task never reaches ✅.
//
// Why ceiling 2, not 1 (T16 review 2026-09-11): at ceiling 1 the tasks serialize, so the second task's
// branch is cut from the feature branch AFTER the first has already merged — it starts from the merged
// text, and its later merge is clean, no conflict at all (verified against the real branch model). A
// conflict needs both branches cut from the SAME ancestor before either merges, which only happens
// when they run concurrently.
//
// The fact is task-AGNOSTIC: `conflictSurfacedAndParked()`, not a task-named one. Which of the two
// workers finishes second — and so which one hits the conflict — is a timing race, so the scenario
// cannot name it. The fact checks the outcome instead: some task was surfaced, no surfaced task
// merged (flow or git log), and nothing was promoted. A worker-caught conflict now reaches the flow
// log too (loop.mjs applyMessages, same review), so the fact holds wherever the conflict is caught.
//
// The `probe` records each task's engineered single-line edit so the build test can replay them from a
// common base and prove the second merge really does conflict (expect: 'conflict'). At ceiling 2 both
// branches ARE cut from that common base, so the probe now models the real interleaving — no worker
// spawned (T16 acceptance).

import { defineScenario } from '../scenario.mjs';
import { conflictSurfacedAndParked } from '../assertions.mjs';
import { progressDoc, taskDoc } from './common.mjs';

const slug = 'merge-conflict';

const seedFiles = { 'greeting.txt': 'hello world\n' };

const progress = progressDoc({
  slug,
  summary: 'Two tasks edit the same line of greeting.txt, ceiling 2: whichever merges second conflicts and parks (DESIGN §4.1).',
  tasks: [
    { num: 'T01', name: 'Change the greeting to "hello there"', runs: 'auto', deps: [], state: '⬜' },
    { num: 'T02', name: 'Change the greeting to "hi world"', runs: 'auto', deps: [], state: '⬜' },
  ],
});

const tasks = {
  'T01-greeting.md': taskDoc({
    num: 'T01',
    title: 'Change the greeting to "hello there"',
    goal: 'Edit `greeting.txt`: change its single line from `hello world` to `hello there`, so the whole file is `hello there`.',
    files: ['`greeting.txt` — edit the one line.'],
    doneWhen: ['`greeting.txt` contains exactly `hello there`.', '`npm test` is still green.'],
  }),
  'T02-greeting.md': taskDoc({
    num: 'T02',
    title: 'Change the greeting to "hi world"',
    goal: 'Edit `greeting.txt`: change its single line from `hello world` to `hi world`, so the whole file is `hi world`.',
    files: ['`greeting.txt` — edit the one line.'],
    doneWhen: ['`greeting.txt` contains exactly `hi world`.', '`npm test` is still green.'],
  }),
};

// Both edits target the same line of greeting.txt from the common base ⇒ the second merge conflicts.
// Order is T01 then T02, matching the ceiling-2 concurrent interleaving the probe replays.
const probe = {
  expect: 'conflict',
  edits: [
    { task: 'T01', file: 'greeting.txt', from: 'hello world', to: 'hello there' },
    { task: 'T02', file: 'greeting.txt', from: 'hello world', to: 'hi world' },
  ],
};

const scenario = defineScenario({
  id: slug,
  title: 'Merge conflict — surfaced and parked, no bad merge',
  fixture: slug,
  seatbelts: { ceiling: 2 },
  facts: [conflictSurfacedAndParked()],
});

export default {
  id: slug,
  slug,
  title: 'Merge conflict — surfaced and parked, no bad merge',
  progress,
  tasks,
  seedFiles,
  probe,
  scenario,
};
