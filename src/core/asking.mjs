// When a task is waiting on the person (real-asking-state DESIGN §2.1) — one pure predicate that the row,
// the clock and Remote Control all read, so the three cannot disagree about whether the person is needed.

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
  if (task?.phase !== AWAITING || task.decision?.sent) return null;
  if (!activity) return 'question';
  const askEnd = task.decision?.askEnd;
  const askingTurnOpen = !!activity.open && (askEnd === undefined || !(activity.turns >= askEnd));
  return askingTurnOpen ? null : 'question';
}
