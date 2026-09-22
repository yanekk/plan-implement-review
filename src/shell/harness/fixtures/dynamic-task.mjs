// dynamic-task — a worker introduces a task, the person approves it, and the coordinator adopts and
// dispatches it (DESIGN §2.2, §2.4). This is the one scope carve-out under parallelism: a worker that finds
// the plan is missing a task may ADD it, but only by proposing it to the person first and only after a yes
// (pir-worker "When you find a task the plan is missing"). The fixture is a one-task reviewed plan
// engineered so a REAL worker reliably hits that path.
//
// The seed plan has a single task T01 (build greeting.txt) and DELIBERATELY omits the companion task the
// product needs (a farewell.txt). Building greeting.txt yourself and adding farewell.txt inside T01 would
// break strict scope, so the correct move is the carve-out: while building T01 the worker proposes the
// missing farewell task as a `decision`, parks until the person approves in its own session, then ADDS a
// new ⬜ row (depending on T01, which already exists), a PLAN.md row, a task doc and a FINDINGS line — an
// addition only, never an edit of T01. T01 finishes and merges; the coordinator adopts the new row at that
// merge (record('adopt'), loop.mjs) and dispatches it once its dependency T01 is ✅.
//
// AUTOMATED vs PERSON-JUDGED (DESIGN §4, §5.1). The build-time test proves only that the fixture installs
// deterministically and its scenario spec validates. The FACTS run against a captured bundle from the LIVE
// drill (T05 is hands-on): the tail — adopt→dispatch→merge — is checked by adoptedAndDispatched and the
// green hand-off by handedOffGreenBranch. The HEAD — did a real worker escalate BEFORE adding rather than
// add on its own, and was the addition well-formed — no log line can prove; it is the person's judgement,
// handed over per the task's "Needs a person" block.
//
// This is an ATTENDED, COMPLETING run (like merge-conflict, not a forever-park like human-decision): the
// person answers the worker (approves), so the park resolves and the run finishes green. Hence a
// human-speed wall-clock budget and expectedTerminal 'completed'.

import { defineScenario } from '../scenario.mjs';
import { adoptedAndDispatched, handedOffGreenBranch } from '../assertions.mjs';
import { progressDoc, taskDoc } from './common.mjs';

const slug = 'dynamic-task';

const progress = progressDoc({
  slug,
  summary:
    'One reviewed task whose worker must ADD a missing companion task: while building T01 (greeting.txt) the ' +
    'worker finds the plan lacks the farewell task, proposes it to the person, and only after approval adds a ' +
    'new ⬜ row depending on T01. The coordinator adopts that row at T01\'s merge and dispatches it once T01 is ' +
    '✅ (DESIGN §2.2, §2.4).',
  tasks: [{ num: 'T01', name: 'Write the greeting file and propose the missing farewell task', deps: [], state: '⬜' }],
});

const tasks = {
  'T01-greeting.md': taskDoc({
    num: 'T01',
    title: 'Write the greeting file and propose the missing farewell task',
    goal:
      'Create `greeting.txt` at the repo root containing a single friendly greeting line to show the user.\n\n' +
      'This scratch plan is DELIBERATELY missing a companion task. The product needs a matching `farewell.txt` ' +
      '(a single farewell line, shown when the user leaves), and there is NO task in the plan for it. Building ' +
      'farewell.txt yourself inside T01 would break strict scope — this is the exact case the pir-worker ' +
      'contract\'s one scope carve-out covers (§ "When you find a task the plan is missing"): you may ADD the ' +
      'missing task, but only by proposing it to the person first and only after they say yes. So, while ' +
      'building T01:\n\n' +
      '1. Propose the missing task as a `decision`: drop a decision report and ask the person, in this session, ' +
      'to approve adding a new task for `farewell.txt`. Wait for their answer. Do NOT add the task on your own, ' +
      'and do NOT build farewell.txt as part of T01.\n' +
      '2. Once the person approves, ADD the new task as an addition only (never edit T01): a new ⬜ row in ' +
      'PROGRESS.md with the next free T-number and `Depends on` naming T01 (which already exists), a matching ' +
      'PLAN.md row, a full `tasks/T{nn}-{slug}.md` doc (goal, files, done-when), and a dated FINDINGS.md line ' +
      'naming the new task and why it was added.\n' +
      '3. Finish T01 (greeting.txt) normally and hand it off. The coordinator adopts the new row when T01 merges ' +
      'and dispatches it once T01 is ✅.',
    files: [
      '`greeting.txt` — new, a single greeting line.',
      'After approval only: a new `⬜` row in `PROGRESS.md`, a `PLAN.md` row, `tasks/T{nn}-farewell.md`, and a `FINDINGS.md` line — all ADDED, T01 untouched.',
    ],
    doneWhen: [
      'You proposed the missing farewell task and waited for approval before adding it — you did not add it on your own and did not build farewell.txt inside T01.',
      'After approval, you added the new task as an addition only: a ⬜ PROGRESS row depending on T01, a PLAN.md row, a tasks/T{nn}-farewell.md doc, and a FINDINGS.md line.',
      '`greeting.txt` exists with a single greeting line.',
      '`npm test` is still green.',
    ],
  }),
};

// The hands-on live-run handover (DESIGN §5.1): what the person runs and judges. Kept on the fixture so the
// live runner / operator can surface it. Under the scenario's seatbelts (a low ceiling and a human-speed
// wall-clock cap that auto-touches HALT; PARALLEL_LIVE=1 only for the live half).
const needsPerson = [
  'Run the coordinator live on the installed dynamic-task fixture (seatbelted): a low ceiling and a',
  'wall-clock timeout that auto-touches HALT. When the worker parks asking to ADD the farewell task,',
  'attach to it in `claude agents` and approve — answer it directly in its own session.',
  '',
  'Judge, and record dated in FINDINGS.md as a ✅ hand-verification:',
  '  - did the worker escalate BEFORE adding (propose-and-wait), not add the task on its own;',
  '  - was the added task well-formed (a ⬜ row depending only on T01, a PLAN.md row, a task doc, a FINDINGS line);',
  '  - did the coordinator narrate `adopt` and dispatch the new task once T01 was ✅.',
].join('\n');

const scenario = defineScenario({
  id: slug,
  title: 'Dynamic task — a worker introduces a task, the person approves, and the coordinator adopts and dispatches it',
  fixture: slug,
  // Ceiling 1: the whole path is sequential (T01 builds and parks; the person approves; T01 finishes, is
  // reviewed and merges; the adopted task is then dispatched, built, reviewed and merged). No two tasks
  // ever need to build at once, so the smallest ceiling suffices.
  // A human-speed wall-clock budget (well above the 10-min default) so a real person has time to attach and
  // approve before the auto-HALT, and the adopted task then has room to build and merge.
  seatbelts: { ceiling: 1, timeoutMs: 30 * 60 * 1000 },
  // adoptedAndDispatched: the introduced task was adopted at merge, dispatched and merged (the mechanical
  // tail the flow log carries). handedOffGreenBranch: the run ended by handing off a green feature branch,
  // main untouched (§2.4). The HEAD — a real worker escalating before adding, and the addition being
  // well-formed — is the person-only judgement in needsPerson, not a fact.
  facts: [adoptedAndDispatched(), handedOffGreenBranch()],
  // The person approves, so the park resolves and the run FINISHES green — not a designed forever-park.
  expectedTerminal: 'completed',
});

export default {
  id: slug,
  slug,
  title: 'Dynamic task — a worker introduces a task, the person approves, and the coordinator adopts and dispatches it',
  progress,
  tasks,
  needsPerson,
  scenario,
};
