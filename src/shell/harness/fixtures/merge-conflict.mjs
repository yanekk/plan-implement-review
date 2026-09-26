// merge-conflict — two tasks whose docs make each edit the SAME line of the same file, at ceiling 2, so a
// real coordinator merge conflict is tested end to end, UNATTENDED (live-workers DESIGN §2.10). The run
// holds merges while either worker is still building (scenario `holdMerges` → PARALLEL_HOLD_MERGES,
// dispatch.mjs), so both branches integrate against the same seeded base before either lands: the first
// merges clean and the second conflicts at the coordinator's own merge (loop.mjs 3d), never at the worker's
// own integrate. Without the hold that ordering is a timing race the worker usually wins, and the
// coordinator-side path is never reached.
//
// On the conflict the coordinator keeps the losing worker alive and SENDS it the fix over its line
// (`conflict-sent`, buildConflictPrompt audience 'worker'); nobody pastes anything. Which greeting ships is
// a judgement, and both task docs say so, so the worker asks the person with AskUserQuestion; the row reads
// `asking you` like any other question. The harness answerer stands in for the person and types `Keep
// "hello there"` on any question (answerPending typed `*`, since the worker's wording cannot be known). The
// worker merges the feature branch into its branch, resolves, commits and re-signals done; the next pass
// merges it and the run HANDS OFF the green feature branch (§2.4 — it never merges to main).
//
// Why ceiling 2, not 1 (T16 review 2026-09-11): at ceiling 1 the tasks serialize, so the second task's
// branch is cut after the first has merged and its merge is clean. A conflict needs both branches cut from
// the SAME ancestor, which only happens when they run concurrently.
//
// `hello there` is a deterministic-test choice, not a product rule: whichever task loses the race, the
// answer names the same side, so the regression assertion (the decided side won, not "hi world") holds.
//
// The fact is `mergeConflictResolved({ file, content })` (task-agnostic): a `conflict-sent` with no merge of
// that task before it, the review session asked the person and got the answer, the SAME worker resolved to
// a merge (no respawn), the run handed off a green feature branch, and the handed-off greeting.txt reads
// `hello there`. Plus `ceilingHeld(2)`.
//
// The `probe` records each task's engineered single-line edit so the build test can replay them from a
// common base and prove the second merge really does conflict (expect: 'conflict'), no worker spawned.

import { defineScenario } from '../scenario.mjs';
import { mergeConflictResolved, ceilingHeld } from '../assertions.mjs';
import { progressDoc, taskDoc } from './common.mjs';

const slug = 'merge-conflict';

const seedFiles = { 'greeting.txt': 'hello world\n' };

const progress = progressDoc({
  slug,
  summary:
    'Two tasks edit the same line of greeting.txt, ceiling 2: whichever merges second conflicts; the ' +
    'coordinator sends that worker the fix, the worker asks the person which greeting ships, and the run ' +
    'hands off the decided side (live-workers DESIGN §2.10).',
  tasks: [
    { num: 'T01', name: 'Change the greeting to "hello there"', deps: [], state: '⬜' },
    { num: 'T02', name: 'Change the greeting to "hi world"', deps: [], state: '⬜' },
  ],
});

const tasks = {
  'T01-greeting.md': taskDoc({
    num: 'T01',
    title: 'Change the greeting to "hello there"',
    goal: 'Edit `greeting.txt`: change its single line from `hello world` to `hello there`, so the whole file is `hello there`. Which greeting ships is the product manager\'s call: if your change to this line ever clashes with another task\'s change to it, do not pick a side or combine them — ask the person which greeting to keep (AskUserQuestion) and resolve as they answer.',
    files: ['`greeting.txt` — edit the one line.'],
    doneWhen: ['`greeting.txt` contains exactly `hello there`.', '`npm test` is still green.'],
  }),
  'T02-greeting.md': taskDoc({
    num: 'T02',
    title: 'Change the greeting to "hi world"',
    goal: 'Edit `greeting.txt`: change its single line from `hello world` to `hi world`, so the whole file is `hi world`. Which greeting ships is the product manager\'s call: if your change to this line ever clashes with another task\'s change to it, do not pick a side or combine them — ask the person which greeting to keep (AskUserQuestion) and resolve as they answer.',
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

// The person's answer, typed by the harness answerer on whatever the worker asks (answerer.mjs `*`).
const ANSWER = 'Keep "hello there": greeting.txt is the single line `hello there`.';

// What the handed-off feature branch (pir/merge-conflict) must read after the resolution — the decided
// side, not the loser. The runner captures this from `git show pir/{slug}:greeting.txt` (§2.4: the run
// never merges to main), and mergeConflictResolved asserts it against `content`.
const finalContent = { file: 'greeting.txt', content: 'hello there' };

const scenario = defineScenario({
  id: slug,
  title: 'Merge conflict — sent to the live worker, the person asked which side, decided side handed off',
  fixture: slug,
  // Two builds, two reviews, the held merges, one resolution and the end tests: the live-workers-demo order
  // of work plus a resolution turn. On expiry the runner auto-HALTs (§5.2) and the run fails.
  seatbelts: { ceiling: 2, timeoutMs: 20 * 60 * 1000 },
  holdMerges: true,
  answerPending: { typed: { '*': ANSWER } },
  facts: [mergeConflictResolved(finalContent), ceilingHeld(2)],
});

export default {
  id: slug,
  slug,
  title: 'Merge conflict — sent to the live worker, the person asked which side, decided side handed off',
  progress,
  tasks,
  seedFiles,
  probe,
  finalContent,
  scenario,
};
