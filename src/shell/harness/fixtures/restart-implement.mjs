// restart-implement — a run STOPPED mid-implement resumes the half-built task on its branch (user decision
// 2026-09-23). One auto task at ceiling 1, built in two separately committed parts. The harness's restart
// mode stops the coordinator with SIGTERM the moment the task branch carries the part-1 commit — the
// implementer is still building, its row still ⬜ — and relaunches on the same scratch. The resumed
// coordinator must keep the branch (`resume T01`, never `rebuild`), and the fresh implementer must find
// part 1 already committed and build only part 2 (skills/pir-worker § Before you start).
//
// Determinism: the task tells the implementer to pause after the part-1 commit, so the stop lands between
// the parts every run rather than racing a fast worker to 🔍. A worker that skips the pause and finishes
// first is caught honestly: the recorded glyph at the stop is 🔍 and resumedFromPartial fails, naming it.
//
// Facts: the stop really ran the teardown (stoppedGracefully); the part-1 commit recorded at the stop is
// still in the final history, exactly one commit carries it, and T01 merged after the restart
// (resumedFromPartial); and the ceiling held.

import { defineScenario } from '../scenario.mjs';
import { resumedFromPartial, stoppedGracefully, ceilingHeld } from '../assertions.mjs';
import { progressDoc, taskDoc } from './common.mjs';

const slug = 'restart-implement';
const PART_ONE = 'T01: part 1';

const progress = progressDoc({
  slug,
  summary:
    'One auto task at ceiling 1, built in two committed parts: the coordinator is stopped (SIGTERM) after part 1 lands and restarted, so the resume must continue the branch and not redo part 1.',
  tasks: [{ num: 'T01', name: 'Write two part markers', deps: [], state: '⬜' }],
});

const tasks = {
  'T01-parts.md': taskDoc({
    num: 'T01',
    title: 'Write two part markers',
    goal: [
      'Build this task in two parts, each its own commit. Do not ask about any of it; everything is specified.',
      '',
      `1. Create \`part-1.txt\` at the repo root containing exactly \`one\` plus a single trailing newline. Commit only that file, with the exact message \`${PART_ONE}\`.`,
      '2. Immediately after that commit, run `sleep 60` in the foreground (a plain Bash call, not in the background). This fixture needs the pause so the run can be stopped between the two parts; do not skip or shorten it.',
      '3. Create `part-2.txt` at the repo root containing exactly `two` plus a single trailing newline, then finish the task as normal: tests green, mark 🔍, commit with the message `T01: part 2`.',
      '',
      'If `part-1.txt` is already committed on this branch when you start, part 1 is done: do not recreate, amend or re-commit it, and skip the pause. Go straight to part 2.',
    ].join('\n'),
    files: ['`part-1.txt` — new.', '`part-2.txt` — new.'],
    doneWhen: [
      '`part-1.txt` is exactly `one` plus one trailing newline, committed alone as `T01: part 1`.',
      '`part-2.txt` is exactly `two` plus one trailing newline.',
      '`npm test` is still green.',
    ],
  }),
};

// Stop once the part-1 commit is on the task branch, with SIGTERM.
const restart = {
  waitFor: { task: 'T01', commit: PART_ONE },
  signal: 'SIGTERM',
};

const scenario = defineScenario({
  id: slug,
  title: 'Restart after a stop mid-implement — the half-built task is continued, not rebuilt',
  fixture: slug,
  seatbelts: { ceiling: 1 },
  facts: [stoppedGracefully(), resumedFromPartial('T01', { commit: PART_ONE }), ceilingHeld(1)],
});

export default {
  id: slug,
  slug,
  title: 'Restart after a stop mid-implement — the half-built task is continued, not rebuilt',
  progress,
  tasks,
  restart,
  scenario,
};
