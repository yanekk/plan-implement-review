// single — one trivial ⬜ auto task. Forces the whole happy path with a real worker: spawn → implement
// → 🔍 → fresh review → merge → idle-gated close, then the run hands off the green feature branch
// (DESIGN §4.1). The old by-name-addressing fact went with the down-channel: a worker no longer messages
// a coordinator session by name, it drops a `reports/` file (DESIGN §2.2, T05).
//
// Facts declared over the captured bundle (T15): no spawn hello was sent at all (retired in T30), no
// finished worker was closed before it went idle, and the run handed off a green feature branch with
// main untouched (no promotion — DESIGN §2.4).

import { defineScenario } from '../scenario.mjs';
import { noHelloEver, noCloseBeforeIdle, handedOffGreenBranch } from '../assertions.mjs';
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
    goal: 'Create a file `single-ok.txt` at the repo root whose entire contents are the two letters `ok` followed by a single trailing newline, and nothing else. That is all — do not ask; the newline is specified.',
    files: ['`single-ok.txt` — new.'],
    doneWhen: ['`single-ok.txt` exists and its entire contents are `ok` plus one trailing newline.', '`npm test` is still green.'],
  }),
};

const scenario = defineScenario({
  id: slug,
  title: 'Single task — the full happy path',
  fixture: slug,
  seatbelts: { ceiling: 1 },
  facts: [noHelloEver(), noCloseBeforeIdle(), handedOffGreenBranch()],
});

export default { id: slug, slug, title: 'Single task — the full happy path', progress, tasks, scenario };
