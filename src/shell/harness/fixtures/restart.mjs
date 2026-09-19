// restart — the kill-and-rebuild drill (DESIGN §2.6, §4, T05). Two auto tasks in a strict chain: T01 is
// independent and T02 depends on it, so the coordinator finishes T01 (reviewed, merged, feature ✅) before
// it even starts T02. The harness's restart mode (run.mjs runRestartScenario) then SIGKILLs the
// coordinator PROCESS the moment T02's own branch has committed 🔍 — the deterministic mid-review crash
// point — and relaunches on the SAME scratch without reinstalling, so the resumed coordinator must
// reconcile from git (§2.6): adopt T02's 🔍 branch to a fresh reviewer rather than re-implement it, leave
// the already-finished T01 alone, reap the dead run's leftover worker sessions, and clear the transient
// reports feed before it acts on any of them. The run never merges to main — it hands off the green
// feature branch (§2.4) — so "done" is every task ✅, not a promotion. The mechanism and the fact
// predicates are proven against the fakes here; the live paid crash-and-restart over real agents is T09.
//
// Why a two-task chain and not one task: it lets the run exercise BOTH resume cases in a single crash.
// T01 (already ✅+merged) proves "do not rebuild the already-done task" (noRebuildFrom); T02 (🔍 at the
// kill) proves "adopt, don't re-implement" (resumedNotRebuilt). The dependency is what guarantees the
// ordering, so the kill lands with T01 done and T02 mid-review every run, deterministically.
//
// Facts (T15): the 🔍 task was reviewed/merged not rebuilt; the ✅ task was left untouched; the restart
// cleared a stale reports leftover; and the dead run's sessions were reaped and the ceiling held across
// the restart. Between them these prove the run rebuilt from committed branch state (§2.6) and reached
// all-✅ — both chained tasks merged (resumedNotRebuilt merges T02 after the boundary, noRebuildFrom
// requires T01 merged before it).

import { defineScenario } from '../scenario.mjs';
import { resumedNotRebuilt, noRebuildFrom, feedsCleared, leftoverSessionsReaped } from '../assertions.mjs';
import { progressDoc, taskDoc } from './common.mjs';

const slug = 'restart';

const progress = progressDoc({
  slug,
  summary:
    'Two chained auto tasks at ceiling 1: T01 finishes and merges, then T02 reaches 🔍 and the coordinator is crashed there and restarted, so the resume must adopt T02 and leave T01 alone, reaching all-✅ (DESIGN §2.6, §4).',
  tasks: [
    { num: 'T01', name: 'Write restart marker one', deps: [], state: '⬜' },
    { num: 'T02', name: 'Write restart marker two', deps: ['T01'], state: '⬜' },
  ],
});

const tasks = {
  'T01-marker.md': taskDoc({
    num: 'T01',
    title: 'Write restart marker one',
    goal: 'Create a file `restart-1.txt` at the repo root whose entire contents are the two letters `ok` followed by a single trailing newline, and nothing else. That is all — do not ask; the newline is specified.',
    files: ['`restart-1.txt` — new.'],
    doneWhen: ['`restart-1.txt` exists and its entire contents are `ok` plus one trailing newline.', '`npm test` is still green.'],
  }),
  'T02-marker.md': taskDoc({
    num: 'T02',
    title: 'Write restart marker two',
    goal: 'Create a file `restart-2.txt` at the repo root whose entire contents are the two letters `ok` followed by a single trailing newline, and nothing else. That is all — do not ask; the newline is specified.',
    files: ['`restart-2.txt` — new.'],
    doneWhen: ['`restart-2.txt` exists and its entire contents are `ok` plus one trailing newline.', '`npm test` is still green.'],
  }),
};

// The restart spec the harness's runRestartScenario reads (T05). `waitFor` is the deterministic crash
// point: the run is killed the moment T02's own task branch has committed the 🔍 glyph — detected from a
// taskBranchState read (T02) or, as a fallback, a `review T02` flow line — never a timer (§2.6). The kill
// is a SIGKILL of the coordinator PROCESS only (leaving its workers and the git state, so there is real
// in-flight state to reconcile), and the relaunch does not reinstall (git on the scratch already holds the
// branches).
const restart = {
  waitFor: { task: 'T02', glyph: '🔍' },
};

const scenario = defineScenario({
  id: slug,
  title: 'Restart resume — adopt the 🔍 task, leave the ✅ task, reap and clear',
  fixture: slug,
  seatbelts: { ceiling: 1 },
  facts: [
    resumedNotRebuilt('T02'),
    noRebuildFrom('T01'),
    feedsCleared(),
    leftoverSessionsReaped({ ceiling: 1 }),
  ],
});

export default {
  id: slug,
  slug,
  title: 'Restart resume — adopt the 🔍 task, leave the ✅ task, reap and clear',
  progress,
  tasks,
  restart,
  scenario,
};
