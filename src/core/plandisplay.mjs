// A planning run's live view as data (plans/pir-plan-command DESIGN §2.8, §2.11). Pure: the snapshot's
// runState (plan-run.mjs planRunState, §3.5), the run's classification, its index record and the reviewed
// plan's PROGRESS.md text go in; the header, one row per step, the footer and the go question come out.
// pir-tui.mjs paints them with the task rows' glyphs and colours, so a step reads like a task.
//
// Why the go question is derived here and not held anywhere: a process waiting on a person would have to
// survive a reboot (§2.8). A finished `reviewed` run with no `go` in its record IS the question; the same
// rule the dashboard's STATE uses (runDisplayState), so the row and the view never disagree.

import { runDisplayState } from './dashboard.mjs';
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
//            else null
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
  const header = { name: label ? `"${label}"` : slug ?? '', state: HEADER_STATE[display] ?? display ?? '', branch };

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
    if (phase === 'done') return { ...base, kind: 'done', text: DONE_TEXT[id], clock: null };
    if (phase === 'failed') return { ...base, kind: 'failed', text: FAILED_TEXT[id], clock: null };
    if (phase === 'pending') return { ...base, kind: 'pending', text: PENDING_TEXT[id], clock: null };
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
