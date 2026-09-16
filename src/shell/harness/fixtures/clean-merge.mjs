// clean-merge — two independent tasks that touch DIFFERENT files, at ceiling 2. Forces two serialized,
// clean merges into the feature branch and one promotion (DESIGN §4.1). The seeded files a.txt and b.txt
// exist on main; each task rewrites its own, so no merge ever conflicts.
//
// The `probe` records the exact single-file edit each task's doc instructs, so the build test can replay
// them on two branches and prove the second merge really is clean (expect: 'clean') — a git-level proof
// of the seeded shape with no worker spawned (T16 acceptance).
//
// Facts (T15): main gained exactly one commit — the promotion, no task branch reaching main directly;
// the ceiling held at 2; no finished worker was closed before it went idle.

import { defineScenario } from '../scenario.mjs';
import { oneMergeToMain, ceilingHeld, noCloseBeforeIdle } from '../assertions.mjs';
import { progressDoc, taskDoc } from './common.mjs';

const slug = 'clean-merge';

const seedFiles = { 'a.txt': 'A\n', 'b.txt': 'B\n' };

const progress = progressDoc({
  slug,
  summary: 'Two independent tasks on different files, ceiling 2: two clean merges and one promotion (DESIGN §4.1).',
  tasks: [
    { num: 'T01', name: 'Rewrite a.txt', runs: 'auto', deps: [], state: '⬜' },
    { num: 'T02', name: 'Rewrite b.txt', runs: 'auto', deps: [], state: '⬜' },
  ],
});

const tasks = {
  'T01-a.md': taskDoc({
    num: 'T01',
    title: 'Rewrite a.txt',
    goal: 'Replace the single line of `a.txt` (currently `A`) with the text `A1`, so the whole file is `A1`.',
    files: ['`a.txt` — edit the one line.'],
    doneWhen: ['`a.txt` contains exactly `A1`.', '`npm test` is still green.'],
  }),
  'T02-b.md': taskDoc({
    num: 'T02',
    title: 'Rewrite b.txt',
    goal: 'Replace the single line of `b.txt` (currently `B`) with the text `B1`, so the whole file is `B1`.',
    files: ['`b.txt` — edit the one line.'],
    doneWhen: ['`b.txt` contains exactly `B1`.', '`npm test` is still green.'],
  }),
};

// Each task's engineered edit, in the order T01 then T02. Different files ⇒ a clean second merge.
const probe = {
  expect: 'clean',
  edits: [
    { task: 'T01', file: 'a.txt', from: 'A', to: 'A1' },
    { task: 'T02', file: 'b.txt', from: 'B', to: 'B1' },
  ],
};

const scenario = defineScenario({
  id: slug,
  title: 'Clean merge — two serialized merges, one promotion',
  fixture: slug,
  seatbelts: { ceiling: 2 },
  facts: [oneMergeToMain(), ceilingHeld(2), noCloseBeforeIdle()],
});

export default {
  id: slug,
  slug,
  title: 'Clean merge — two serialized merges, one promotion',
  progress,
  tasks,
  seedFiles,
  probe,
  scenario,
};
