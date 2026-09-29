// dev-base — `pir plan` end to end in a repo with no `main` (base-branch DESIGN §1 success criteria, T09).
// The repo has only `dev`, a committed `.pir/settings.json` naming it, and an `origin` that is a local bare
// repository (fixtures.mjs REMOTE_DIR) whose `dev` is one commit ahead of the local one: the stale clone
// the plan exists for. The runner (run.mjs runPlanScenario) plans, reviews and builds as plan-command does,
// with the coordinator agent on so the build ends by syncing with the base. What the run must show:
//   - pir/{slug} was cut from origin/dev's commit, not the stale local dev (§2.3, §2.6);
//   - the end sync merged dev, the report footer reads `Synced with `dev``, the hand-off is
//     `git switch dev && git merge pir/{slug}` and nothing printed says main (§2.8, §2.9);
//   - the person merges on the remote's dev only (`mergeWhenReady: 'remote'`, a merge done on GitHub), and
//     the run sees it through its watch fetch and finishes (§2.8). `baseWatchMs` makes that fetch every
//     second instead of every 5 minutes, so the scenario is not waiting on the clock;
//   - the local dev moved at most forward to origin/dev's commit at the start (§2.3), never to the build.
//
// run-dev-base.test.mjs drives it in `npm test` against the fake `claude`. Against real Claude it is the
// same command as plan-command (an `ask` action: it spends model time on a whole plan):
//
//   node src/shell/harness/run.mjs dev-base --into <empty scratch folder>

import { defineScenario } from '../scenario.mjs';
import {
  baseUntouched,
  cutFromRemote,
  everyTaskDone,
  finishedOnRemoteMerge,
  handedOffGreenBranch,
  handedOffOnBase,
  indexRowIsWork,
  planReviewedOnBranch,
  readyWithReport,
} from '../assertions.mjs';
import { REMOTE_DIR } from './common.mjs';
import { BRIEF, PIR_HOME_DIR, REPLY } from './plan-command.mjs';

const id = 'dev-base';
const title = '`pir plan` in a repo with only `dev`, whose remote dev is ahead — plan, build, sync, hand off on dev';

// What the remote's dev has that the local dev lacks.
export const REMOTE_AHEAD = { files: { 'CHANGELOG.md': '# Changelog\n\n- dev moved on the remote\n' }, message: 'dev: moved on the remote' };

const files = {
  'package.json': `${JSON.stringify({ name: 'dev-base-scratch', private: true, type: 'module', scripts: { test: 'node --test' } }, null, 2)}\n`,
  'src/slug.mjs': '// slugify(text) belongs here. Nothing is exported yet.\nexport {};\n',
  'test/smoke.test.mjs': `import { test } from 'node:test';
import assert from 'node:assert/strict';

test('the package loads', async () => {
  const mod = await import('../src/slug.mjs');
  assert.equal(typeof mod, 'object');
});
`,
  // The run's worktrees and control folders, the scratch PIR_HOME and the bare remote all sit inside the
  // repo; none of it may show in dev's status.
  '.gitignore': `node_modules
.claude/worktrees/
plans/*/.parallel/
${PIR_HOME_DIR}/
${REMOTE_DIR}/
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
  coordinator: true,
  mergeWhenReady: 'remote',
  baseWatchMs: 1000,
  facts: [
    planReviewedOnBranch(),
    cutFromRemote(),
    everyTaskDone(),
    handedOffGreenBranch(),
    handedOffOnBase(),
    readyWithReport({ conflict: false }),
    finishedOnRemoteMerge(),
    baseUntouched(),
    indexRowIsWork(),
  ],
});

export default { id, slug: null, title, files, carrySource: false, pirHome: PIR_HOME_DIR, brief: BRIEF, base: 'dev', remote: { ahead: REMOTE_AHEAD }, scenario };
