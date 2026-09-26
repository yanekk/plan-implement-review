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
  task,
  slug,
  plan = null,
  taskBranch,
  featureBranch,
  files = [],
  audience = 'person',
} = {}) {
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
