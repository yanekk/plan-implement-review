// human-decision — a worker parks on the person and it costs only that one task (DESIGN §2.2, §2.8). Two
// INDEPENDENT tasks at ceiling 2:
//   T01 leaves a single user-facing choice deliberately unspecified (the greeting wording). A real worker
//       cannot guess a user-facing requirement (CLAUDE.md: an underspecified requirement is the exact
//       thing the person is here for), so it drops a `question` report and PARKS, holding its slot.
//   T02 is a self-contained task that needs no decision; it builds, is reviewed, and merges.
//
// The point of the fixture is the non-agentic park (§2.2): the worker asking is real, the person answers
// it DIRECTLY in its own session, and the program routes NOTHING down — there is no scripted answer, no
// `answers` file, no relay. T01 stays parked (a live run would wait for the person; this scratch run just
// captures that it held its slot and never got an answer routed to it), while T02 — independent — keeps
// moving to a merge. That is the whole property: a park throttles only its own decision, not the run.
//
// This REPLACES the old surface→answer→route round-trip (the `scriptedAnswer` the T17 runner fed down),
// which was removed with the down-channel (§2.2, T05).
//
// Fact (T15): parkedWorkerHoldsSlot('T01') — T01 surfaced a question, held its slot, no `answer` was
// routed, and T02 merged while it parked.

import { defineScenario } from '../scenario.mjs';
import { parkedWorkerHoldsSlot } from '../assertions.mjs';
import { progressDoc, taskDoc } from './common.mjs';

const slug = 'human-decision';

const progress = progressDoc({
  slug,
  summary:
    'Two independent tasks at ceiling 2: T01 leaves a user-facing choice unspecified so its worker parks and holds its slot, while the independent T02 keeps moving to a merge — the person answers T01 directly and the program routes nothing (DESIGN §2.2, §2.8).',
  tasks: [
    { num: 'T01', name: 'Write the greeting file (wording unspecified)', deps: [], state: '⬜' },
    { num: 'T02', name: 'Write the build stamp file (fully specified)', deps: [], state: '⬜' },
  ],
});

const tasks = {
  'T01-greeting.md': taskDoc({
    num: 'T01',
    title: 'Write the greeting file (wording unspecified)',
    goal:
      'Create `greeting.txt` at the repo root containing a single greeting line to show the user. The exact ' +
      'wording is DELIBERATELY NOT SPECIFIED here: choosing user-facing wording is the product manager\'s ' +
      'call, not yours. Do not guess or pick a default — ask the person which wording to use (drop a ' +
      '`question` report and park), and continue only once they have answered you directly in this session.',
    files: ['`greeting.txt` — new, its contents chosen by the user.'],
    doneWhen: [
      'You asked for the greeting wording rather than guessing it, and parked until the person answered.',
      '`greeting.txt` contains exactly the wording the person gave.',
      '`npm test` is still green.',
    ],
  }),
  'T02-stamp.md': taskDoc({
    num: 'T02',
    title: 'Write the build stamp file (fully specified)',
    goal:
      'Create `stamp.txt` at the repo root whose entire contents are the two letters `ok` followed by a ' +
      'single trailing newline, and nothing else. This task is independent of T01 and fully specified. That ' +
      'is all — do not ask; the contents are specified.',
    files: ['`stamp.txt` — new.'],
    doneWhen: ['`stamp.txt` exists and its entire contents are `ok` plus one trailing newline.', '`npm test` is still green.'],
  }),
};

const scenario = defineScenario({
  id: slug,
  title: 'Human decision — a worker parks and holds its slot; the independent task keeps moving',
  fixture: slug,
  // Ceiling 2 so the independent T02 can run alongside the parked T01 — the whole point is that the park
  // costs only its own task, which a ceiling of 1 could not show (the parked T01 would block T02's slot).
  seatbelts: { ceiling: 2 },
  facts: [parkedWorkerHoldsSlot('T01')],
});

export default {
  id: slug,
  slug,
  title: 'Human decision — a worker parks and holds its slot; the independent task keeps moving',
  progress,
  tasks,
  scenario,
};
