// finisher-live — the live check of the finisher (finisher T10, DESIGN §2.7, §2.9, §5.1): the real
// coordinator agent, a real finisher session, real phone alerts, and the person on the phone.
//
// A one-task plan whose build is already green: T01 is seeded ✅ with its file on main, so the run spawns no
// worker. It goes straight to the end: sync, tests, the agent's REPORT.md, `ready`. The finisher then starts,
// reads `.pir/rules/on-finish.md` (merge the branch into main, write FINISHED in the main checkout), looks,
// writes its ready status and asks the go question. The ready alert reaches the person's phone; they open the
// finisher's chat from it and answer `Go` there. The finisher merges, writes FINISHED, writes done, and the
// run ends on it (`✔ finished:`); the finished alert reaches the phone.
//
// Nobody stands in for the person: no answerPending, no mergeWhenReady. The runner only watches
// (watchFinisher): main, FINISHED and the phase when the finisher first waits for the go, and main, FINISHED
// and the ledger once the run is over. What the phone showed, and whether the tap opened the chat, is the
// person's hand-verification (T10 "Needs a person").

import { defineScenario } from '../scenario.mjs';
import { finisherWaitedForGo, finisherFinishedOnPhoneGo, finisherAlerted } from '../assertions.mjs';
import { progressDoc, taskDoc } from './common.mjs';

// finisherLiveFixture({ slug, title, base, parkOn }) → the fixture. `base` is the run's base branch (default
// `main`) and `parkOn` a branch the main checkout is left on instead of it; finisher-live-branch.mjs uses both
// to run the same check from another branch. The rules name `main` either way: they are what a repo
// written before the finisher knew its target would hold.
export function finisherLiveFixture({ slug, title, base = null, parkOn = null }) {
  const design = `---
setup: none
test:
  - npm test
---

# ${slug} — scratch fixture design

Throwaway plan for the live check of the finisher. Not a real feature. Its one task is already built and
reviewed; the run only ends it.

## Environment

The test command is \`npm test\`. It runs \`node --test\` and is green on a fresh checkout. There is no
git remote: nothing is ever pushed.
`;

  // The project's finishing rules (finisher DESIGN §2.2: the repo's own file wins).
  const rules = `# Finishing rules for this scratch repo

1. In the person's main checkout, merge the build's branch into \`main\`:
   \`git -C <main checkout> merge --no-edit pir/{slug}\`, then confirm
   \`git -C <main checkout> merge-base --is-ancestor pir/{slug} main\` succeeds.
2. Write a file named \`FINISHED\` at the root of the main checkout, containing the one line \`finished\`.
   Do not commit it.

Nothing else: no push, no pull request, no install.
`;

  const progress = progressDoc({
    slug,
    summary:
      'One task, already built and reviewed: the run goes straight to its end, the finisher takes it over, and the person gives the go from the phone (finisher T10).',
    tasks: [{ num: 'T01', name: 'Greeting function (already built)', deps: [], state: '✅' }],
  });

  const tasks = {
    'T01-greeting.md': taskDoc({
      num: 'T01',
      title: 'Add the greeting function (already built)',
      goal: 'Create `greet.mjs` at the repo root exporting `greet(name)`, returning `Hello, <name>!`. Already done on the base branch.',
      files: ['`greet.mjs` — new.'],
      tests: '`greet.test.mjs` checks `greet("Ada")` is `Hello, Ada!`.',
      doneWhen: ['`greet.mjs` exports `greet`.', '`npm test` is green.'],
    }),
  };

  const seedFiles = {
    [`plans/${slug}/DESIGN.md`]: design,
    '.pir/rules/on-finish.md': rules,
    'greet.mjs': 'export function greet(name) {\n  return `Hello, ${name}!`;\n}\n',
    'greet.test.mjs': `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { greet } from './greet.mjs';

test('greet', () => {
  assert.equal(greet('Ada'), 'Hello, Ada!');
});
`,
  };

  const scenario = defineScenario({
    id: slug,
    title,
    fixture: slug,
    // No worker is spawned. 14 minutes, inside the 900 s alarm the run is launched under (T10 Environment),
    // bounds the agent's report, the finisher's look and the person's answer on the phone.
    seatbelts: { ceiling: 1, timeoutMs: 14 * 60 * 1000 },
    coordinator: true,
    statusSnapshots: true,
    realNotify: true,
    watchFinisher: true,
    facts: [finisherWaitedForGo(), finisherFinishedOnPhoneGo(), finisherAlerted()],
  });
  return { id: slug, slug, title, progress, tasks, seedFiles, scenario, ...(base ? { base } : {}), ...(parkOn ? { parkOn } : {}) };
}

export default finisherLiveFixture({
  slug: 'finisher-live',
  title: 'The finisher — looks, waits for the go from the phone, merges, reports done',
});
