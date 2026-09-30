// A planning run's live view as data (plans/pir-plan-command DESIGN §2.8, §2.11). Pure: the snapshot's
// runState (plan-run.mjs planRunState, §3.5), the run's classification, its index record and the reviewed
// plan's PROGRESS.md text go in; the header, one row per step, the footer and the go question come out.
// pir-tui.mjs paints them with the task rows' glyphs and colours, so a step reads like a task.
//
// Why the go question is derived here and not held anywhere: a process waiting on a person would have to
// survive a reboot (§2.8). A finished `reviewed` run with no `go` in its record IS the question; the same
// rule the dashboard's STATE uses (runDisplayState), so the row and the view never disagree.

import { mergeLine } from './coordinator-brief.mjs';
import { planStepState, runDisplayState, singleStepState } from './dashboard.mjs';
import { analyzeParallelism } from './parallelism.mjs';
import { parseProgress } from './progress.mjs';

// Who runs each step, the prototype's second column.
const ROLE = { plan: 'planner', review: 'reviewer', build: '—' };

// The label of an asking step, the same words workerActivity's kinds get on a task row (display.mjs).
const ASKING_TEXT = { questions: 'asking you · a question', question: 'asking you · a question', permission: 'asking you · allow a command?' };

// What a done, failed or pending step says. A pending step names what it waits on.
const DONE_TEXT = { plan: 'plan written', review: 'reviewed' };
const FAILED_TEXT = { plan: 'no plan', review: 'not reviewed' };
const PENDING_TEXT = { plan: 'starting the planner…', review: 'starts when the plan is written', build: 'asks your go after review' };
const ACTIVE_TEXT = { plan: 'planning', review: 'reviewing' };

// The header's state word per display state.
const HEADER_STATE = { planning: 'planning', reviewing: 'reviewing', 'your-go': 'reviewed', finished: 'finished', stopped: 'stopped', crashed: 'crashed' };

// widthLine(progressText) → 'N tasks, longest chain M, up to W can run at once.' from the plan's own
// PROGRESS.md, or null when it cannot be read or has no tasks (the question is still asked without it).
export function widthLine(progressText) {
  if (typeof progressText !== 'string') return null;
  let tasks;
  try {
    tasks = parseProgress(progressText).tasks ?? [];
  } catch {
    return null;
  }
  if (tasks.length === 0) return null;
  const { totalTasks, criticalPathLength, maxWidth } = analyzeParallelism(tasks);
  return `${totalTasks} task${totalTasks === 1 ? '' : 's'}, longest chain ${criticalPathLength}, up to ${maxWidth} can run at once.`;
}

// buildPlanDisplay(runState, { now, record, state, progress }) →
//   { header, rows: [{ id, role, kind, text, clock }], footer, go }
//
//   runState — the snapshot's planning runState, or null before the program wrote one
//   now      — the clock, injected (ms)
//   record   — the index record: { slug, label, branch, go }
//   state    — classifyRun's classification of the run: 'running' | 'finished' | 'stopped' | 'crashed'
//   progress — the reviewed plan's PROGRESS.md text (the shell reads it from the plan's home), for the
//              go question's width line; null or absent → no width line
//
//   header — { name, state, branch }: name is the slug, or the label in quotes before the rename
//   kind   — 'active' | 'asking' | 'done' | 'failed' | 'pending'
//   clock  — elapsed ms for an active or asking step (stopped at stoppedAt while asking, as task rows are),
//            the step's tookMs for a done or failed one (null when not recorded), else null
//   footer — null | { kind: 'asking', step } | { kind: 'build-later', slug, branch } | { kind: 'no-plan', branch }
//            | { kind: 'not-reviewed' } | { kind: 'stale', state }
//   go     — null | { slug, branch, widthLine }: set exactly when runDisplayState reads 'your-go'
export function buildPlanDisplay(runState, { now = null, record = null, state = 'running', progress = null } = {}) {
  const rs = runState ?? null;
  const display = runDisplayState({ state, record: { ...(record ?? {}), kind: 'plan' }, snap: { runState: rs ? { ...rs, kind: 'plan' } : null } });
  const alive = state === 'running';
  const slug = rs?.slug ?? record?.slug ?? null;
  const label = record?.label ?? rs?.label ?? null;
  const branch = record?.branch ?? (slug ? `pir/${slug}` : null);
  const header = { name: label ? `"${label}"` : slug ?? '', state: display === 'asking-you' ? planStepState(rs) : HEADER_STATE[display] ?? display ?? '', branch };

  const steps = rs?.steps ?? [];
  const stepOf = (id) => steps.find((s) => s.id === id) ?? null;
  const outcome = rs?.outcome ?? null;

  const row = (id) => {
    const s = stepOf(id);
    const base = { id, role: ROLE[id] };
    if (id === 'build') {
      if (display === 'your-go') return { ...base, kind: 'asking', text: 'waiting for your go', clock: null };
      if (outcome) return { ...base, kind: 'pending', text: 'not started', clock: null };
      return { ...base, kind: 'pending', text: PENDING_TEXT.build, clock: null };
    }
    const phase = s?.phase ?? (id === 'plan' && !rs ? 'planning' : 'pending');
    // A finished step shows how long it worked, as a ✅ task row shows its time (user, T14 drill).
    if (phase === 'done') return { ...base, kind: 'done', text: DONE_TEXT[id], clock: s?.tookMs ?? null };
    if (phase === 'failed') return { ...base, kind: 'failed', text: FAILED_TEXT[id], clock: s?.tookMs ?? null };
    // A run with an outcome has ended: a step it never reached will not start (a no-plan run's review).
    if (phase === 'pending') return { ...base, kind: 'pending', text: outcome ? 'not started' : PENDING_TEXT[id], clock: null };
    // An active or asking step of a run whose program is gone is stale: it names how the run ended, and
    // its clock is not shown, since nothing is running for it (the dashboard decides crashed, §2.10).
    if (!alive) return { ...base, kind: 'failed', text: state === 'stopped' ? 'stopped' : 'crashed', clock: null };
    const asking = s?.asking ?? (phase === 'asking' ? 'question' : null);
    const until = asking ? s?.stoppedAt ?? now : now;
    const clock = s?.since != null && until != null ? Math.max(0, until - s.since) : null;
    if (asking) return { ...base, kind: 'asking', text: ASKING_TEXT[asking] ?? ASKING_TEXT.question, clock };
    // No snapshot yet: the program has not named its planner (§2.12's `starting the planner…`).
    return { ...base, kind: 'active', text: rs ? ACTIVE_TEXT[id] : PENDING_TEXT.plan, clock };
  };
  const rows = ['plan', 'review', 'build'].map(row);

  let footer = null;
  let go = null;
  if (display === 'your-go') {
    go = { slug, branch, widthLine: widthLine(progress) };
  } else if (!alive && state !== 'finished') {
    footer = { kind: 'stale', state };
  } else if (state === 'finished') {
    if (outcome === 'reviewed') footer = { kind: 'build-later', slug, branch };
    else if (outcome === 'no-plan') footer = { kind: 'no-plan', branch };
    else if (outcome === 'not-reviewed') footer = { kind: 'not-reviewed' };
    else footer = { kind: 'stale', state };
  } else {
    const asking = rows.find((r) => r.kind === 'asking');
    if (asking) footer = { kind: 'asking', step: asking.id };
  }
  return { header, rows, footer, go };
}

// --- A single run's steps view (single-runs DESIGN §2.8) -------------------------------------------------

const SINGLE_ROLE = { build: 'builder', review: 'reviewer', merge: '—' };
const SINGLE_DONE_TEXT = { build: 'built', review: 'reviewed' };
const SINGLE_PENDING_TEXT = { build: 'starting the builder…', review: 'waits on build', merge: 'waits on review' };
const SINGLE_ACTIVE_TEXT = { build: 'building', review: 'reviewing' };
const SINGLE_HEADER_STATE = { 'ready-to-merge': 'ready to merge' };

// buildSingleDisplay(runState, { now, record, state, merged, dropped }) →
//   { header, rows: [{ id, role, kind, text, clock }], footer }
//
//   runState — the snapshot's single runState (single-run.mjs singleRunState), or null before the first one
//   now      — the clock, injected (ms)
//   record   — the index record: { slug, label, branch, baseBranch }
//   state    — classifyRun's classification: 'running' | 'finished' | 'stopped' | 'crashed'
//   merged   — the shell's merged check: the run's branch is in the base
//   dropped  — the body of the `dropped` report, which the shell reads from state.json (the snapshot does
//              not carry it); null when unknown
//
//   rows   — build, review, merge, shaped as buildPlanDisplay's. A step whose tests run reads `testing…`
//            with the test run's clock; a step back at work after a red run reads `tests red · round {n}`.
//            The merge row waits on review, then carries the hand-off line (kind `asking`: it is the
//            person's to run), then `merged`.
//   footer — null | { kind: 'asking', step } | { kind: 'ready', line } | { kind: 'dropped', reason }
//            | { kind: 'stale', state }. `ready` repeats the hand-off line for a frame too narrow to show
//            it whole on the merge row.
export function buildSingleDisplay(runState, { now = null, record = null, state = 'running', merged = false, dropped = null } = {}) {
  const rs = runState ?? null;
  const display = runDisplayState({ state, merged, record: { ...(record ?? {}), kind: 'single' }, snap: { runState: rs ? { ...rs, kind: 'single' } : null } });
  const alive = state === 'running';
  const label = record?.label ?? rs?.label ?? null;
  const name = record?.slug ?? rs?.name ?? null;
  const branch = record?.branch ?? (name ? `pir/${name}` : null);
  const base = rs?.base ?? record?.baseBranch ?? null;
  const headerState = display === 'asking-you' ? singleStepState(rs) : SINGLE_HEADER_STATE[display] ?? display ?? '';
  const header = { name: label ? `"${label}"` : name ?? '', state: headerState, branch };

  const steps = rs?.steps ?? [];
  const outcome = rs?.outcome ?? null;
  // The hand-off (base-branch's text): named by the branch, which after the rename is pir/{name}.
  const line = outcome === 'ready' && base && branch ? mergeLine(base, branch.replace(/^pir\//, '')) : null;

  const row = (id) => {
    const s = steps.find((st) => st.id === id) ?? null;
    const cell = { id, role: SINGLE_ROLE[id] };
    if (id === 'merge') {
      if (display === 'merged') return { ...cell, kind: 'done', text: 'merged', clock: null };
      if (line) return { ...cell, kind: 'asking', text: line, clock: null };
      return { ...cell, kind: 'pending', text: outcome ? 'not started' : SINGLE_PENDING_TEXT.merge, clock: null };
    }
    const phase = s?.phase ?? (id === 'build' && !rs ? 'building' : 'pending');
    if (phase === 'done') return { ...cell, kind: 'done', text: SINGLE_DONE_TEXT[id], clock: s?.tookMs ?? null };
    if (phase === 'failed') return { ...cell, kind: 'failed', text: 'dropped', clock: s?.tookMs ?? null };
    if (phase === 'pending') return { ...cell, kind: 'pending', text: outcome ? 'not started' : SINGLE_PENDING_TEXT[id], clock: null };
    // A working, testing or asking step of a run whose program is gone is stale, as a planning step is.
    if (!alive) return { ...cell, kind: 'failed', text: state === 'stopped' ? 'stopped' : 'crashed', clock: null };
    const elapsed = (from, until) => (from != null && until != null ? Math.max(0, until - from) : null);
    const asking = s?.asking ?? (phase === 'asking' ? 'question' : null);
    if (asking) return { ...cell, kind: 'asking', text: ASKING_TEXT[asking] ?? ASKING_TEXT.question, clock: elapsed(s?.since, s?.stoppedAt ?? now) };
    // The session waits on pir here, not on the person (§2.9), and the clock is the test run's own.
    if (phase === 'testing') return { ...cell, kind: 'active', text: 'testing…', clock: elapsed(s?.testingSince ?? s?.since, now) };
    const round = s?.round ?? 0;
    const text = !rs ? SINGLE_PENDING_TEXT.build : round > 0 ? `tests red · round ${round}` : SINGLE_ACTIVE_TEXT[id];
    return { ...cell, kind: 'active', text, clock: elapsed(s?.since, now) };
  };
  const rows = ['build', 'review', 'merge'].map(row);

  let footer = null;
  if (!alive && state !== 'finished') {
    footer = { kind: 'stale', state };
  } else if (state === 'finished') {
    if (outcome === 'dropped') footer = { kind: 'dropped', reason: firstLine(dropped) };
    else if (outcome !== 'ready') footer = { kind: 'stale', state };
    else if (display !== 'merged' && line) footer = { kind: 'ready', line };
  } else {
    const asking = rows.find((r) => r.kind === 'asking' && r.id !== 'merge');
    if (asking) footer = { kind: 'asking', step: asking.id };
  }
  return { header, rows, footer };
}

// The first non-empty line of a report body, or null.
function firstLine(text) {
  if (typeof text !== 'string') return null;
  return text.split('\n').map((l) => l.trim()).find((l) => l !== '') ?? null;
}
