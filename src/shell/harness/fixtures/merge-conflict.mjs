// merge-conflict — two tasks whose docs make each edit the SAME line of the same file, at ceiling 2, so
// a real coordinator merge conflict is tested end-to-end under the non-agentic, ATTENDED model (DESIGN
// §2.8). Ceiling 2 so both task branches are cut from the common seeded base and worked concurrently: the
// first worker to complete merges cleanly into the feature branch, and the second then cannot merge that
// line — the coordinator hits the conflict at its own merge step (loop.mjs mergeTask). It KEEPS that
// worker alive and parked (AWAITING), never closing it or merging past it, and shows a ready-to-paste
// resolution prompt for it (buildConflictPrompt, T14).
//
// There is no down-channel and no scripted answer any more (DESIGN §2.2, T05): the worker learns the
// resolution from a PERSON attaching to it directly (§2.8), not from a routed answer. A person copies the
// coordinator's prompt, fills the keep-which-side blank with the fixed decided wording `hello there`,
// attaches to that worker in `claude agents`, and pastes it. The worker merges the feature branch into its
// own branch, resolves keeping that side, commits, and re-signals done; the coordinator's next pass merges
// its now-clean branch, and the run HANDS OFF the green feature branch (§2.4 — it never merges to main).
//
// This REPLACES the old down-channel fixture, whose `scriptedAnswer` the T17 runner wrote to a control
// `answers` file the moment the conflict surfaced, and whose fact required an `answer` flow line and a
// promotion to main — all removed with the relay and the promotion (§2.2, §2.4, T05). The loop no longer
// emits `answer`, so that shape could never go green again (FINDINGS 2026-09-20); this task reworks the
// fixture and its fact to the attended reality.
//
// Why ceiling 2, not 1 (T16 review 2026-09-11): at ceiling 1 the tasks serialize, so the second task's
// branch is cut from the feature branch AFTER the first has already merged — it starts from the merged
// text, and its later merge is clean, no conflict at all (verified against the real branch model). A
// conflict needs both branches cut from the SAME ancestor before either merges, which only happens when
// they run concurrently.
//
// Keeping `hello there` as the fixed resolution wording is a deterministic-test choice, not a product
// rule: it matches the old decided side so the regression assertion (the decided side won, not "hi world")
// stays meaningful whichever worker loses the merge race.
//
// The fact is `mergeConflictResolved({ file, content })` (task-agnostic): a conflict surfaced with no
// merge of that task before it, the SAME worker resumed to a merge (no respawn, no routed answer), the run
// handed off a green feature branch (zero promote, no merge to main, ≥1 task merge), and — the crux of the
// old T22 regression — the handed-off feature branch's greeting.txt reads the DECIDED `hello there`, not
// the losing `hi world`. Plus `ceilingHeld(2)`.
//
// The `probe` records each task's engineered single-line edit so the build test can replay them from a
// common base and prove the second merge really does conflict (expect: 'conflict'). At ceiling 2 both
// branches ARE cut from that common base, so the probe models the real interleaving — no worker spawned.

import { defineScenario } from '../scenario.mjs';
import { mergeConflictResolved, ceilingHeld } from '../assertions.mjs';
import { progressDoc, taskDoc } from './common.mjs';

const slug = 'merge-conflict';

const seedFiles = { 'greeting.txt': 'hello world\n' };

const progress = progressDoc({
  slug,
  summary:
    'Two tasks edit the same line of greeting.txt, ceiling 2: whichever merges second conflicts; the ' +
    'coordinator keeps that worker alive and parked, a person resolves it on the live worker by hand, and ' +
    'the run hands off the decided side (DESIGN §2.8, §2.4).',
  tasks: [
    { num: 'T01', name: 'Change the greeting to "hello there"', deps: [], state: '⬜' },
    { num: 'T02', name: 'Change the greeting to "hi world"', deps: [], state: '⬜' },
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

// The one thing no tool reaches here (DESIGN §5.1): a person must attach to the parked worker and paste the
// resolution — nothing is routed down (§2.2). Named on the fixture so whoever drives
// `run.mjs merge-conflict --into <dir>` knows exactly what to do in step 3 when the coordinator parks the
// conflict. The coordinator's own live display already shows the ready-to-paste prompt (buildConflictPrompt,
// T14); this text mirrors it so the harness reader and the hand-over both name the same steps.
const needsPerson = [
  'Attended step — a machine cannot do this; you resolve the conflict on the live worker:',
  '  1. When the coordinator parks the conflict, copy the resolution prompt it shows (T14). It names the',
  '     parked worker, the branch to merge into that worker, and greeting.txt as the conflicting file.',
  '  2. Where the prompt asks which side to keep, keep "hello there" — the whole file must end as one line,',
  '     `hello there`, discarding "hi world", so the run stays deterministic and the regression fact holds.',
  '  3. In `claude agents`, attach to that named worker and paste the prompt.',
  '  4. The worker merges the feature branch into its own branch, resolves keeping "hello there", commits',
  '     and re-signals done. The coordinator retries the merge, it lands clean, and the run completes and',
  '     hands off pir/merge-conflict (it does not merge to main).',
].join('\n');

// What the handed-off feature branch (pir/merge-conflict) must read after the resolution — the decided
// side, not the loser. The runner captures this from `git show pir/{slug}:greeting.txt` (§2.4: the run
// never merges to main), and mergeConflictResolved asserts it against `content`.
const finalContent = { file: 'greeting.txt', content: 'hello there' };

const scenario = defineScenario({
  id: slug,
  title: 'Merge conflict — kept alive, resolved by a person on the live worker, decided side handed off',
  fixture: slug,
  // ~25 min wall-clock: a human-speed budget for the person to attach and paste, matching the order of the
  // old hands-on fixture. On expiry the runner auto-HALTs (§5.2). expectedTerminal stays 'completed' (the
  // default): unlike human-decision's designed never-resolving park, this run FINISHES once the person
  // resolves — so a timeout here is a genuine FAIL, not a scored park.
  seatbelts: { ceiling: 2, timeoutMs: 25 * 60 * 1000 },
  facts: [mergeConflictResolved(finalContent), ceilingHeld(2)],
});

export default {
  id: slug,
  slug,
  title: 'Merge conflict — kept alive, resolved by a person on the live worker, decided side handed off',
  progress,
  tasks,
  seedFiles,
  probe,
  needsPerson,
  finalContent,
  scenario,
};
