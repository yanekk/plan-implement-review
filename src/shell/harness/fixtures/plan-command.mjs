// plan-command — `pir plan` end to end with real Claude (pir-plan-command DESIGN §4, §5.2, T17; run in T18).
// Unlike every other fixture this one seeds NO plan: a tiny node package with an empty src/slug.mjs, a
// green `node --test`, and nothing under plans/. The runner (run.mjs runPlanScenario) starts a planning
// run on it with the brief below, plays the person through the planner and the reviewer with one canned
// reply, gives the go, waits for the build, and checks what the run left behind.
//
// The live command (T18; an `ask` action, DESIGN §5.3 — it spends model time on a whole plan):
//
//   node src/shell/harness/run.mjs plan-command --into <empty scratch folder>
//
// run from the engine checkout whose skills and code are to be proven. The dry pass in
// run-plan.test.mjs runs the same scenario against the fake `claude` in `npm test`.
//
// The brief is chosen so a real planner converges fast: one pure function, no screen, a hard cap of three
// tasks. The reply is the person saying yes to whatever the session recommends, which is what a planner
// asking "shall I …?" needs to move on; the cap (§5.2) stops one that never converges.
//
// Two things differ from the build fixtures on purpose:
//   - `files` replaces the plan-tree builders: there is no PROGRESS.md or task doc to lay down.
//   - `carrySource: false`: the planning program and the coordinator run from the engine checkout the
//     harness runs from (launch.mjs resolves them from its own file), so the scratch needs no copy of src/.
//     A copy would also put the framework's code in front of a planner told to check what the code already
//     does, and under the scratch's own `src/`.
// The repo's skills are still carried to .claude/skills; an installed personal skill of the same name
// shadows them (FINDINGS 2026-09-26), which is why T18 installs the two planning skills first.

import { defineScenario } from '../scenario.mjs';
import { baseUntouched, everyTaskDone, handedOffGreenBranch, indexRowIsWork, planReviewedOnBranch } from '../assertions.mjs';

const id = 'plan-command';
const title = '`pir plan` — plan, review, go and build from a repo with no plan';

export const BRIEF =
  'Add a slugify(text) function to src/slug.mjs: lowercase, ASCII letters and digits, words joined by ' +
  'single hyphens. Headless, no UI. Keep the plan to at most three tasks.';

export const REPLY = 'Yes. Go with your recommendation, and keep it as small as possible.';

// PIR_HOME for the run: inside the scratch repo, ignored, so the run's index never touches the person's
// ~/.pir and is deleted with the scratch. The runner reads this name too.
export const PIR_HOME_DIR = '.pir-home';

const files = {
  'package.json': `${JSON.stringify({ name: 'slug-scratch', private: true, type: 'module', scripts: { test: 'node --test' } }, null, 2)}\n`,
  'src/slug.mjs': '// slugify(text) belongs here. Nothing is exported yet.\nexport {};\n',
  'test/smoke.test.mjs': `import { test } from 'node:test';
import assert from 'node:assert/strict';

test('the package loads', async () => {
  const mod = await import('../src/slug.mjs');
  assert.equal(typeof mod, 'object');
});
`,
  // The run's worktrees and control folders sit inside the repo; none of it may show in main's status
  // (FINDINGS 2026-09-26: only this repo's own .gitignore covers them otherwise).
  '.gitignore': `node_modules
.claude/worktrees/
plans/*/.parallel/
${PIR_HOME_DIR}/
`,
};

const scenario = defineScenario({
  id,
  title,
  fixture: id,
  kind: 'plan',
  seatbelts: { ceiling: 2, timeoutMs: 90 * 60_000 },
  reply: REPLY,
  replyCap: 40,
  facts: [planReviewedOnBranch(), everyTaskDone(), handedOffGreenBranch(), baseUntouched(), indexRowIsWork()],
});

export default { id, slug: null, title, files, carrySource: false, pirHome: PIR_HOME_DIR, brief: BRIEF, scenario };
