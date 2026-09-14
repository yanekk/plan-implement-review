// merge-conflict — two tasks whose docs make each edit the SAME line of the same file, at ceiling 2.
// Ceiling 2 so both task branches are cut from the common seeded base and worked concurrently: the
// first worker to complete merges cleanly into the feature branch, and the second then cannot merge
// that line — the coordinator hits the conflict at its own merge step. Under Option 2 (DESIGN §2.5,
// T28) the coordinator KEEPS that worker alive and parked, surfaces the conflict, delivers the user's
// decision, and the worker resolves on its own branch and re-signals done; the decided side then merges
// and the plan promotes once. (This replaced the old terminal-park behaviour, where the conflicting
// task never merged and the plan stalled behind one clash — the T22 live run under it shipped the WRONG
// side to main because the done+merged worker was closed and its task respawned; see FINDINGS.)
//
// Why ceiling 2, not 1 (T16 review 2026-09-11): at ceiling 1 the tasks serialize, so the second task's
// branch is cut from the feature branch AFTER the first has already merged — it starts from the merged
// text, and its later merge is clean, no conflict at all (verified against the real branch model). A
// conflict needs both branches cut from the SAME ancestor before either merges, which only happens
// when they run concurrently.
//
// merge-conflict is INTERACTIVE, not hands-off (like human-decision): a decision must reach the parked
// worker for the run to finish. `scriptedAnswer` is the fixed decision the T17 runner writes to the
// control `answers` file the moment the conflict surfaces, so the re-run is deterministic without a
// live human — the worker's parking, the delivery and the resolution are all still real. The decision
// is task-AGNOSTIC on purpose (it names no task): whichever worker merges second conflicts, and the
// runner fills in that task from the `surface` line, so the DECIDED content ("hello there") is fixed
// regardless of which side lost the race.
//
// The fact is `mergeConflictResolved({ file, content })` (task-agnostic): a conflict surfaced with no
// merge of that task before it, the decision delivered to the live worker (an `answer` line), the same
// worker resumed to a merge, exactly one implement session for it (no respawn), exactly one promotion,
// and — the crux of the T22 regression — main's final greeting.txt reads the DECIDED "hello there",
// not the losing "hi world".
//
// The `probe` records each task's engineered single-line edit so the build test can replay them from a
// common base and prove the second merge really does conflict (expect: 'conflict'). At ceiling 2 both
// branches ARE cut from that common base, so the probe models the real interleaving — no worker spawned.

import { defineScenario } from '../scenario.mjs';
import { mergeConflictResolved } from '../assertions.mjs';
import { progressDoc, taskDoc } from './common.mjs';

const slug = 'merge-conflict';

const seedFiles = { 'greeting.txt': 'hello world\n' };

const progress = progressDoc({
  slug,
  summary: 'Two tasks edit the same line of greeting.txt, ceiling 2: whichever merges second conflicts; the coordinator keeps that worker alive, delivers the decision, and it resolves to the decided side (DESIGN §2.5 Option 2, §4.1).',
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

// The fixed decision the T17 runner writes to the control `answers` file when the conflict surfaces, so
// the round trip is repeatable without a live human. It names no task — the runner fills in whichever
// task the `surface` line reports — so the decided content is fixed however the merge race falls out.
// The worker's parking, the delivery and the resolution are all still real.
const scriptedAnswer = {
  text:
    'There is a merge conflict in greeting.txt between the two greeting tasks. Resolve it by KEEPING the ' +
    'wording "hello there": the whole file must read exactly one line, `hello there`, and the other ' +
    'wording ("hi world") is discarded. Resolve it on your own branch and re-signal done.',
};

// What main must read after the resolution promotes — the decided side, not the loser.
const finalContent = { file: 'greeting.txt', content: 'hello there' };

const scenario = defineScenario({
  id: slug,
  title: 'Merge conflict — kept alive, decided, resolved, decided side reaches main',
  fixture: slug,
  seatbelts: { ceiling: 2 },
  facts: [mergeConflictResolved(finalContent)],
});

export default {
  id: slug,
  slug,
  title: 'Merge conflict — kept alive, decided, resolved, decided side reaches main',
  progress,
  tasks,
  seedFiles,
  probe,
  scriptedAnswer,
  finalContent,
  scenario,
};
