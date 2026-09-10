// merge-conflict — two tasks whose docs make each edit the SAME line of the same file, at ceiling 1.
// Ceiling 1 serializes them for determinism: T01 completes and merges into the feature branch first, so
// when T02 integrates the feature branch it hits the conflict on that line, cannot resolve it cleanly,
// and the worker surfaces a decision and parks (DESIGN §2.5, §4.1). No bad merge lands.
//
// The scenario names the CONFLICTING task, T02, because the flow log does not carry a surface's kind —
// only its type and task (FINDINGS 2026-09-10). mergeConflictParked('T02') keys on that task: a surface
// for it, and no merge of it in the flow or git log.
//
// The `probe` records each task's engineered single-line edit so the build test can replay them and
// prove the second merge really does conflict (expect: 'conflict') — no worker spawned (T16 acceptance).

import { defineScenario } from '../scenario.mjs';
import { mergeConflictParked } from '../assertions.mjs';
import { progressDoc, taskDoc } from './common.mjs';

const slug = 'merge-conflict';

const seedFiles = { 'greeting.txt': 'hello world\n' };

const progress = progressDoc({
  slug,
  summary: 'Two tasks edit the same line of greeting.txt, ceiling 1: the second merge conflicts and parks (DESIGN §4.1).',
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

// Both edits target the same line of greeting.txt ⇒ the second merge conflicts. Order is T01 then T02.
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
  seatbelts: { ceiling: 1 },
  facts: [mergeConflictParked('T02')],
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
