// buildConflictPrompt — the ready-to-paste resolution prompt the run offers the PERSON when its own
// merge of a task branch into the feature branch conflicts (DESIGN §2.8). Pure: every input arrives as
// a parameter and it returns a string, so the wording is tested in milliseconds and the core reaches
// for no clock, git or IO (DESIGN § Architecture).
//
// Why a prompt at all. When the coordinator's own `mergeTask` conflicts, the worker that built the
// losing branch has no idea: it integrated cleanly, signalled done, and went idle — the clash is on the
// coordinator's side, and the down-channel that once pushed a decision down to it is gone (§2.2). So the
// person has to reconstruct the whole situation and the git steps by hand before briefing that worker
// (§2.8). This composes that briefing once, so the person copies it, attaches to the named worker, and
// pastes it.
//
// Who picks the side. The worker does: it holds the task's context, and most clashes (two tasks each
// appending rows to FINDINGS.md) have one obvious resolution. The prompt used to carry a `KEEP:` blank for
// the person to fill in before pasting; the person dropped it (user 2026-09-24) — the worker asks when
// the right side is a judgement, like any other decision. The prompt still bakes in no resolution.
//
// The human is the transport (§2.2). This returns text the run prints on its OWN display; it sends
// nothing to the worker and revives no down-channel.
//
// workerName is the `/`-separated session name to attach to (DESIGN §2.9). It is null when no live
// worker holds the task — the restart-reconcile path, where the crashed run's session is gone (§2.6) —
// and the prompt then names the branch to check out and land by hand instead of a worker to re-signal.

// The pasteable block is delimited so the person can select exactly what to copy — plain ASCII markers,
// never box-drawing, because those would be copied into the worker along with the content.
const COPY_START = '----- copy everything between these lines into the worker -----';
const COPY_END = '----- end of the part to paste -----';

export function buildConflictPrompt({
  task,
  slug,
  plan = null,
  workerName = null,
  taskBranch,
  featureBranch,
  files = [],
} = {}) {
  const label = [task, slug].filter(Boolean).join(' ') || 'a task';
  const branchOn = taskBranch ? ` (${taskBranch})` : '';
  const fileList = (files.length ? files : ['(the feature branch)']).map((f) => `  - ${f}`).join('\n');

  // Where the person goes to drive the resolution: the live worker's own session, or — on a restart
  // with no live worker — the task branch, checked out by hand.
  const where = workerName
    ? `Attach to this worker in \`claude agents\` and paste the block below into it:\n\n  ${workerName}`
    : `No live worker holds this task — the run was restarted (DESIGN §2.6). Check out its branch and\n` +
      `paste the block below to a session working on it:\n\n  git checkout ${taskBranch}`;

  // The final step differs by whether a live worker is there to re-signal done: a live worker resolves
  // on its branch and re-signals, and the run merges it on its next pass; with no worker the run has
  // parked the row (⛔) and will not merge it on its own, so the person lands the branch.
  // The tests are the `test` lines of the plan's front-matter block, never a fixed `npm test`: the engine
  // runs projects on any stack, and the gate at the end of the run runs the same lines (DESIGN §2.5).
  // The folder is the PLAN's slug; `slug` is the task's and named a folder that does not exist
  // (plans/red-reason-visible/, declared-test-command T05, 2026-09-24).
  const testStep =
    `the \`test\` lines at the top of plans/${plan || '{plan}'}/DESIGN.md (run its \`setup\` lines\n` +
    `     first if the worktree is not ready)`;
  const finish = workerName
    ? `  4. Signal done again so the run can merge your branch.`
    : `  4. Commit, run the \`test\` lines again, then land this branch yourself — the run has parked it\n` +
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
