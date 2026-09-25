// The live-display model (DESIGN §2.3, §3.1, §3.3). Pure: it turns the run state a pass produces —
// the tasks, the phase each worker is in, the counts and the ceiling — into the rows, summary and
// footer the terminal renderer paints (src/shell/render.mjs). It holds no clock and no I/O: the
// current time and the spinner frame arrive as arguments, so the whole status vocabulary and the
// counts are checkable in milliseconds without a terminal (DESIGN §2.3's reason for the split).
//
// The shape it produces was confirmed with the person against prototype/cli-display.html (2026-09-19):
// one row per task styled after `docker compose up`, a summary line, a ceiling pill, an asking-you
// footer, and the git-merge hand-off. The renderer owns the glyph characters and the in-place painting;
// this model carries only `kind` (a rule a person can check) and the data each row needs.

// A task is done once its row on the feature branch is ✅ (DESIGN §2.4: the run folds a merged task
// to ✅ there). The model is handed `done` as a boolean, so this glyph never leaks into the pure side;
// it is only the documented meaning of that boolean.
const DONE_GLYPH = '✅';

// The phases a live worker can be in, in display terms (the shell maps the loop's own phase names onto
// these before handing them in). Each is one row `kind`; `asking` is the parked-on-the-person state
// (DESIGN §2.2, §2.5 — a hands-on check is a worker asking you, not a separate state). These are the
// "active" kinds: a task in any of them holds a slot under the ceiling. `preparing` is the plan's setup
// lines running in a fresh task worktree before its implementer is spawned (DESIGN §2.4): it holds the
// slot it is about to use, and shows as active so an `npm ci` does not read as a stalled screen.
const ACTIVE_PHASES = new Set(['preparing', 'building', 'reviewing', 'merging', 'asking']);

// The human label per active phase. `asking` reads "asking you" because the person is the one being
// asked (§2.2). The other kinds read as their phase.
const PHASE_LABEL = {
  preparing: 'preparing',
  building: 'building',
  reviewing: 'reviewing',
  merging: 'merging',
  asking: 'asking you',
};

// A coordinator-side merge conflict is the one asking state that carries a prompt (T14). Since
// live-workers T08 the prompt is sent to the live worker when there is one (`conflictSent`): that task is
// being fixed and asks nothing of the person (§2.10). Only an unsent one waits on the person's paste.
function isConflict(t) {
  return t.phase === 'asking' && !!t.prompt && !t.conflictSent;
}
function isFixingConflict(t) {
  return t.phase === 'asking' && !!t.prompt && !!t.conflictSent;
}

// buildDisplay(runState, { now, spinnerFrame }) → { summary, rows, footer } (DESIGN §2.3).
//
// runState (a pass's output, assembled by the shell):
//   { branch, ceiling, complete?, readyToMerge?, testsReason?, testing?, interrupted?, tasks: [task…] }
//   testsReason: { reason, logPath } from the red end gate, or null (green, unfinished, an old snapshot).
//   testing: { since:ms } while the end gate runs the plan's setup and test lines on the finished feature
//            branch, else null. Every task is merged by then, so without it the screen reads as done for
//            the minutes the suite takes (user 2026-09-25).
//   task: { id, slug, deps:[id…], done:bool, phase:null|'preparing'|'building'|'reviewing'|'merging'|'asking',
//           since:ms|null, doneMs:ms|null, question:string|null, prompt:string|null, conflictSent?:bool }
//     phase   — set when a live worker holds the task; null when no worker does. An `asking` task that
//               carries a `prompt` is a merge conflict and shows as row/footer kind `conflict`.
//     since   — when the current phase began, for the elapsed clock (now − since).
//     doneMs  — the final duration to show on a ✅ row, or null if the run never timed it.
//     question— the parked worker's rendered question, shown on the asking row's footer.
//     prompt  — the copy-paste resolution prompt for a merge conflict the run hit at its own merge
//               (buildConflictPrompt, T14). Carried on the `conflict` footer as DATA. The bounded live
//               block does not paint this multi-line block (it would clip and re-open the T15 wrap bug);
//               `pir`'s watch view draws it under the block, and the coordinator prints it once on its
//               normal screen (coordinate.mjs). It rides in the model so the vocabulary stays testable without a
//               terminal, and null for an ordinary question (only a coordinator-side conflict has one).
//     conflictSent — the prompt went to the task's live worker (live-workers §2.10): row kind
//               `fixing-conflict` in the active style, counted as running, no footer.
//
// opts.now is the current time in ms (the clock, injected — never read here, §3.1). opts.spinnerFrame
// is accepted for signature symmetry with the renderer but not used by the model: the spinner glyph is
// the renderer's, the model carries `kind` (DESIGN §2.3).
export function buildDisplay(runState, { now, spinnerFrame } = {}) {
  const { branch, ceiling, complete = false, readyToMerge = false, testsReason = null, testing = null, interrupted = false, tasks = [] } =
    runState ?? {};

  const doneIds = new Set(tasks.filter((t) => t.done).map((t) => t.id));
  const running = tasks.filter((t) => !t.done && ACTIVE_PHASES.has(t.phase)).length;
  const ceilingFull = ceiling != null && running >= ceiling;

  const rows = tasks.map((t) => rowFor(t, { now, doneIds, ceilingFull }));

  const done = doneIds.size;
  const total = tasks.length;
  const asking = tasks.filter((t) => !t.done && t.phase === 'asking' && !isConflict(t) && !isFixingConflict(t)).length;
  const conflicts = tasks.filter((t) => !t.done && isConflict(t)).length;
  // A run whose tasks are all merged is not finished while its end gate is still running.
  const finished = complete || (!testing && total > 0 && done === total);
  const summary = {
    done,
    total,
    running,
    asking,
    conflicts,
    waiting: total - done - running,
    ceiling: ceiling ?? null,
    ceilingFull,
    finished,
  };

  // `branch` rides at the top level beside summary/rows/footer: the renderer shows the run's branch in
  // its header line on every paint, but the footer only carries a branch in some states (handoff, red),
  // so the summary line cannot source it from there. It is the one field added to the interface sketch.
  return { branch: branch ?? null, summary, rows, footer: footerFor({ tasks, complete, readyToMerge, testsReason, testing, interrupted, branch, now }) };
}

// One row for one task. The order of the checks is the priority: a ✅ task is done however it got there;
// otherwise a live worker's phase names the row; otherwise the task is idle and the reason (an unmet
// dependency, or a full ceiling) is what the row shows.
function rowFor(t, { now, doneIds, ceilingFull }) {
  const base = { id: t.id, slug: t.slug };

  if (t.done) {
    return { ...base, kind: 'done', label: 'merged', elapsedMs: t.doneMs ?? null };
  }

  if (ACTIVE_PHASES.has(t.phase)) {
    const elapsedMs = t.since != null && now != null ? now - t.since : null;
    // A task parked on a merge conflict the run hit at its own merge is not a worker asking anything:
    // its worker has stopped and does not know. It reads `merge conflict` (orange, user 2026-09-24) so the
    // person looks for the paste-in prompt instead of attaching to wait for a question that never comes.
    if (isConflict(t)) return { ...base, kind: 'conflict', label: 'merge conflict', elapsedMs };
    // The worker was sent the fix and is working on it: nothing for the person to do (§2.10).
    if (isFixingConflict(t)) return { ...base, kind: 'fixing-conflict', label: 'fixing conflict', elapsedMs };
    return { ...base, kind: t.phase, label: PHASE_LABEL[t.phase], elapsedMs };
  }

  // Idle: not started and no worker holds it. Name the unmet dependencies if any, else it is ready and
  // simply queued behind the ceiling (DESIGN §2.3: `waiting` names which dep, `queued` means ready-but-full).
  const unmet = (t.deps ?? []).filter((d) => !doneIds.has(d));
  if (unmet.length > 0) {
    return { ...base, kind: 'waiting', label: `needs ${unmet.join(', ')}`, elapsedMs: null };
  }
  return {
    ...base,
    kind: 'queued',
    label: ceilingFull ? 'queued · ceiling full' : 'queued',
    elapsedMs: null,
  };
}

// The footer, in priority order (DESIGN §2.3, §2.4, §2.8): an interrupted run first (Ctrl-C), then a
// parked worker the person must answer, then the end-of-run hand-off (green) or failure (red), then the
// end gate still running (`testing`), else the plain running line. `asking` beats `handoff`/`red` because a complete run has nothing asking, so the
// two never contend; the order only makes the intent explicit.
function footerFor({ tasks, complete, readyToMerge, testsReason, testing, interrupted, branch, now }) {
  if (interrupted) return { kind: 'interrupted' };

  // A worker fixing a conflict it was sent asks nothing, so it never takes the footer (§2.10).
  const asking = tasks.find((t) => !t.done && t.phase === 'asking' && !isFixingConflict(t));
  if (asking) {
    // A merge conflict the run hit at its own merge carries a copy-paste resolution prompt (T14) and
    // gets its own footer kind; an ordinary question keeps the unchanged `asking` shape with no prompt key.
    if (isConflict(asking)) {
      return { kind: 'conflict', task: asking.id, slug: asking.slug, question: asking.question ?? '', prompt: asking.prompt };
    }
    return { kind: 'asking', task: asking.id, slug: asking.slug, question: asking.question ?? '' };
  }

  if (complete) {
    if (readyToMerge) return { kind: 'handoff', branch };
    // The red footer says why and where the output is (DESIGN §2.8); both null for a snapshot written
    // before the gate carried them.
    return { kind: 'red', branch, reason: testsReason?.reason ?? null, logPath: testsReason?.logPath ?? null };
  }
  if (testing) {
    const elapsedMs = testing.since != null && now != null ? now - testing.since : null;
    return { kind: 'testing', branch, elapsedMs };
  }
  return { kind: 'running' };
}
