// single — one trivial ⬜ auto task. Forces the whole happy path with a real worker: spawn → hello →
// implement → 🔍 → fresh review → merge → promote → idle-gated close (DESIGN §4.1). Subsumes T13's live
// comms proof, so its facts include the hello and by-name addressing (DESIGN §2.2, §2.8).
//
// Facts declared over the captured bundle (T15): a hello opened the channel at spawn and each fresh
// session, the worker addressed the coordinator by its convention name, no finished worker was closed
// before it went idle, and main gained exactly one commit — the promotion.

import { defineScenario } from '../scenario.mjs';
import { helloPerSpawn, byNameAddressing, noCloseBeforeIdle, oneMergeToMain } from '../assertions.mjs';
import { progressDoc, taskDoc } from './common.mjs';

const slug = 'single';

const progress = progressDoc({
  slug,
  summary: 'One trivial task, one worker, end to end. The single-task happy path (DESIGN §4.1).',
  tasks: [{ num: 'T01', name: 'Write the single-task marker file', runs: 'auto', deps: [], state: '⬜' }],
});

const tasks = {
  'T01-marker.md': taskDoc({
    num: 'T01',
    title: 'Write the single-task marker file',
    goal: 'Create a file `single-ok.txt` at the repo root whose only contents are the text `ok`. That is all.',
    files: ['`single-ok.txt` — new.'],
    doneWhen: ['`single-ok.txt` exists and contains `ok`.', '`npm test` is still green.'],
  }),
};

const scenario = defineScenario({
  id: slug,
  title: 'Single task — the full happy path',
  fixture: slug,
  seatbelts: { ceiling: 1 },
  facts: [helloPerSpawn(), byNameAddressing(), noCloseBeforeIdle(), oneMergeToMain()],
});

export default { id: slug, slug, title: 'Single task — the full happy path', progress, tasks, scenario };
