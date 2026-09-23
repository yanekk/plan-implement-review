// restart-review — a run STOPPED mid-review resumes at review (user report 2026-09-23). One auto task at
// ceiling 1. The harness's restart mode stops the coordinator with SIGTERM the moment T01's own branch has
// committed 🔍 — the deterministic mid-review point — and relaunches on the same scratch without
// reinstalling. SIGTERM, not the `restart` fixture's SIGKILL, is the point: the coordinator's own
// teardownRun runs on a stop, and that teardown used to remove every task branch (the ENOSPC loss,
// 2026-09-22), so the restart found nothing and re-implemented a task that was already built.
//
// Facts: the stop really ran the teardown (stoppedGracefully); T01's 🔍 branch survived it and went to a
// fresh reviewer and merged, with one implement session across the whole run (resumedNotRebuilt); the
// restart cleared a stale reports leftover; and the ceiling held.

import { defineScenario } from '../scenario.mjs';
import { resumedNotRebuilt, stoppedGracefully, feedsCleared, ceilingHeld } from '../assertions.mjs';
import { progressDoc, taskDoc } from './common.mjs';

const slug = 'restart-review';

const progress = progressDoc({
  slug,
  summary:
    'One auto task at ceiling 1: T01 reaches 🔍, the coordinator is stopped (SIGTERM, its teardown runs) and restarted, so the resume must review T01 rather than re-implement it.',
  tasks: [{ num: 'T01', name: 'Write review marker', deps: [], state: '⬜' }],
});

const tasks = {
  'T01-marker.md': taskDoc({
    num: 'T01',
    title: 'Write review marker',
    goal: 'Create a file `review-marker.txt` at the repo root whose entire contents are the two letters `ok` followed by a single trailing newline, and nothing else. That is all — do not ask; the newline is specified.',
    files: ['`review-marker.txt` — new.'],
    doneWhen: ['`review-marker.txt` exists and its entire contents are `ok` plus one trailing newline.', '`npm test` is still green.'],
  }),
};

// Stop the moment T01's branch commits 🔍 (or the coordinator logs `review T01`), with SIGTERM.
const restart = {
  waitFor: { task: 'T01', glyph: '🔍' },
  signal: 'SIGTERM',
};

const scenario = defineScenario({
  id: slug,
  title: 'Restart after a stop mid-review — the built task is reviewed, not re-implemented',
  fixture: slug,
  seatbelts: { ceiling: 1 },
  facts: [stoppedGracefully(), resumedNotRebuilt('T01'), feedsCleared(), ceilingHeld(1)],
});

export default {
  id: slug,
  slug,
  title: 'Restart after a stop mid-review — the built task is reviewed, not re-implemented',
  progress,
  tasks,
  restart,
  scenario,
};
