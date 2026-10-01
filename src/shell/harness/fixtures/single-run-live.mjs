// single-run-live — one single run with real Claude, end to end (single-runs DESIGN §5.1 first row, §5.2,
// §5.3; T12). Not to be confused with the `single` fixture, a one-task plan build (FINDINGS 2026-09-29).
//
// The scratch repo is a tiny node package with one seeded defect: `addAll` in add.mjs starts its loop at 1,
// so it skips the first number, and add.test.mjs catches it. The repo's settings name no setup and
// `node --test` as the test line, so pir's own test runs are the fixture's test. The runner (run.mjs
// runSingleScenario) starts the run with startSingleRun, exactly as `@repo/single <prompt>` does, plays
// the person with one canned reply, waits for the program's final status, and checks what it left.
//
// The live command (T12; a `worker` action, DESIGN §5.3 — two short sessions on plan limits):
//
//   perl -e 'alarm 1200; exec @ARGV' node src/shell/harness/run.mjs single-run-live --into /tmp/pir-single-live
//
// run from the engine checkout whose skills and code are to be proven. The dry pass in
// run-single.test.mjs runs the same scenario against the fake `claude` in `npm test`.
//
// `carrySource: false`, as plan-command: the single program runs from the engine checkout the harness
// runs from (launch.mjs resolves it from its own file), and a copy of src/ would put the framework's own
// tests in front of the scratch's `node --test`. The repo's skills are still carried to .claude/skills;
// an installed ~/.claude/skills/pir-single of the same name would shadow them (§5.3).

import { defineScenario } from '../scenario.mjs';
import { baseUntouched, singleBuilderCommitGreen, singleIndexUnderName, singleNoSessionLeft, singleReady } from '../assertions.mjs';

const id = 'single-run-live';
const title = 'A single run with real Claude: a seeded off-by-one fixed, reviewed and ready to merge';

export const PROMPT = 'fix the failing test in add.mjs';

// The person's answer to anything a session asks, typed on a question's Other line or sent as words.
export const REPLY = 'go ahead';

// PIR_HOME for the run: inside the scratch repo, ignored, deleted with it (plan-command's reason).
export const PIR_HOME_DIR = '.pir-home';

// The settings the seed commits (fixtures.mjs seedGit merges them over its defaults): no setup, and the
// package's own tests as pir's test line (T12 Interface).
export const SETTINGS = { setup: [], test: ['node --test'] };

const files = {
  'package.json': `${JSON.stringify({ name: 'add-scratch', private: true, type: 'module', scripts: { test: 'node --test' } }, null, 2)}\n`,
  'add.mjs': `// addAll(nums) → the sum of every number in nums.
export function addAll(nums) {
  let total = 0;
  for (let i = 1; i < nums.length; i++) total += nums[i];
  return total;
}
`,
  'add.test.mjs': `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addAll } from './add.mjs';

test('addAll sums every number', () => {
  assert.equal(addAll([1, 2, 3]), 6);
});

test('addAll of nothing is 0', () => {
  assert.equal(addAll([]), 0);
});
`,
  // The run's worktree and control folder sit inside the repo; none of it may show in main's status.
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
  kind: 'single',
  // DESIGN §5.2 wraps the live command in a 1200 s alarm; the runner's own clock stops the run first, as
  // pir's stop does, so the teardown still runs and the bundle is still written.
  seatbelts: { timeoutMs: 18 * 60_000 },
  reply: REPLY,
  replyCap: 10,
  facts: [singleReady(), singleBuilderCommitGreen(), singleIndexUnderName(), singleNoSessionLeft(), baseUntouched()],
});

export default { id, slug: null, title, files, settings: SETTINGS, carrySource: false, pirHome: PIR_HOME_DIR, prompt: PROMPT, scenario };
