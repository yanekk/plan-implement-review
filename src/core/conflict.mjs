// buildConflictPrompt — the ready-to-paste resolution prompt the run offers the PERSON when its own
// merge of a task branch into the feature branch conflicts (DESIGN §2.8). Pure: every input arrives as
// a parameter and it returns a string, so the wording is tested in milliseconds and the core reaches
// for no clock, git or IO (DESIGN § Architecture).
//
// Why a prompt at all. When the coordinator's own `mergeTask` conflicts, the worker that built the
// losing branch has no idea: it integrated cleanly, signalled done, and went idle — the clash is on the
// coordinator's side. This composes the briefing once: pir sends it to that worker over its line, or,
// when no worker is left to send it to, prints it for the person to land the branch by hand.
//
// Who picks the side. The worker does: it holds the task's context, and most clashes (two tasks each
// appending rows to FINDINGS.md) have one obvious resolution. The prompt used to carry a `KEEP:` blank for
// the person to fill in before pasting; the person dropped it (user 2026-09-24) — the worker asks when
// the right side is a judgement, like any other decision. The prompt still bakes in no resolution.
//
// The function itself sends nothing: it returns text. The loop prints the 'person' variant on its own
// display, or sends the 'worker' variant down the live line (below).
//
// audience (live-workers T08, DESIGN §2.10). 'worker' is what pir SENDS a live worker over its line: no
// copy markers, since it is the message itself, and it is addressed to the worker, so "ask me" becomes
// "ask the person" — the person, not pir, answers a worker's question (§2.2). 'person' (the default) is
// printed only when no live worker holds the task — the restart-reconcile path, or a send that failed
// because the worker exited (loop.mjs 3d) — so it names the branch to check out and land by hand. The
// attach-to-this-worker wording it once had for a live worker went with T08: nothing prints it any more.

// The pasteable block is delimited so the person can select exactly what to copy — plain ASCII markers,
// never box-drawing, because those would be copied into the worker along with the content.
const COPY_START = '----- copy everything between these lines into the worker -----';
const COPY_END = '----- end of the part to paste -----';

export function buildConflictPrompt({
  kind = 'task',
  task,
  slug,
  plan = null,
  taskBranch,
  featureBranch,
  files = [],
  testsReason = null,
  logPath = null,
  audience = 'person',
} = {}) {
  if (kind === 'main-sync') return mainSyncPrompt({ plan: plan ?? slug, files });
  if (kind === 'tests-red') return testsRedPrompt({ plan: plan ?? slug, testsReason, logPath });
  if (audience === 'worker') return workerPrompt({ plan, taskBranch, featureBranch, files });
  const label = [task, slug].filter(Boolean).join(' ') || 'a task';
  const branchOn = taskBranch ? ` (${taskBranch})` : '';
  const fileList = listFiles(files);

  // With no live worker the person drives the resolution from the task branch, checked out by hand.
  const where =
    `No live worker holds this task — the run was restarted (DESIGN §2.6). Check out its branch and\n` +
    `paste the block below to a session working on it:\n\n  git checkout ${taskBranch}`;

  // The run has parked the row (⛔) and will not merge it on its own, so the person lands the branch.
  // The tests are the `test` lines of the plan's front-matter block, never a fixed `npm test`: the engine
  // runs projects on any stack, and the gate at the end of the run runs the same lines (DESIGN §2.5).
  // The folder is the PLAN's slug; `slug` is the task's and named a folder that does not exist
  // (plans/red-reason-visible/, declared-test-command T05, 2026-09-24).
  const testStep = testStepFor(plan);
  const finish =
    `  4. Commit, run the \`test\` lines again, then land this branch yourself — the run has parked it\n` +
    `     and will not merge it on its own.`;

  const pasteable = [
    `The run hit a merge conflict folding your branch into ${featureBranch}. Resolve it on your own`,
    `task branch${branchOn}, then finish as below.`,
    ``,
    `  git merge ${featureBranch}`,
    ``,
    `Conflicting file(s):`,
    fileList,
    ``,
    `Resolve it where both sides' work makes the right result clear. If choosing a side needs a`,
    `judgement, ask me before you resolve it.`,
    ``,
    `Then:`,
    `  1. Resolve the conflict in the file(s) above.`,
    `  2. git add the resolved file(s) and commit.`,
    `  3. Run ${testStep}.`,
    finish,
  ].join('\n');

  return (
    `Merge conflict on ${label} — the run parked it for you (DESIGN §2.8).\n\n` +
    `${where}\n\n` +
    `${COPY_START}\n${pasteable}\n${COPY_END}\n`
  );
}

function listFiles(files) {
  return (files.length ? files : ['(the feature branch)']).map((f) => `  - ${f}`).join('\n');
}

function testStepFor(plan) {
  return (
    `the \`test\` lines at the top of plans/${plan || '{plan}'}/DESIGN.md (run its \`setup\` lines\n` +
    `     first if the worktree is not ready)`
  );
}

// The message pir sends a live worker (DESIGN §2.10). The worker had already integrated cleanly and
// signalled done, so it opens by saying its branch did NOT land. The finish step names the `done` report,
// because re-signalling done is what makes the loop's merge step run again (§2.5).
function workerPrompt({ plan, taskBranch, featureBranch, files }) {
  const branchOn = taskBranch ? ` (${taskBranch})` : '';
  return [
    `The run could not merge your branch into ${featureBranch}: the merge conflicts, so your task has`,
    `not landed. Resolve it on your own task branch${branchOn}:`,
    ``,
    `  git merge ${featureBranch}`,
    ``,
    `Conflicting file(s):`,
    listFiles(files),
    ``,
    `Resolve it where both sides' work makes the right result clear. If choosing a side needs a`,
    `judgement, ask the person before you resolve it, as with any other decision.`,
    ``,
    `Then:`,
    `  1. Resolve the conflict in the file(s) above.`,
    `  2. git add the resolved file(s) and commit.`,
    `  3. Run ${testStepFor(plan)}.`,
    `  4. Signal done again (a fresh \`done\` report) so the run can merge your branch.`,
    ``,
  ].join('\n');
}

// The task label the main-sync worker reports under: it holds no task of the plan, so its `done` names
// this instead of a T-number (pir-coordinator T05).
export const MAIN_SYNC_TASK = 'main-sync';

// kind 'main-sync' (pir-coordinator DESIGN §2.9, §3.3): at the end of the run pir merged `main` into the
// feature branch in the feature worktree and it conflicted. The merge is left in progress there; a worker
// spawned in that worktree finishes it, keeping both sides' intent, runs the plan's test block, commits
// and reports `done`. It is only ever sent to a worker, so there is no person variant.
function mainSyncPrompt({ plan, files }) {
  const featureBranch = `pir/${plan || '{plan}'}`;
  return [
    `Every task of plan ${plan || '{plan}'} is built and reviewed. Before the branch is handed to the person, pir`,
    `merged the current \`main\` into ${featureBranch}, here in this worktree, and the merge conflicts. The merge`,
    `is in progress: do not abort it, reset or start over. Finish it.`,
    ``,
    `Conflicting file(s):`,
    listFiles(files),
    ``,
    `Resolve each so the result keeps the intent of both sides: what main changed and what this plan built.`,
    `If choosing between them needs a judgement, ask the person before you resolve it, as with any other`,
    `decision.`,
    ``,
    `Then:`,
    `  1. Resolve the conflict in the file(s) above.`,
    `  2. git add the resolved file(s) and commit the merge (git commit --no-edit).`,
    `  3. Run ${testStepFor(plan)}.`,
    `     If they fail because of the merge, fix it and commit.`,
    `  4. Report done: \`[pir:v1 kind=done task=${MAIN_SYNC_TASK}]\`, saying whether the tests pass.`,
    ``,
    `You are on ${featureBranch} itself, not a task branch: there is nothing to integrate afterwards, and you`,
    `never merge into main or push.`,
    ``,
  ].join('\n');
}

// The task label the end-of-run test-fix worker reports under (pir-coordinator T10), like MAIN_SYNC_TASK.
export const TESTS_FIX_TASK = 'tests-fix';

// kind 'tests-red' (pir-coordinator T10, DESIGN §2.9 step 1, user 2026-09-27): every task is ✅ but the
// plan's test block fails on the feature branch, at the end gate or after main was merged in. A worker
// spawned in the feature worktree gets one attempt to make it pass, the way a main-sync conflict gets a
// worker. It is only ever sent to a worker. `testsReason` is the gate's one-line reason, `logPath` where
// the full output was written; either may be missing.
function testsRedPrompt({ plan, testsReason, logPath }) {
  const featureBranch = `pir/${plan || '{plan}'}`;
  const why = [];
  if (testsReason) why.push(`  What failed: ${String(testsReason).replace(/\s+/g, ' ').trim()}`);
  if (logPath) why.push(`  Full output: ${logPath}`);
  return [
    `Every task of plan ${plan || '{plan}'} is built and reviewed, but the plan's test block fails on ${featureBranch},`,
    `here in this worktree. Make it pass.`,
    ``,
    ...(why.length ? [...why, ``] : []),
    `An earlier session may have left edits here (a restart during a fix): read \`git status\` and keep what is`,
    `right rather than starting over.`,
    ``,
    `Fix the cause, and only the cause: do not change what any task delivered beyond what the fix needs, and`,
    `never weaken or delete a test to make it pass. If the right fix needs a judgement about what the plan`,
    `should do, ask the person, as with any other decision.`,
    ``,
    `Then:`,
    `  1. Run ${testStepFor(plan)}.`,
    `  2. Commit the fix on ${featureBranch}.`,
    `  3. Report done: \`[pir:v1 kind=done task=${TESTS_FIX_TASK}]\`, saying whether the tests pass. If you`,
    `     cannot make them pass, report \`[pir:v1 kind=question task=${TESTS_FIX_TASK}]\` and ask the person.`,
    ``,
    `You are on ${featureBranch} itself, not a task branch: there is nothing to integrate afterwards, and you`,
    `never merge into main or push. pir reruns the tests after your done; you get one attempt.`,
    ``,
  ].join('\n');
}
