// When a task is waiting on the person (real-asking-state DESIGN §2.1) — one pure predicate that the row,
// the clock and Remote Control all read, so the three cannot disagree about whether the person is needed.

import { reservedFor } from './coordinator-policy.mjs';

const AWAITING = 'awaiting-answer'; // loop.mjs AWAITING: a task parked on its worker's own report
const REQUEST_KINDS = new Set(['permission', 'questions']);

// waitingOn(task, activity) → null | 'question' | 'permission' | 'questions'
//   task:     { phase, decision } from coordinator.state.tasks, or undefined
//   activity: the task's live worker's workerActivity fold, or undefined when pir cannot see the worker
//
// A pending request (a permission prompt or a question set) is what the person must answer now, so it
// outranks the report and names the kind. A report park is only real once the worker has ended the turn
// it dropped the report in: a worker drops the report from inside a turn and then ends that turn with the
// question put to the person, and one that keeps working instead (the T10 incident: auto mode allowed the
// `ask`-bin command with no prompt) is working, whatever it reported. `askEnd` is the result count the
// asking turn ends at (resumeAnswered sets it once and never moves it), so an open turn with
// `turns >= askEnd` is a LATER turn — a background wake-up that answered nothing — and the task stays
// asking: flipping the row and Remote Control for the seconds a wake-up lasts would switch the person's
// phone session off and on under them. An unseen worker (no activity) keeps the parked reading: guessing
// `building` for a worker pir cannot see would hide a real question. A conflict fix pir sent
// (`decision.sent`) asks the person nothing.
export function waitingOn(task, activity) {
  if (REQUEST_KINDS.has(activity?.state)) return activity.state;
  return parkWaiting(task, activity) ? 'question' : null;
}

// Whether the task's report park is waiting on an answer now, whatever request is also pending.
function parkWaiting(task, activity) {
  if (task?.phase !== AWAITING || task.decision?.sent) return false;
  if (!activity) return true;
  const askEnd = task.decision?.askEnd;
  const askingTurnOpen = !!activity.open && (askEnd === undefined || !(activity.turns >= askEnd));
  return !askingTurnOpen;
}

// ---- Who holds a waiting item (pir-coordinator DESIGN §2.3, §2.5, §3.6) ----
//
// The coordinator agent is briefed on every item first. An item is held by the agent from its brief
// until it is answered or passed on; a reserved item (DESIGN §2.4) is briefed for a note but is the
// person's from the start; with no live agent every item is the person's. The shell keeps the set of
// held keys and passes it in, so the rule is one function the row, the clock and Remote Control share.

// itemKey(item) → the key `heldByAgent` is keyed by: `${workerId}:${requestId ?? 'report'}`.
export const itemKey = (item) => `${item.worker}:${item.requestId ?? 'report'}`;

// waitingItems(stateTasks, workers, { askRules }) → T01 `waiting` entries, one per pending request and
// one per report park, for every live worker:
//   { worker, task, kind: 'permission'|'questions'|'report', requestId?, request?, reserved?, text? }
// A report park counts only for the worker holding the task (the one the loop tracks) and only once
// its asking turn has ended, as waitingOn reads it. `reserved` is set, from reservedFor, on a
// permission request the person keeps (DESIGN §2.4); `askRules` are the project's permissions.ask.
export function waitingItems(stateTasks = {}, workers = [], { askRules = [] } = {}) {
  const items = [];
  for (const w of Array.isArray(workers) ? workers : []) {
    if (!w?.live) continue;
    const t = stateTasks?.[w.task];
    items.push(...itemsOf(w.id, w.task, t?.workerId === w.id ? t : undefined, w.activity, askRules));
  }
  return items;
}

// One worker's waiting items; `task` is the tracked task only when this worker holds it.
function itemsOf(worker, taskNum, task, activity, askRules = []) {
  const items = [];
  for (const ev of Array.isArray(activity?.pending) ? activity.pending : []) {
    if (!REQUEST_KINDS.has(ev?.kind) || typeof ev.requestId !== 'string') continue;
    const item = { worker, task: taskNum, kind: ev.kind, requestId: ev.requestId, request: ev };
    if (ev.kind === 'permission') {
      const reserved = reservedFor(ev, askRules);
      if (reserved) item.reserved = reserved;
    }
    items.push(item);
  }
  if (task && activity && parkWaiting(task, activity)) {
    items.push({ worker, task: taskNum, kind: 'report', text: task.decision?.text ?? '' });
  }
  return items;
}

// holderOf(items, heldByAgent) → 'coordinator' | 'person' | null for one worker's waiting items: null
// when nothing waits, 'coordinator' only when the agent holds every one, since a single item the person
// must answer is enough to make the task the person's.
export function holderOf(items, heldByAgent = new Set()) {
  if (!items?.length) return null;
  return items.every((i) => heldByAgent.has(itemKey(i))) ? 'coordinator' : 'person';
}

// waitingFor(task, activity, { workerId, heldByAgent }) → null | { kind, holder }: waitingOn's kind and who
// holds the worker's items. waitingOn keeps returning the kind alone, so every caller that only asks "is
// anyone needed" is unchanged. What pir cannot key (an unseen worker's park, a request with no id seen)
// is the person's.
export function waitingFor(task, activity, { workerId = task?.workerId, heldByAgent = new Set() } = {}) {
  const kind = waitingOn(task, activity);
  if (!kind) return null;
  const items = workerId ? itemsOf(workerId, null, task, activity) : [];
  return { kind, holder: items.length ? holderOf(items, heldByAgent) : 'person' };
}
