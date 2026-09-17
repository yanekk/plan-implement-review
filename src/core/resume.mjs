// decideResume — the pure decision at the heart of the restart-resume fix (DESIGN §2.3, §3.3).
// A restart cannot trust the feature-branch PROGRESS.md: it advances a task past ⬜ only at
// merge, so a task built (🔍) or built-and-reviewed (✅) on its own task branch but not yet
// merged still reads ⬜ there and would be rebuilt from scratch. Git is the ground truth. This
// function takes the parsed feature task table and, for each task, the committed glyph on its
// own task branch, and decides one action per task: merge the finished branch, review the built
// one, or rebuild the half-done one. It touches no git and no filesystem — the shell (src/shell/,
// T03) reads the branch glyphs and executes these actions — which is what lets the whole four-way
// classification be proven in milliseconds and lets the old "every ⬜ is a fresh implement" redden
// a test (DESIGN §3.1, enforced by boundary.test.mjs).

// The glyph vocabulary, named so the intent reads at the call site rather than a bare emoji.
// READY is the only feature-row state reconciliation acts on: the coordinator is the single
// writer of the feature branch and advances a row to ✅ only at merge, so mid-flight a feature
// row reads ⬜ and every other feature state (✅ merged, ⛔ deferred, and 🟡/🔍 which the feature
// branch never carries) is terminal or impossible and produces no reconciliation entry (DESIGN §2.2).
const READY = '⬜';
const REVIEWED = '✅';
const REVIEW_READY = '🔍';

// The numeric order of a task id ("T05" → 5), for the "sorted by task number" the interface promises.
function order(id) {
  return Number(String(id).slice(1));
}

// decideResume({ featureTasks, branchStates }) → { merge, review, rebuild }, each a list of task
// numbers sorted by number. The four-way classification of DESIGN §2.3, for feature-⬜ tasks only:
//
//   branch ✅            → merge   (built and reviewed; fold it in, do not rebuild or re-review)
//   branch 🔍            → review  (built, not reviewed; a fresh review, not a re-implement)
//   branch present, else → rebuild (⬜/🟡/anything but ✅/🔍; half-built, discard and re-implement)
//   branch absent (null) → no entry (never started; the normal dispatch implements it)
//
// implement (absent branch) and skip (feature ✅/⛔) produce no entry: normal dispatch handles the
// first and nothing is to be done for the second. A worker never writes ⛔ on its own branch, so a
// ⛔ branch glyph is just "present and not ✅/🔍" → rebuild, which the else clause gives for free; no
// Runs-specific branch is needed either, because a you/verify branch has no 🔍 stage (DESIGN §2.3).
export function decideResume({ featureTasks, branchStates }) {
  const merge = [];
  const review = [];
  const rebuild = [];

  for (const task of featureTasks) {
    // Only a feature ⬜ row is in flight and reconcilable; ✅/⛔ (and any state the feature branch
    // cannot carry) are terminal, so they are skipped with no entry in any list.
    if (task.state !== READY) continue;

    const branch = branchStates[task.num] ?? null;
    if (branch === null) continue; // never started — normal dispatch implements it, not reconciliation.

    if (branch === REVIEWED) merge.push(task.num);
    else if (branch === REVIEW_READY) review.push(task.num);
    else rebuild.push(task.num); // present but neither ✅ nor 🔍 → half-built, rebuild clean.
  }

  const byTask = (a, b) => order(a) - order(b);
  return { merge: merge.sort(byTask), review: review.sort(byTask), rebuild: rebuild.sort(byTask) };
}
